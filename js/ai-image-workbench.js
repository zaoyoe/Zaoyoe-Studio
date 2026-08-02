(function (global) {
    'use strict';

    if (global.AIImageWorkbench) {
        return;
    }

    const STORAGE_KEY = 'zaoyoe_ai_image_workbench_state_v1';
    const USER_STORAGE_PREFIX = `${STORAGE_KEY}:user:`;
    const API_SCOPE_PATH = '/api/public?scope=ai-image';
    const API_REQUEST_TIMEOUT_MS = 45000;
    const CANNOT_CANCEL_CHARGED_MESSAGE = '任务已进入上游生成阶段，可能已产生扣费，无法取消。';
    const ORIGINAL_READY_POLL_LIMIT = 80;
    const VIDEO_LOAD_RETRY_DELAY_MS = 1000;
    const VIDEO_ERROR_CONFIRMATION_MS = 30000;
    const RELOADABLE_BILLING_RECORD_MIN_AGE_MS = 5 * 60 * 1000;
    const INCOMPLETE_SUCCEEDED_IMAGE_RESULT_GRACE_MS = 5 * 60 * 1000;
    const MAX_REFERENCE_IMAGE_INPUTS = 16;
    const MAX_CHAT_ATTACHMENT_COUNT = 8;
    const MAX_CHAT_ATTACHMENT_TEXT_CHARS = 50000;
    const MAX_CHAT_ATTACHMENT_TOTAL_CHARS = 120000;
    const MAX_CHAT_ATTACHMENT_FILE_BYTES = 8 * 1024 * 1024;
    const CHAT_DOCUMENT_ACCEPT = '.txt,.md,.csv,.json,.html,.htm,.xml,.log,.pdf,text/*,application/pdf,application/json,text/markdown,text/csv,text/html,text/xml';
    const CHAT_ATTACHMENT_ACCEPT = `image/*,${CHAT_DOCUMENT_ACCEPT}`;
    const WORKBENCH_NARROW_QUERY = '(max-width: 1120px)';
    const CHAT_NAVIGATION_MIN_ITEMS = 2;
    const CHAT_STAGE_BOTTOM_STICKY_THRESHOLD_PX = 96;
    const CHAT_STREAM_PROGRESSIVE_THRESHOLD_CHARS = 48;
    const CHAT_STREAM_PROGRESSIVE_FIRST_CHARS = 18;
    const CHAT_STREAM_PROGRESSIVE_MAX_FRAMES = 10;
    const CHAT_STREAM_PROGRESSIVE_TARGET_CHARS = 48;
    const CHAT_STREAM_PERSIST_DELAY_MS = 120;
    const MOBILE_HISTORY_PANEL_COMPOSER_GAP_PX = 12;
    const PDFJS_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
    const PDFJS_WORKER_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    const MAX_LOCAL_TASKS = 40;
    const BUSY_CLIENT_TASK_RECOVERY_DELAY_MS = 5000;
    const BUSY_CLIENT_TASK_RECOVERY_INTERVAL_MS = 7000;
    const DEFERRED_IMAGE_BATCH_SIZE = 2;
    const DEFERRED_IMAGE_BATCH_DELAY_MS = 520;
    const REMOTE_RECORDS_POLL_DEFAULT_MS = 2200;
    const REMOTE_RECORDS_POLL_FAST_MS = 700;
    const REMOTE_RECORDS_POLL_WARM_MS = 1200;
    const REMOTE_RECORDS_FAST_POLL_ROUNDS = 48;
    const REMOTE_RECORDS_FAST_POLL_FAST_ROUNDS = 6;
    const DEFAULT_API_BASE_PROFILES = Object.freeze([
        { id: 'fatherkey', label: 'FatherKey', baseUrl: 'https://sub2api.fatherkey.com/v1' },
        { id: 'zaoyoe', label: 'Zaoyoe', baseUrl: 'https://sub2api.zaoyoe.xyz/v1' }
    ]);
    let runtimeApiBaseProfiles = DEFAULT_API_BASE_PROFILES.slice();

    const API_TEXT_MODELS = Object.freeze([
        { id: 'gpt-4.1-api', label: 'GPT-4.1 Chat' },
        { id: 'gemini-2.5-api', label: 'Gemini 2.5 Chat' },
        { id: 'claude-sonnet-api', label: 'Claude Sonnet' }
    ]);

    const API_IMAGE_MODELS = Object.freeze([
        { id: 'gemini-image-api', label: 'Gemini Image' },
        { id: 'gpt-image-api', label: 'GPT Image' },
        { id: 'flux-pro-api', label: 'FLUX Pro' }
    ]);
    let runtimeApiTextModels = API_TEXT_MODELS.slice();
    let runtimeApiImageModels = API_IMAGE_MODELS.slice();
    let runtimeApiVideoModels = [];
    let runtimeApiModelProviders = [];
    let runtimeApiModelsLockedToDiscovery = false;
    let runtimeAdminTextModels = [];
    let runtimeAdminImageModels = [];
    let runtimeAdminVideoModels = [];
    let runtimeAdminModelProviders = [];
    let runtimeAdminModelsConfigured = false;
    let runtimeApiModelCacheByBaseUrl = {};

    function isTextVisionMode(mode = '') {
        return mode === 'chat' || mode === 'reverse';
    }

    function isVideoMode(mode = '') {
        return mode === 'video';
    }

    function isImageGenerationMode(mode = '') {
        return mode === 'text' || mode === 'image';
    }

    function isTextVisionTask(task = {}) {
        return isTextVisionMode(task?.mode || '');
    }

    function isBusyTask(task = {}) {
        return ['queued', 'processing', 'streaming'].includes(task?.status);
    }

    function isTaskPastCancelableGenerationStage(task = {}) {
        if (!task || isTextVisionTask(task)) return false;
        return normalizeTaskStatus(task.status) === 'processing';
    }

    function getDefaultApiProfile() {
        const host = String(global.location?.hostname || '').toLowerCase();
        return host.includes('zaoyoe') ? 'zaoyoe' : 'fatherkey';
    }

    function getDefaultApiBaseUrl() {
        const profile = runtimeApiBaseProfiles.find((item) => item.id === getDefaultApiProfile())
            || runtimeApiBaseProfiles[0]
            || DEFAULT_API_BASE_PROFILES[0];
        return profile.baseUrl;
    }

    const DEFAULT_STATE = Object.freeze({
        open: false,
        billingMode: '',
        apiBaseUrl: getDefaultApiBaseUrl(),
        apiKey: '',
        storedApiKeys: [],
        apiImageTool: false,
        pointsTextModel: '',
        pointsVideoModel: '',
	        apiTextModel: 'gpt-4.1-api',
	        apiImageModel: 'gemini-image-api',
	        apiVideoModel: '',
	        chatMemoryMode: 'fast',
	        chatReasoningEffort: 'auto',
	        chatGeminiThinkingLevel: 'medium',
	        chatClaudeThinkingBudget: '1024',
	        chatServiceTier: 'unset',
	        chatThinkingMode: 'disabled',
	        chatFastDefaultsVersion: 1,
	        verifiedKimiThinkingModels: [],
	        chatImageInput: 'auto',
        mode: 'text',
        ratio: '1:1',
        resolution: '1k',
        videoRatio: 'adaptive',
        videoResolution: '720p',
        videoDuration: '5',
        videoAudio: 'true',
        videoWatermark: 'false',
        videoCameraFixed: 'false',
        model: 'gpt-image',
        quantity: 2,
        prompt: '',
        referenceImage: '',
        referenceTitle: '',
        referenceIntent: '',
        referenceImages: [],
        chatAttachments: [],
        continuationImage: null,
        composerError: '',
        activeTaskId: '',
        historyPrefsRemoteSynced: false,
        historyPrefs: {
            deletedTaskIds: [],
            pinnedTaskIds: [],
            taskAccentById: {}
        },
        tasks: []
    });

    const MODE_META = Object.freeze({
        chat: { label: '文本对话', sub: '流式对话', icon: 'fa-comments', cost: 0 },
        text: { label: '文生图', sub: '从文字开始', icon: 'fa-wand-magic-sparkles', cost: 8 },
        video: { label: '生成视频', sub: '文字生成视频', icon: 'fa-film', cost: 60 },
        image: { label: '图像发散', sub: '参考图创作', icon: 'fa-images', cost: 12 },
        reverse: { label: '反推提示词', sub: '图片转描述', icon: 'fa-quote-left', cost: 0 }
    });

    const PRICING_MODE_ALIASES = Object.freeze({
        image: 'text',
        agent: 'text',
        reverse: 'chat'
    });

    const HISTORY_ACCENTS = Object.freeze([
        { id: 'blue', label: '蓝色' },
        { id: 'green', label: '绿色' },
        { id: 'gold', label: '金色' },
        { id: 'rose', label: '玫红' }
    ]);
	    const CHAT_MEMORY_OPTIONS = Object.freeze([
        {
            id: 'fast',
            label: '速度优先',
            shortLabel: '快',
            messageLimit: 4,
            tokenBudget: 4000,
            hint: '首 token 更快，仅保留最近两轮上下文'
        },
        {
            id: 'recent',
            label: '最近 16 条',
            shortLabel: '16 条',
            messageLimit: 16,
            tokenBudget: 16000,
            hint: '兼顾连续性和等待时间'
        },
        {
            id: 'model',
            label: '尽量模型窗口',
            shortLabel: '长记忆',
            messageLimit: 80,
            tokenBudget: 48000,
            hint: '上下文更完整，但首 token 会变慢'
        }
	    ]);
	    const OPENAI_REASONING_EFFORT_OPTIONS = Object.freeze([
	        { id: 'auto', label: 'auto', shortLabel: 'auto', hint: '不额外指定 reasoning.effort，使用模型默认设置' },
	        { id: 'minimal', label: 'minimal', shortLabel: 'minimal', hint: 'OpenAI reasoning.effort 官方值，优先速度' },
	        { id: 'low', label: 'low', shortLabel: 'low', hint: 'OpenAI reasoning.effort 官方值' },
	        { id: 'medium', label: 'medium', shortLabel: 'medium', hint: 'OpenAI reasoning.effort 官方值' },
	        { id: 'high', label: 'high', shortLabel: 'high', hint: 'OpenAI reasoning.effort 官方值，等待可能更久' },
	        { id: 'xhigh', label: 'xhigh', shortLabel: 'xhigh', hint: 'OpenAI 最高推理强度，等待和消耗都会增加' }
	    ]);
	    const OPENAI_SERVICE_TIER_OPTIONS = Object.freeze([
	        { id: 'unset', label: '默认', shortLabel: '默认', hint: '使用项目或上游默认服务档位' },
	        { id: 'auto', label: 'auto', shortLabel: 'auto', hint: 'OpenAI service_tier 官方值' },
	        { id: 'default', label: 'default', shortLabel: 'default', hint: 'OpenAI service_tier 官方值' },
	        { id: 'flex', label: 'flex', shortLabel: 'flex', hint: 'OpenAI service_tier 官方值，可能等待更久' },
	        { id: 'priority', label: 'priority', shortLabel: 'priority', hint: 'OpenAI service_tier 官方值，优先响应' }
	    ]);
	    const DEEPSEEK_REASONING_EFFORT_OPTIONS = Object.freeze([
	        { id: 'auto', label: 'auto', shortLabel: 'auto', hint: '不额外指定 reasoning_effort，使用 DeepSeek 默认设置' },
	        { id: 'high', label: 'high', shortLabel: 'high', hint: 'DeepSeek reasoning_effort 官方值' },
	        { id: 'max', label: 'max', shortLabel: 'max', hint: 'DeepSeek reasoning_effort 官方值，等待可能更久' }
	    ]);
	    const GLM_REASONING_EFFORT_OPTIONS = Object.freeze([
	        { id: 'auto', label: 'auto', shortLabel: 'auto', hint: '不额外指定推理强度，使用 GLM 默认设置' },
	        { id: 'high', label: 'high', shortLabel: 'high', hint: 'GLM 官方推理强度，适合一般复杂任务' },
	        { id: 'max', label: 'max', shortLabel: 'max', hint: 'GLM 官方最高推理强度，等待可能更久' }
	    ]);
	    const XAI_REASONING_EFFORT_OPTIONS = Object.freeze([
	        { id: 'auto', label: 'auto', shortLabel: 'auto', hint: '不额外指定 reasoning_effort，使用 Grok 默认设置' },
	        { id: 'none', label: 'none', shortLabel: 'none', hint: 'xAI reasoning_effort 官方值' },
	        { id: 'low', label: 'low', shortLabel: 'low', hint: 'xAI reasoning_effort 官方值' },
	        { id: 'medium', label: 'medium', shortLabel: 'medium', hint: 'xAI reasoning_effort 官方值' },
	        { id: 'high', label: 'high', shortLabel: 'high', hint: 'xAI reasoning_effort 官方值，等待可能更久' }
	    ]);
	    const GEMINI_THINKING_LEVEL_OPTIONS = Object.freeze([
	        { id: 'minimal', label: 'minimal', shortLabel: 'minimal', hint: 'Gemini thinking_level 官方值，优先速度' },
	        { id: 'low', label: 'low', shortLabel: 'low', hint: 'Gemini thinking_level 官方值' },
	        { id: 'medium', label: 'medium', shortLabel: 'medium', hint: 'Gemini thinking_level 官方值' },
	        { id: 'high', label: 'high', shortLabel: 'high', hint: 'Gemini thinking_level 官方值，等待可能更久' }
	    ]);
	    const GROK_THINKING_OPTIONS = Object.freeze([
	        { id: 'disabled', label: '关闭', shortLabel: '关闭', hint: '关闭 Grok 思考模式，直接回答' },
	        { id: 'enabled', label: '思考', shortLabel: '思考', hint: '开启 Grok 思考模式并展示思考过程' }
	    ]);
	    const OPENAI_THINKING_OPTIONS = Object.freeze([
	        { id: 'disabled', label: '关闭', shortLabel: '关闭', hint: '关闭 OpenAI 推理模式，直接回答' },
	        { id: 'enabled', label: '思考', shortLabel: '思考', hint: '开启 OpenAI 推理模式并展示官方思考摘要' }
	    ]);
	    const GEMINI_THINKING_OPTIONS = Object.freeze([
	        { id: 'disabled', label: '关闭', shortLabel: '关闭', hint: '关闭 Gemini 思考展示，直接回答' },
	        { id: 'enabled', label: '思考', shortLabel: '思考', hint: '开启 Gemini 思考模式并展示思考过程' }
	    ]);
	    const CLAUDE_THINKING_BUDGET_OPTIONS = Object.freeze([
	        { id: '1024', label: 'low', shortLabel: 'low', hint: 'Claude 官方最低思考预算，1024 tokens' },
	        { id: '4096', label: 'medium', shortLabel: 'medium', hint: 'Claude 官方思考预算，4096 tokens' },
	        { id: '16000', label: 'high', shortLabel: 'high', hint: 'Claude 官方较高思考预算，16000 tokens，等待和成本都会增加' }
	    ]);
	    const DEEPSEEK_THINKING_OPTIONS = Object.freeze([
	        { id: 'enabled', label: '展示思考', shortLabel: '展示', hint: '展示 DeepSeek 的思考过程' },
	        { id: 'disabled', label: '直接回答', shortLabel: '直答', hint: '不展示思考过程，直接给出回答' },
	        { id: 'unset', label: '模型默认', shortLabel: '默认', hint: '使用 DeepSeek 的默认思考设置' }
	    ]);
	    const KIMI_THINKING_OPTIONS = Object.freeze([
	        { id: 'enabled', label: '展示思考', shortLabel: '展示', hint: '展示 Kimi 的思考过程' },
	        { id: 'disabled', label: '直接回答', shortLabel: '直答', hint: '不展示思考过程，直接给出回答' },
	        { id: 'unset', label: '模型默认', shortLabel: '默认', hint: '使用 Kimi 的默认思考设置' }
	    ]);
	    const CLAUDE_THINKING_OPTIONS = Object.freeze([
	        { id: 'enabled', label: '思考', shortLabel: '思考', hint: '展示 Claude Extended Thinking 思考过程' },
	        { id: 'disabled', label: '关闭', shortLabel: '关闭', hint: '关闭 Claude 思考过程，直接回答' },
	        { id: 'unset', label: '默认', shortLabel: '默认', hint: '使用 Claude 的默认思考设置' }
	    ]);
	    const QWEN_ENABLE_THINKING_OPTIONS = Object.freeze([
	        { id: 'enabled', label: '思考', shortLabel: '思考', hint: '展示 Qwen 思考过程' },
	        { id: 'disabled', label: '关闭', shortLabel: '关闭', hint: '关闭 Qwen 思考过程展示，直接回答' },
	        { id: 'unset', label: '默认', shortLabel: '默认', hint: '不额外指定 Qwen 思考模式，使用模型默认设置' }
	    ]);
	    const GLM_THINKING_OPTIONS = Object.freeze([
	        { id: 'enabled', label: '思考', shortLabel: '思考', hint: '开启 GLM 思考模式并展示思考过程' },
	        { id: 'disabled', label: '关闭', shortLabel: '关闭', hint: '关闭 GLM 思考模式，直接回答' },
	        { id: 'unset', label: '默认', shortLabel: '默认', hint: '使用 GLM 默认思考设置' }
	    ]);
	    const MINIMAX_THINKING_OPTIONS = Object.freeze([
	        { id: 'enabled', label: '思考', shortLabel: '思考', hint: '开启 MiniMax 自适应思考并展示思考过程' },
	        { id: 'disabled', label: '关闭', shortLabel: '关闭', hint: '关闭 MiniMax 思考模式，直接回答' },
	        { id: 'unset', label: '默认', shortLabel: '默认', hint: '使用 MiniMax 默认思考设置' }
	    ]);
	    const DOUBAO_THINKING_OPTIONS = Object.freeze([
	        { id: 'enabled', label: '思考', shortLabel: '思考', hint: '开启豆包思考模式并展示思考过程' },
	        { id: 'disabled', label: '关闭', shortLabel: '关闭', hint: '关闭豆包思考模式，直接回答' },
	        { id: 'unset', label: '默认', shortLabel: '默认', hint: '使用豆包默认思考设置' }
	    ]);
	    const OPENAI_IMAGE_INPUT_OPTIONS = Object.freeze([
	        { id: 'auto', label: '允许读图', shortLabel: '读图', hint: '模型支持视觉时，会把图片作为对话输入' },
	        { id: 'off', label: '仅文字', shortLabel: '文字', hint: '只发送文字内容，不发送图片' }
	    ]);
    const CHAT_SETTINGS_CAPABILITY_IDS = Object.freeze(['thinking', 'reasoning', 'geminiThinking', 'claudeThinkingBudget']);

    const RATIO_META = Object.freeze({
        '1:1': { label: '1:1', aspect: '1 / 1' },
        '5:4': { label: '5:4', aspect: '5 / 4' },
        '9:16': { label: '9:16', aspect: '9 / 16' },
        '21:9': { label: '21:9', aspect: '21 / 9' },
        '16:9': { label: '16:9', aspect: '16 / 9' },
        '3:2': { label: '3:2', aspect: '3 / 2' },
        '4:3': { label: '4:3', aspect: '4 / 3' },
        '4:5': { label: '4:5', aspect: '4 / 5' },
        '3:4': { label: '3:4', aspect: '3 / 4' },
        '2:3': { label: '2:3', aspect: '2 / 3' }
    });

    const RESOLUTION_META = Object.freeze({
        '1k': { label: '1K', multiplier: 1 },
        '2k': { label: '2K', multiplier: 1.8 },
        '4k': { label: '4K', multiplier: 3.2 }
    });

    const VIDEO_RATIO_META = Object.freeze({
        adaptive: { label: 'adaptive', aspect: '16 / 9', hint: 'Seedance 2.0 / 1.5 Pro 官方默认：模型自动选择画幅' },
        '16:9': { label: '16:9', aspect: '16 / 9' },
        '4:3': { label: '4:3', aspect: '4 / 3' },
        '1:1': { label: '1:1', aspect: '1 / 1' },
        '3:4': { label: '3:4', aspect: '3 / 4' },
        '9:16': { label: '9:16', aspect: '9 / 16' },
        '21:9': { label: '21:9', aspect: '21 / 9' }
    });

    const VIDEO_RESOLUTION_META = Object.freeze({
        '480p': { label: '480p', hint: 'Seedance 官方视频分辨率' },
        '720p': { label: '720p', hint: 'Seedance 2.0 / 1.5 Pro 官方默认' },
        '1080p': { label: '1080p', hint: 'Seedance 2.0 Fast / Mini 不支持' },
        '4k': { label: '4k', hint: '仅 Seedance 2.0 支持' }
    });

    const VIDEO_DURATION_META = Object.freeze({
        '-1': { label: '智能时长', shortLabel: '智能', hint: 'Seedance 2.0 / 1.5 Pro 官方值：模型在可用范围内自动选择' },
        '4': { label: '4 秒', shortLabel: '4s' },
        '5': { label: '5 秒', shortLabel: '5s' },
        '6': { label: '6 秒', shortLabel: '6s' },
        '8': { label: '8 秒', shortLabel: '8s' },
        '10': { label: '10 秒', shortLabel: '10s' },
        '12': { label: '12 秒', shortLabel: '12s' },
        '15': { label: '15 秒', shortLabel: '15s', hint: 'Seedance 2.0 系列上限；部分模型不支持' }
    });

    const VIDEO_AUDIO_META = Object.freeze({
        true: { label: '有声', shortLabel: '有声', hint: 'generate_audio：Seedance 2.0 / 1.5 Pro 支持同步音频' },
        false: { label: '无声', shortLabel: '无声', hint: 'generate_audio：输出无声视频' }
    });

    const VIDEO_WATERMARK_META = Object.freeze({
        false: { label: '无水印', shortLabel: '无水印', hint: 'watermark：官方默认不添加水印' },
        true: { label: 'AI Generated 水印', shortLabel: '水印', hint: 'watermark：右下角显示 AI Generated 水印' }
    });

    const VIDEO_CAMERA_FIXED_META = Object.freeze({
        false: { label: '不固定镜头', shortLabel: '不固定', hint: 'camera_fixed：官方默认不固定镜头；Seedance 2.0 暂不支持' },
        true: { label: '固定镜头', shortLabel: '固定', hint: 'camera_fixed：部分 Seedance 1.x 模型支持' }
    });

    const MODEL_OPTIONS = Object.freeze([
        { id: 'gpt-image', label: 'GPT Image' },
        { id: 'gemini-image', label: 'Gemini Image' },
        { id: 'grok-imagine', label: 'Grok Imagine' },
        { id: 'flux-pro', label: 'FLUX Pro' }
    ]);

    const state = {
        ...DEFAULT_STATE
    };

    const AI_IMAGE_UPLOAD_API_BASE_URL = 'https://verify-api.fatherkey.com/api/public';

    let referenceUploadBusy = false;
    let pdfJsModulePromise = null;
    let runtimePricingRules = [];
    let remoteConfigLoaded = false;
    let remoteConfigAvailable = false;
    let remoteConfigPromise = null;
    let remoteRecordsLoaded = false;
    let remoteHistoryPrefsLoaded = false;
    let modelDiscoveryState = {
        loading: false,
        message: '',
        tone: ''
    };
    let modelPricingView = {
        open: false,
        loading: false,
        loaded: false,
        error: '',
        tab: 'chat',
        textPrices: [],
        providerStatuses: []
    };
    let historyPrefsSyncInFlight = 0;
    let historyPrefsMutationSerial = 0;
    let activitySummary = {
        apiTokens: 0,
        apiCalls: 0,
        downloads: 0
    };
    let root = null;
    let overlay = null;
    let dock = null;
    let nativeToggle = null;
    let remotePollTimer = null;
    let remotePollDueAt = 0;
    let remoteFastPollsRemaining = 0;
    let liveElapsedTimer = null;
    let deferredImageLoadTimer = null;
    let openSelect = '';
    let openImageSettingsSection = 'ratio';
    let openVideoSettingsSection = 'videoRatio';
    let openChatSettingsSection = 'memory';
    let openModelProvider = '';
    let sidebarView = '';
    let sidebarEnteredView = '';
    let historySelectionMode = false;
    let historySearchQuery = '';
    let selectedHistoryTaskIds = new Set();
    let seenTaskIds = new Set();
    let openHistoryAccentMenu = false;
    let currentAuthSession = null;
    const loadedImageUrls = new Set();
    const failedImageUrls = new Set();
    const loadedVideoUrls = new Set();
    const failedVideoUrls = new Set();
    const videoErrorTimersByKey = new Map();
    const videoProgressByKey = new Map();
    const warmedVideoOrigins = new Set();
    const stableImageUrlsByIdentity = new Map();
    const backgroundPrefetchedImageUrls = new Set();
    let imagePreview = null;
    let imagePreviewLoadTimer = null;
    let chatNavigationObserver = null;
    let chatNavigationDragState = null;
    let chatNavigationResizeObserver = null;
    let chatNavigationScrollTarget = null;
    let chatNavigationPositionFrame = 0;
    let chatNavigationWheelTarget = null;
    let historyLocatorWheelTarget = null;
    let chatStageScrollTarget = null;
    let chatStageScrollStateFrame = 0;
    let chatStageScrollState = {
        element: null,
        bottomDistance: Number.POSITIVE_INFINITY,
        nearBottom: true
    };
    let chatStagePinFrame = 0;
    let chatNavigationResizeBound = false;
    let suppressNextChatNavigationClick = false;
    let mobileWorkbenchStaticHeight = 0;
    let mobilePromptProxy = null;
    let mobilePromptProxyInput = null;
    let mobilePromptProxySource = null;
    let mobilePromptProxyState = 'closed';
    let mobilePromptProxyBaselineHeight = 0;
    let mobilePromptProxyKeyboardVisible = false;
    let mobilePromptProxyOpenViewportHeight = 0;
    let mobilePromptProxyStartedAt = 0;
    let mobilePromptProxyCandidateViewport = null;
    let mobilePromptProxyCandidateSince = 0;
    let mobilePromptProxyAppliedViewport = null;
    let mobilePromptProxyViewportFrame = 0;
    let mobilePromptProxyCloseTimer = 0;
    let mobilePromptProxyBlurTimer = 0;
    let bodyScrollLockState = null;
    let viewportScaleLockState = null;
    const progressVisualCache = new Map();
    const originalReadyPollCounts = new Map();
    const busyClientTaskRecoveryAt = new Map();
    const activeChatStreamTaskIds = new Set();
    let lastBusyTaskCount = 0;
    let lastDockTerminalSignature = '';
    let dockAnimationRateFrame = 0;
    let dockPopoverEnterTimer = 0;
    let dockPopoverEnterActive = false;
    let dockPopoverSessionActive = false;
    let dockPopoverPointerInside = false;
    let dockPopoverFocusInside = false;

    const DOCK_STAGE_PROGRESS = Object.freeze({
        idle: 0,
        queued: 0.12,
        generating: 0.60,
        saving: 0.88,
        reloading: 1,
        complete: 1,
        failed: 1
    });

    function clampNumber(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, number));
    }

    function normalizePoints(value, fallback = 0) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(0, Math.round(number * 100) / 100);
    }

    function normalizePricingText(value = '', maxLength = 120) {
        return String(value || '').trim().slice(0, maxLength);
    }

    function normalizePricingModel(value = '') {
        const model = normalizePricingText(value, 120);
        if (model === 'gpt-image' || model === 'gpt-image-api') return 'gpt-image-2';
        return model;
    }

    function normalizePricingProviderId(value = '') {
        const raw = normalizePricingText(value, 80);
        if (!raw) return '';
        if (raw === '*' || raw.toLowerCase() === 'all') return '*';
        return raw
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function getPricingRuleProviderId(rule = {}) {
        const metadata = rule?.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata)
            ? rule.metadata
            : {};
        const pricing = metadata.pricing && typeof metadata.pricing === 'object' && !Array.isArray(metadata.pricing)
            ? metadata.pricing
            : {};
        return normalizePricingProviderId(
            metadata.provider_id
            || metadata.providerId
            || pricing.provider_id
            || pricing.providerId
            || rule.provider_id
            || rule.providerId
            || ''
        );
    }

    function getRuntimePricingRuleStrategy(rule = {}) {
        const metadata = rule?.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata)
            ? rule.metadata
            : {};
        const pricing = metadata.pricing && typeof metadata.pricing === 'object' && !Array.isArray(metadata.pricing)
            ? metadata.pricing
            : {};
        const strategy = normalizePricingText(
            metadata.billing_strategy
            || metadata.billingStrategy
            || pricing.billing_strategy
            || pricing.billingStrategy
            || '',
            40
        ).toLowerCase().replace(/-/g, '_');
        if (['token_sub2api', 'fixed_points', 'per_request'].includes(strategy)) return strategy;
        return rule.mode === 'chat' || rule.mode === 'reverse' ? 'token_sub2api' : 'per_request';
    }

    function getRuntimePricingRuleTokenEstimate(rule = {}) {
        const metadata = rule?.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata)
            ? rule.metadata
            : {};
        const pricing = metadata.pricing && typeof metadata.pricing === 'object' && !Array.isArray(metadata.pricing)
            ? metadata.pricing
            : {};
        const rates = pricing.rates && typeof pricing.rates === 'object' && !Array.isArray(pricing.rates)
            ? pricing.rates
            : {};
        const estimate = pricing.estimate && typeof pricing.estimate === 'object' && !Array.isArray(pricing.estimate)
            ? pricing.estimate
            : {};
        const inputTokens = Math.max(0, Math.round(Number(estimate.input_tokens ?? estimate.inputTokens ?? 0) || 0));
        const outputTokens = Math.max(0, Math.round(Number(estimate.output_tokens ?? estimate.outputTokens ?? 0) || 0));
        const cacheWriteTokens = Math.max(0, Math.round(Number(estimate.cache_write_tokens ?? estimate.cacheWriteTokens ?? 0) || 0));
        const cacheReadTokens = Math.max(0, Math.round(Number(estimate.cache_read_tokens ?? estimate.cacheReadTokens ?? 0) || 0));
        const imageOutputTokens = Math.max(0, Math.round(Number(estimate.image_output_tokens ?? estimate.imageOutputTokens ?? 0) || 0));
        const explicitEstimate = Number(estimate.estimated_points ?? estimate.estimatedPoints ?? 0) || 0;
        if (explicitEstimate > 0) return normalizePoints(explicitEstimate, 0);
        const requestBase = Number(pricing.request_base ?? pricing.requestBase ?? pricing.per_request ?? pricing.perRequest ?? 0) || 0;
        const multiplier = Number(pricing.multiplier ?? 1) || 1;
        const pointsPerUsd = Number(pricing.points_per_usd ?? pricing.pointsPerUsd ?? 1) || 1;
        const total = requestBase
            + (Math.max(0, inputTokens - cacheReadTokens) * (Number(rates.input ?? rates.input_per_million ?? rates.inputPerMillion ?? 0) || 0) / 1000000)
            + (Math.max(0, outputTokens - imageOutputTokens) * (Number(rates.output ?? rates.output_per_million ?? rates.outputPerMillion ?? 0) || 0) / 1000000)
            + (cacheWriteTokens * (Number(rates.cache_write ?? rates.cacheWrite ?? 0) || 0) / 1000000)
            + (cacheReadTokens * (Number(rates.cache_read ?? rates.cacheRead ?? 0) || 0) / 1000000)
            + (imageOutputTokens * (Number(rates.image_output ?? rates.imageOutput ?? 0) || 0) / 1000000);
        return normalizePoints(total * multiplier * pointsPerUsd, 0);
    }

    function getRuntimePricingRuleEstimate(rule = {}, quantity = 1) {
        const strategy = getRuntimePricingRuleStrategy(rule);
        if (strategy === 'token_sub2api') {
            const tokenEstimate = getRuntimePricingRuleTokenEstimate(rule);
            return tokenEstimate > 0 ? tokenEstimate : normalizePoints(rule.points, 0);
        }
        const points = normalizePoints(rule.points, 0);
        const multiplier = strategy === 'fixed_points' ? 1 : clampNumber(quantity, 1, 8, 1);
        return normalizePoints(points * multiplier, 0);
    }

    function formatPoints(value = 0) {
        const points = normalizePoints(value, 0);
        if (Number.isInteger(points)) return String(points);
        return String(points).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
    }

    function formatBillingPoints(value = 0) {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) return '0';
        const rounded = Math.round(number * 1000000) / 1000000;
        if (Number.isInteger(rounded)) return String(rounded);
        return String(rounded).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getImageLoadKey(value = '') {
        const raw = String(value || '').trim();
        if (!raw) return '';
        try {
            return new URL(raw, global.location?.href || document.baseURI || '').href;
        } catch (_) {
            return raw;
        }
    }

    function rememberImageLoaded(value = '') {
        const key = getImageLoadKey(value);
        if (!key) return;
        loadedImageUrls.add(key);
        failedImageUrls.delete(key);
    }

    function rememberImageFailed(value = '') {
        const key = getImageLoadKey(value);
        if (!key) return;
        if (loadedImageUrls.has(key)) return;
        failedImageUrls.add(key);
    }

    function hasLoadedImage(value = '') {
        const key = getImageLoadKey(value);
        return Boolean(key && loadedImageUrls.has(key));
    }

    function hasFailedImage(value = '') {
        const key = getImageLoadKey(value);
        return Boolean(key && failedImageUrls.has(key) && !loadedImageUrls.has(key));
    }

    function getTaskPreviewImageUrls(task = {}) {
        return (Array.isArray(task.images) ? task.images : [])
            .map((image) => getImagePreviewUrl(image) || getImageUrl(image))
            .map((url) => String(url || '').trim())
            .filter(Boolean);
    }

    function getActiveThreadTaskIds() {
        const activeTask = getActiveTask();
        const rootTask = getTaskThreadRoot(activeTask) || activeTask;
        if (!rootTask) return new Set();
        return new Set(getTaskThread(rootTask).map((task) => task?.id).filter(Boolean));
    }

    function getActiveThreadImageUrls() {
        const activeTask = getActiveTask();
        const rootTask = getTaskThreadRoot(activeTask) || activeTask;
        if (!rootTask) return [];
        const seen = new Set();
        return getTaskThread(rootTask)
            .flatMap(getTaskPreviewImageUrls)
            .filter((url) => {
                const key = getImageLoadKey(url);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    function hasPendingActiveThreadImages() {
        if (!state.open) return false;
        return getActiveThreadImageUrls().some((url) => !hasLoadedImage(url) && !hasFailedImage(url));
    }

    function shouldDeferHistoryThumbnail(row = {}, src = '', deferHistoryImages = hasPendingActiveThreadImages()) {
        if (!src || hasLoadedImage(src) || hasFailedImage(src)) return false;
        if (!state.open || row?.isActive) return false;
        return Boolean(deferHistoryImages);
    }

    function clearDeferredImageLoadTimer() {
        if (!deferredImageLoadTimer) return;
        global.clearTimeout?.(deferredImageLoadTimer);
        deferredImageLoadTimer = null;
    }

    function scheduleDeferredImageLoading(delayMs = DEFERRED_IMAGE_BATCH_DELAY_MS) {
        if (deferredImageLoadTimer || !state.open) return;
        deferredImageLoadTimer = global.setTimeout?.(() => {
            deferredImageLoadTimer = null;
            syncDeferredImageLoading();
        }, Math.max(0, Number(delayMs) || 0)) || null;
    }

    function activateDeferredImage(image) {
        if (!(image instanceof HTMLImageElement)) return false;
        const src = String(image.dataset.aiwDeferredSrc || '').trim();
        if (!src || image.getAttribute('src')) return false;
        const key = getImageLoadKey(src);
        if (key) backgroundPrefetchedImageUrls.add(key);
        image.loading = 'lazy';
        image.decoding = 'async';
        image.setAttribute('fetchpriority', 'low');
        image.setAttribute('src', src);
        image.removeAttribute('data-aiw-deferred-src');
        return true;
    }

    function getBackgroundImagePrefetchCandidates() {
        const activeThreadIds = getActiveThreadTaskIds();
        const seen = new Set();
        return state.tasks
            .filter((task) => task?.id && !activeThreadIds.has(task.id))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .flatMap(getTaskPreviewImageUrls)
            .filter((url) => {
                const key = getImageLoadKey(url);
                if (!key || seen.has(key) || backgroundPrefetchedImageUrls.has(key)) return false;
                if (hasLoadedImage(key) || hasFailedImage(key)) return false;
                seen.add(key);
                return true;
            });
    }

    function prefetchBackgroundImage(url = '') {
        const key = getImageLoadKey(url);
        if (!key || backgroundPrefetchedImageUrls.has(key) || hasLoadedImage(key) || hasFailedImage(key)) return false;
        backgroundPrefetchedImageUrls.add(key);
        const loader = new Image();
        loader.decoding = 'async';
        loader.loading = 'lazy';
        loader.onload = () => rememberImageLoaded(url);
        loader.onerror = () => rememberImageFailed(url);
        loader.src = url;
        return true;
    }

    function syncDeferredImageLoading() {
        if (!root?.querySelectorAll || !state.open) return;
        if (hasPendingActiveThreadImages()) {
            scheduleDeferredImageLoading();
            return;
        }
        const deferredImages = Array.from(root.querySelectorAll('img[data-aiw-deferred-src]'));
        const activated = deferredImages.slice(0, DEFERRED_IMAGE_BATCH_SIZE).filter(activateDeferredImage).length;
        if (deferredImages.length > DEFERRED_IMAGE_BATCH_SIZE || activated) {
            scheduleDeferredImageLoading();
            return;
        }
        const candidates = getBackgroundImagePrefetchCandidates().slice(0, DEFERRED_IMAGE_BATCH_SIZE);
        candidates.forEach(prefetchBackgroundImage);
        if (candidates.length) scheduleDeferredImageLoading(DEFERRED_IMAGE_BATCH_DELAY_MS * 2);
    }

    function rememberVideoLoaded(value = '') {
        const key = getImageLoadKey(value);
        if (!key) return;
        loadedVideoUrls.add(key);
        failedVideoUrls.delete(key);
        videoProgressByKey.set(key, 100);
        const timer = videoErrorTimersByKey.get(key);
        if (timer) {
            global.clearTimeout?.(timer);
            videoErrorTimersByKey.delete(key);
        }
    }

    function rememberVideoFailed(value = '') {
        const key = getImageLoadKey(value);
        if (!key) return;
        if (loadedVideoUrls.has(key)) return;
        failedVideoUrls.add(key);
        videoProgressByKey.delete(key);
    }

    function hasLoadedVideo(value = '') {
        const key = getImageLoadKey(value);
        return Boolean(key && loadedVideoUrls.has(key));
    }

    function hasFailedVideo(value = '') {
        const key = getImageLoadKey(value);
        return Boolean(key && failedVideoUrls.has(key) && !loadedVideoUrls.has(key));
    }

    function isOriginalStatusPending(status = '') {
        const normalized = String(status || '').trim().toLowerCase();
        return !['ready', 'failed', 'missing', 'upstream_url'].includes(normalized);
    }

    function isVideoImageAwaitingReady(image = {}) {
        if (!image) return false;
        return !image.originalReady && isOriginalStatusPending(image.originalStatus);
    }

    function isMediaAwaitingVideoReady(media = null) {
        if (typeof Element === 'undefined' || !(media instanceof Element)) return false;
        if (media.getAttribute('data-aiw-media-type') !== 'video') return false;
        if (media.getAttribute('data-aiw-original-ready') === 'true') return false;
        return isOriginalStatusPending(media.getAttribute('data-aiw-original-status') || '');
    }

    function hasMediaVideoFileBytes(media = null) {
        if (typeof Element === 'undefined' || !(media instanceof Element)) return false;
        if (media.getAttribute('data-aiw-media-type') !== 'video') return false;
        return Boolean(
            normalizeByteCount(media.getAttribute('data-aiw-original-bytes'))
            || normalizeByteCount(media.getAttribute('data-aiw-preview-bytes'))
        );
    }

    function shouldKeepVideoLoadingAfterError(media = null) {
        return isMediaAwaitingVideoReady(media) || hasMediaVideoFileBytes(media);
    }

    function getMediaVideoLoadingLabel(media = null, fallback = '加载中') {
        return isMediaAwaitingVideoReady(media) ? '转存中' : fallback;
    }

    function normalizeVideoProgressPercent(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        return Math.max(0, Math.min(100, Math.round(number)));
    }

    function rememberVideoProgress(value = '', percent = null) {
        const key = getImageLoadKey(value);
        const normalized = normalizeVideoProgressPercent(percent);
        if (!key || normalized === null) return;
        videoProgressByKey.set(key, normalized);
    }

    function getStoredVideoProgress(value = '') {
        const key = getImageLoadKey(value);
        if (!key) return 0;
        return normalizeVideoProgressPercent(videoProgressByKey.get(key)) || 0;
    }

    function getVideoProgressLabel(value = '') {
        const percent = getStoredVideoProgress(value);
        return percent > 0 ? `${percent}%` : '加载中';
    }

    function getVideoProgressCss(value = '') {
        return `${getStoredVideoProgress(value)}%`;
    }

    function getVideoBufferedPercent(video) {
        if (!(video instanceof HTMLVideoElement)) return null;
        const duration = Number(video.duration);
        const ranges = video.buffered;
        if (!Number.isFinite(duration) || duration <= 0 || !ranges?.length) return null;
        let bufferedEnd = 0;
        try {
            for (let index = 0; index < ranges.length; index += 1) {
                bufferedEnd = Math.max(bufferedEnd, Number(ranges.end(index)) || 0);
            }
        } catch (_) {
            return null;
        }
        if (!Number.isFinite(bufferedEnd) || bufferedEnd <= 0) return null;
        return normalizeVideoProgressPercent((bufferedEnd / duration) * 100);
    }

    function updateVideoLoadingProgress(video, { forceComplete = false } = {}) {
        if (!(video instanceof HTMLVideoElement)) return;
        const videoSrc = video.currentSrc || video.src || video.getAttribute('src') || '';
        if (!videoSrc) return;
        const percent = forceComplete ? 100 : getVideoBufferedPercent(video);
        if (percent !== null) rememberVideoProgress(videoSrc, percent);
        const currentPercent = getStoredVideoProgress(videoSrc);
        const media = video.closest?.('.ai-image-result-media');
        if (!media) return;
        const label = getMediaVideoLoadingLabel(media, getVideoProgressLabel(videoSrc));
        media.style.setProperty('--aiw-video-progress', `${currentPercent}%`);
        media.setAttribute('data-aiw-video-progress-label', label);
        const progress = media.querySelector?.('[data-aiw-video-progress]');
        if (!progress) return;
        progress.textContent = label;
        progress.setAttribute('aria-label', label === '转存中' ? '视频转存中' : (currentPercent > 0 ? `视频已缓冲 ${label}` : '视频加载中'));
    }

    function ensureVideoPreviewLoading(video) {
        if (!(video instanceof HTMLVideoElement)) return;
        updateVideoLoadingProgress(video);
        if (video.readyState >= 2 || video.error) return;
        video.preload = 'auto';
        if (video.dataset.aiwVideoLoadPrimed !== 'true') {
            video.dataset.aiwVideoLoadPrimed = 'true';
            if (video.networkState === 0 || !video.currentSrc) {
                try {
                    video.load();
                } catch (_) {
                    // Some browsers throw if the media node is mid-detach.
                }
            }
        }
        if (video.dataset.aiwVideoPrimeRetried === 'true') return;
        video.dataset.aiwVideoPrimeRetried = 'true';
        global.setTimeout?.(() => {
            if (!video.isConnected || video.readyState >= 2 || video.error) return;
            if (![0, 1].includes(video.networkState)) return;
            try {
                video.load();
            } catch (_) {
                // Keep the preview quiet; the normal error path will surface failures.
            }
        }, VIDEO_LOAD_RETRY_DELAY_MS);
    }

    function scheduleVideoErrorConfirmation(video, videoSrc = '') {
        if (!(video instanceof HTMLVideoElement)) return;
        const key = getImageLoadKey(videoSrc || video.currentSrc || video.src || video.getAttribute('src') || '');
        if (!key || loadedVideoUrls.has(key)) return;
        const media = video.closest?.('.ai-image-result-media');
        if (!media) return;
        media.classList.add('is-video-loading');
        media.classList.remove('is-video-broken', 'is-video-ready', 'is-image-broken', 'is-image-loaded');
        updateVideoLoadingProgress(video);
        video.removeAttribute('aria-hidden');
        if (video.dataset.aiwVideoReloadTried !== 'true') {
            video.dataset.aiwVideoReloadTried = 'true';
            global.setTimeout?.(() => {
                if (!video.isConnected || hasLoadedVideo(key) || video.readyState >= 2) return;
                try {
                    video.load();
                } catch (_) {
                    // Browser media reload can fail synchronously on detached nodes.
                }
            }, VIDEO_LOAD_RETRY_DELAY_MS);
        }
        if (videoErrorTimersByKey.has(key)) return;
        const timer = global.setTimeout?.(() => {
            videoErrorTimersByKey.delete(key);
            if (!video.isConnected || hasLoadedVideo(key) || video.readyState >= 2) return;
            const currentMedia = video.closest?.('.ai-image-result-media');
            if (!currentMedia) return;
            if (shouldKeepVideoLoadingAfterError(currentMedia)) {
                const label = getMediaVideoLoadingLabel(currentMedia);
                currentMedia.classList.add('is-video-loading');
                currentMedia.classList.remove('is-video-broken', 'is-video-ready', 'is-image-broken', 'is-image-loaded');
                currentMedia.setAttribute('data-aiw-video-progress-label', label);
                const progress = currentMedia.querySelector?.('[data-aiw-video-progress]');
                if (progress) {
                    progress.textContent = label;
                    progress.setAttribute('aria-label', label === '转存中' ? '视频转存中' : '视频加载中');
                }
                global.setTimeout?.(() => {
                    if (!video.isConnected || hasLoadedVideo(key) || video.readyState >= 2) return;
                    try {
                        video.load();
                    } catch (_) {
                        // Keep the card in a recoverable loading state for playable server files.
                    }
                }, VIDEO_LOAD_RETRY_DELAY_MS * 3);
                loadRemoteRecords({ force: true }).finally(scheduleRemoteRecordsPoll);
                return;
            }
            rememberVideoFailed(key);
            currentMedia.classList.add('is-video-broken');
            currentMedia.classList.remove('is-video-loading', 'is-video-ready', 'is-image-broken', 'is-image-loaded');
            video.setAttribute('aria-hidden', 'true');
            const downloadLink = currentMedia.querySelector('[data-aiw-download]');
            if (downloadLink instanceof HTMLAnchorElement && downloadLink.href === key) {
                downloadLink.setAttribute('aria-disabled', 'true');
                downloadLink.classList.add('is-disabled');
            }
        }, VIDEO_ERROR_CONFIRMATION_MS);
        if (timer) videoErrorTimersByKey.set(key, timer);
    }

    function warmVideoPreviewConnection(src = '') {
        const raw = String(src || '').trim();
        if (!raw || !document?.head) return;
        let origin = '';
        try {
            origin = new URL(raw, global.location?.href || document.baseURI || '').origin;
        } catch (_) {
            return;
        }
        if (!origin || warmedVideoOrigins.has(origin)) return;
        warmedVideoOrigins.add(origin);
        ['preconnect', 'dns-prefetch'].forEach((rel) => {
            const link = document.createElement('link');
            link.rel = rel;
            link.href = origin;
            if (rel === 'preconnect') link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        });
    }

    function getImageIdentityKey({
        taskId = '',
        resultId = '',
        resultIndex = '',
        src = '',
        context = 'image'
    } = {}) {
        const normalizedContext = String(context || 'image').trim() || 'image';
        const normalizedResultId = String(resultId || '').trim();
        if (normalizedResultId) return `${normalizedContext}:result:${normalizedResultId}`;
        const normalizedTaskId = String(taskId || '').trim();
        const normalizedIndex = String(resultIndex ?? '').trim();
        if (normalizedTaskId && normalizedIndex) return `${normalizedContext}:task:${normalizedTaskId}:${normalizedIndex}`;
        const srcKey = getImageLoadKey(src);
        return srcKey ? `${normalizedContext}:${srcKey}` : '';
    }

    function rememberStableImageUrl(identityKey = '', src = '') {
        const key = String(identityKey || '').trim();
        const imageKey = getImageLoadKey(src);
        if (!key || !imageKey) return;
        stableImageUrlsByIdentity.set(key, imageKey);
    }

    function forgetStableImageUrl(identityKey = '') {
        const key = String(identityKey || '').trim();
        if (key) stableImageUrlsByIdentity.delete(key);
    }

    function getStableImageUrl(identityKey = '', fallbackSrc = '') {
        const key = String(identityKey || '').trim();
        if (!key) return fallbackSrc;
        const stableSrc = stableImageUrlsByIdentity.get(key);
        return stableSrc && !hasFailedImage(stableSrc) ? stableSrc : fallbackSrc;
    }

    function truncateText(value, maxLength = 92) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (text.length <= maxLength) return text;
        return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
    }

    function formatFileSize(bytes = 0) {
        const size = Math.max(0, Number(bytes) || 0);
        if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
        if (size >= 1024) return `${Math.round(size / 1024)}KB`;
        return `${size}B`;
    }

    function normalizeByteCount(value = 0) {
        const bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes <= 0) return 0;
        return Math.round(bytes);
    }

    function getResultImagePreviewBytes(image = {}) {
        const metadata = image?.metadata && typeof image.metadata === 'object' && !Array.isArray(image.metadata)
            ? image.metadata
            : {};
        return normalizeByteCount(image?.previewBytes ?? image?.preview_bytes ?? metadata.preview_bytes ?? metadata.previewBytes);
    }

    function getResultImageOriginalBytes(image = {}) {
        const metadata = image?.metadata && typeof image.metadata === 'object' && !Array.isArray(image.metadata)
            ? image.metadata
            : {};
        return normalizeByteCount(image?.originalBytes ?? image?.original_bytes ?? metadata.original_bytes ?? metadata.originalBytes);
    }

    function formatPreviewFileSize(bytes = 0) {
        const size = normalizeByteCount(bytes);
        if (!size) return '';
        return `体积 ${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
    }

    function normalizeReferenceItem(value = null) {
        if (!value) return null;
        if (typeof value === 'string') {
            const image = value.trim();
            return image ? { image, title: '参考图片' } : null;
        }
        if (typeof value !== 'object') return null;
        const image = String(value.image || value.url || value.imageUrl || value.image_url || value.referenceImage || value.reference_image || '').trim();
        if (!image) return null;
        return {
            image,
            title: String(value.title || value.name || value.referenceTitle || value.reference_title || '参考图片').trim().slice(0, 160),
            taskId: String(value.taskId || value.task_id || '').trim(),
            resultId: String(value.resultId || value.result_id || '').trim(),
            resultIndex: String(value.resultIndex ?? value.result_index ?? '').trim(),
            role: String(value.role || '').trim()
        };
    }

    function normalizeReferenceList(value = []) {
        const list = Array.isArray(value) ? value : [value];
        const seen = new Set();
        return list
            .map(normalizeReferenceItem)
            .filter((item) => {
                if (!item?.image || seen.has(item.image)) return false;
                seen.add(item.image);
                return true;
            })
            .slice(0, MAX_REFERENCE_IMAGE_INPUTS);
    }

    function normalizeChatAttachmentItem(value = null) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const text = String(value.text || value.content || value.extractedText || value.extracted_text || '').trim();
        if (!text) return null;
        const name = String(value.name || value.fileName || value.file_name || '附件').trim().slice(0, 180) || '附件';
        const mimeType = String(value.mimeType || value.mime_type || value.type || '').trim().slice(0, 120);
        const size = Math.max(0, Number(value.size || value.bytes || 0) || 0);
        return {
            id: String(value.id || `${name}:${size}:${text.length}`).trim().slice(0, 220),
            name,
            mimeType,
            size,
            text: text.slice(0, MAX_CHAT_ATTACHMENT_TEXT_CHARS),
            chars: Math.min(text.length, MAX_CHAT_ATTACHMENT_TEXT_CHARS)
        };
    }

    function normalizeChatAttachmentList(value = []) {
        const list = Array.isArray(value) ? value : [value];
        const seen = new Set();
        let totalChars = 0;
        const normalized = [];
        for (const raw of list) {
            const item = normalizeChatAttachmentItem(raw);
            if (!item) continue;
            const dedupeKey = `${item.name}:${item.size}:${item.text.slice(0, 160)}`;
            if (seen.has(dedupeKey)) continue;
            const remainingChars = MAX_CHAT_ATTACHMENT_TOTAL_CHARS - totalChars;
            if (remainingChars <= 0) break;
            const clippedText = item.text.slice(0, remainingChars);
            normalized.push({
                ...item,
                id: item.id || dedupeKey,
                text: clippedText,
                chars: clippedText.length
            });
            totalChars += clippedText.length;
            seen.add(dedupeKey);
            if (normalized.length >= MAX_CHAT_ATTACHMENT_COUNT) break;
        }
        return normalized;
    }

    function clearChatAttachments() {
        state.chatAttachments = [];
    }

    function normalizeApiBaseUrl(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        try {
            const url = new URL(raw);
            url.hash = '';
            url.search = '';
            url.pathname = url.pathname.replace(/\/+$/, '');
            if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
            if (!/\/v\d+(?:alpha|beta)?$/i.test(url.pathname)) url.pathname = `${url.pathname}/v1`.replace(/\/+/g, '/');
            return url.toString().replace(/\/$/, '');
        } catch (_) {
            return raw.replace(/\/+$/, '');
        }
    }

    function getApiBaseProfile(value = state.apiBaseUrl) {
        const normalized = normalizeApiBaseUrl(value);
        return runtimeApiBaseProfiles.find((item) => normalizeApiBaseUrl(item.baseUrl) === normalized) || null;
    }

    function isConfiguredApiBaseUrl(value = state.apiBaseUrl) {
        return Boolean(getApiBaseProfile(value));
    }

    function updateRuntimeApiBaseProfiles(rows = []) {
        const nextProfiles = (Array.isArray(rows) ? rows : [])
            .map((row, index) => {
                const baseUrl = normalizeApiBaseUrl(row.baseUrl || row.base_url);
                if (!baseUrl) return null;
                const label = String(row.label || '').trim()
                    || (baseUrl.includes('generativelanguage.googleapis.com') ? 'Gemini API' : (baseUrl.includes('zaoyoe') ? 'Zaoyoe Sub2API' : (baseUrl.includes('fatherkey') ? 'FatherKey Sub2API' : 'API')));
                const id = String(row.id || label || baseUrl || index)
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    || `api-base-${index + 1}`;
                return {
                    id,
                    label,
                    baseUrl
                };
            })
            .filter(Boolean);

        runtimeApiBaseProfiles = nextProfiles.length ? nextProfiles : DEFAULT_API_BASE_PROFILES.slice();
        if (!isConfiguredApiBaseUrl(state.apiBaseUrl)) {
            state.apiBaseUrl = getDefaultApiBaseUrl();
        }
        applyRuntimeModelCache(state.apiBaseUrl);
    }

    function normalizeRuntimeModelLabel(label = '') {
        return String(label || '')
            .trim()
            .replace(/^Default\s*[·•]\s*/i, '')
            .trim();
    }

    function normalizeRuntimeModelOption(item = null, fallbackProvider = {}) {
        if (!item) return null;
        const id = typeof item === 'string'
            ? item.trim()
            : String(item.id || item.model || item.name || item.value || '').trim();
        if (!id) return null;
        const providerLabel = String(item.providerLabel || item.provider_label || fallbackProvider.label || '').trim();
        const vendorLabel = String(item.vendorLabel || item.vendor_label || fallbackProvider.vendorLabel || fallbackProvider.vendor_label || '').trim();
        const vendor = String(item.vendor || fallbackProvider.vendor || '').trim().toLowerCase();
        const protocol = String(item.protocol || item.adapter || fallbackProvider.protocol || fallbackProvider.adapter || '').trim().toLowerCase();
        const label = normalizeRuntimeModelLabel(String(item.label || item.displayName || item.display_name || id).trim());
        const providerId = String(item.providerId || item.provider_id || fallbackProvider.providerId || fallbackProvider.provider_id || '').trim();
        const rawSupportsImageInput = item.supportsImageInput ?? item.supports_image_input ?? item.vision ?? item.vision_input ?? null;
        const normalizedSupportsImageInput = String(rawSupportsImageInput ?? '').trim().toLowerCase();
        const supportsImageInput = rawSupportsImageInput === null || rawSupportsImageInput === undefined || !normalizedSupportsImageInput
            ? null
            : (['true', '1', 'yes', 'on', 'enabled'].includes(normalizedSupportsImageInput)
                ? true
                : (['false', '0', 'no', 'off', 'disabled'].includes(normalizedSupportsImageInput) ? false : null));
        return {
            id,
            label,
            providerId,
            providerLabel,
            vendorLabel,
            vendor,
            protocol,
            supportsImageInput
        };
    }

    function getRuntimeProviderModelOption(model = '', provider = {}) {
        if (model && typeof model === 'object' && !Array.isArray(model)) {
            return normalizeRuntimeModelOption(model, provider);
        }
        const id = String(model || '').trim();
        const displayNames = provider.modelDisplayNames || provider.model_display_names || {};
        const matchedKey = displayNames && typeof displayNames === 'object'
            ? Object.keys(displayNames).find((key) => key.toLowerCase() === id.toLowerCase())
            : '';
        const label = String(matchedKey ? displayNames[matchedKey] : '').trim();
        return normalizeRuntimeModelOption(label ? { id, label } : id, provider);
    }

    function uniqueModelOptions(options = []) {
        const seen = new Set();
        return options.filter((item) => {
            const key = String(item?.id || '').trim().toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function looksLikeImageModelId(value = '') {
        return /(?:^|[-_/])(image|img|imagen|nano-?banana|dall-?e|flux|kontext|imagine|stable|sdxl?|midjourney)(?:[-_/]|$)|gpt-image/i.test(String(value || ''));
    }

    function looksLikeTextModelId(value = '') {
        return /(?:^|[-_/])(gpt|o\d|chat|claude|gemini|qwen|deepseek|grok|llama|mistral|kimi|moonshot|doubao|ernie|glm|yi)(?:[-_/]|$)/i.test(String(value || ''));
    }

    function looksLikeVideoModelId(value = '') {
        return /(?:^|[-_/])(video|vid|veo|sora|kling|runway|wan|hailuo|luma|pika|seedance|jimeng|dreamina)(?:[-_/]|$)|generate-?video/i.test(String(value || ''));
    }

    function supportsVideoCameraFixed(modelId = '') {
        const normalized = String(modelId || '').trim().toLowerCase();
        if (!normalized) return false;
        if (/seedance[-_/]?(2|2\.0)|seed[-_/]?2|dreamina[-_/]?seedance[-_/]?2|jimeng[-_/]?(2|2\.0)/.test(normalized)) return false;
        return /seedance[-_/]?1|seedance[-_/]?1\.0|seedance[-_/]?1\.5|seed[-_/]?1|jimeng|dreamina/.test(normalized);
    }

    function filterRuntimeModelsByGroup(options = [], group = 'image') {
        return options.filter((item) => {
            const id = String(item?.id || '').trim();
            if (!id) return false;
            if (group === 'video') return looksLikeVideoModelId(id);
            if (group === 'image') return looksLikeImageModelId(id) || !looksLikeTextModelId(id);
            return !looksLikeImageModelId(id);
        });
    }

    function getRuntimeProviderFallbackLabel(apiBaseUrl = state.apiBaseUrl) {
        return getApiBaseProfile(apiBaseUrl)?.label || '当前上游';
    }

    function normalizeRuntimeProviderLabel(label = '', fallbackLabel = '当前上游') {
        const normalized = String(label || '').trim();
        if (!normalized || /^检测到的上游模型$/i.test(normalized)) return fallbackLabel;
        return normalized;
    }

    function inferModelFamilyLabel(modelId = '', fallbackLabel = '') {
        const normalized = String(modelId || '').trim().toLowerCase();
        if (/(^|[-_/])gemini([-_/]|$)|(^|[-_/])imagen([-_/]|$)|nano-?banana/.test(normalized)) return 'Gemini';
        if (/(^|[-_/])(gpt|o\d|chatgpt|dall-?e)([-_/]|$)|gpt-image/.test(normalized)) return 'ChatGPT';
        if (/(^|[-_/])claude([-_/]|$)/.test(normalized)) return 'Claude';
        if (/(^|[-_/])deepseek([-_/]|$)/.test(normalized)) return 'DeepSeek';
        if (/(^|[-_/])qwen([-_/]|$)/.test(normalized)) return 'Qwen';
        if (/(^|[-_/])grok([-_/]|$)/.test(normalized)) return 'Grok';
        if (/(^|[-_/])flux([-_/]|$)/.test(normalized)) return 'FLUX';
        if (/(^|[-_/])midjourney([-_/]|$)/.test(normalized)) return 'Midjourney';
        if (/(^|[-_/])(llama|meta)([-_/]|$)/.test(normalized)) return 'Llama';
        if (/(^|[-_/])mistral([-_/]|$)/.test(normalized)) return 'Mistral';
        if (/(^|[-_/])(kimi|moonshot)([-_/]|$)/.test(normalized)) return 'Kimi';
        if (/(^|[-_/])(doubao|seed)([-_/]|$)/.test(normalized)) return '豆包';
        if (/(^|[-_/])(ernie|wenxin)([-_/]|$)/.test(normalized)) return '文心';
        if (/(^|[-_/])(glm|zhipu)([-_/]|$)/.test(normalized)) return '智谱 GLM';
        return String(fallbackLabel || '其他模型').trim() || '其他模型';
    }

    function groupRuntimeModelsByFamily(providers = [], mode = inferWorkbenchMode()) {
        const isTextMode = isTextVisionMode(mode);
        const isVideo = isVideoMode(mode);
        const familyMap = new Map();
        (Array.isArray(providers) ? providers : []).forEach((provider) => {
            const models = isTextMode ? provider.chatModels : (isVideo ? provider.videoModels : provider.imageModels);
            (Array.isArray(models) ? models : []).forEach((model) => {
                const familyLabel = inferModelFamilyLabel(model.id, provider.vendorLabel || provider.label);
                const familyId = familyLabel.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'models';
                if (!familyMap.has(familyId)) {
                    familyMap.set(familyId, {
                        providerId: familyId,
                        label: familyLabel,
                        models: []
                    });
                }
                familyMap.get(familyId).models.push({
                    ...model,
                    providerId: provider.providerId,
                    providerLabel: provider.label,
                    vendorLabel: provider.vendorLabel || '',
                    vendor: model.vendor || provider.vendor || '',
                    protocol: model.protocol || provider.protocol || ''
                });
            });
        });
        return Array.from(familyMap.values()).map((group) => ({
            ...group,
            models: uniqueModelOptions(group.models)
        })).filter((group) => group.models.length);
    }

    function normalizeRuntimeModelProvider(provider = {}, index = 0, { fallbackLabel = '' } = {}) {
        if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return null;
        const providerId = String(provider.providerId || provider.provider_id || provider.id || `provider-${index + 1}`)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            || `provider-${index + 1}`;
        const label = normalizeRuntimeProviderLabel(
            provider.label || provider.name || provider.providerLabel || provider.provider_label || providerId,
            fallbackLabel || providerId
        );
        const vendorLabel = normalizeRuntimeProviderLabel(
            provider.vendorLabel || provider.vendor_label || provider.vendorName || provider.vendor_name || '',
            ''
        );
        const vendor = String(provider.vendor || '').trim().toLowerCase();
        const protocol = String(provider.protocol || provider.adapter || '').trim().toLowerCase();
        const modelGroup = String(provider.modelGroup || provider.model_group || '').trim().toLowerCase();
        const visionModelSet = new Set((Array.isArray(provider.visionModels || provider.vision_models || provider.chatVisionModels || provider.chat_vision_models)
            ? (provider.visionModels || provider.vision_models || provider.chatVisionModels || provider.chat_vision_models)
            : [])
            .map((model) => String(model || '').trim().toLowerCase())
            .filter(Boolean));
        const imageModels = modelGroup === 'chat' || modelGroup === 'video' ? [] : filterRuntimeModelsByGroup(uniqueModelOptions(
            (Array.isArray(provider.imageModels || provider.image_models)
                ? (provider.imageModels || provider.image_models)
                : (Array.isArray(provider.models) ? provider.models : []))
                .map((model) => getRuntimeProviderModelOption(model, { ...provider, providerId, label, vendorLabel }))
                .filter(Boolean)
        ), 'image');
        const chatModels = modelGroup === 'image' || modelGroup === 'video' ? [] : filterRuntimeModelsByGroup(uniqueModelOptions(
            (Array.isArray(provider.chatModels || provider.chat_models) ? (provider.chatModels || provider.chat_models) : [])
                .map((model) => {
	                    const option = getRuntimeProviderModelOption(model, { ...provider, providerId, label, vendorLabel });
	                    if (!option) return null;
	                    if (option.supportsImageInput === null && visionModelSet.has(String(option.id || '').trim().toLowerCase())) {
	                        option.supportsImageInput = true;
	                    }
	                    return option;
                })
                .filter(Boolean)
        ), 'chat');
        const videoModels = uniqueModelOptions(
            (Array.isArray(provider.videoModels || provider.video_models) ? (provider.videoModels || provider.video_models) : [])
                .map((model) => getRuntimeProviderModelOption(model, { ...provider, providerId, label, vendorLabel }))
                .filter(Boolean)
        );
        if (!imageModels.length && !chatModels.length && !videoModels.length) return null;
        return {
            providerId,
            label,
            vendorLabel,
            vendor,
            protocol,
            imageModels,
            chatModels,
            videoModels
        };
    }

    function buildFallbackRuntimeModelProvider({ providerId = 'default', label = '默认模型', imageModels = [], chatModels = [], videoModels = [] } = {}) {
        return {
            providerId,
            label,
            imageModels: uniqueModelOptions(imageModels.map((model) => normalizeRuntimeModelOption(model, { providerId, label })).filter(Boolean)),
            chatModels: uniqueModelOptions(chatModels.map((model) => normalizeRuntimeModelOption(model, { providerId, label })).filter(Boolean)),
            videoModels: uniqueModelOptions(videoModels.map((model) => normalizeRuntimeModelOption(model, { providerId, label })).filter(Boolean))
        };
    }

    function getRuntimeModelProvidersForBillingMode() {
        return state.billingMode === 'api' ? runtimeApiModelProviders : runtimeAdminModelProviders;
    }

    function isRuntimeModelSourceLockedForBillingMode() {
        return state.billingMode === 'api' ? runtimeApiModelsLockedToDiscovery : runtimeAdminModelsConfigured;
    }

    function filterRuntimeModelGroupsForMode(groups = [], mode = inferWorkbenchMode()) {
        if (mode !== 'reverse') return groups;
        return groups.map((group) => ({
            ...group,
            models: (Array.isArray(group.models) ? group.models : []).filter((model) => {
                if (model.supportsImageInput === false) return false;
                if (model.supportsImageInput === true) return true;
                return modelLikelySupportsChatImageInput(model.id);
            })
        })).filter((group) => group.models.length);
    }

    function getRuntimeModelGroups(mode = inferWorkbenchMode(), providers = getRuntimeModelProvidersForBillingMode()) {
        const isTextMode = isTextVisionMode(mode);
        const isVideo = isVideoMode(mode);
        const groups = filterRuntimeModelGroupsForMode(groupRuntimeModelsByFamily(providers, mode), mode);
        if (groups.length) return groups;
        if (providers.length || isRuntimeModelSourceLockedForBillingMode()) return [];
        if (isVideo) return [];
        if (isTextMode) {
            if (state.billingMode !== 'api') return [];
            return filterRuntimeModelGroupsForMode([buildFallbackRuntimeModelProvider({
                providerId: 'default-chat',
                label: '默认对话模型',
                chatModels: runtimeApiTextModels.length ? runtimeApiTextModels : API_TEXT_MODELS
            })].map((provider) => ({ providerId: provider.providerId, label: provider.label, models: provider.chatModels })), mode);
        }
        if (state.billingMode === 'api') {
            return [buildFallbackRuntimeModelProvider({
                providerId: 'default-image-api',
                label: '默认图片模型',
                imageModels: runtimeApiImageModels.length ? runtimeApiImageModels : API_IMAGE_MODELS
            })].map((provider) => ({ providerId: provider.providerId, label: provider.label, models: provider.imageModels }));
        }
        return [];
    }

    function getRuntimeModelGroupOptions(mode = inferWorkbenchMode()) {
        return getRuntimeModelGroups(mode).flatMap((group) => group.models);
    }

    function normalizeRuntimeModelCacheEntry(entry = null) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const apiBaseUrl = normalizeApiBaseUrl(entry.apiBaseUrl || entry.api_base_url);
        if (!apiBaseUrl) return null;
        const detected = entry.detected === true || entry.discovered === true || entry.source === 'upstream_discovery';
        const chatModels = uniqueModelOptions((Array.isArray(entry.chatModels || entry.chat_models) ? (entry.chatModels || entry.chat_models) : [])
            .map((item) => normalizeRuntimeModelOption(item))
            .filter(Boolean));
        const imageModels = uniqueModelOptions((Array.isArray(entry.imageModels || entry.image_models) ? (entry.imageModels || entry.image_models) : [])
            .map((item) => normalizeRuntimeModelOption(item))
            .filter(Boolean));
        const videoModels = uniqueModelOptions((Array.isArray(entry.videoModels || entry.video_models) ? (entry.videoModels || entry.video_models) : [])
            .map((item) => normalizeRuntimeModelOption(item))
            .filter(Boolean));
        if (!detected && !chatModels.length && !imageModels.length && !videoModels.length) return null;
        return {
            apiBaseUrl,
            detected,
            chatModels: filterRuntimeModelsByGroup(chatModels, 'chat'),
            imageModels: filterRuntimeModelsByGroup(imageModels, 'image'),
            videoModels
        };
    }

    function normalizeRuntimeModelCache(value = {}) {
        const entries = Array.isArray(value)
            ? value
            : Object.entries(value && typeof value === 'object' ? value : {}).map(([apiBaseUrl, entry]) => ({
                ...(entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}),
                apiBaseUrl
            }));
        return entries.reduce((cache, entry) => {
            const normalized = normalizeRuntimeModelCacheEntry(entry);
            if (normalized) {
                cache[normalized.apiBaseUrl] = {
                    detected: normalized.detected,
                    chatModels: normalized.chatModels,
                    imageModels: normalized.imageModels,
                    videoModels: normalized.videoModels
                };
            }
            return cache;
        }, {});
    }

    function serializeRuntimeModelCache() {
        return Object.entries(runtimeApiModelCacheByBaseUrl).reduce((cache, [apiBaseUrl, entry]) => {
            const normalized = normalizeRuntimeModelCacheEntry({ apiBaseUrl, ...entry });
            if (normalized) {
                cache[normalized.apiBaseUrl] = {
                    detected: normalized.detected,
                    chatModels: normalized.chatModels,
                    imageModels: normalized.imageModels,
                    videoModels: normalized.videoModels
                };
            }
            return cache;
        }, {});
    }

    function getRuntimeModelCacheEntry(apiBaseUrl = state.apiBaseUrl) {
        const normalizedBaseUrl = normalizeApiBaseUrl(apiBaseUrl || getDefaultApiBaseUrl());
        return runtimeApiModelCacheByBaseUrl[normalizedBaseUrl] || null;
    }

    function applyRuntimeModelSelectionDefaults({
        textModels = [],
        imageModels = [],
        videoModels = [],
        target = 'api',
        explicit = false
    } = {}) {
        if (target === 'admin') {
            if (!textModels.some((model) => model.id === state.pointsTextModel)) {
                state.pointsTextModel = textModels[0]?.id || '';
            }
            if (!imageModels.some((model) => model.id === state.model)) {
                state.model = imageModels[0]?.id || (explicit ? '' : DEFAULT_STATE.model);
            }
            if (!videoModels.some((model) => model.id === state.pointsVideoModel)) {
                state.pointsVideoModel = videoModels[0]?.id || '';
            }
            return;
        }
        if (!textModels.some((model) => model.id === state.apiTextModel)) {
            state.apiTextModel = textModels[0]?.id || (explicit ? '' : DEFAULT_STATE.apiTextModel);
        }
        if (!imageModels.some((model) => model.id === state.apiImageModel)) {
            state.apiImageModel = imageModels[0]?.id || (explicit ? '' : DEFAULT_STATE.apiImageModel);
        }
        if (!videoModels.some((model) => model.id === state.apiVideoModel)) {
            state.apiVideoModel = videoModels[0]?.id || '';
        }
    }

    function applyRuntimeModelCache(apiBaseUrl = state.apiBaseUrl) {
        const cached = getRuntimeModelCacheEntry(apiBaseUrl);
        if (!cached) return false;
        runtimeApiTextModels = cached.chatModels.slice();
        runtimeApiImageModels = cached.imageModels.slice();
        runtimeApiVideoModels = cached.videoModels.slice();
        runtimeApiModelsLockedToDiscovery = true;
        runtimeApiModelProviders = [buildFallbackRuntimeModelProvider({
            providerId: 'detected-upstream',
            label: getRuntimeProviderFallbackLabel(apiBaseUrl),
            imageModels: runtimeApiImageModels,
            chatModels: runtimeApiTextModels,
            videoModels: runtimeApiVideoModels
        })];
        applyRuntimeModelSelectionDefaults({
            textModels: runtimeApiTextModels,
            imageModels: runtimeApiImageModels,
            videoModels: runtimeApiVideoModels,
            target: 'api',
            explicit: true
        });
        const cachedCount = uniqueModelOptions([
            ...cached.chatModels,
            ...cached.imageModels,
            ...cached.videoModels
        ]).length;
        if (!modelDiscoveryState.loading) {
            modelDiscoveryState = {
                loading: false,
                message: cachedCount
                    ? `已使用上次检测到的 ${cachedCount} 个上游模型，模型下拉已更新。`
                    : '已使用上次检测结果：未发现可用模型。',
                tone: cachedCount ? 'success' : 'warning'
            };
        }
        return true;
    }

    function updateRuntimeApiModels(payload = {}, { cache = false, apiBaseUrl = state.apiBaseUrl, target = 'api' } = {}) {
        const hasExplicitProviders = Array.isArray(payload?.model_providers || payload?.image_model_providers);
        const hasExplicitDiscoveryResult = cache === true || payload?.discovery || payload?.source === 'upstream_discovery' || hasExplicitProviders;
        const providers = Array.isArray(payload?.model_providers || payload?.image_model_providers)
            ? (payload.model_providers || payload.image_model_providers)
            : [];
        const fallbackProviderLabel = getRuntimeProviderFallbackLabel(apiBaseUrl || payload.apiBaseUrl || payload.api_base_url);
        const groupedProviders = providers
            .map((provider, index) => normalizeRuntimeModelProvider(provider, index, { fallbackLabel: fallbackProviderLabel }))
            .filter(Boolean);
        const providerImageModels = providers.flatMap((provider) => (
            Array.isArray(provider.imageModels || provider.image_models)
                ? (provider.imageModels || provider.image_models).map((model) => normalizeRuntimeModelOption(model, provider))
                : []
        ));
        const providerChatModels = providers.flatMap((provider) => (
            Array.isArray(provider.chatModels || provider.chat_models)
                ? (provider.chatModels || provider.chat_models).map((model) => normalizeRuntimeModelOption(model, provider))
                : []
        ));
        const providerVideoModels = providers.flatMap((provider) => (
            Array.isArray(provider.videoModels || provider.video_models)
                ? (provider.videoModels || provider.video_models).map((model) => normalizeRuntimeModelOption(model, provider))
                : []
        ));
        const imageModels = filterRuntimeModelsByGroup(uniqueModelOptions([
            ...(Array.isArray(payload?.image_models) ? payload.image_models.map((item) => normalizeRuntimeModelOption(item)) : []),
            ...providerImageModels
        ].filter(Boolean)), 'image');
        const chatModels = filterRuntimeModelsByGroup(uniqueModelOptions([
            ...(Array.isArray(payload?.chat_models) ? payload.chat_models.map((item) => normalizeRuntimeModelOption(item)) : []),
            ...providerChatModels
        ].filter(Boolean)), 'chat');
        const videoModels = uniqueModelOptions([
            ...(Array.isArray(payload?.video_models) ? payload.video_models.map((item) => normalizeRuntimeModelOption(item)) : []),
            ...providerVideoModels
        ].filter(Boolean));
        const nextProviders = groupedProviders.length
            ? groupedProviders
            : (hasExplicitDiscoveryResult ? [buildFallbackRuntimeModelProvider({
                providerId: target === 'admin' ? 'admin-configured-models' : 'detected-upstream',
                label: fallbackProviderLabel,
                imageModels,
                chatModels,
                videoModels
            })] : []);

        if (target === 'admin') {
            runtimeAdminModelsConfigured = Boolean(hasExplicitProviders || imageModels.length || chatModels.length || videoModels.length);
            runtimeAdminImageModels = imageModels;
            runtimeAdminTextModels = chatModels;
            runtimeAdminVideoModels = videoModels;
            runtimeAdminModelProviders = nextProviders;
            applyRuntimeModelSelectionDefaults({
                textModels: runtimeAdminTextModels,
                imageModels: runtimeAdminImageModels,
                videoModels: runtimeAdminVideoModels,
                target: 'admin',
                explicit: runtimeAdminModelsConfigured
            });
        } else {
            runtimeApiModelsLockedToDiscovery = Boolean(hasExplicitDiscoveryResult);
            runtimeApiImageModels = hasExplicitDiscoveryResult ? imageModels : (imageModels.length ? imageModels : API_IMAGE_MODELS.slice());
            runtimeApiTextModels = hasExplicitDiscoveryResult ? chatModels : (chatModels.length ? chatModels : API_TEXT_MODELS.slice());
            runtimeApiVideoModels = videoModels;
            runtimeApiModelProviders = nextProviders;
            applyRuntimeModelSelectionDefaults({
                textModels: runtimeApiTextModels,
                imageModels: runtimeApiImageModels,
                videoModels: runtimeApiVideoModels,
                target: 'api',
                explicit: hasExplicitDiscoveryResult
            });
        }
        if (cache) {
            const normalizedBaseUrl = normalizeApiBaseUrl(apiBaseUrl || payload.apiBaseUrl || payload.api_base_url || state.apiBaseUrl);
            if (normalizedBaseUrl) {
                runtimeApiModelCacheByBaseUrl = {
                    ...runtimeApiModelCacheByBaseUrl,
                    [normalizedBaseUrl]: {
                        detected: true,
                        chatModels,
                        imageModels,
                        videoModels
                    }
                };
            }
        }
    }

    function normalizeStoredApiKeyStatus(item = {}) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const apiBaseUrl = normalizeApiBaseUrl(item.apiBaseUrl || item.api_base_url);
        if (!apiBaseUrl) return null;
        const apiKeyTail = String(item.apiKeyTail || item.api_key_tail || '').trim().slice(-8);
        const configured = Boolean(item.configured || item.apiKeyConfigured || item.api_key_configured || apiKeyTail);
        return {
            configured,
            apiBaseUrl,
            apiKeyTail,
            apiKeyFingerprint: String(item.apiKeyFingerprint || item.api_key_fingerprint || '').trim().slice(0, 80),
            updatedAt: String(item.updatedAt || item.updated_at || '').trim()
        };
    }

    function updateStoredApiKeyStatuses(value = []) {
        const rows = Array.isArray(value) ? value : [];
        state.storedApiKeys = rows.map(normalizeStoredApiKeyStatus).filter(Boolean);
    }

    function getStoredApiKeyStatus(value = state.apiBaseUrl) {
        const normalizedBaseUrl = normalizeApiBaseUrl(value || getDefaultApiBaseUrl());
        return state.storedApiKeys.find((item) => item.apiBaseUrl === normalizedBaseUrl && item.configured) || null;
    }

    function hasUsableApiKey() {
        return Boolean(String(state.apiKey || '').trim() || getStoredApiKeyStatus());
    }

    function getApiKeyTail(value = state.apiKey) {
        const key = String(value || '').trim();
        if (key) return key.slice(-8);
        return getStoredApiKeyStatus()?.apiKeyTail || '';
    }

    function applyStoredApiKeyStatus(item = null) {
        const normalized = normalizeStoredApiKeyStatus(item);
        if (!normalized?.configured) return false;
        const index = state.storedApiKeys.findIndex((existing) => existing.apiBaseUrl === normalized.apiBaseUrl);
        if (index >= 0) {
            state.storedApiKeys.splice(index, 1, normalized);
        } else {
            state.storedApiKeys.push(normalized);
        }
        state.apiKey = '';
        return true;
    }

    function applyStoredApiKeyFromPayload(payload = {}) {
        return applyStoredApiKeyStatus(payload?.storedApiKey || payload?.stored_api_key || payload?.apiKeyStatus || payload?.api_key_status);
    }

    function formatCompactNumber(value = 0) {
        const number = Number(value) || 0;
        if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}w`;
        if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`;
        return String(Math.round(number));
    }

    function updateActivitySummary(payload = {}) {
        const apiUsage = Array.isArray(payload.apiUsage)
            ? payload.apiUsage
            : (Array.isArray(payload.api_usage) ? payload.api_usage : (Array.isArray(payload.usage) ? payload.usage : []));
        const downloads = Array.isArray(payload.downloadEvents)
            ? payload.downloadEvents
            : (Array.isArray(payload.download_events) ? payload.download_events : (Array.isArray(payload.downloads) ? payload.downloads : []));

        activitySummary = {
            apiTokens: apiUsage.reduce((sum, item) => sum + (Number(item.total_tokens ?? item.totalTokens ?? 0) || 0), 0),
            apiCalls: apiUsage.length,
            downloads: downloads.length
        };
    }

    function getActivitySummarySignature(summary = activitySummary) {
        return [
            Number(summary.apiTokens) || 0,
            Number(summary.apiCalls) || 0,
            Number(summary.downloads) || 0
        ].join(':');
    }

    function getRuntimeSite() {
        const configured = String(global.SiteConfig?.site || document.documentElement?.dataset?.site || '').trim().toLowerCase();
        const host = String(global.location?.hostname || '').toLowerCase();
        if (configured === 'intl' || configured === 'cn') return configured;
        return host.includes('zaoyoe') ? 'intl' : 'cn';
    }

    function getRuntimePricingRuleModes(mode = 'text') {
        const normalizedMode = normalizePricingText(mode, 40).toLowerCase();
        const canonicalMode = PRICING_MODE_ALIASES[normalizedMode] || normalizedMode;
        return [...new Set([normalizedMode, canonicalMode].filter(Boolean))];
    }

    function pricingRuleScore(rule = {}, request = {}) {
        let score = 0;
        if (rule.mode === request.mode) score += 64;
        if (rule.site === request.site) score += 32;
        if (rule.model === request.model) score += 16;
        const ruleProviderId = getPricingRuleProviderId(rule);
        if (ruleProviderId && ruleProviderId !== '*' && ruleProviderId === request.providerId) score += 24;
        if (rule.resolution === request.resolution) score += 8;
        if (rule.ratio === request.ratio) score += 4;
        if (Number(rule.quantity) === Number(request.quantity)) score += 2;
        score += Math.max(0, 1000 - Number(rule.priority || 100)) / 1000;
        return score;
    }

    function findRuntimePricingRule({
        site = getRuntimeSite(),
        mode = state.mode,
        billingMode = state.billingMode,
        model = state.model,
        providerId = getActiveModelProviderId(mode),
        resolution = state.resolution,
        ratio = state.ratio,
        quantity = state.quantity
    } = {}) {
        if (billingMode !== 'points') return null;
        const request = {
            site,
            mode,
            pricingModes: getRuntimePricingRuleModes(mode),
            billingMode,
            model: normalizePricingModel(model),
            providerId: normalizePricingProviderId(providerId),
            resolution: normalizePricingText(resolution, 20).toLowerCase() || '1k',
            ratio: normalizePricingText(ratio, 20).toLowerCase() || '1:1',
            quantity: clampNumber(quantity, 1, 8, 1)
        };
        const candidates = (Array.isArray(runtimePricingRules) ? runtimePricingRules : [])
            .filter((rule) => {
                if (rule?.is_active === false) return false;
                const ruleSite = normalizePricingText(rule.site || 'all', 20).toLowerCase() || 'all';
                const ruleMode = normalizePricingText(rule.mode, 40).toLowerCase();
                const ruleBillingMode = normalizePricingText(rule.billing_mode || rule.billingMode, 40).toLowerCase();
                const ruleModel = normalizePricingModel(rule.model || '*') || '*';
                const ruleProviderId = getPricingRuleProviderId(rule);
                const ruleResolution = normalizePricingText(rule.resolution || '*', 20).toLowerCase() || '*';
                const ruleRatio = normalizePricingText(rule.ratio || '*', 20).toLowerCase() || '*';
                const ruleQuantity = Number(rule.quantity || 1);
                const providerMatches = !ruleProviderId
                    || ruleProviderId === '*'
                    || (request.providerId && ruleProviderId === request.providerId);
                return (ruleSite === request.site || ruleSite === 'all')
                    && request.pricingModes.includes(ruleMode)
                    && ruleBillingMode === request.billingMode
                    && (ruleModel === '*' || ruleModel === request.model)
                    && providerMatches
                    && (ruleResolution === '*' || ruleResolution === request.resolution)
                    && (ruleRatio === '*' || ruleRatio === request.ratio)
                    && (ruleQuantity === 1 || ruleQuantity === Number(request.quantity));
            });
        return candidates
            .sort((left, right) => pricingRuleScore(right, request) - pricingRuleScore(left, request))[0] || null;
    }

    function normalizeSessionCandidate(value = null) {
        if (!value || typeof value !== 'object') return null;
        return value.currentSession || value.session || value;
    }

    function getSessionAccessToken(session = null) {
        return String(session?.access_token || '').trim();
    }

    function getSessionUserId(session = null) {
        return String(session?.user?.id || session?.user_id || session?.userId || '').trim();
    }

    function getAuthUserStorageKey(session = null) {
        const userId = getSessionUserId(session);
        if (!userId) return '';
        return `${USER_STORAGE_PREFIX}${userId}`;
    }

    function hasPersistedAuthSession() {
        return Boolean(getSessionAccessToken(readPersistedSupabaseSession()));
    }

    function readPersistedSupabaseSession() {
        try {
            const storage = global.localStorage;
            if (!storage) return null;
            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
                const session = normalizeSessionCandidate(JSON.parse(storage.getItem(key) || '{}'));
                if (getSessionAccessToken(session)) return session;
            }
        } catch (_) {
            // Auth fallback is best effort.
        }
        return null;
    }

    function withTimeout(promise, timeoutMs = API_REQUEST_TIMEOUT_MS) {
        let timeoutId = 0;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = global.setTimeout(() => reject(new Error('AI image request timeout')), timeoutMs);
        });
        return Promise.race([promise, timeoutPromise]).finally(() => {
            if (timeoutId) global.clearTimeout(timeoutId);
        });
    }

    async function getAuthToken() {
        let token = '';
        try {
            const result = await withTimeout(Promise.resolve(global.supabaseClient?.auth?.getSession?.()), 4000);
            const session = normalizeSessionCandidate(result?.data?.session);
            token = getSessionAccessToken(session);
            if (token) currentAuthSession = session;
        } catch (_) {
            token = '';
        }

        if (!token && typeof global.supabaseClient?.accessToken === 'function') {
            try {
                token = String(await withTimeout(Promise.resolve(global.supabaseClient.accessToken()), 4000) || '').trim();
            } catch (_) {
                token = '';
            }
        }

        if (!token) {
            const persistedSession = readPersistedSupabaseSession();
            token = getSessionAccessToken(persistedSession);
            if (token) currentAuthSession = persistedSession;
        }

        return token;
    }

    async function requestAiImage(route, { method = 'GET', query = {}, body = null, auth = true, allowTaskOnFailure = false } = {}) {
        const params = new URLSearchParams({
            scope: 'ai-image',
            route
        });
        Object.entries(query || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            params.set(key, String(value));
        });

        const headers = body ? { 'Content-Type': 'application/json' } : {};
        if (auth) {
            const token = await getAuthToken();
            if (!token && auth !== 'optional') {
                throw new Error('请先登录后使用 AI 图片工作台');
            }
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }
        }

        const requestUrl = route === 'upload'
            ? `${AI_IMAGE_UPLOAD_API_BASE_URL}?${params.toString()}`
            : `/api/public?${params.toString()}`;
        const response = await withTimeout(fetch(requestUrl, {
            method,
            headers,
            ...(body ? { body: JSON.stringify(body) } : {})
        }));
        const payload = await response.json().catch(() => ({}));
        const toleratedTaskFailure = allowTaskOnFailure && payload?.task;
        if ((!response.ok || payload?.success === false) && !toleratedTaskFailure) {
            const error = new Error(payload?.message || 'AI 图片工作台请求失败');
            error.code = payload?.code || '';
            error.payload = payload;
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    async function requestAiImageStream(route, { method = 'POST', query = {}, body = null, auth = true, onEvent = null } = {}) {
        const params = new URLSearchParams({
            scope: 'ai-image',
            route
        });
        Object.entries(query || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            params.set(key, String(value));
        });

        const headers = body ? { 'Content-Type': 'application/json' } : {};
        if (auth) {
            const token = await getAuthToken();
            if (!token) {
                throw new Error('请先登录后使用 AI 图片工作台');
            }
            headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(`/api/public?${params.toString()}`, {
            method,
            headers,
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            const error = new Error(payload?.message || 'AI 图片工作台请求失败');
            error.code = payload?.code || '';
            error.payload = payload;
            error.status = response.status;
            throw error;
        }
        const reader = response.body?.getReader?.();
        if (!reader) {
            throw new Error('当前浏览器不支持流式对话');
        }
        const decoder = new TextDecoder();
        let buffer = '';
        const dispatchEventBlock = async (block = '') => {
            const lines = String(block || '').split(/\r?\n/);
            let eventName = 'message';
            const dataLines = [];
            lines.forEach((line) => {
                if (line.startsWith('event:')) {
                    eventName = line.slice(6).trim() || eventName;
                } else if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).trimStart());
                }
            });
            if (!dataLines.length) return null;
            let data = {};
            try {
                data = JSON.parse(dataLines.join('\n'));
            } catch (_) {
                data = { text: dataLines.join('\n') };
            }
            if (typeof onEvent === 'function') {
                await onEvent(eventName, data);
            }
            return { event: eventName, data };
        };

        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const blocks = buffer.split(/\n\n|\r\n\r\n/);
            buffer = blocks.pop() || '';
            for (const block of blocks) {
                await dispatchEventBlock(block);
            }
        }
        if (buffer.trim()) {
            await dispatchEventBlock(buffer);
        }
    }

    function splitProgressiveChatDelta(value = '') {
        const chars = Array.from(String(value || ''));
        if (chars.length <= CHAT_STREAM_PROGRESSIVE_THRESHOLD_CHARS) {
            return chars.length ? [chars.join('')] : [];
        }
        const first = chars.splice(0, CHAT_STREAM_PROGRESSIVE_FIRST_CHARS).join('');
        const remainingFrames = Math.min(
            CHAT_STREAM_PROGRESSIVE_MAX_FRAMES,
            Math.max(1, Math.ceil(chars.length / CHAT_STREAM_PROGRESSIVE_TARGET_CHARS))
        );
        const chunkSize = Math.max(1, Math.ceil(chars.length / remainingFrames));
        const chunks = [first];
        while (chars.length) {
            chunks.push(chars.splice(0, chunkSize).join(''));
        }
        return chunks.filter(Boolean);
    }

    function waitForChatStreamPaint() {
        return new Promise((resolve) => {
            const afterFrame = () => {
                if (typeof global.setTimeout === 'function') {
                    global.setTimeout(resolve, 0);
                } else {
                    resolve();
                }
            };
            if (typeof global.requestAnimationFrame === 'function') {
                global.requestAnimationFrame(afterFrame);
            } else if (typeof global.setTimeout === 'function') {
                global.setTimeout(resolve, 16);
            } else {
                resolve();
            }
        });
    }

    function getNowId(prefix = 'img') {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function readStorage() {
        try {
            const parsed = JSON.parse(global.localStorage?.getItem(STORAGE_KEY) || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            return parsed;
        } catch (_) {
            return {};
        }
    }

    function readUserScopedStorage(session = currentAuthSession || readPersistedSupabaseSession()) {
        const key = getAuthUserStorageKey(session);
        if (!key) return {};
        try {
            const parsed = JSON.parse(global.localStorage?.getItem(key) || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            return parsed;
        } catch (_) {
            return {};
        }
    }

    function normalizeStringList(value = [], limit = 80) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        return value
            .map((item) => String(item || '').trim())
            .filter((item) => {
                if (!item || seen.has(item)) return false;
                seen.add(item);
                return true;
            })
            .slice(0, limit);
    }

    function normalizeTaskAccentMap(value = {}) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        const allowed = new Set(HISTORY_ACCENTS.map((accent) => accent.id));
        return Object.entries(value).reduce((nextMap, [taskId, accent]) => {
            const normalizedTaskId = String(taskId || '').trim();
            const normalizedAccent = String(accent || '').trim();
            if (normalizedTaskId && allowed.has(normalizedAccent)) {
                nextMap[normalizedTaskId] = normalizedAccent;
            }
            return nextMap;
        }, {});
    }

    function isUuid(value = '') {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
    }

    function serverUuidOrEmpty(value = '') {
        const normalized = String(value || '').trim();
        return isUuid(normalized) ? normalized : '';
    }

    function normalizeHistoryPrefs(value = {}) {
        const prefs = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        return {
            deletedTaskIds: normalizeStringList(prefs.deletedTaskIds || prefs.deleted_task_ids, 120),
            pinnedTaskIds: normalizeStringList(prefs.pinnedTaskIds || prefs.pinned_task_ids, 80),
            taskAccentById: normalizeTaskAccentMap(prefs.taskAccentById || prefs.task_accent_by_id)
        };
    }

    function persistState() {
        try {
            const serializable = {
                billingMode: state.billingMode,
                apiImageTool: state.apiImageTool,
        pointsTextModel: state.pointsTextModel,
                pointsVideoModel: state.pointsVideoModel,
	                apiTextModel: state.apiTextModel,
	                apiImageModel: state.apiImageModel,
	                apiVideoModel: state.apiVideoModel,
	                chatMemoryMode: state.chatMemoryMode,
	                chatReasoningEffort: state.chatReasoningEffort,
	                chatGeminiThinkingLevel: state.chatGeminiThinkingLevel,
	                chatClaudeThinkingBudget: state.chatClaudeThinkingBudget,
	                chatServiceTier: state.chatServiceTier,
	                chatThinkingMode: state.chatThinkingMode,
	                chatFastDefaultsVersion: DEFAULT_STATE.chatFastDefaultsVersion,
	                verifiedKimiThinkingModels: normalizeStringList(state.verifiedKimiThinkingModels, 100),
	                chatImageInput: state.chatImageInput,
	                runtimeApiModelCacheByBaseUrl: serializeRuntimeModelCache(),
                mode: state.mode,
                ratio: state.ratio,
                resolution: state.resolution,
                videoRatio: state.videoRatio,
                videoResolution: state.videoResolution,
                videoDuration: state.videoDuration,
                videoAudio: state.videoAudio,
                videoWatermark: state.videoWatermark,
                videoCameraFixed: state.videoCameraFixed,
                model: state.model,
                quantity: state.quantity,
                prompt: state.prompt,
                referenceImage: state.referenceImage,
                referenceTitle: state.referenceTitle,
                referenceIntent: state.referenceIntent,
                referenceImages: state.referenceImages,
                continuationImage: state.continuationImage
            };
            global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(serializable));
            persistUserScopedState();
        } catch (_) {
            // Local storage is best effort.
        }
    }

    function persistUserScopedState() {
        const session = currentAuthSession || readPersistedSupabaseSession();
        const key = getAuthUserStorageKey(session);
        if (!key) return;
        try {
            const serializable = {
                activeTaskId: state.activeTaskId,
                historyPrefsRemoteSynced: Boolean(state.historyPrefsRemoteSynced),
                historyPrefs: normalizeHistoryPrefs(state.historyPrefs),
                activitySummary,
                seenTaskIds: normalizeStringList(Array.from(seenTaskIds), 500),
                tasks: state.tasks.slice(0, MAX_LOCAL_TASKS)
            };
            global.localStorage?.setItem(key, JSON.stringify(serializable));
        } catch (_) {
            // User scoped cache is best effort.
        }
    }

    function restoreUserScopedState(session = currentAuthSession || readPersistedSupabaseSession()) {
        const stored = readUserScopedStorage(session);
        state.historyPrefsRemoteSynced = Boolean(stored.historyPrefsRemoteSynced || stored.history_prefs_remote_synced);
        state.historyPrefs = normalizeHistoryPrefs(stored.historyPrefs || stored.history_prefs);
        const summary = stored.activitySummary || stored.activity_summary || {};
        activitySummary = {
            apiTokens: Number(summary.apiTokens ?? summary.api_tokens ?? 0) || 0,
            apiCalls: Number(summary.apiCalls ?? summary.api_calls ?? 0) || 0,
            downloads: Number(summary.downloads ?? 0) || 0
        };
        seenTaskIds = new Set(normalizeStringList(stored.seenTaskIds || stored.seen_task_ids, 500));
        state.tasks = Array.isArray(stored.tasks) ? stored.tasks.slice(0, MAX_LOCAL_TASKS).map(normalizeTask).filter(Boolean) : [];
        state.tasks.filter((task) => task.seen).forEach(markTaskSeen);
        state.activeTaskId = stored.activeTaskId && state.tasks.some((task) => task.id === stored.activeTaskId)
            ? stored.activeTaskId
            : '';
    }

    function resetUserScopedWorkbenchData({ renderAfter = true, persistAfter = false } = {}) {
        state.storedApiKeys = [];
        state.tasks = [];
        state.activeTaskId = '';
        state.historyPrefs = normalizeHistoryPrefs({});
        state.historyPrefsRemoteSynced = false;
        selectedHistoryTaskIds = new Set();
        seenTaskIds = new Set();
        historySelectionMode = false;
        openHistoryAccentMenu = false;
        historySearchQuery = '';
        activitySummary = {
            apiTokens: 0,
            apiCalls: 0,
            downloads: 0
        };
        remoteRecordsLoaded = false;
        remoteHistoryPrefsLoaded = false;
        loadedImageUrls.clear();
        failedImageUrls.clear();
        backgroundPrefetchedImageUrls.clear();
        loadedVideoUrls.clear();
        failedVideoUrls.clear();
        videoProgressByKey.clear();
        videoErrorTimersByKey.forEach((timer) => global.clearTimeout?.(timer));
        videoErrorTimersByKey.clear();
        warmedVideoOrigins.clear();
        stableImageUrlsByIdentity.clear();
        clearDeferredImageLoadTimer();
        originalReadyPollCounts.clear();
        if (persistAfter) persistState();
        if (renderAfter) render();
    }

    function restoreState() {
        const stored = readStorage();
        const persistedSession = readPersistedSupabaseSession();
        currentAuthSession = persistedSession;
        const shouldRestoreUserScopedData = Boolean(getSessionAccessToken(persistedSession));
        state.billingMode = ['points', 'api'].includes(stored.billingMode) ? stored.billingMode : DEFAULT_STATE.billingMode;
        state.apiBaseUrl = getDefaultApiBaseUrl();
        state.apiKey = '';
        state.storedApiKeys = [];
        state.apiImageTool = Boolean(stored.apiImageTool);
        runtimeApiModelCacheByBaseUrl = normalizeRuntimeModelCache(stored.runtimeApiModelCacheByBaseUrl || stored.runtime_api_model_cache_by_base_url || {});
        applyRuntimeModelCache(state.apiBaseUrl);
        state.pointsTextModel = String(stored.pointsTextModel || stored.points_text_model || '').trim();
        state.pointsVideoModel = String(stored.pointsVideoModel || stored.points_video_model || '').trim();
        state.apiTextModel = runtimeApiTextModels.some((model) => model.id === stored.apiTextModel) ? stored.apiTextModel : (runtimeApiTextModels[0]?.id || '');
	        state.apiImageModel = runtimeApiImageModels.some((model) => model.id === stored.apiImageModel) ? stored.apiImageModel : (runtimeApiImageModels[0]?.id || '');
	        state.apiVideoModel = runtimeApiVideoModels.some((model) => model.id === stored.apiVideoModel) ? stored.apiVideoModel : (runtimeApiVideoModels[0]?.id || '');
	        state.chatMemoryMode = CHAT_MEMORY_OPTIONS.some((option) => option.id === stored.chatMemoryMode || option.id === stored.chat_memory_mode)
	            ? (stored.chatMemoryMode || stored.chat_memory_mode)
	            : DEFAULT_STATE.chatMemoryMode;
	        const storedReasoningEffort = String(stored.chatReasoningEffort || stored.chat_reasoning_effort || '').trim();
	        const storedGeminiThinkingLevel = String(stored.chatGeminiThinkingLevel || stored.chat_gemini_thinking_level || '').trim();
	        const storedClaudeThinkingBudget = String(stored.chatClaudeThinkingBudget || stored.chat_claude_thinking_budget || '').trim();
	        const storedServiceTier = String(stored.chatServiceTier || stored.chat_service_tier || '').trim();
	        const storedThinkingMode = String(stored.chatThinkingMode || stored.chat_thinking_mode || '').trim();
	        const storedFastDefaultsVersion = Number(stored.chatFastDefaultsVersion ?? stored.chat_fast_defaults_version ?? 0) || 0;
	        const storedImageInput = String(stored.chatImageInput || stored.chat_image_input || '').trim();
	        state.chatReasoningEffort = [...OPENAI_REASONING_EFFORT_OPTIONS, ...DEEPSEEK_REASONING_EFFORT_OPTIONS, ...GLM_REASONING_EFFORT_OPTIONS, ...XAI_REASONING_EFFORT_OPTIONS].some((option) => option.id === storedReasoningEffort)
	            ? storedReasoningEffort
	            : DEFAULT_STATE.chatReasoningEffort;
	        state.chatGeminiThinkingLevel = GEMINI_THINKING_LEVEL_OPTIONS.some((option) => option.id === storedGeminiThinkingLevel)
	            ? storedGeminiThinkingLevel
	            : DEFAULT_STATE.chatGeminiThinkingLevel;
	        state.chatClaudeThinkingBudget = CLAUDE_THINKING_BUDGET_OPTIONS.some((option) => option.id === storedClaudeThinkingBudget)
	            ? storedClaudeThinkingBudget
	            : DEFAULT_STATE.chatClaudeThinkingBudget;
	        state.chatServiceTier = OPENAI_SERVICE_TIER_OPTIONS.some((option) => option.id === storedServiceTier)
	            ? storedServiceTier
	            : DEFAULT_STATE.chatServiceTier;
	        state.chatThinkingMode = [...DEEPSEEK_THINKING_OPTIONS, ...KIMI_THINKING_OPTIONS, ...CLAUDE_THINKING_OPTIONS, ...QWEN_ENABLE_THINKING_OPTIONS, ...GLM_THINKING_OPTIONS, ...MINIMAX_THINKING_OPTIONS, ...DOUBAO_THINKING_OPTIONS, ...GROK_THINKING_OPTIONS, ...OPENAI_THINKING_OPTIONS, ...GEMINI_THINKING_OPTIONS].some((option) => option.id === storedThinkingMode)
	            ? storedThinkingMode
	            : (storedThinkingMode === 'show' ? 'enabled' : (storedThinkingMode === 'hide' ? 'unset' : DEFAULT_STATE.chatThinkingMode));
	        if (storedFastDefaultsVersion < 1 && state.chatThinkingMode === 'enabled') {
	            state.chatThinkingMode = DEFAULT_STATE.chatThinkingMode;
	        }
	        state.verifiedKimiThinkingModels = normalizeStringList(stored.verifiedKimiThinkingModels || stored.verified_kimi_thinking_models, 100);
	        state.chatImageInput = OPENAI_IMAGE_INPUT_OPTIONS.some((option) => option.id === storedImageInput)
	            ? storedImageInput
	            : (storedImageInput === 'on' ? 'auto' : (storedImageInput === 'off' ? 'off' : DEFAULT_STATE.chatImageInput));
        state.mode = ['chat', 'text', 'image', 'video', 'reverse'].includes(stored.mode) ? stored.mode : DEFAULT_STATE.mode;
        state.ratio = RATIO_META[stored.ratio] ? stored.ratio : DEFAULT_STATE.ratio;
        state.resolution = RESOLUTION_META[stored.resolution] ? stored.resolution : '1k';
        state.videoRatio = VIDEO_RATIO_META[stored.videoRatio || stored.video_ratio] ? (stored.videoRatio || stored.video_ratio) : DEFAULT_STATE.videoRatio;
        state.videoResolution = VIDEO_RESOLUTION_META[stored.videoResolution || stored.video_resolution] ? (stored.videoResolution || stored.video_resolution) : DEFAULT_STATE.videoResolution;
        state.videoDuration = VIDEO_DURATION_META[String(stored.videoDuration || stored.video_duration || '')] ? String(stored.videoDuration || stored.video_duration) : DEFAULT_STATE.videoDuration;
        state.videoAudio = VIDEO_AUDIO_META[String(stored.videoAudio ?? stored.video_audio ?? '')] ? String(stored.videoAudio ?? stored.video_audio) : DEFAULT_STATE.videoAudio;
        state.videoWatermark = VIDEO_WATERMARK_META[String(stored.videoWatermark ?? stored.video_watermark ?? '')] ? String(stored.videoWatermark ?? stored.video_watermark) : DEFAULT_STATE.videoWatermark;
        state.videoCameraFixed = VIDEO_CAMERA_FIXED_META[String(stored.videoCameraFixed ?? stored.video_camera_fixed ?? '')] ? String(stored.videoCameraFixed ?? stored.video_camera_fixed) : DEFAULT_STATE.videoCameraFixed;
        state.model = getActiveModelOptions('text').some((model) => model.id === stored.model)
            ? stored.model
            : (getActiveModelOptions('text')[0]?.id || DEFAULT_STATE.model);
        state.quantity = clampNumber(stored.quantity, 1, 4, DEFAULT_STATE.quantity);
        state.agent = '';
        state.prompt = String(stored.prompt || '').slice(0, 4000);
        state.referenceImage = String(stored.referenceImage || '');
        state.referenceTitle = String(stored.referenceTitle || '').slice(0, 160);
        state.referenceIntent = ['variation'].includes(stored.referenceIntent) ? stored.referenceIntent : '';
        state.referenceImages = normalizeReferenceList(stored.referenceImages || stored.reference_images);
        state.chatAttachments = [];
        state.continuationImage = normalizeReferenceItem(stored.continuationImage || stored.continuation_image);
        state.composerError = '';
        if (shouldRestoreUserScopedData) {
            restoreUserScopedState(persistedSession);
        } else {
            resetUserScopedWorkbenchData({ renderAfter: false, persistAfter: false });
        }
    }

    function normalizeTaskStatus(value) {
        const status = String(value || '').trim().toLowerCase();
        if (status === 'streaming') return 'streaming';
        if (status === 'running' || status === 'processing') return 'processing';
        if (status === 'succeeded' || status === 'completed' || status === 'success') return 'succeeded';
        if (status === 'cancelled' || status === 'canceled') return 'cancelled';
        if (status === 'failed' || status === 'refunded') return 'failed';
        return 'queued';
    }

    function isVideoResultImage(image = {}) {
        const metadata = image?.metadata && typeof image.metadata === 'object' && !Array.isArray(image.metadata)
            ? image.metadata
            : {};
        const mimeType = String(image?.mimeType || image?.mime_type || metadata.mime_type || metadata.mimeType || '').trim().toLowerCase();
        const mediaType = String(image?.mediaType || image?.media_type || metadata.media_type || metadata.mediaType || '').trim().toLowerCase();
        return mediaType === 'video' || mimeType.startsWith('video/');
    }

    function isRequestTimeoutError(error) {
        return /request timeout|请求超时|timeout/i.test(String(error?.message || error || ''));
    }

    function shouldRecoverChatStreamError(error) {
        if (String(error?.code || '').trim() === 'pricing_changed') return false;
        const message = String(error?.message || error || '');
        return !/请先登录|unauthorized|billing_mode_required|insufficient|余额|积分不足/i.test(message);
    }

    function getFriendlyTaskError(value, fallback = '生成过程遇到异常，请稍后重试。', mode = '') {
        const raw = String(value || '').trim();
        if (!raw) return fallback;
        const normalizedMode = String(mode || '').trim();
        if (/task_not_cancellable|已开始调用模型|已开始处理|已进入上游生成|已产生扣费|无法取消/i.test(raw)) {
            return CANNOT_CANCEL_CHARGED_MESSAGE;
        }
        if (/reference_image_requires_upload|请先上传参考图片/i.test(raw)) {
            return '续作底图仍是临时预览，系统会先上传为正式参考图后再提交。请重新发送一次。';
        }
        if (/pricing_changed|计价标准已更新/i.test(raw)) {
            return '计价标准刚刚更新，请确认最新价格后重新提交。';
        }
        if (/(generated images? (?:appear|appears|were|was|are|is) (?:to be )?unsafe|unsafe generated images?|safety (?:filter|system|policy)|content policy|policy violation|moderation|blocked by (?:the )?safety|violat(?:e|ed|ion).*policy|try modifying the prompts? or the seeds?)/i.test(raw)) {
            return '上游安全审核未通过，请降低性感、暴露、真实人物相关描述后重试。';
        }
        if (/^AI image request timeout$/i.test(raw) || /request timeout/i.test(raw)) {
            return '状态同步超时，任务可能仍在后台运行。请稍等片刻，系统会自动刷新结果；若最终失败，本次不会扣积分。';
        }
        if (/provider_timeout|上游请求超时|operation was aborted|ETIMEDOUT|timeout/i.test(raw)) {
            if (normalizedMode === 'chat') return '上游对话超时，未扣积分。请稍后重试，或切换更稳定的对话模型后再试。';
            return '上游生成超时，未扣积分。请稍后重试，或降低分辨率、张数后再试。';
        }
        if (normalizedMode === 'chat' && /降低分辨率|减少参考图|分辨率、张数|张数后再试/i.test(raw)) {
            return '这次没有扣积分。可以稍后重试，或切换更稳定的对话模型后再试。';
        }
        if (/ECONNRESET|connection failed|fetch failed|网络|连接失败/i.test(raw)) {
            return '上游连接异常，未扣积分。请稍后重试，或切换更稳定的模型配置。';
        }
        return raw;
    }

    function normalizeTimestamp(value, fallback = Date.now()) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        const parsed = Date.parse(String(value || ''));
        return Number.isNaN(parsed) ? fallback : parsed;
    }

    function normalizeResultImage(value, index = 0, task = {}) {
        if (typeof value === 'string') {
            return {
                src: value,
                original: value,
                originalReady: true,
                originalStatus: 'ready',
                mimeType: '',
                mediaType: '',
                previewBytes: 0,
                originalBytes: 0,
                resultId: '',
                taskId: String(task.id || task.taskId || task.task_id || ''),
                index
            };
        }
        if (!value || typeof value !== 'object') return null;
        const imageUrl = String(value.imageUrl || value.image_url || '').trim();
        const original = String(value.originalImageUrl || value.original_image_url || '').trim();
        const metadata = value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
            ? value.metadata
            : {};
        const mimeType = String(value.mimeType || value.mime_type || metadata.mime_type || metadata.mimeType || '').trim();
        const mediaType = String(value.mediaType || value.media_type || metadata.media_type || metadata.mediaType || '').trim();
        const originalStatus = String(value.originalStatus || value.original_status || metadata.original_status || '').trim().toLowerCase()
            || (original ? 'ready' : 'pending');
        const originalReady = Boolean(value.originalReady ?? value.original_ready ?? (originalStatus === 'ready' && original));
        const previewBytes = normalizeByteCount(value.previewBytes ?? value.preview_bytes ?? metadata.preview_bytes ?? metadata.previewBytes);
        const originalBytes = normalizeByteCount(value.originalBytes ?? value.original_bytes ?? metadata.original_bytes ?? metadata.originalBytes);
        if (!original && !imageUrl) return null;
        return {
            src: imageUrl || original,
            original,
            preview: imageUrl || original,
            originalReady,
            originalStatus,
            mimeType,
            mediaType,
            previewBytes,
            originalBytes,
            metadata,
            resultId: String(value.id || value.resultId || value.result_id || '').trim(),
            taskId: String(value.taskId || value.task_id || task.id || task.taskId || task.task_id || '').trim(),
            index: Number.isFinite(Number(value.resultIndex ?? value.result_index)) ? Number(value.resultIndex ?? value.result_index) : index
        };
    }

    function normalizeTask(task) {
        if (!task || typeof task !== 'object') return null;
        const id = String(task.id || task.taskId || task.task_id || task.clientTaskId || task.client_task_id || '').trim();
        if (!id) return null;
        const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
            ? task.metadata
            : {};
        const delivery = metadata.delivery && typeof metadata.delivery === 'object' && !Array.isArray(metadata.delivery)
            ? metadata.delivery
            : {};
        const requestedImageCount = Number(delivery.requested_image_count ?? delivery.requestedImageCount);
        const deliveredImageCount = Number(delivery.delivered_image_count ?? delivery.deliveredImageCount);
        const clientTaskId = String(task.clientTaskId || task.client_task_id || (id.startsWith('aiw_') ? id : '') || '').trim();
        const mode = MODE_META[task.mode] ? task.mode : 'text';
        const status = normalizeTaskStatus(task.status);
        const serverImages = Array.isArray(task.results) && task.results.length ? task.results : task.images;
        const rawProgress = task.progress ?? task.progressPercent ?? task.progress_percent ?? metadata.progress ?? metadata.progress_percent;
        const hasExplicitProgress = rawProgress !== undefined && rawProgress !== null && String(rawProgress).trim() !== '';
        const createdAt = normalizeTimestamp(task.createdAt || task.created_at, Date.now());
        const startedAt = task.startedAt || task.started_at
            ? normalizeTimestamp(task.startedAt || task.started_at, 0)
            : 0;
        const completedAt = task.completedAt || task.completed_at
            ? normalizeTimestamp(task.completedAt || task.completed_at, 0)
            : 0;
        const rawGenerationCompletedAt = task.generationCompletedAt
            || task.generation_completed_at
            || metadata.content_completed_at
            || metadata.contentCompletedAt;
        const generationElapsedMs = Number(
            task.generationElapsedMs
            ?? task.generation_elapsed_ms
            ?? metadata.timing?.generation_elapsed_ms
            ?? metadata.generation_elapsed_ms
        );
        const generationCompletedAt = rawGenerationCompletedAt
            ? normalizeTimestamp(rawGenerationCompletedAt, 0)
            : (startedAt && Number.isFinite(generationElapsedMs) && generationElapsedMs >= 0
                ? startedAt + generationElapsedMs
                : 0);
        const updatedAt = task.updatedAt || task.updated_at
            ? normalizeTimestamp(task.updatedAt || task.updated_at, 0)
            : 0;
        const chargedPoints = Number(task.chargedPoints ?? task.charged_points ?? 0);
        const estimatedPoints = Number(task.estimatedPoints ?? task.estimated_points ?? task.cost ?? 0);
        const queuePosition = Number(task.queuePosition ?? task.queue_position ?? metadata.queue_position ?? metadata.queuePosition);
        const estimatedWaitSeconds = Number(
            task.estimatedWaitSeconds
            ?? task.estimated_wait_seconds
            ?? task.queueEtaSeconds
            ?? task.queue_eta_seconds
            ?? metadata.estimated_wait_seconds
            ?? metadata.estimatedWaitSeconds
            ?? metadata.queue_eta_seconds
            ?? metadata.queueEtaSeconds
        );
        const cost = ['failed', 'cancelled', 'refunded'].includes(status)
            ? Math.max(0, chargedPoints)
            : (status === 'succeeded' ? chargedPoints : estimatedPoints);
        const rawTokenUsage = task.tokenUsage || task.token_usage || {};
        const tokenUsage = Number(
            task.totalTokens
            ?? task.total_tokens
            ?? rawTokenUsage.total_tokens
            ?? rawTokenUsage.totalTokens
            ?? (typeof rawTokenUsage === 'number' ? rawTokenUsage : 0)
        );
        const inputTokens = Number(task.inputTokens ?? task.input_tokens ?? rawTokenUsage.input_tokens ?? rawTokenUsage.inputTokens ?? 0);
        const outputTokens = Number(task.outputTokens ?? task.output_tokens ?? rawTokenUsage.output_tokens ?? rawTokenUsage.outputTokens ?? 0);
        const rawInputTokenDetails = rawTokenUsage && typeof rawTokenUsage === 'object' && !Array.isArray(rawTokenUsage)
            ? (rawTokenUsage.input_tokens_details || rawTokenUsage.inputTokenDetails || rawTokenUsage.prompt_tokens_details || rawTokenUsage.promptTokenDetails || {})
            : {};
        const cachedTokens = Number(task.cachedTokens ?? task.cached_tokens ?? rawTokenUsage.cached_tokens ?? rawTokenUsage.cachedTokens ?? rawInputTokenDetails.cached_tokens ?? rawInputTokenDetails.cachedTokens ?? 0);
        const agentId = String(task.agent || task.agentSlug || task.agent_slug || '');
        const apiBaseUrl = normalizeApiBaseUrl(task.apiBaseUrl || task.api_base_url || '');
        const billingMode = task.billingMode || task.billing_mode;
        const modelProviderId = normalizePricingProviderId(task.modelProviderId || task.model_provider_id || task.providerId || task.provider_id || metadata.provider_id || metadata.providerId || metadata.model_provider_id || metadata.modelProviderId);
        const errorCode = String(task.errorCode || task.error_code || '').trim();
        const errorMessage = getFriendlyTaskError(task.errorMessage || task.error_message || task.remoteError || '', '', mode);
        return {
            id,
            clientTaskId,
            parentTaskId: String(task.parentTaskId || task.parent_task_id || ''),
            mode,
            status,
            progress: status === 'succeeded' ? 100 : (hasExplicitProgress ? clampNumber(rawProgress, 0, 99, 0) : 0),
            progressKnown: Boolean(hasExplicitProgress || status === 'succeeded'),
            prompt: String(task.prompt || '').slice(0, 4000),
            referenceImage: String(task.referenceImage || task.referenceImageUrl || task.reference_image_url || ''),
            referenceTitle: String(task.referenceTitle || task.reference_title || ''),
            referenceImages: normalizeReferenceList(task.referenceImages || task.reference_images || metadata.reference_images || metadata.referenceImages),
            ratio: isVideoMode(mode)
                ? (VIDEO_RATIO_META[task.ratio] ? task.ratio : (VIDEO_RATIO_META[metadata.video_ratio || metadata.ratio] ? (metadata.video_ratio || metadata.ratio) : DEFAULT_STATE.videoRatio))
                : (RATIO_META[task.ratio] ? task.ratio : '1:1'),
            resolution: isVideoMode(mode)
                ? (VIDEO_RESOLUTION_META[task.resolution] ? task.resolution : (VIDEO_RESOLUTION_META[metadata.video_resolution || metadata.resolution] ? (metadata.video_resolution || metadata.resolution) : DEFAULT_STATE.videoResolution))
                : (RESOLUTION_META[task.resolution] ? task.resolution : '1k'),
            videoDuration: isVideoMode(mode) && VIDEO_DURATION_META[String(metadata.video_duration ?? metadata.duration ?? task.videoDuration ?? task.video_duration ?? '')]
                ? String(metadata.video_duration ?? metadata.duration ?? task.videoDuration ?? task.video_duration)
                : DEFAULT_STATE.videoDuration,
            videoAudio: isVideoMode(mode) && VIDEO_AUDIO_META[String(metadata.generate_audio ?? metadata.video_audio ?? task.videoAudio ?? task.video_audio ?? '')]
                ? String(metadata.generate_audio ?? metadata.video_audio ?? task.videoAudio ?? task.video_audio)
                : DEFAULT_STATE.videoAudio,
            videoWatermark: isVideoMode(mode) && VIDEO_WATERMARK_META[String(metadata.watermark ?? metadata.video_watermark ?? task.videoWatermark ?? task.video_watermark ?? '')]
                ? String(metadata.watermark ?? metadata.video_watermark ?? task.videoWatermark ?? task.video_watermark)
                : DEFAULT_STATE.videoWatermark,
            videoCameraFixed: isVideoMode(mode) && VIDEO_CAMERA_FIXED_META[String(metadata.camera_fixed ?? metadata.video_camera_fixed ?? task.videoCameraFixed ?? task.video_camera_fixed ?? '')]
                ? String(metadata.camera_fixed ?? metadata.video_camera_fixed ?? task.videoCameraFixed ?? task.video_camera_fixed)
                : DEFAULT_STATE.videoCameraFixed,
            model: String(task.model || 'gpt-image'),
            modelProviderId,
            providerId: modelProviderId,
            billingMode: ['points', 'api'].includes(billingMode) ? String(billingMode) : 'points',
            apiBaseUrl,
            apiProvider: getApiBaseProfile(apiBaseUrl)?.label || '',
            apiModelGroup: ['chat', 'image', 'video'].includes(task.apiModelGroup || task.api_model_group) ? String(task.apiModelGroup || task.api_model_group) : '',
            apiKeyTail: String(task.apiKeyTail || task.api_key_tail || '').slice(-8),
            tokenUsage: clampNumber(tokenUsage, 0, 9999999, 0),
            inputTokens: clampNumber(inputTokens, 0, 9999999, 0),
            outputTokens: clampNumber(outputTokens, 0, 9999999, 0),
            cachedTokens: clampNumber(cachedTokens, 0, 9999999, 0),
            tokenUsageRaw: rawTokenUsage && typeof rawTokenUsage === 'object' && !Array.isArray(rawTokenUsage) ? rawTokenUsage : {},
            billingSyncStatus: String(task.billingSyncStatus || task.billing_sync_status || metadata.sub2api_billing_sync?.status || metadata.sub2apiBillingSync?.status || '').trim(),
            billingSyncMessage: String(task.billingSyncMessage || task.billing_sync_message || metadata.sub2api_billing_sync?.message || metadata.sub2apiBillingSync?.message || '').trim(),
            providerTaskId: String(task.providerTaskId || task.provider_task_id || metadata.provider_task_id || metadata.providerTaskId || metadata.provider_async?.provider_task_id || metadata.providerAsync?.providerTaskId || '').trim(),
            quantity: clampNumber(
                Number.isFinite(requestedImageCount) && requestedImageCount > 0 ? requestedImageCount : task.quantity,
                1,
                4,
                2
            ),
            agent: agentId,
            cost: clampNumber(cost, 0, 9999, 0),
            estimatedPoints: clampNumber(estimatedPoints, 0, 9999, 0),
            chargedPoints: clampNumber(chargedPoints, 0, 9999, 0),
            queuePosition: Number.isFinite(queuePosition) ? Math.max(0, Math.round(queuePosition)) : null,
            estimatedWaitSeconds: Number.isFinite(estimatedWaitSeconds) ? Math.max(0, Math.round(estimatedWaitSeconds)) : null,
            createdAt,
            startedAt,
            completedAt,
            generationCompletedAt,
            updatedAt,
            images: Array.isArray(serverImages) ? serverImages.slice(0, 4).map((image, index) => normalizeResultImage(image, index, task)).filter(Boolean) : [],
            deliveredImageCount: Number.isFinite(deliveredImageCount) && deliveredImageCount >= 0 ? deliveredImageCount : 0,
            resultPrompt: String(task.resultPrompt || task.result_prompt || ''),
            reasoningText: String(task.reasoningText || task.reasoning_text || metadata.reasoning_content || metadata.reasoningContent || '').slice(0, 12000),
            reasoningStartedAt: Number(task.reasoningStartedAt || task.reasoning_started_at || 0) || 0,
            reasoningCompletedAt: Number(task.reasoningCompletedAt || task.reasoning_completed_at || 0) || 0,
            reasoningExpanded: typeof task.reasoningExpanded === 'boolean'
                ? task.reasoningExpanded
                : (typeof task.reasoning_expanded === 'boolean' ? task.reasoning_expanded : undefined),
            metadata,
            errorCode,
            errorMessage,
            remoteError: errorMessage,
            source: String(task.source || (task.task_id || task.created_at ? 'remote' : 'local')).slice(0, 40),
            seen: isTaskSeen(task)
        };
    }

    function isTransientImageUrl(value = '') {
        return /^(data|blob):/i.test(String(value || '').trim());
    }

    function isDataImageUrl(value = '') {
        return /^data:image\/(png|jpe?g|webp);base64,/i.test(String(value || '').trim());
    }

    function setComposerError(message = '') {
        state.composerError = String(message || '').trim().slice(0, 240);
    }

    function clearComposerError() {
        setComposerError('');
    }

    function isCannotCancelChargedMessage(value = '') {
        return String(value || '').trim() === CANNOT_CANCEL_CHARGED_MESSAGE;
    }

    function syncCannotCancelComposerWarning() {
        if (!isCannotCancelChargedMessage(state.composerError)) return false;
        const hasActiveCannotCancelTask = state.tasks.some((task) => (
            isBusyTask(task)
            && (
                isCannotCancelChargedMessage(task.remoteError)
                || isCannotCancelChargedMessage(task.errorMessage)
            )
        ));
        if (hasActiveCannotCancelTask) return false;
        clearComposerError();
        return true;
    }

    function clearComposerReferences() {
        state.referenceImage = '';
        state.referenceTitle = '';
        state.referenceIntent = '';
        state.referenceImages = [];
        state.continuationImage = null;
    }

    function isTaskSeen(task = {}) {
        const ids = [
            task.id,
            task.clientTaskId,
            task.taskId,
            task.task_id
        ].map((value) => String(value || '').trim()).filter(Boolean);
        return Boolean(ids.some((id) => seenTaskIds.has(id)) || task.seen);
    }

    function markTaskSeen(task = {}) {
        [
            task.id,
            task.clientTaskId,
            task.taskId,
            task.task_id
        ].map((value) => String(value || '').trim()).filter(Boolean).forEach((id) => seenTaskIds.add(id));
        if (task?.id) task.seen = true;
    }

    function markTaskThreadSeen(taskOrId = '') {
        const task = typeof taskOrId === 'string'
            ? state.tasks.find((item) => item.id === taskOrId)
            : taskOrId;
        if (!task) return false;
        getTaskThread(getTaskThreadRoot(task) || task).forEach(markTaskSeen);
        return true;
    }

    function mergeTaskSnapshots(localTask = {}, remoteTask = {}) {
        const remoteStatus = normalizeTaskStatus(remoteTask.status || localTask.status);
        const localStatus = normalizeTaskStatus(localTask.status);
        const keepLocalSucceeded = localStatus === 'succeeded' && remoteStatus !== 'succeeded';
        const keepLocalCancel = localStatus === 'cancelled' && remoteStatus !== 'failed';
        const keepLocalStreaming = localStatus === 'streaming' && ['queued', 'processing'].includes(remoteStatus);
        const keepLocalProcessing = localStatus === 'processing' && remoteStatus === 'queued';
        const localQuantity = Number(localTask.quantity);
        const remoteQuantity = Number(remoteTask.quantity);
        const localDeliveredImageCount = Number(localTask.deliveredImageCount);
        const remoteDeliveredImageCount = Number(remoteTask.deliveredImageCount);
        const localImages = Array.isArray(localTask.images) ? localTask.images : [];
        const remoteImages = Array.isArray(remoteTask.images) ? remoteTask.images : [];
        const shouldPreserveLocalQuantity = Number.isFinite(localQuantity)
            && Number.isFinite(remoteQuantity)
            && localQuantity > remoteQuantity;
        const nextQuantity = shouldPreserveLocalQuantity
            ? clampNumber(localQuantity, 1, 4, remoteQuantity)
            : (remoteTask.quantity ?? localTask.quantity);
        const expectedImageCount = clampNumber(nextQuantity, 1, 4, 1);
        const mergedMode = remoteTask.mode || localTask.mode || '';
        const keepLocalIncompleteRemoteSuccess = isBusyTask(localTask)
            && remoteStatus === 'succeeded'
            && !isTextVisionMode(mergedMode)
            && !isVideoMode(mergedMode)
            && remoteImages.length < expectedImageCount;
        const finalStatus = keepLocalSucceeded
            ? 'succeeded'
            : keepLocalCancel
                ? 'cancelled'
                : keepLocalStreaming
                    ? 'streaming'
                    : (keepLocalProcessing || keepLocalIncompleteRemoteSuccess ? 'processing' : remoteStatus);
        const localProgress = clampNumber(localTask.progress, 0, 100, 0);
        const remoteProgress = clampNumber(remoteTask.progress, 0, 100, 0);
        const busyFinalStatus = isBusyTask({ status: finalStatus });
        const localVisualProgress = isBusyTask(localTask)
            ? clampNumber(getTaskStageProgressPercent(localTask), 0, 100, localProgress)
            : localProgress;
        const remoteVisualProgress = isBusyTask(remoteTask)
            ? clampNumber(getTaskStageProgressPercent(remoteTask), 0, 100, remoteProgress)
            : remoteProgress;
        const keepLocalProgressKnown = busyFinalStatus
            && Boolean(localTask.progressKnown)
            && localProgress >= remoteProgress;
        const progressKnown = finalStatus === 'succeeded'
            || (!keepLocalIncompleteRemoteSuccess && Boolean(remoteTask.progressKnown))
            || keepLocalProgressKnown
            || (remoteTask.progress === undefined && Boolean(localTask.progressKnown));
        const nextProgress = keepLocalIncompleteRemoteSuccess
            ? Math.max(localProgress, localVisualProgress)
            : (finalStatus === 'succeeded'
                ? 100
                : (finalStatus === 'cancelled' || finalStatus === 'failed'
                    ? localProgress
                    : (progressKnown ? Math.max(localProgress, remoteProgress, localVisualProgress, remoteVisualProgress) : 0)));
        const keepLocalRuntimeClock = Boolean(localTask.id && remoteTask.id && localTask.id !== remoteTask.id && localTask.clientTaskId);
        const nextDeliveredImageCount = Number.isFinite(localDeliveredImageCount) || Number.isFinite(remoteDeliveredImageCount)
            ? Math.max(
                Number.isFinite(localDeliveredImageCount) ? localDeliveredImageCount : 0,
                Number.isFinite(remoteDeliveredImageCount) ? remoteDeliveredImageCount : 0
            )
            : remoteTask.deliveredImageCount;
        const runtimeStarts = [
            localTask.startedAt || localTask.createdAt || 0,
            remoteTask.startedAt || remoteTask.createdAt || 0
        ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
        const stableRuntimeStartedAt = runtimeStarts.length ? Math.min(...runtimeStarts) : 0;
        const nextStartedAt = busyFinalStatus && stableRuntimeStartedAt
            ? stableRuntimeStartedAt
            : (keepLocalRuntimeClock
                ? (localTask.startedAt || localTask.createdAt || remoteTask.startedAt || remoteTask.createdAt || 0)
                : (remoteTask.startedAt || localTask.startedAt || 0));
        const keepCannotCancelWarning = busyFinalStatus
            && (
                isCannotCancelChargedMessage(localTask.remoteError)
                || isCannotCancelChargedMessage(localTask.errorMessage)
            );
        const nextErrorMessage = finalStatus === 'succeeded'
            ? ''
            : (keepCannotCancelWarning ? CANNOT_CANCEL_CHARGED_MESSAGE : (remoteTask.errorMessage || localTask.errorMessage || ''));
        const nextRemoteError = finalStatus === 'succeeded'
            ? ''
            : (keepCannotCancelWarning ? CANNOT_CANCEL_CHARGED_MESSAGE : (remoteTask.remoteError || localTask.remoteError || ''));

        return {
            ...localTask,
            ...remoteTask,
            clientTaskId: remoteTask.clientTaskId || localTask.clientTaskId || '',
            quantity: nextQuantity,
            deliveredImageCount: nextDeliveredImageCount,
            createdAt: keepLocalRuntimeClock ? (localTask.createdAt || remoteTask.createdAt || 0) : (remoteTask.createdAt || localTask.createdAt || 0),
            startedAt: nextStartedAt,
            completedAt: keepLocalSucceeded ? (localTask.completedAt || remoteTask.completedAt || 0) : (remoteTask.completedAt || localTask.completedAt || 0),
            generationCompletedAt: remoteTask.generationCompletedAt || localTask.generationCompletedAt || 0,
            updatedAt: Math.max(Number(localTask.updatedAt || 0), Number(remoteTask.updatedAt || 0)),
            status: finalStatus,
            progress: nextProgress,
            progressKnown,
            images: remoteImages.length ? remoteImages : localImages,
            errorMessage: nextErrorMessage,
            remoteError: nextRemoteError,
            resultPrompt: keepLocalCancel
                ? (localTask.resultPrompt || remoteTask.resultPrompt || '')
                : (keepLocalStreaming
                ? (localTask.resultPrompt || remoteTask.resultPrompt || '')
                : (remoteTask.resultPrompt || localTask.resultPrompt || '')),
            reasoningText: remoteTask.reasoningText || localTask.reasoningText || '',
            reasoningStartedAt: localTask.reasoningStartedAt || remoteTask.reasoningStartedAt || 0,
            reasoningCompletedAt: localTask.reasoningCompletedAt || remoteTask.reasoningCompletedAt || 0,
            reasoningExpanded: typeof localTask.reasoningExpanded === 'boolean'
                ? localTask.reasoningExpanded
                : remoteTask.reasoningExpanded,
            metadata: {
                ...(localTask.metadata || {}),
                ...(remoteTask.metadata || {})
            },
            queuePosition: remoteTask.queuePosition ?? localTask.queuePosition ?? null,
            estimatedWaitSeconds: remoteTask.estimatedWaitSeconds ?? localTask.estimatedWaitSeconds ?? null,
            seen: Boolean(isTaskSeen(localTask) || isTaskSeen(remoteTask))
        };
    }

    function isKimiModelProfile(modelId = '', apiBaseUrl = '') {
        return /kimi|moonshot/.test(`${String(modelId || '').toLowerCase()} ${String(apiBaseUrl || '').toLowerCase()}`);
    }

    function getKimiThinkingCapabilityKey({
        model = getActiveModelValue('chat'),
        billingMode = state.billingMode,
        apiBaseUrl = state.apiBaseUrl,
        site = getRuntimeSite()
    } = {}) {
        const normalizedModel = String(model || '').trim().toLowerCase();
        if (!normalizedModel) return '';
        const normalizedBilling = ['points', 'api'].includes(billingMode) ? billingMode : 'points';
        const normalizedBaseUrl = normalizedBilling === 'api' ? normalizeApiBaseUrl(apiBaseUrl || '') : '';
        return [
            String(site || getRuntimeSite()).trim().toLowerCase(),
            normalizedBilling,
            normalizedBaseUrl,
            normalizedModel
        ].map((part) => String(part || '').replace(/\|/g, '%7C')).join('|');
    }

    function isKimiThinkingCapabilityVerified({
        model = getActiveModelValue('chat'),
        billingMode = state.billingMode,
        apiBaseUrl = state.apiBaseUrl,
        site = getRuntimeSite()
    } = {}) {
        const key = getKimiThinkingCapabilityKey({ model, billingMode, apiBaseUrl, site });
        return Boolean(key && normalizeStringList(state.verifiedKimiThinkingModels, 100).includes(key));
    }

    function isKimiThinkingVerificationInFlight({
        model = getActiveModelValue('chat'),
        billingMode = state.billingMode,
        apiBaseUrl = state.apiBaseUrl
    } = {}) {
        const key = getKimiThinkingCapabilityKey({ model, billingMode, apiBaseUrl });
        if (!key) return false;
        return getBusyTasks().some((task) => {
            if (task.mode !== 'chat' || !taskHasReasoningCapability(task)) return false;
            return getKimiThinkingCapabilityKey({
                model: task.model,
                billingMode: task.billingMode,
                apiBaseUrl: task.apiBaseUrl
            }) === key;
        });
    }

    function getTaskReasoningDiagnostic(task = {}) {
        const metadata = task?.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
            ? task.metadata
            : {};
        const diagnostic = metadata.reasoning_diagnostic || metadata.reasoningDiagnostic || {};
        return diagnostic && typeof diagnostic === 'object' && !Array.isArray(diagnostic) ? diagnostic : {};
    }

    function taskHasReasoningCapability(task = {}) {
        const metadata = task?.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
            ? task.metadata
            : {};
        const reasoningText = String(
            task.reasoningText
            || task.reasoning_text
            || metadata.reasoning_content
            || metadata.reasoningContent
            || ''
        ).trim();
        if (reasoningText) return true;
        const diagnostic = getTaskReasoningDiagnostic(task);
        const reasoningPayloads = Number(diagnostic.reasoning_payloads ?? diagnostic.reasoningPayloads ?? 0);
        const reasoningChars = Number(diagnostic.reasoning_chars ?? diagnostic.reasoningChars ?? 0);
        return (Number.isFinite(reasoningPayloads) && reasoningPayloads > 0)
            || (Number.isFinite(reasoningChars) && reasoningChars > 0);
    }

    function maybeRememberKimiThinkingCapability(task = {}) {
        if (!task || task.mode !== 'chat') return false;
        const model = String(task.model || '').trim();
        const apiBaseUrl = normalizeApiBaseUrl(task.apiBaseUrl || task.api_base_url || '');
        const billingMode = ['points', 'api'].includes(task.billingMode || task.billing_mode)
            ? String(task.billingMode || task.billing_mode)
            : state.billingMode;
        if (!isKimiModelProfile(model, apiBaseUrl)) return false;
        if (!taskHasReasoningCapability(task)) return false;
        const key = getKimiThinkingCapabilityKey({ model, billingMode, apiBaseUrl });
        if (!key) return false;
        const existing = normalizeStringList(state.verifiedKimiThinkingModels, 100);
        if (existing.includes(key)) return false;
        state.verifiedKimiThinkingModels = normalizeStringList([key, ...existing], 100);
        return true;
    }

    function maybeClearComposerReferencesAfterTaskSuccess(task = {}, previousTask = {}) {
        if (!task || task.status !== 'succeeded') return false;
        if (previousTask?.status === 'succeeded') return false;
        const taskReferenceUrls = new Set([
            task.referenceImage,
            ...(task.referenceImages || []).map((item) => item?.image)
        ].filter(Boolean));
        const currentReferenceUrls = [
            state.referenceImage,
            state.continuationImage?.image,
            ...(state.referenceImages || []).map((item) => item?.image)
        ].filter(Boolean);
        const referencesMatch = currentReferenceUrls.some((url) => taskReferenceUrls.has(url))
            || Boolean(state.continuationImage?.taskId && (state.continuationImage.taskId === task.parentTaskId || state.continuationImage.taskId === task.referenceTaskId));
        if (!referencesMatch) return false;
        clearComposerReferences();
        return true;
    }

    function taskHasPendingOriginal(task = {}) {
        if (!task || task.status !== 'succeeded') return false;
        return (task.images || []).some((image) => (
            image?.preview
            && !image.originalReady
            && !['failed', 'missing'].includes(String(image.originalStatus || '').toLowerCase())
        ));
    }

    function getPendingOriginalTasks() {
        return state.tasks.filter(taskHasPendingOriginal);
    }

    function shouldPollRemoteRecords() {
        return getRemotePollBusyTasks().length > 0 || getPendingOriginalTasks().length > 0;
    }

    function getBusyImageGenerationTasks() {
        return state.tasks.filter((task) => isBusyTask(task) && isImageGenerationMode(task.mode));
    }

    function requestFastRemoteRecordsPoll(rounds = REMOTE_RECORDS_FAST_POLL_ROUNDS) {
        if (!Number.isFinite(rounds) || rounds <= 0) return;
        remoteFastPollsRemaining = Math.max(remoteFastPollsRemaining, Math.floor(rounds));
    }

    function getRemoteRecordsPollDelayMs({ consume = false } = {}) {
        const hasBusyImageTasks = getBusyImageGenerationTasks().length > 0;
        if (!hasBusyImageTasks) {
            remoteFastPollsRemaining = 0;
            return REMOTE_RECORDS_POLL_DEFAULT_MS;
        }
        if (remoteFastPollsRemaining <= 0) return REMOTE_RECORDS_POLL_DEFAULT_MS;

        const warmThreshold = Math.max(0, REMOTE_RECORDS_FAST_POLL_ROUNDS - REMOTE_RECORDS_FAST_POLL_FAST_ROUNDS);
        const delayMs = remoteFastPollsRemaining > warmThreshold
            ? REMOTE_RECORDS_POLL_FAST_MS
            : REMOTE_RECORDS_POLL_WARM_MS;
        if (consume) {
            remoteFastPollsRemaining = Math.max(0, remoteFastPollsRemaining - 1);
        }
        return delayMs;
    }

    function shouldIncludeUsageForRemotePoll(delayMs = REMOTE_RECORDS_POLL_DEFAULT_MS) {
        if (delayMs >= REMOTE_RECORDS_POLL_DEFAULT_MS) return true;
        return remoteFastPollsRemaining % 6 === 0;
    }

    function getTaskSnapshotSignature(task = {}) {
        return JSON.stringify({
            id: task.id || '',
            clientTaskId: task.clientTaskId || '',
            parentTaskId: task.parentTaskId || '',
            mode: task.mode || '',
            status: task.status || '',
            progress: Math.round(clampNumber(task.progress, 0, 100, 0)),
            progressKnown: Boolean(task.progressKnown),
            prompt: task.prompt || '',
            referenceImage: task.referenceImage || '',
            referenceTitle: task.referenceTitle || '',
            referenceImages: normalizeReferenceList(task.referenceImages || []),
            ratio: task.ratio || '',
            resolution: task.resolution || '',
            videoDuration: task.videoDuration || '',
            videoAudio: task.videoAudio || '',
            videoWatermark: task.videoWatermark || '',
            videoCameraFixed: task.videoCameraFixed || '',
            model: task.model || '',
            billingMode: task.billingMode || '',
            quantity: task.quantity || 0,
            deliveredImageCount: task.deliveredImageCount || 0,
            agent: task.agent || '',
            cost: task.cost || 0,
            startedAt: task.startedAt || 0,
            completedAt: task.completedAt || 0,
            updatedAt: task.updatedAt || 0,
            resultPrompt: task.resultPrompt || '',
            timing: getTaskTiming(task),
            errorCode: task.errorCode || '',
            errorMessage: task.errorMessage || '',
            remoteError: task.remoteError || '',
            images: (task.images || []).map((image) => ({
                src: image?.src || '',
                original: image?.original || '',
                preview: image?.preview || '',
                originalReady: Boolean(image?.originalReady),
                originalStatus: image?.originalStatus || '',
                previewBytes: normalizeByteCount(image?.previewBytes),
                originalBytes: normalizeByteCount(image?.originalBytes),
                resultId: image?.resultId || '',
                taskId: image?.taskId || '',
                index: image?.index ?? ''
            }))
        });
    }

    function getTasksSnapshotSignature(tasks = state.tasks) {
        return tasks.map(getTaskSnapshotSignature).join('|');
    }

    function getHistoryPrefs() {
        state.historyPrefs = normalizeHistoryPrefs(state.historyPrefs);
        return state.historyPrefs;
    }

    function mergeHistoryPrefs(basePrefs = {}, localPrefs = {}) {
        const base = normalizeHistoryPrefs(basePrefs);
        const local = normalizeHistoryPrefs(localPrefs);
        const deletedTaskIds = normalizeStringList([...base.deletedTaskIds, ...local.deletedTaskIds], 160);
        const pinnedTaskIds = normalizeStringList([...base.pinnedTaskIds, ...local.pinnedTaskIds], 120);
        return normalizeHistoryPrefs({
            deletedTaskIds,
            pinnedTaskIds,
            taskAccentById: {
                ...local.taskAccentById,
                ...base.taskAccentById
            }
        });
    }

    function applyRemoteHistoryPrefs(rawPrefs = {}, { mergeLocal = false } = {}) {
        const currentPrefs = getHistoryPrefs();
        const nextPrefs = mergeLocal
            ? mergeHistoryPrefs(rawPrefs, currentPrefs)
            : normalizeHistoryPrefs(rawPrefs);
        const beforeSignature = JSON.stringify(currentPrefs);
        state.historyPrefs = nextPrefs;
        state.tasks = state.tasks.filter((task) => !isHistoryTaskDeleted(task));
        pruneHistorySelections();
        if (state.activeTaskId && !state.tasks.some((task) => task.id === state.activeTaskId)) {
            state.activeTaskId = '';
        }
        return beforeSignature !== JSON.stringify(nextPrefs);
    }

    function getServerHistoryIds(ids = []) {
        return normalizeStringList(ids, 100).filter(isUuid);
    }

    function syncHistoryPrefs(action, ids = [], accent = '') {
        const taskIds = getServerHistoryIds(ids);
        if (!taskIds.length) return Promise.resolve(null);
        const syncId = ++historyPrefsSyncInFlight;
        historyPrefsMutationSerial = historyPrefsMutationSerial.then
            ? historyPrefsMutationSerial
            : Promise.resolve();
        const request = () => requestAiImage('task-prefs', {
            method: 'POST',
            body: {
                site: getRuntimeSite(),
                action,
                taskIds,
                accent
            },
            auth: true
        });
        historyPrefsMutationSerial = historyPrefsMutationSerial
            .catch(() => null)
            .then(request);
        return historyPrefsMutationSerial
            .then((payload) => {
                if (payload?.unavailable) return payload;
                if (syncId !== historyPrefsSyncInFlight) return payload;
                const changed = applyRemoteHistoryPrefs(payload?.prefs || payload?.historyPrefs || payload?.history_prefs || {});
                state.historyPrefsRemoteSynced = true;
                persistState();
                if (changed) {
                    render();
                }
                return payload;
            })
            .catch((error) => {
                console.warn('[AIImageWorkbench] Failed to sync history preferences:', error?.message || error);
                return null;
            });
    }

    function syncHistoryPrefsForIds(ids = []) {
        const taskIds = getServerHistoryIds(ids);
        if (!taskIds.length) return;
        const prefs = getHistoryPrefs();
        const deletedIds = taskIds.filter((id) => prefs.deletedTaskIds.includes(id));
        const pinnedIds = taskIds.filter((id) => prefs.pinnedTaskIds.includes(id));
        if (deletedIds.length) {
            syncHistoryPrefs('hide', deletedIds);
        }
        if (pinnedIds.length) {
            syncHistoryPrefs('pin', pinnedIds);
        }
        const idsByAccent = taskIds.reduce((nextMap, id) => {
            const accent = prefs.taskAccentById[id] || '';
            if (!accent) return nextMap;
            if (!nextMap[accent]) nextMap[accent] = [];
            nextMap[accent].push(id);
            return nextMap;
        }, {});
        Object.entries(idsByAccent).forEach(([accent, accentIds]) => {
            syncHistoryPrefs('accent', accentIds, accent);
        });
    }

    function migrateHistoryPrefsTaskId(fromId = '', toId = '') {
        const sourceId = String(fromId || '').trim();
        const targetId = String(toId || '').trim();
        if (!sourceId || !targetId || sourceId === targetId) return false;
        const prefs = getHistoryPrefs();
        let changed = false;
        const deleted = prefs.deletedTaskIds.map((id) => (id === sourceId ? targetId : id));
        const pinned = prefs.pinnedTaskIds.map((id) => (id === sourceId ? targetId : id));
        const taskAccentById = { ...prefs.taskAccentById };
        if (Object.prototype.hasOwnProperty.call(taskAccentById, sourceId) && !taskAccentById[targetId]) {
            taskAccentById[targetId] = taskAccentById[sourceId];
        }
        if (Object.prototype.hasOwnProperty.call(taskAccentById, sourceId)) {
            delete taskAccentById[sourceId];
        }
        const nextPrefs = normalizeHistoryPrefs({
            deletedTaskIds: deleted,
            pinnedTaskIds: pinned,
            taskAccentById
        });
        changed = JSON.stringify(nextPrefs) !== JSON.stringify(prefs);
        if (changed) {
            state.historyPrefs = nextPrefs;
        }
        return changed;
    }

    function getTaskThreadId(task = {}) {
        return String((getTaskThreadRoot(task) || task)?.id || task?.id || '').trim();
    }

    function isHistoryTaskDeleted(task = {}) {
        const taskId = String(task?.id || '').trim();
        const rootId = getTaskThreadId(task);
        const deleted = new Set(getHistoryPrefs().deletedTaskIds);
        return Boolean((taskId && deleted.has(taskId)) || (rootId && deleted.has(rootId)));
    }

    function isHistoryTaskPinned(task = {}) {
        const rootId = getTaskThreadId(task);
        return Boolean(rootId && getHistoryPrefs().pinnedTaskIds.includes(rootId));
    }

    function getHistoryTaskAccent(task = {}) {
        const rootId = getTaskThreadId(task);
        return rootId ? (getHistoryPrefs().taskAccentById[rootId] || '') : '';
    }

    function pruneHistorySelections() {
        const availableIds = new Set(getHistoryThreadRows().map((row) => row.id).filter(Boolean));
        selectedHistoryTaskIds = new Set(Array.from(selectedHistoryTaskIds).filter((id) => availableIds.has(id)));
        if (!selectedHistoryTaskIds.size) {
            openHistoryAccentMenu = false;
        }
    }

    function getSelectedHistoryIds() {
        pruneHistorySelections();
        return Array.from(selectedHistoryTaskIds);
    }

    function setHistorySelectionMode(enabled) {
        historySelectionMode = Boolean(enabled);
        if (!historySelectionMode) {
            selectedHistoryTaskIds = new Set();
            openHistoryAccentMenu = false;
        } else {
            setSidebarView('history');
            pruneHistorySelections();
        }
    }

    function toggleHistorySelection(taskId = '') {
        const normalized = String(taskId || '').trim();
        if (!normalized) return;
        if (selectedHistoryTaskIds.has(normalized)) {
            selectedHistoryTaskIds.delete(normalized);
        } else {
            selectedHistoryTaskIds.add(normalized);
        }
        historySelectionMode = true;
        pruneHistorySelections();
    }

    function toggleAllHistorySelections() {
        const rowIds = getFilteredHistoryRows(getHistoryThreadRows()).map((row) => row.id).filter(Boolean);
        if (!rowIds.length) return;
        const allSelected = rowIds.every((id) => selectedHistoryTaskIds.has(id));
        selectedHistoryTaskIds = allSelected ? new Set() : new Set(rowIds);
        historySelectionMode = true;
        openHistoryAccentMenu = false;
    }

    function deleteSelectedHistoryTasks() {
        const ids = getSelectedHistoryIds();
        if (!ids.length) return;
        const prefs = getHistoryPrefs();
        const deleted = new Set([...prefs.deletedTaskIds, ...ids]);
        state.historyPrefs = {
            ...prefs,
            deletedTaskIds: Array.from(deleted)
        };
        state.tasks = state.tasks.filter((task) => !isHistoryTaskDeleted(task));
        const activeThreadId = getTaskThreadId(getActiveTask());
        if (state.activeTaskId && (ids.includes(activeThreadId) || !state.tasks.some((task) => task.id === state.activeTaskId))) {
            state.activeTaskId = '';
        }
        selectedHistoryTaskIds = new Set();
        openHistoryAccentMenu = false;
        persistState();
        render();
        syncHistoryPrefs('hide', ids);
    }

    function pinSelectedHistoryTasks() {
        const ids = getSelectedHistoryIds();
        if (!ids.length) return;
        const prefs = getHistoryPrefs();
        const pinned = new Set([...ids, ...prefs.pinnedTaskIds]);
        state.historyPrefs = {
            ...prefs,
            pinnedTaskIds: Array.from(pinned)
        };
        openHistoryAccentMenu = false;
        persistState();
        render();
        syncHistoryPrefs('pin', ids);
    }

    function unpinSelectedHistoryTasks() {
        const ids = getSelectedHistoryIds();
        const idSet = new Set(ids);
        if (!idSet.size) return;
        const prefs = getHistoryPrefs();
        state.historyPrefs = {
            ...prefs,
            pinnedTaskIds: prefs.pinnedTaskIds.filter((id) => !idSet.has(id))
        };
        openHistoryAccentMenu = false;
        persistState();
        render();
        syncHistoryPrefs('unpin', ids);
    }

    function setSelectedHistoryAccent(accent = '') {
        const ids = getSelectedHistoryIds();
        if (!ids.length) return;
        const normalizedAccent = String(accent || '').trim();
        const allowed = new Set(HISTORY_ACCENTS.map((item) => item.id));
        const prefs = getHistoryPrefs();
        const taskAccentById = { ...prefs.taskAccentById };
        ids.forEach((id) => {
            if (allowed.has(normalizedAccent)) {
                taskAccentById[id] = normalizedAccent;
            } else {
                delete taskAccentById[id];
            }
        });
        state.historyPrefs = {
            ...prefs,
            taskAccentById
        };
        openHistoryAccentMenu = false;
        persistState();
        render();
        syncHistoryPrefs(allowed.has(normalizedAccent) ? 'accent' : 'clear-accent', ids, normalizedAccent);
    }

    function mergeRemoteTasks(remoteTasks = []) {
        const normalized = remoteTasks.map(normalizeTask).filter(Boolean);
        if (!normalized.length) return false;
        const beforeSignature = getTasksSnapshotSignature();
        const beforeContinuationImage = JSON.stringify(state.continuationImage || null);
        const beforeActiveTaskId = state.activeTaskId || '';
        const byId = new Map(state.tasks.map((task) => [task.id, task]));
        const idReplacements = new Map();
        let capabilityChanged = false;
        normalized.forEach((remoteTask) => {
            let mergeId = remoteTask.id;
            if (!byId.has(mergeId) && remoteTask.clientTaskId) {
                const matchedLocal = Array.from(byId.values()).find((task) => (
                    task.id === remoteTask.clientTaskId
                    || task.clientTaskId === remoteTask.clientTaskId
                ));
                if (matchedLocal?.id) {
                    mergeId = matchedLocal.id;
                }
            }

            const localTask = byId.get(mergeId) || {};
            const isHydratedRemoteHistory = !localTask.id && remoteTask.source === 'remote' && remoteTask.status === 'succeeded';
            if (isHydratedRemoteHistory) markTaskSeen(remoteTask);
            const nextTask = mergeTaskSnapshots(localTask, remoteTask);
            if (mergeId !== nextTask.id) {
                byId.delete(mergeId);
                idReplacements.set(mergeId, nextTask.id);
            }
            byId.set(nextTask.id, nextTask);
            capabilityChanged = maybeRememberKimiThinkingCapability(nextTask) || capabilityChanged;
        });
        const seen = new Set();
        state.tasks = Array.from(byId.values())
            .filter((task) => {
                if (!task?.id || seen.has(task.id)) return false;
                if (isHistoryTaskDeleted(task)) return false;
                seen.add(task.id);
                return true;
            })
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, MAX_LOCAL_TASKS);
        if (idReplacements.size) {
            const migratedIds = [];
            state.tasks.forEach((task) => {
                if (idReplacements.has(task.parentTaskId)) {
                    task.parentTaskId = idReplacements.get(task.parentTaskId);
                }
                if (idReplacements.has(task.referenceTaskId)) {
                    task.referenceTaskId = idReplacements.get(task.referenceTaskId);
                }
            });
            if (state.continuationImage?.taskId && idReplacements.has(state.continuationImage.taskId)) {
                state.continuationImage = normalizeReferenceItem({
                    ...state.continuationImage,
                    taskId: idReplacements.get(state.continuationImage.taskId)
                });
            }
            idReplacements.forEach((toId, fromId) => {
                if (migrateHistoryPrefsTaskId(fromId, toId)) {
                    migratedIds.push(toId);
                }
                if (selectedHistoryTaskIds.has(fromId)) {
                    selectedHistoryTaskIds.delete(fromId);
                    selectedHistoryTaskIds.add(toId);
                }
                if (seenTaskIds.has(fromId)) {
                    seenTaskIds.add(toId);
                }
            });
            if (idReplacements.has(state.activeTaskId)) {
                state.activeTaskId = idReplacements.get(state.activeTaskId);
            }
            if (migratedIds.length) {
                syncHistoryPrefsForIds(migratedIds);
            }
        }
        if (state.activeTaskId && !state.tasks.some((task) => task.id === state.activeTaskId)) {
            state.activeTaskId = '';
        }
        const composerWarningChanged = syncCannotCancelComposerWarning();
        return capabilityChanged
            || beforeSignature !== getTasksSnapshotSignature()
            || beforeContinuationImage !== JSON.stringify(state.continuationImage || null)
            || beforeActiveTaskId !== (state.activeTaskId || '')
            || composerWarningChanged;
    }

    async function loadRemoteConfig({ force = false } = {}) {
        if (remoteConfigLoaded && !force) return remoteConfigAvailable;
        if (remoteConfigPromise) return remoteConfigPromise;

        remoteConfigPromise = (async () => {
            try {
                const site = getRuntimeSite();
                const pricingPayload = await requestAiImage('pricing', { query: { site }, auth: 'optional' });
                if (!pricingPayload || pricingPayload.success === false || !Array.isArray(pricingPayload.pricing)) {
                    throw new Error('价格配置响应无效');
                }
                runtimePricingRules = pricingPayload.pricing;
                updateRuntimeApiBaseProfiles(pricingPayload.api_base_urls || []);
                updateRuntimeApiModels(pricingPayload || {}, { target: 'admin' });
                applyRuntimeModelCache(state.apiBaseUrl);
                updateStoredApiKeyStatuses(pricingPayload.storedApiKeys || pricingPayload.stored_api_keys || []);
                remoteConfigAvailable = true;
                return true;
            } catch (error) {
                remoteConfigAvailable = false;
                console.warn('[AIImageWorkbench] Remote config unavailable:', error?.message || error);
                return false;
            } finally {
                remoteConfigLoaded = true;
                remoteConfigPromise = null;
                render();
            }
        })();
        return remoteConfigPromise;
    }

    async function refreshPricingAfterChange(error = {}) {
        if (String(error?.code || '').trim() !== 'pricing_changed') return false;
        remoteConfigLoaded = false;
        await loadRemoteConfig({ force: true });
        setComposerError('计价标准刚刚更新，请确认最新价格后重新提交。');
        return true;
    }

    async function discoverRuntimeApiModels() {
        if (modelDiscoveryState.loading) return;
        const normalizedBaseUrl = normalizeApiBaseUrl(state.apiBaseUrl || getDefaultApiBaseUrl());
        if (!state.billingMode || state.billingMode !== 'api') {
            state.billingMode = 'api';
        }
        if (!isConfiguredApiBaseUrl(normalizedBaseUrl)) {
            modelDiscoveryState = {
                loading: false,
                message: '请先让管理员配置可用的 Base URL。',
                tone: 'warning'
            };
            setSidebarView('billing');
            render();
            return;
        }
        if (!hasUsableApiKey()) {
            modelDiscoveryState = {
                loading: false,
                message: '请先输入或保存 API Key 后再检测模型。',
                tone: 'warning'
            };
            setSidebarView('billing');
            render();
            root?.querySelector?.('[data-aiw-api-key]')?.focus?.();
            return;
        }

        modelDiscoveryState = {
            loading: true,
            message: '正在检测上游支持的模型...',
            tone: ''
        };
        setSidebarView('billing');
        render();

        try {
            const payload = await requestAiImage('models', {
                method: 'POST',
                body: {
                    site: getRuntimeSite(),
                    apiBaseUrl: normalizedBaseUrl,
                    apiKey: String(state.apiKey || '').trim()
                },
                auth: true
            });
            updateRuntimeApiModels(payload || {}, { cache: true, apiBaseUrl: normalizedBaseUrl });
            const detectedCount = uniqueModelOptions([
                ...(Array.isArray(payload?.chat_models) ? payload.chat_models.map((item) => normalizeRuntimeModelOption(item)) : []),
                ...(Array.isArray(payload?.image_models) ? payload.image_models.map((item) => normalizeRuntimeModelOption(item)) : []),
                ...(Array.isArray(payload?.video_models) ? payload.video_models.map((item) => normalizeRuntimeModelOption(item)) : [])
            ].filter(Boolean)).length;
            modelDiscoveryState = {
                loading: false,
                message: detectedCount
                    ? `已检测到 ${detectedCount} 个上游模型，模型下拉已更新。`
                    : '检测完成，但上游没有返回可识别的模型列表。',
                tone: detectedCount ? 'success' : 'warning'
            };
            persistState();
            render();
        } catch (error) {
            modelDiscoveryState = {
                loading: false,
                message: error?.message || '模型检测失败，请确认 API Key 是否可用。',
                tone: 'warning'
            };
            render();
        }
    }

    async function loadRemoteHistoryPrefs({ force = false } = {}) {
        if (remoteHistoryPrefsLoaded && !force) return;
        try {
            const payload = await requestAiImage('task-prefs', {
                query: {
                    site: getRuntimeSite()
                },
                auth: true
            });
            remoteHistoryPrefsLoaded = true;
            if (payload?.unavailable) return;
            const remotePrefs = normalizeHistoryPrefs(payload?.prefs || payload?.historyPrefs || payload?.history_prefs || {});
            const beforePrefs = getHistoryPrefs();
            const beforeSignature = JSON.stringify(beforePrefs);
            const shouldMergeLocal = !state.historyPrefsRemoteSynced;
            const changed = applyRemoteHistoryPrefs(remotePrefs, { mergeLocal: shouldMergeLocal });
            state.historyPrefsRemoteSynced = true;
            const missingRemoteIds = new Set();
            if (shouldMergeLocal) {
                beforePrefs.deletedTaskIds.forEach((id) => {
                    if (!remotePrefs.deletedTaskIds.includes(id)) missingRemoteIds.add(id);
                });
                beforePrefs.pinnedTaskIds.forEach((id) => {
                    if (!remotePrefs.pinnedTaskIds.includes(id)) missingRemoteIds.add(id);
                });
                Object.entries(beforePrefs.taskAccentById).forEach(([id, accent]) => {
                    if (remotePrefs.taskAccentById[id] !== accent) missingRemoteIds.add(id);
                });
            }
            if (changed || beforeSignature !== JSON.stringify(getHistoryPrefs())) {
                render();
            }
            persistState();
            const syncIds = getServerHistoryIds(Array.from(missingRemoteIds));
            if (syncIds.length) {
                syncHistoryPrefsForIds(syncIds);
            }
        } catch (error) {
            const message = String(error?.message || error || '');
            remoteHistoryPrefsLoaded = !/请先登录|unauthorized|auth/i.test(message);
            if (!remoteHistoryPrefsLoaded) {
                resetUserScopedWorkbenchData();
                return;
            }
            console.warn('[AIImageWorkbench] Remote history preferences unavailable, using local preferences:', error?.message || error);
        }
    }

    async function loadRemoteRecords({ force = false, includeUsage = true } = {}) {
        if (remoteRecordsLoaded && !force) return;
        try {
            const beforeActivitySignature = getActivitySummarySignature();
            const beforeBusyCount = getRemotePollBusyTasks().length;
            const [payload, usagePayload] = await Promise.all([
                requestAiImage('tasks', {
                    query: {
                        site: getRuntimeSite(),
                        limit: MAX_LOCAL_TASKS
                    },
                    auth: true
                }),
                includeUsage ? requestAiImage('usage', {
                    query: {
                        site: getRuntimeSite(),
                        limit: MAX_LOCAL_TASKS
                    },
                    auth: true
                }).catch(() => null) : Promise.resolve(null)
            ]);
            if (usagePayload) {
                updateActivitySummary(usagePayload);
            }
            const tasksChanged = mergeRemoteTasks(payload.tasks || payload.records || []);
            const activityChanged = beforeActivitySignature !== getActivitySummarySignature();
            const previewChanged = syncImagePreviewFromTasks();
            if (imagePreview?.originalReady && !imagePreview.originalLoaded) {
                preloadImagePreviewOriginal();
            }
            remoteRecordsLoaded = true;
            const afterBusyCount = getRemotePollBusyTasks().length;
            const busySettled = beforeBusyCount > 0 && afterBusyCount === 0;
            lastBusyTaskCount = afterBusyCount;
            const preserveActiveChatStream = hasActiveChatStreamInCurrentThread();
            const renderRemoteSyncWithoutChat = () => {
                renderDock();
                if (state.open) renderHistoryPanelOnly();
            };
            if (tasksChanged || activityChanged || previewChanged) {
                persistState();
                if (preserveActiveChatStream && state.open) {
                    renderRemoteSyncWithoutChat();
                } else {
                    render();
                }
                if (!preserveActiveChatStream && state.open && getActiveTask()?.mode === 'chat') {
                    scrollChatStageToBottom();
                }
            }
            if (busySettled) {
                if (!state.open && getCompletedUnreadTasks().length) {
                    showDoneNotice();
                } else if (preserveActiveChatStream && state.open) {
                    renderRemoteSyncWithoutChat();
                } else {
                    render();
                    if (state.open && getActiveTask()?.mode === 'chat') {
                        scrollChatStageToBottom();
                    }
                }
            }
            if (getPendingOriginalTasks().length) {
                scheduleRemoteRecordsPoll();
            }
        } catch (error) {
            const message = String(error?.message || error || '');
            const authMissing = /请先登录|unauthorized|auth/i.test(message);
            remoteRecordsLoaded = !authMissing;
            if (authMissing) {
                resetUserScopedWorkbenchData();
                return;
            }
            console.warn('[AIImageWorkbench] Remote records unavailable, using local records:', error?.message || error);
        }
    }

    async function recoverRemoteTaskByClientId(localTask = {}) {
        const clientTaskId = String(localTask.clientTaskId || localTask.id || '').trim();
        if (!clientTaskId) return null;
        try {
            const payload = await requestAiImage('task', {
                query: {
                    site: getRuntimeSite(),
                    clientTaskId
                },
                auth: true
            });
            if (!payload?.task) return null;
            return replaceTask(localTask.id, payload.task);
        } catch (error) {
            if (!/task_not_found|任务不存在/i.test(String(error?.code || error?.message || error || ''))) {
                console.warn('[AIImageWorkbench] Chat stream recovery task lookup failed:', error?.message || error);
            }
            return null;
        }
    }

    function getRecoverableClientTaskId(task = {}) {
        const clientTaskId = String(task.clientTaskId || '').trim();
        if (clientTaskId) return clientTaskId;
        const localId = String(task.id || '').trim();
        return localId.startsWith('aiw_') ? localId : '';
    }

    function shouldRecoverBusyTaskByClientId(task = {}) {
        if (!isBusyTask(task)) return false;
        const clientTaskId = getRecoverableClientTaskId(task);
        if (!clientTaskId) return false;
        const createdAt = Number(task.createdAt || task.startedAt || 0);
        if (createdAt && Date.now() - createdAt < BUSY_CLIENT_TASK_RECOVERY_DELAY_MS) return false;
        const previousRecoveryAt = Number(busyClientTaskRecoveryAt.get(clientTaskId) || 0);
        return Date.now() - previousRecoveryAt >= BUSY_CLIENT_TASK_RECOVERY_INTERVAL_MS;
    }

    async function recoverBusyTasksByClientId({ limit = 4 } = {}) {
        const candidates = getRemotePollBusyTasks()
            .filter(shouldRecoverBusyTaskByClientId)
            .slice(0, limit);
        if (!candidates.length) return false;

        const recoveryStartedAt = Date.now();
        candidates.forEach((task) => {
            busyClientTaskRecoveryAt.set(getRecoverableClientTaskId(task), recoveryStartedAt);
        });

        const results = await Promise.allSettled(candidates.map((task) => recoverRemoteTaskByClientId(task)));
        const recoveredTasks = results
            .filter((result) => result.status === 'fulfilled' && result.value)
            .map((result) => result.value);
        recoveredTasks.forEach((task) => {
            if (!isBusyTask(task)) {
                const clientTaskId = getRecoverableClientTaskId(task);
                if (clientTaskId) busyClientTaskRecoveryAt.delete(clientTaskId);
            }
        });
        if (recoveredTasks.length) {
            syncImagePreviewFromTasks();
            persistState();
            render();
            if (state.open && getActiveTask()?.mode === 'chat') {
                scrollChatStageToBottom();
            }
        }
        return recoveredTasks.length > 0;
    }

    async function recoverChatStreamTask(localTask = {}) {
        if (!localTask?.id) return null;
        try {
            await loadRemoteRecords({ force: true });
        } catch (_) {
            // loadRemoteRecords already logs recoverable sync failures.
        }
        const currentTask = state.tasks.find((item) => (
            item.id === localTask.id
            || item.clientTaskId === localTask.id
            || item.id === localTask.clientTaskId
            || item.clientTaskId === localTask.clientTaskId
        ));
        if (currentTask && currentTask.id !== localTask.id) return currentTask;
        if (currentTask && currentTask.source === 'remote') return currentTask;
        return recoverRemoteTaskByClientId(localTask);
    }

    function getActiveTask() {
        if (!state.activeTaskId) return null;
        return state.tasks.find((task) => task.id === state.activeTaskId) || null;
    }

    function getImageUrl(image) {
        if (typeof image === 'string') return image;
        if (!image || typeof image !== 'object') return '';
        return String(image.original || image.originalImageUrl || image.original_image_url || '').trim();
    }

    function getImagePreviewUrl(image) {
        if (typeof image === 'string') return image;
        if (!image || typeof image !== 'object') return '';
        return String(image.preview || image.imageUrl || image.image_url || image.src || image.original || image.originalImageUrl || image.original_image_url || '').trim();
    }

    function getTaskPrimaryImage(task) {
        return getImagePreviewUrl(task?.images?.[0]) || getImageUrl(task?.images?.[0]) || task?.referenceImage || '';
    }

    function getTaskPrimaryMedia(task) {
        const media = task?.images?.[0] || null;
        const src = getImagePreviewUrl(media) || getImageUrl(media);
        return {
            src,
            record: media,
            isVideo: isVideoMode(task?.mode) || isVideoResultImage(media)
        };
    }

    function getTaskReferencePreviewImage(task = {}) {
        const firstReference = normalizeReferenceItem(task.referenceImages?.[0]);
        return String(task.referenceImage || firstReference?.image || '').trim();
    }

    function getImageOriginalStatusLabel(image = {}) {
        if (image?.originalReady) return '高清原图';
        const status = String(image?.originalStatus || '').toLowerCase();
        if (status === 'failed') return '原图转存失败';
        return '原图转存中';
    }

    function getResultImageByIdentity(taskId = '', resultId = '', resultIndex = '') {
        const normalizedTaskId = String(taskId || '').trim();
        const normalizedResultId = String(resultId || '').trim();
        const normalizedIndex = String(resultIndex ?? '').trim();
        for (const task of state.tasks) {
            const image = (task.images || []).find((item) => {
                if (normalizedResultId && String(item?.resultId || '').trim() === normalizedResultId) return true;
                if (normalizedTaskId && task.id !== normalizedTaskId && String(item?.taskId || '').trim() !== normalizedTaskId) return false;
                return normalizedIndex && String(item?.index ?? '').trim() === normalizedIndex;
            });
            if (image) return { task, image };
        }
        return null;
    }

    function getResultPreviewPayload(task = null, image = null, fallbackSrc = '') {
        const previewSrc = getImagePreviewUrl(image) || fallbackSrc || getImageUrl(image);
        const originalSrc = getImageUrl(image);
        const originalReady = Boolean(image?.originalReady && originalSrc);
        const taskTitle = task ? getTaskTitle(task) : '参考图片';
        const originalStatusLabel = image ? getImageOriginalStatusLabel(image) : '';
        const previewMeta = [
            task ? getTaskImageMeta(task) : '',
            originalStatusLabel,
            task ? formatGeneratedTime(task.completedAt || task.createdAt) : ''
        ].filter(Boolean).join(' · ') || '参考图片';
        return {
            previewSrc,
            originalSrc,
            originalReady,
            originalStatus: String(image?.originalStatus || '').trim(),
            title: taskTitle,
            meta: previewMeta,
            previewBytes: getResultImagePreviewBytes(image),
            originalBytes: getResultImageOriginalBytes(image),
            taskId: String(image?.taskId || task?.id || '').trim(),
            resultId: String(image?.resultId || '').trim(),
            resultIndex: String(image?.index ?? '').trim()
        };
    }

    function scrollToResultImage(taskId = '', resultId = '', resultIndex = '') {
        const selectors = [];
        const escapedTaskId = global.CSS?.escape ? global.CSS.escape(String(taskId || '')) : String(taskId || '').replace(/"/g, '\\"');
        const escapedResultId = global.CSS?.escape ? global.CSS.escape(String(resultId || '')) : String(resultId || '').replace(/"/g, '\\"');
        const escapedResultIndex = global.CSS?.escape ? global.CSS.escape(String(resultIndex ?? '')) : String(resultIndex ?? '').replace(/"/g, '\\"');
        if (resultId) selectors.push(`[data-aiw-preview-open][data-result-id="${escapedResultId}"]`);
        if (taskId && resultIndex !== '') selectors.push(`[data-aiw-preview-open][data-task-id="${escapedTaskId}"][data-result-index="${escapedResultIndex}"]`);
        if (taskId) selectors.push(`[data-aiw-preview-open][data-task-id="${escapedTaskId}"]`);
        const target = selectors.map((selector) => root?.querySelector?.(selector)).find(Boolean);
        if (!target) {
            setComposerError('底图暂未在当前对话中找到，请刷新生成记录后再试');
            render();
            return;
        }
        target.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        target.classList.add('is-located');
        global.setTimeout?.(() => target.classList.remove('is-located'), 1300);
    }

    function syncImagePreviewFromTasks() {
        if (!imagePreview?.taskId) return false;
        const matched = getResultImageByIdentity(imagePreview.taskId, imagePreview.resultId, imagePreview.resultIndex);
        if (!matched?.image) return false;
        const previewSrc = getImagePreviewUrl(matched.image) || imagePreview.previewSrc || imagePreview.src;
        const originalSrc = getImageUrl(matched.image);
        const originalReady = Boolean(matched.image.originalReady && originalSrc);
        const originalStatus = String(matched.image.originalStatus || imagePreview.originalStatus || '').trim();
        imagePreview = {
            ...imagePreview,
            src: imagePreview.originalLoaded && originalReady ? originalSrc : (previewSrc || imagePreview.src),
            previewSrc: previewSrc || imagePreview.previewSrc || imagePreview.src,
            originalReady,
            originalStatus,
            originalSrc,
            previewBytes: getResultImagePreviewBytes(matched.image) || imagePreview.previewBytes || 0,
            originalBytes: getResultImageOriginalBytes(matched.image) || imagePreview.originalBytes || 0,
            meta: [getTaskImageMeta(matched.task), getImageOriginalStatusLabel(matched.image), formatGeneratedTime(matched.task.completedAt || matched.task.createdAt)].filter(Boolean).join(' · ') || imagePreview.meta
        };
        return true;
    }

    function getPreviewOriginalProgress(preview = imagePreview) {
        if (!preview) return 0;
        if (preview.originalReady && preview.originalLoaded) return 100;
        const status = String(preview.originalStatus || '').toLowerCase();
        if (status === 'failed' || status === 'missing') return 100;
        if (preview.originalReady && !preview.originalLoaded) {
            const openedAt = Number(preview.openedAt || Date.now());
            const elapsed = Math.max(0, Date.now() - openedAt);
            return Math.min(96, Math.max(18, Math.round(28 + elapsed / 70)));
        }
        const task = state.tasks.find((item) => item.id === preview.taskId);
        const createdAt = Number(task?.completedAt || task?.createdAt || 0);
        const elapsed = createdAt ? Math.max(0, Date.now() - createdAt) : 0;
        return Math.min(96, Math.max(12, Math.round(24 + elapsed / 900)));
    }

    function isImageResultTask(task) {
        return Boolean(task && task.status === 'succeeded' && task.mode !== 'chat' && task.mode !== 'reverse' && !isVideoMode(task.mode) && getTaskPrimaryImage(task));
    }

    function getTaskThreadRoot(task = getActiveTask()) {
        if (!task) return null;
        const taskById = new Map(state.tasks.filter((item) => item?.id).map((item) => [item.id, item]));
        const seen = new Set([task.id]);
        let current = task;
        while (current?.parentTaskId) {
            const parent = taskById.get(current.parentTaskId);
            if (!parent || seen.has(parent.id)) break;
            current = parent;
            seen.add(current.id);
        }
        return current;
    }

    function getTaskThreadChildren(rootTask) {
        if (!rootTask) return [];
        return state.tasks
            .filter((task) => task?.id && task.id !== rootTask.id && getTaskThreadRoot(task)?.id === rootTask.id)
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    function getTaskThread(rootTask) {
        if (!rootTask) return [];
        return [rootTask, ...getTaskThreadChildren(rootTask)];
    }

    function getActiveChatThreadRoot() {
        const activeTask = getActiveTask();
        if (!activeTask || activeTask.mode !== 'chat') return null;
        const rootTask = getTaskThreadRoot(activeTask) || activeTask;
        return rootTask?.mode === 'chat' ? rootTask : null;
    }

    function updateChatStageScrollState(stage = overlay?.querySelector?.('.ai-image-stage')) {
        if (!stage) {
            chatStageScrollState = {
                element: null,
                bottomDistance: Number.POSITIVE_INFINITY,
                nearBottom: true
            };
            return chatStageScrollState;
        }
        const bottomDistance = Math.max(0, Number(stage.scrollHeight || 0) - Number(stage.clientHeight || 0) - Number(stage.scrollTop || 0));
        chatStageScrollState = {
            element: stage,
            bottomDistance,
            nearBottom: bottomDistance <= CHAT_STAGE_BOTTOM_STICKY_THRESHOLD_PX
        };
        return chatStageScrollState;
    }

    function scheduleChatStageScrollState(stage = overlay?.querySelector?.('.ai-image-stage')) {
        if (!stage || chatStageScrollStateFrame) return;
        const update = () => {
            chatStageScrollStateFrame = 0;
            if (stage.isConnected && stage === overlay?.querySelector?.('.ai-image-stage')) {
                updateChatStageScrollState(stage);
            }
        };
        if (typeof global.requestAnimationFrame === 'function') {
            chatStageScrollStateFrame = global.requestAnimationFrame(update);
        } else {
            chatStageScrollStateFrame = global.setTimeout?.(update, 16) || 0;
        }
    }

    function handleChatStageScroll() {
        scheduleChatStageScrollState(chatStageScrollTarget);
    }

    function syncChatStageScrollListener() {
        const nextStage = overlay?.querySelector?.('.ai-image-stage');
        if (chatStageScrollTarget === nextStage) {
            if (nextStage && chatStageScrollState.element !== nextStage) updateChatStageScrollState(nextStage);
            return;
        }
        chatStageScrollTarget?.removeEventListener('scroll', handleChatStageScroll);
        chatStageScrollTarget = nextStage || null;
        if (!chatStageScrollTarget) {
            updateChatStageScrollState(null);
            return;
        }
        chatStageScrollTarget.addEventListener('scroll', handleChatStageScroll, { passive: true });
        updateChatStageScrollState(chatStageScrollTarget);
    }

    function getChatStageBottomDistance(stage = overlay?.querySelector?.('.ai-image-stage')) {
        if (!stage) return Number.POSITIVE_INFINITY;
        if (chatStageScrollState.element === stage) return chatStageScrollState.bottomDistance;
        return updateChatStageScrollState(stage).bottomDistance;
    }

    function isChatStageNearBottom(stage = overlay?.querySelector?.('.ai-image-stage')) {
        if (!stage) return true;
        if (chatStageScrollState.element === stage) return chatStageScrollState.nearBottom;
        return updateChatStageScrollState(stage).nearBottom;
    }

    function shouldKeepChatStagePinnedToBottom(renderSnapshot = null, { force = false } = {}) {
        if (!state.open) return false;
        const rootTask = getActiveChatThreadRoot();
        if (!rootTask) return false;
        const hasBusyChatTask = getTaskThread(rootTask).some((task) => task.mode === 'chat' && isBusyTask(task));
        if (!hasBusyChatTask) return false;
        if (force) return true;
        return Boolean(renderSnapshot?.stage?.wasNearBottom ?? isChatStageNearBottom());
    }

    function getLastChatThreadTask(rootTask = getActiveChatThreadRoot()) {
        if (!rootTask) return null;
        return getTaskThread(rootTask)
            .filter((task) => task.mode === 'chat')
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || rootTask;
    }

	    function getChatMemoryOption(mode = state.chatMemoryMode) {
	        return CHAT_MEMORY_OPTIONS.find((option) => option.id === mode) || CHAT_MEMORY_OPTIONS[0];
	    }

	    function getChatReasoningOption(mode = state.chatReasoningEffort) {
	        return [...OPENAI_REASONING_EFFORT_OPTIONS, ...DEEPSEEK_REASONING_EFFORT_OPTIONS, ...GLM_REASONING_EFFORT_OPTIONS, ...XAI_REASONING_EFFORT_OPTIONS].find((option) => option.id === mode)
	            || OPENAI_REASONING_EFFORT_OPTIONS[0];
	    }

	    function getChatServiceTierOption(mode = state.chatServiceTier) {
	        return OPENAI_SERVICE_TIER_OPTIONS.find((option) => option.id === mode) || OPENAI_SERVICE_TIER_OPTIONS[0];
	    }

	    function getChatThinkingOption(mode = state.chatThinkingMode) {
	        return [...DEEPSEEK_THINKING_OPTIONS, ...KIMI_THINKING_OPTIONS, ...CLAUDE_THINKING_OPTIONS, ...QWEN_ENABLE_THINKING_OPTIONS, ...GLM_THINKING_OPTIONS, ...MINIMAX_THINKING_OPTIONS, ...DOUBAO_THINKING_OPTIONS, ...GROK_THINKING_OPTIONS, ...OPENAI_THINKING_OPTIONS, ...GEMINI_THINKING_OPTIONS].find((option) => option.id === mode) || DEEPSEEK_THINKING_OPTIONS[0];
	    }

	    function getChatImageInputOption(mode = state.chatImageInput) {
	        return OPENAI_IMAGE_INPUT_OPTIONS.find((option) => option.id === mode) || OPENAI_IMAGE_INPUT_OPTIONS[0];
	    }

	    function modelLikelySupportsChatImageInput(modelId = getActiveModelValue('chat')) {
	        const model = String(modelId || '').toLowerCase();
	        const baseUrl = String(state.billingMode === 'api' ? state.apiBaseUrl : '').toLowerCase();
	        return /gpt-4o|gpt-4\.1|gpt-5|o\d|gemini|claude|qwen-vl|vision|multimodal/.test(`${model} ${baseUrl}`);
	    }

	    function getChatModelOption(modelId = getActiveModelValue('chat')) {
	        const normalized = String(modelId || '').trim();
	        return getRuntimeModelGroupOptions('chat').find((model) => model.id === normalized)
	            || getActiveModelOptions('chat').find((model) => model.id === normalized)
	            || null;
	    }

	    function shouldExposeChatImageInput(modelId = getActiveModelValue('chat')) {
	        if (state.chatImageInput === 'off') return false;
	        const option = getChatModelOption(modelId);
	        if (option?.supportsImageInput === true) return true;
	        if (option?.supportsImageInput === false) return false;
	        return modelLikelySupportsChatImageInput(modelId);
	    }

	    function getChatModelCapabilities(modelId = getActiveModelValue('chat')) {
	        const modelOption = getChatModelOption(modelId) || {};
	        const resolver = global.AIChatModelCapabilities?.resolveAiChatModelCapabilities;
	        const capabilityProfile = typeof resolver === 'function'
	            ? resolver({
	                model: modelId,
	                vendor: modelOption.vendor,
	                protocol: modelOption.protocol,
	                providerLabel: modelOption.providerLabel
	            })
	            : { family: 'unknown', supportsThinking: false };
	        const family = capabilityProfile.family;
	        const isDeepSeek = family === 'deepseek';
	        const isKimi = family === 'kimi';
	        const isQwen = family === 'qwen';
	        const isGrok = family === 'grok';
	        const isGemini = family === 'gemini';
	        const isClaude = family === 'claude';
	        const isOpenAiLike = family === 'openai';
	        const isVisionLikely = modelLikelySupportsChatImageInput(modelId);
	        const controls = [];
		        if (isDeepSeek && capabilityProfile.supportsThinking) {
		            controls.push({
		                id: 'thinking',
		                icon: 'fa-lightbulb',
		                label: 'DeepSeek 思考模式',
		                activeValue: state.chatThinkingMode,
		                options: DEEPSEEK_THINKING_OPTIONS
		            });
		            controls.push({
		                id: 'reasoning',
		                icon: 'fa-gauge-high',
		                label: 'DeepSeek 推理强度',
		                activeValue: state.chatReasoningEffort,
			                options: DEEPSEEK_REASONING_EFFORT_OPTIONS
			            });
	        } else if (isKimi && capabilityProfile.supportsThinking) {
	            controls.push({
	                id: 'thinking',
	                icon: 'fa-lightbulb',
	                label: 'Kimi 思考模式',
	                activeValue: state.chatThinkingMode,
	                options: KIMI_THINKING_OPTIONS
	            });
	        } else if (isQwen && capabilityProfile.supportsThinking) {
	            controls.push({
	                id: 'thinking',
	                icon: 'fa-lightbulb',
	                label: 'Qwen 思考模式',
	                activeValue: state.chatThinkingMode,
	                options: QWEN_ENABLE_THINKING_OPTIONS
	            });
	        } else if (family === 'glm' && capabilityProfile.supportsThinking) {
	            controls.push({
	                id: 'thinking',
	                icon: 'fa-lightbulb',
	                label: 'GLM 思考模式',
	                activeValue: state.chatThinkingMode,
	                options: GLM_THINKING_OPTIONS
	            });
	            if (capabilityProfile.reasoningEffortProfile === 'glm') {
	                controls.push({
	                    id: 'reasoning',
	                    icon: 'fa-gauge-high',
	                    label: 'GLM 推理强度',
	                    activeValue: state.chatReasoningEffort,
	                    options: GLM_REASONING_EFFORT_OPTIONS
	                });
	            }
	        } else if (family === 'minimax' && capabilityProfile.supportsThinking) {
	            controls.push({
	                id: 'thinking',
	                icon: 'fa-lightbulb',
	                label: 'MiniMax 思考模式',
	                activeValue: state.chatThinkingMode,
	                options: MINIMAX_THINKING_OPTIONS
	            });
	        } else if (family === 'doubao' && capabilityProfile.supportsThinking) {
	            controls.push({
	                id: 'thinking',
	                icon: 'fa-lightbulb',
	                label: '豆包思考模式',
	                activeValue: state.chatThinkingMode,
	                options: DOUBAO_THINKING_OPTIONS
	            });
	        } else if (isGrok && capabilityProfile.supportsThinking) {
	            controls.push({
	                id: 'thinking',
	                icon: 'fa-lightbulb',
	                label: 'Grok 思考模式',
	                activeValue: state.chatThinkingMode,
	                options: GROK_THINKING_OPTIONS
	            });
	            controls.push({
	                id: 'reasoning',
	                icon: 'fa-gauge-high',
	                label: 'xAI 推理强度',
	                activeValue: state.chatReasoningEffort,
	                options: XAI_REASONING_EFFORT_OPTIONS
	            });
	        } else if (isGemini && capabilityProfile.supportsThinking) {
	            controls.push({
	                id: 'thinking',
	                icon: 'fa-lightbulb',
	                label: 'Gemini 思考模式',
	                activeValue: state.chatThinkingMode,
	                options: GEMINI_THINKING_OPTIONS
	            });
	            if (capabilityProfile.thinkingLevelProfile === 'gemini') {
	                controls.push({
	                    id: 'geminiThinking',
	                    icon: 'fa-brain',
	                    label: 'Gemini 思考等级',
	                    activeValue: state.chatGeminiThinkingLevel,
	                    options: GEMINI_THINKING_LEVEL_OPTIONS
	                });
	            }
	        } else if (isClaude) {
	            if (capabilityProfile.supportsThinking) {
	                controls.push({
	                    id: 'thinking',
	                    icon: 'fa-lightbulb',
	                    label: 'Claude Extended Thinking',
	                    activeValue: state.chatThinkingMode,
	                    options: CLAUDE_THINKING_OPTIONS
	                });
	                controls.push({
	                    id: 'claudeThinkingBudget',
	                    icon: 'fa-gauge-high',
	                    label: 'Claude thinking budget_tokens',
	                    activeValue: state.chatClaudeThinkingBudget,
	                    options: CLAUDE_THINKING_BUDGET_OPTIONS
	                });
	            }
	        } else if (isOpenAiLike) {
	            if (capabilityProfile.reasoningEffortProfile === 'openai') {
	                const supportedReasoningEfforts = new Set(capabilityProfile.reasoningEfforts || []);
	                const reasoningOptions = OPENAI_REASONING_EFFORT_OPTIONS.filter((option) => (
	                    option.id === 'auto' || supportedReasoningEfforts.has(option.id)
	                ));
	                controls.push({
	                    id: 'thinking',
	                    icon: 'fa-lightbulb',
	                    label: 'OpenAI 思考模式',
	                    activeValue: state.chatThinkingMode,
	                    options: OPENAI_THINKING_OPTIONS
	                });
	                controls.push({
	                    id: 'reasoning',
	                    icon: 'fa-gauge-high',
	                    label: 'OpenAI 推理强度',
	                    activeValue: state.chatReasoningEffort,
	                    options: reasoningOptions
	                });
	            }
	            controls.push({
	                id: 'serviceTier',
	                icon: 'fa-bolt',
	                label: 'OpenAI 服务档位',
	                activeValue: state.chatServiceTier,
	                options: OPENAI_SERVICE_TIER_OPTIONS
	            });
	            if (isVisionLikely) {
		                controls.push({
		                    id: 'imageInput',
		                    icon: 'fa-image',
		                    label: 'OpenAI 图片输入',
		                    activeValue: state.chatImageInput,
		                    options: OPENAI_IMAGE_INPUT_OPTIONS
		                });
	            }
	        }

        return {
	            provider: family,
	            profile: capabilityProfile,
            supportsImageInput: isVisionLikely,
            controls
        };
	    }

	    function getEffectiveChatCapabilityValue(value = '', options = []) {
	        const normalized = String(value || '').trim();
	        return options.some((option) => option.id === normalized)
	            ? normalized
	            : (options[0]?.id || '');
	    }

    function estimateChatMessageTokens(message = {}) {
        return Math.max(1, Math.ceil(String(`${message.role || ''}\n${message.content || ''}`).length / 2.6)) + 4;
    }

    function trimChatMessagesForMemory(messages = [], memoryOption = getChatMemoryOption()) {
        const messageLimit = Math.max(0, Number(memoryOption.messageLimit || 0) || 0);
        const tokenBudget = Math.max(1000, Number(memoryOption.tokenBudget || 6000) || 6000);
        if (!messageLimit) return [];
        const candidates = messages.slice(-messageLimit);
        const selected = [];
        let usedTokens = 0;
        for (let index = candidates.length - 1; index >= 0; index -= 1) {
            const message = candidates[index];
            const messageTokens = estimateChatMessageTokens(message);
            if (selected.length && usedTokens + messageTokens > tokenBudget) break;
            selected.unshift(message);
            usedTokens += messageTokens;
        }
        return selected;
    }

    function getChatThreadMessages(rootTask = getActiveChatThreadRoot()) {
        if (!rootTask) return [];
        const messages = getTaskThread(rootTask)
            .filter((task) => task.mode === 'chat')
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
            .flatMap((task) => {
                const messages = [];
                if (task.prompt) {
                    messages.push({
                        role: 'user',
                        content: task.prompt
                    });
                }
	                if (task.resultPrompt && task.status === 'succeeded') {
	                    messages.push({
	                        role: 'assistant',
	                        content: task.resultPrompt
	                    });
	                }
                return messages;
            });
        return trimChatMessagesForMemory(messages);
    }

    function getHistoryThreadRows() {
        const rootMap = new Map();
        state.tasks.forEach((task) => {
            if (!task?.id) return;
            if (isHistoryTaskDeleted(task)) return;
            const rootTask = getTaskThreadRoot(task) || task;
            const rootId = rootTask?.id || task.id;
            if (!rootMap.has(rootId)) {
                rootMap.set(rootId, rootTask || task);
            }
        });

        return Array.from(rootMap.values())
            .map((rootTask) => {
                const tasks = getTaskThread(rootTask).filter(Boolean);
                const sortedTasks = tasks.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                const latestTask = sortedTasks[0] || rootTask;
                const busyTask = sortedTasks.find(isBusyTask) || null;
                const imageTask = sortedTasks.find(isImageResultTask) || latestTask;
                const displayTask = busyTask || latestTask;
                return {
                    id: rootTask.id,
                    rootTask,
                    tasks,
                    latestTask,
                    displayTask,
                    imageTask,
                    isPinned: isHistoryTaskPinned(rootTask),
                    accent: getHistoryTaskAccent(rootTask),
                    isActive: tasks.some((task) => task.id === state.activeTaskId) || state.activeTaskId === rootTask.id,
                    count: tasks.length
                };
            })
            .sort((left, right) => {
                if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
                return (right.latestTask?.createdAt || 0) - (left.latestTask?.createdAt || 0);
            });
    }

    function normalizeHistorySearchText(value = '') {
        return String(value || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
    }

    function compactHistorySearchText(value = '') {
        return normalizeHistorySearchText(value)
            .replace(/[^\p{L}\p{N}]+/gu, '');
    }

    function getTaskSearchText(task = {}) {
        const modeMeta = MODE_META[task.mode] || {};
        const ratioMeta = isVideoMode(task.mode) ? (VIDEO_RATIO_META[task.ratio] || {}) : (RATIO_META[task.ratio] || {});
        const resolutionMeta = isVideoMode(task.mode) ? (VIDEO_RESOLUTION_META[task.resolution] || {}) : (RESOLUTION_META[task.resolution] || {});
        return [
            task.id,
            task.mode,
            modeMeta.label,
            task.status,
            getStatusLabel(task),
            getTaskTitle(task),
            getTaskSubtitle(task),
            getTaskPromptText(task),
            task.prompt,
            task.resultPrompt,
            task.errorMessage,
            task.remoteError,
            task.model,
            task.apiModel,
            task.referenceTitle,
            ratioMeta.label,
            resolutionMeta.label
        ].filter(Boolean).join(' ');
    }

    function getFilteredHistoryRows(historyRows = getHistoryThreadRows()) {
        const query = normalizeHistorySearchText(historySearchQuery);
        if (!query) return historyRows;
        const terms = query.split(' ').filter(Boolean);
        const compactQuery = compactHistorySearchText(query);
        return historyRows.filter((row) => {
            const searchable = normalizeHistorySearchText([
                row.id,
                row.count > 1 ? `${row.count} 步` : '',
                row.isPinned ? '置顶' : '',
                row.accent || '',
                ...(row.tasks || []).map(getTaskSearchText)
            ].filter(Boolean).join(' '));
            const compactSearchable = compactHistorySearchText(searchable);
            const matchesTerms = terms.every((term) => searchable.includes(term) || compactSearchable.includes(compactHistorySearchText(term)));
            return matchesTerms || Boolean(compactQuery && compactSearchable.includes(compactQuery));
        });
    }

    function getLatestThreadImageTask(rootTask) {
        return getTaskThread(rootTask)
            .filter(isImageResultTask)
            .sort((a, b) => ((b.completedAt || b.createdAt || 0) - (a.completedAt || a.createdAt || 0)))[0] || null;
    }

    function getContinuationSourceTask() {
        if (state.billingMode === 'api' && !state.apiImageTool) return null;
        if (state.continuationImage || state.referenceImage) return null;
        return getLatestThreadImageTask(getTaskThreadRoot());
    }

    function getCurrentImageContext() {
        const explicitContinuation = normalizeReferenceItem(state.continuationImage);
        if (explicitContinuation?.image) {
            const matched = getResultImageByIdentity(
                explicitContinuation.taskId,
                explicitContinuation.resultId,
                explicitContinuation.resultIndex
            );
            const sourceTask = matched?.task || state.tasks.find((task) => task.id === explicitContinuation.taskId) || null;
            return {
                image: explicitContinuation.image,
                title: explicitContinuation.title || '续作图片',
                sourceTask,
                resultId: explicitContinuation.resultId || '',
                resultIndex: explicitContinuation.resultIndex || '',
                explicit: true,
                isContinuation: true
            };
        }

        const sourceTask = getContinuationSourceTask();
        if (sourceTask) {
            const sourceImageRecord = sourceTask.images?.[0] || null;
            const sourceImage = getImagePreviewUrl(sourceImageRecord) || getImageUrl(sourceImageRecord) || sourceTask.referenceImage || '';
            if (sourceImage) {
                return {
                    image: sourceImage,
                    title: getTaskTitle(sourceTask),
                    sourceTask,
                    resultId: String(sourceImageRecord?.resultId || '').trim(),
                    resultIndex: String(sourceImageRecord?.index ?? '').trim(),
                    explicit: false,
                    isContinuation: true
                };
            }
        }
        if (state.referenceImage) {
            return {
                image: state.referenceImage,
                title: state.referenceTitle,
                sourceTask: null,
                resultId: '',
                resultIndex: '',
                explicit: true,
                isContinuation: false
            };
        }
        const firstReference = normalizeReferenceItem(state.referenceImages?.[0]);
        if (firstReference?.image) {
            return {
                image: firstReference.image,
                title: firstReference.title,
                sourceTask: null,
                resultId: '',
                resultIndex: '',
                explicit: true,
                isContinuation: false
            };
        }
        return {
            image: '',
            title: '',
            sourceTask: null,
            resultId: '',
            resultIndex: '',
            explicit: false,
            isContinuation: false
        };
    }

    function getExtraReferenceImages() {
        return normalizeReferenceList(state.referenceImages || []);
    }

    function getActiveRatio(mode = inferWorkbenchMode()) {
        return isVideoMode(mode) ? state.videoRatio : state.ratio;
    }

    function getActiveResolution(mode = inferWorkbenchMode()) {
        return isVideoMode(mode) ? state.videoResolution : state.resolution;
    }

    function getRatioAspect(ratio = '1:1', mode = '') {
        if (isVideoMode(mode)) return VIDEO_RATIO_META[ratio]?.aspect || VIDEO_RATIO_META[DEFAULT_STATE.videoRatio]?.aspect || '16 / 9';
        return RATIO_META[ratio]?.aspect || '1 / 1';
    }

    function getAspectRatioValue(aspect = '1 / 1') {
        const match = String(aspect || '').match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
        if (!match) return 1;
        const width = Number(match[1]);
        const height = Number(match[2]);
        if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) return 1;
        return width / height;
    }

    function getResultGridRatioClass(task = {}) {
        if (isVideoMode(task?.mode)) return '';
        const aspectValue = getAspectRatioValue(getRatioAspect(task?.ratio, task?.mode));
        return aspectValue >= 1.9 ? 'ai-image-result-grid--wide' : '';
    }

    function getResolutionLabel(resolution = '', mode = '') {
        if (isVideoMode(mode)) return VIDEO_RESOLUTION_META[resolution]?.label || String(resolution || DEFAULT_STATE.videoResolution);
        return RESOLUTION_META[resolution]?.label || String(resolution || '标准').toUpperCase();
    }

    function getReferenceInputCount() {
        return (getCurrentImageContext().image ? 1 : 0) + getExtraReferenceImages().length;
    }

    function getActiveDisplayTask() {
        const activeTask = getActiveTask();
        const rootTask = getTaskThreadRoot(activeTask);
        const busyChild = getTaskThreadChildren(rootTask)
            .filter(isBusyTask)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
        return busyChild || activeTask || rootTask;
    }

    function getBusyTasks() {
        return state.tasks.filter(isBusyTask);
    }

    function isActiveChatStreamTask(task = {}) {
        if (!task || task.mode !== 'chat') return false;
        const taskId = String(task.id || '').trim();
        const clientTaskId = String(task.clientTaskId || '').trim();
        return Boolean(
            (taskId && activeChatStreamTaskIds.has(taskId))
            || (clientTaskId && activeChatStreamTaskIds.has(clientTaskId))
        );
    }

    function getRemotePollBusyTasks() {
        return getBusyTasks().filter((task) => !isActiveChatStreamTask(task));
    }

    function hasActiveChatStreamInCurrentThread() {
        if (!state.open) return false;
        const activeTask = getActiveTask();
        if (!activeTask || activeTask.mode !== 'chat') return false;
        const rootTask = getTaskThreadRoot(activeTask) || activeTask;
        return getTaskThread(rootTask).some((task) => isActiveChatStreamTask(task));
    }

    function getCompletedUnreadTasks() {
        return state.tasks.filter((task) => task.status === 'succeeded' && !isTaskSeen(task));
    }

    function inferWorkbenchMode() {
        const imageContext = getCurrentImageContext();
        if (state.mode === 'video') return 'video';
        if (!imageContext.image) return !state.apiImageTool ? 'chat' : 'text';
        if (state.referenceIntent === 'variation') return 'image';
        const prompt = String(state.prompt || '').trim().toLowerCase();
        const reverseHints = ['反推', '提示词', 'prompt', '描述这张图', '图片描述', '分析图片', '识别画面'];
        if (state.referenceImage && (!prompt || reverseHints.some((hint) => prompt.includes(hint)))) return 'reverse';
        if (!state.referenceImage && reverseHints.some((hint) => prompt.includes(hint))) return 'reverse';
        if (!state.apiImageTool && shouldExposeChatImageInput()) return 'chat';
        return 'image';
    }

    function getCurrentWorkbenchToolMode(mode = inferWorkbenchMode()) {
        if (isVideoMode(mode)) return 'video';
        if (mode === 'chat') return 'chat';
        return 'image';
    }

    function getRuntimePointPricingRule(mode = inferWorkbenchMode()) {
        if (state.billingMode !== 'points' || !remoteConfigLoaded || !remoteConfigAvailable) return null;
        return findRuntimePricingRule({
            mode,
            billingMode: state.billingMode,
            model: getActiveModelValue(mode),
            resolution: getActiveResolution(mode),
            ratio: getActiveRatio(mode),
            quantity: mode === 'reverse' || isVideoMode(mode) ? 1 : clampNumber(state.quantity, 1, 4, 2)
        });
    }

    function applyWorkbenchToolMode(value = 'chat', { allowUnavailableVideo = false } = {}) {
        const normalized = String(value || '').trim();
        if (normalized === 'video' && (allowUnavailableVideo || getActiveModelOptions('video').length)) {
            state.apiImageTool = true;
            state.mode = 'video';
            return;
        }
        if (normalized === 'image') {
            state.apiImageTool = true;
            state.mode = getCurrentImageContext().image ? 'image' : 'text';
            return;
        }
        state.apiImageTool = false;
        state.mode = 'chat';
    }

    function setWorkbenchToolMode(value = 'chat') {
        applyWorkbenchToolMode(value);
    }

    function getCostEstimate(modeOverride = state.mode) {
        if (state.billingMode === 'api') return 0;
        if (!remoteConfigLoaded || !remoteConfigAvailable) return 0;
        const mode = MODE_META[modeOverride] ? modeOverride : state.mode;
        const quantity = mode === 'reverse' || isVideoMode(mode) ? 1 : clampNumber(state.quantity, 1, 4, 2);
        const resolution = getActiveResolution(mode);
        const matchedRule = getRuntimePointPricingRule(mode);
        if (matchedRule) {
            return getRuntimePricingRuleEstimate(matchedRule, quantity);
        }
        if (mode === 'reverse') return 0;
        const modeCost = MODE_META[mode]?.cost ?? 8;
        const resolutionMultiplier = isVideoMode(mode)
            ? ({
                '480p': 0.7,
                '720p': 1,
                '1080p': 1.8,
                '4k': 3.6
            }[String(resolution || '').toLowerCase()] || 1)
            : (RESOLUTION_META[state.resolution]?.multiplier || 1);
        return normalizePoints(Math.max(modeCost > 0 ? 1 : 0, modeCost * resolutionMultiplier * quantity), 0);
    }

    function getModeLabel(mode = state.mode) {
        return MODE_META[mode]?.label || MODE_META.text.label;
    }

    function getActiveModelOptions(mode = inferWorkbenchMode()) {
        const groupedOptions = getRuntimeModelGroupOptions(mode);
        if (groupedOptions.length || getRuntimeModelProvidersForBillingMode().length || isRuntimeModelSourceLockedForBillingMode()) return groupedOptions;
        if (state.billingMode !== 'api') return [];
        if (isTextVisionMode(mode)) return runtimeApiTextModels;
        if (isVideoMode(mode)) return runtimeApiVideoModels;
        return runtimeApiImageModels;
    }

    function isModelOptionsLoading(mode = inferWorkbenchMode()) {
        if (modelDiscoveryState.loading) return true;
        if (!remoteConfigLoaded) return true;
        const groupedOptions = getRuntimeModelGroupOptions(mode);
        if (groupedOptions.length) return false;
        if (getRuntimeModelProvidersForBillingMode().length || isRuntimeModelSourceLockedForBillingMode()) return false;
        return state.billingMode === 'points';
    }

    function getActiveModelValue(mode = inferWorkbenchMode()) {
        const options = getActiveModelOptions(mode);
        const preferredValue = isTextVisionMode(mode)
            ? (state.billingMode === 'api' ? state.apiTextModel : state.pointsTextModel)
            : (isVideoMode(mode)
                ? (state.billingMode === 'api' ? state.apiVideoModel : state.pointsVideoModel)
                : (state.billingMode === 'api' ? state.apiImageModel : state.model));
        if (options.some((model) => model.id === preferredValue)) return preferredValue;
        return options[0]?.id || '';
    }

    function getActiveBillingLabel() {
        if (state.billingMode === 'points') return '积分计费';
        if (state.billingMode === 'api') return `${getApiBaseProfile()?.label || 'Sub2API'} Key`;
        return '选择计费';
    }

    function getMainCostCopy(mode = inferWorkbenchMode()) {
        if (!state.billingMode) return '请选择计费方式';
        if (state.billingMode === 'api') return isTextVisionMode(mode) ? '消耗 API token' : (isVideoMode(mode) ? '消耗 API 视频额度' : '消耗 API 图片额度');
        if (!remoteConfigLoaded) return '价格加载中';
        if (!remoteConfigAvailable) return '价格暂不可用';
        const matchedRule = getRuntimePointPricingRule(mode);
        if (mode === 'reverse' && !matchedRule) return '价格未配置';
        if (matchedRule && getRuntimePricingRuleStrategy(matchedRule) === 'token_sub2api' && getRuntimePricingRuleEstimate(matchedRule, 1) <= 0) {
            return '按实际用量扣费';
        }
        return `预计 ${formatPoints(getCostEstimate(mode))} 积分`;
    }

    function getComposerCostValue(mode = inferWorkbenchMode()) {
        if (!state.billingMode) return '选择计费';
        if (state.billingMode === 'api') return isTextVisionMode(mode) ? 'API token' : (isVideoMode(mode) ? 'API 视频' : 'API 图片');
        if (!remoteConfigLoaded) return '价格加载中';
        if (!remoteConfigAvailable) return '价格暂不可用';
        const matchedRule = getRuntimePointPricingRule(mode);
        if (mode === 'reverse' && !matchedRule) return '价格未配置';
        if (matchedRule && getRuntimePricingRuleStrategy(matchedRule) === 'token_sub2api' && getRuntimePricingRuleEstimate(matchedRule, 1) <= 0) {
            return '实际扣费';
        }
        return `${formatPoints(getCostEstimate(mode))}积分`;
    }

    function estimateLocalQueueSeconds({
        mode = state.mode,
        resolution = getActiveResolution(mode),
        quantity = state.quantity
    } = {}) {
        if (isTextVisionMode(mode)) return 20;
        if (isVideoMode(mode)) {
            const videoMultiplier = {
                '480p': 0.75,
                '720p': 1,
                '1080p': 1.8,
                '4k': 2.6,
                '2k': 1.6,
                '1k': 1
            }[String(resolution || '').toLowerCase()] || 1;
            return Math.round(150 * videoMultiplier);
        }
        const resolutionMultiplier = {
            '4k': 2.6,
            '2k': 1.6,
            '1k': 1
        }[String(resolution || '').toLowerCase()] || 1;
        return Math.round(90 * resolutionMultiplier * clampNumber(quantity, 1, 4, 1));
    }

    function canSubmitWorkbench(mode = inferWorkbenchMode()) {
        if (referenceUploadBusy) return false;
        if (!state.billingMode) return false;
        if (state.billingMode === 'api') return Boolean(getActiveModelValue() && isConfiguredApiBaseUrl() && hasUsableApiKey());
        return Boolean(remoteConfigLoaded && remoteConfigAvailable && MODE_META[mode] && getActiveModelValue(mode)
            && (mode !== 'reverse' || getRuntimePointPricingRule(mode)));
    }

    function getStatusLabel(task) {
        if (!task) return '待开始';
        if (isTaskReloadableBillingRecord(task)) return '记录重新加载中';
        if (task.status === 'queued') {
            const step = getTaskQueuedStepLabel(task);
            return `${step} · ${getTaskQueuedDetailLabel(task) || '等待调度'}`;
        }
        if (task.status === 'processing' || task.status === 'streaming') {
            if (task.mode === 'chat') return getTaskProgressDetail(task);
            return `${getTaskCurrentStepLabel(task)} · ${getTaskCurrentImageLabel(task)} · ${getTaskElapsedLabel(task)}`;
        }
        if (task.status === 'succeeded') {
            const { completed, total } = getTaskGenerationCount(task);
            if (isVideoMode(task.mode)) return completed < total ? `已生成 ${completed}/${total} 段` : '已完成';
            return completed < total ? `已生成 ${completed}/${total} 张` : '已完成';
        }
        if (task.status === 'cancelled') return '已取消';
        return '生成失败';
    }

    function getComposerBusyLabel(task) {
        return getTaskElapsedLabel(task);
    }

    function getTaskGenerationCount(task) {
        if (isTextVisionTask(task)) {
            const completed = task?.status === 'succeeded' ? 1 : 0;
            return { completed, total: 1 };
        }
        if (isVideoMode(task?.mode)) {
            const completed = task?.status === 'succeeded' && Array.isArray(task?.images) && task.images.length ? 1 : 0;
            return { completed, total: 1 };
        }
        const total = clampNumber(task?.quantity, 1, 4, 1);
        const deliveredCount = Number(task?.deliveredImageCount);
        const imageCount = Array.isArray(task?.images) ? task.images.length : 0;
        const completed = Math.min(total, Math.max(0, Number.isFinite(deliveredCount) && deliveredCount > 0 ? deliveredCount : imageCount));
        return { completed, total };
    }

    function getTaskProgressPercent(task) {
        if (!task) return null;
        if (task.status === 'succeeded') return 100;
        if (!task.progressKnown) return null;
        return Math.round(clampNumber(task.progress, 0, 99, 0));
    }

    function getImageTaskStageProgressPercent(task, stage = getDockTaskStage(task)) {
        if (!task) return 0;
        if (stage === 'complete' || stage === 'failed') return 100;
        const knownProgress = getTaskProgressPercent(task);
        if (knownProgress !== null) {
            const fallback = Math.round((DOCK_STAGE_PROGRESS[stage] || 0) * 100);
            return Math.round(clampNumber(knownProgress, stage === 'queued' ? 8 : 12, stage === 'saving' ? 92 : 88, fallback));
        }
        if (!isBusyTask(task)) return task.status === 'succeeded' ? 100 : 0;
        if (isTextVisionTask(task) || isVideoMode(task?.mode)) {
            return getDockTaskProgressPercent(task, getDockTaskStage(task));
        }
        if (task.status === 'queued') {
            const queuedStep = getTaskQueuedStepLabel(task);
            if (/排队|已受理/.test(queuedStep)) return 12;
            if (/准备/.test(queuedStep)) return 22;
            if (/生成/.test(queuedStep)) return 46;
            if (/返回|等待/.test(queuedStep)) return 72;
            return 12;
        }
        const step = getTaskCurrentStepLabel(task);
        if (/请求|受理/.test(step)) return 24;
        if (/模型|Gemini|生成/.test(step)) return 60;
        if (/返回|剩余/.test(step)) return 72;
        if (/同步/.test(step)) return 88;
        if (/保存/.test(step)) return 90;
        return Math.round((DOCK_STAGE_PROGRESS[stage] || 0) * 100);
    }

    function getTaskStageProgressPercent(task) {
        if (!task) return 0;
        if (isTextVisionTask(task) || isVideoMode(task?.mode)) {
            return getDockTaskProgressPercent(task, getDockTaskStage(task));
        }
        return getImageTaskStageProgressPercent(task, getDockTaskStage(task));
    }

    function getTaskProgressBadge(task) {
        const percent = getTaskProgressPercent(task);
        if (percent !== null) return `${percent}%`;
        if (task?.status === 'queued') return getTaskQueuedBadgeLabel(task);
        if (task?.status === 'processing' || task?.status === 'streaming') return getTaskCurrentStepLabel(task);
        if (task?.status === 'cancelled') return '已取消';
        if (isTaskReloadableBillingRecord(task)) return '加载中';
        if (task?.status === 'failed') return '失败';
        return '待开始';
    }

    function getTaskGenerationLabel(task) {
        if (isTextVisionTask(task)) {
            if (task?.status === 'succeeded') return '文本完成';
            if (task?.status === 'queued') return getTaskQueuedStepLabel(task);
            if (task?.status === 'processing' || task?.status === 'streaming') {
                if (task?.metadata?.stream_finalizing) return '正在完成';
                return task.mode === 'reverse' ? '视觉分析中' : '对话生成中';
            }
            if (task?.status === 'cancelled') return '已取消';
            if (isTaskReloadableBillingRecord(task)) return '重新加载中';
            return '处理失败';
        }
        if (isVideoMode(task?.mode)) {
            const { completed, total } = getTaskGenerationCount(task);
            return `已生成 ${completed}/${total} 段`;
        }
        const { completed, total } = getTaskGenerationCount(task);
        return `已生成 ${completed}/${total} 张`;
    }

    function getTaskElapsedSeconds(task) {
        if (!task) return 0;
        const startedAt = Number(task.startedAt || task.createdAt || 0);
        const finishedAt = Number(task.completedAt || 0);
        const generationCompletedAt = Number(task.generationCompletedAt || 0);
        const endAt = generationCompletedAt
            || (['succeeded', 'failed', 'cancelled'].includes(task.status) && finishedAt ? finishedAt : Date.now());
        if (!startedAt || endAt < startedAt) return 0;
        return Math.max(0, Math.floor((endAt - startedAt) / 1000));
    }

    function getTaskElapsedLabel(task) {
        const seconds = getTaskElapsedSeconds(task);
        if (seconds < 60) return `已耗时 ${seconds} 秒`;
        const minutes = Math.floor(seconds / 60);
        const restSeconds = seconds % 60;
        return `已耗时 ${minutes}分${String(restSeconds).padStart(2, '0')}秒`;
    }

    function isGeminiImageTask(task = {}) {
        if (!task || isTextVisionTask(task) || isVideoMode(task.mode)) return false;
        const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
            ? task.metadata
            : {};
        const providerModel = metadata.provider_model || metadata.providerModel || metadata.upstream_model || metadata.upstreamModel;
        const source = [
            task.model,
            task.modelProviderId,
            task.providerId,
            task.apiModelGroup,
            providerModel
        ].map((value) => String(value || '').toLowerCase()).join(' ');
        return source.includes('gemini');
    }

    function getImageTaskWaitingResultLabel(task = {}) {
        return isGeminiImageTask(task) ? '等待 Gemini 图片返回' : '等待上游返回';
    }

    function getImageTaskProcessingStepLabel(task = {}) {
        const { completed, total } = getTaskGenerationCount(task);
        if (completed >= total && total > 0) return '结果同步中';
        if (completed > 0 && completed < total) return '等待剩余结果';
        const progress = Number(task.progress || 0);
        if (task.progressKnown) {
            if (progress < 12) return '请求上游中';
            if (progress < 70) return '模型生成中';
            return getImageTaskWaitingResultLabel(task);
        }
        const elapsed = getTaskElapsedSeconds(task);
        if (elapsed < 20) return '请求上游中';
        if (elapsed < 60) return '模型生成中';
        return getImageTaskWaitingResultLabel(task);
    }

    function getTaskCurrentStepLabel(task) {
        if (!task) return '待开始';
        if (task.status === 'queued') return getTaskQueuedStepLabel(task);
        if (task.status === 'processing' || task.status === 'streaming') {
            if (isTextVisionTask(task)) {
                if (task?.metadata?.stream_finalizing) return '正在完成';
                return task.mode === 'reverse' ? '视觉分析中' : '对话生成中';
            }
            if (isVideoMode(task.mode)) return '视频生成中';
            return getImageTaskProcessingStepLabel(task);
        }
        if (task.status === 'succeeded') return '生成完成';
        if (task.status === 'cancelled') return '已取消';
        if (isTaskReloadableBillingRecord(task)) return '记录重新加载中';
        return '生成失败';
    }

    function getTaskQueuedStepLabel(task = {}) {
        if (!task) return '已受理';
        const position = Number(task.queuePosition);
        if (Number.isFinite(position) && position > 1) return '排队等待中';
        const elapsed = getTaskElapsedSeconds(task);
        if (isTextVisionTask(task)) {
            if (elapsed < 4) return '已受理';
            return task.mode === 'reverse' ? '等待视觉模型响应' : '等待对话模型响应';
        }
        if (isVideoMode(task.mode)) {
            if (elapsed < 4) return '已受理';
            if (elapsed < 15) return '准备视频生成';
            return '等待视频返回';
        }
        if (elapsed < 4) return '已受理';
        if (elapsed < 10) return '准备图片生成';
        if (elapsed < 30) return isGeminiImageTask(task) ? 'Gemini 生成中' : '模型生成中';
        return isGeminiImageTask(task) ? '等待 Gemini 图片返回' : '等待图片返回';
    }

    function getTaskQueuedBadgeLabel(task = {}) {
        const label = getTaskQueuedStepLabel(task);
        if (label === '已受理') return '受理';
        if (/排队/.test(label)) return '排队中';
        if (/准备/.test(label)) return '准备中';
        if (/返回|响应/.test(label)) return '等待返回';
        if (/生成/.test(label)) return '生成中';
        return label;
    }

    function getTaskQueuedDetailLabel(task = {}) {
        const estimate = getTaskQueueEstimateLabel(task);
        const step = getTaskQueuedStepLabel(task);
        if (estimate && (estimate !== '即将开始' || step === '已受理' || /排队/.test(step))) {
            return estimate;
        }
        if (isTextVisionTask(task)) return estimate || '等待模型';
        return getTaskCurrentImageLabel(task);
    }

    function getTaskFailureReason(task = {}) {
        if (!task || !['failed', 'cancelled'].includes(task.status)) return '';
        if (task.status === 'cancelled') return '已停止生成';
        if (isTaskReloadableBillingRecord(task)) return '刷新后正在重新加载记录';
        if (taskChargeMayHaveOccurred(task)) return '上游任务已受理，可能已产生扣费；请稍后刷新生成记录，系统会按上游明细同步。';
        const explicitReason = getFriendlyTaskError(task.errorMessage || task.error_message || task.remoteError || '', '', task.mode);
        if (explicitReason) return explicitReason;
        if (task.mode === 'chat') return '这次没有扣积分。可以稍后重试，或切换更稳定的对话模型后再试。';
        if (isVideoMode(task.mode)) return '这次没有扣积分。可以稍后重试，或切换更稳定的视频模型后再试。';
        return '这次没有扣积分。可以稍后重试，或降低分辨率、减少参考图后再生成。';
    }

    function getTaskCurrentImageLabel(task) {
        if (isTextVisionTask(task)) {
            if (task?.mode === 'reverse') return '输出提示词';
            return '输出文本';
        }
        if (isVideoMode(task?.mode)) {
            const { completed, total } = getTaskGenerationCount(task);
            const current = isBusyTask(task)
                ? Math.min(total, Math.max(1, completed + 1))
                : completed;
            return `第 ${current}/${total} 段`;
        }
        const { completed, total } = getTaskGenerationCount(task);
        const current = isBusyTask(task)
            ? Math.min(total, Math.max(1, completed + 1))
            : completed;
        return `第 ${current}/${total} 张`;
    }

    function getTaskSlotImageLabel(task, slotSequence = null) {
        if (isTextVisionTask(task)) return getTaskCurrentImageLabel(task);
        const { total } = getTaskGenerationCount(task);
        const parsed = Number(slotSequence);
        const current = Number.isFinite(parsed) && parsed > 0
            ? clampNumber(Math.round(parsed), 1, total, 1)
            : Number.NaN;
        if (!Number.isFinite(current)) return getTaskCurrentImageLabel(task);
        return isVideoMode(task?.mode)
            ? `第 ${current}/${total} 段`
            : `第 ${current}/${total} 张`;
    }

    function getTaskProgressDetail(task) {
        if (task?.mode === 'chat') {
            const parts = [getTaskCurrentStepLabel(task)];
            if (task?.status === 'queued') {
                const queueLabel = getTaskQueueEstimateLabel(task);
                if (queueLabel) parts.push(queueLabel);
            }
            parts.push(getTaskElapsedLabel(task));
            return parts.filter(Boolean).join(' · ');
        }
        if (task?.status === 'queued') {
            return `${getTaskCurrentStepLabel(task)} · ${getTaskQueuedDetailLabel(task) || getTaskCurrentImageLabel(task)} · ${getTaskElapsedLabel(task)}`;
        }
        return `${getTaskCurrentStepLabel(task)} · ${getTaskCurrentImageLabel(task)} · ${getTaskElapsedLabel(task)}`;
    }

    function getStatusIcon(task) {
        if (!task) return 'fa-circle';
        if (task.status === 'succeeded') return 'fa-check';
        if (task.status === 'cancelled') return 'fa-ban';
        if (isTaskReloadableBillingRecord(task)) return 'fa-rotate-right';
        if (task.status === 'failed') return 'fa-triangle-exclamation';
        return 'fa-spinner';
    }

    function getTaskTitle(task) {
        if (!task) return 'AI 图片创作';
        if (task.mode === 'chat') return truncateText(task.prompt, 34) || 'API 文本对话';
        if (task.mode === 'reverse') return '图片提示词反推';
        const prompt = truncateText(task.prompt, 34);
        return prompt || getModeLabel(task.mode);
    }

    function getTaskSubtitle(task) {
        if (!task) return '从提示词画廊继续创作';
        const resolution = getResolutionLabel(task.resolution, task.mode);
        const billingText = (() => {
            if (task.status === 'failed' || task.status === 'cancelled') return getTaskChargeMetaLabel(task) || '未扣费';
            if (task.status === 'succeeded') return `已扣 ${formatPoints(task.chargedPoints || task.cost || 0)} 积分`;
            return `预计 ${formatPoints(task.estimatedPoints || task.cost || 0)} 积分`;
        })();
        if (task.billingMode === 'api') {
            const profile = task.apiProvider || getApiBaseProfile(task.apiBaseUrl)?.label || 'Sub2API';
            const usage = task.tokenUsage ? ` · ${task.tokenUsage} tokens` : '';
            const key = task.apiKeyTail ? ` · Key ${task.apiKeyTail}` : '';
            const groupLabel = task.apiModelGroup === 'video'
                ? '视频模型'
                : (task.apiModelGroup === 'image' ? '生图模型' : '对话模型');
            return `${profile} · ${groupLabel}${key}${usage}`;
        }
        if (isTextVisionTask(task)) {
            return `${getModeLabel(task.mode)} · ${getTaskImageMeta(task)} · ${billingText}`;
        }
        return `${getModeLabel(task.mode)} · ${task.ratio} · ${resolution} · ${billingText}`;
    }

    function getTaskPromptText(task) {
        if (!task) return '';
        if (task.mode === 'reverse') return task.resultPrompt || buildReversePrompt(task);
        if (task.mode === 'chat') return task.resultPrompt || task.prompt || getTaskTitle(task);
        return task.prompt || getTaskTitle(task);
    }

    function getTaskResolutionLabel(task) {
        return getResolutionLabel(task?.resolution, task?.mode);
    }

    function getTaskImageMeta(task) {
        if (isTextVisionTask(task)) {
            const model = [...runtimeApiTextModels, ...runtimeApiImageModels, ...MODEL_OPTIONS].find((item) => item.id === task?.model)?.label || task?.model || '对话视觉模型';
            return `${model} · ${task.mode === 'reverse' ? '图片转提示词' : '文本对话'}`;
        }
        const ratio = task?.ratio || '1:1';
        const resolution = getTaskResolutionLabel(task);
        if (task?.billingMode === 'api') {
            const model = [...runtimeApiVideoModels, ...runtimeApiImageModels, ...runtimeApiTextModels].find((item) => item.id === task.model)?.label || task.model || 'API 模型';
            return `${model} · ${ratio} · ${resolution}`;
        }
        const model = [...runtimeAdminVideoModels, ...MODEL_OPTIONS].find((item) => item.id === task?.model)?.label || task?.model || (isVideoMode(task?.mode) ? '视频模型' : '生图模型');
        return `${model} · ${ratio} · ${resolution}`;
    }

    function normalizeDurationMs(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
    }

    function formatDuration(ms) {
        const duration = normalizeDurationMs(ms);
        if (!duration) return '';
        if (duration < 1000) return `${duration}ms`;
        const seconds = Math.round(duration / 1000);
        if (seconds < 60) return `${seconds}秒`;
        const minutes = Math.floor(seconds / 60);
        const restSeconds = seconds % 60;
        return restSeconds ? `${minutes}分${restSeconds}秒` : `${minutes}分`;
    }

    function formatTokenCount(value = 0) {
        const count = Math.max(0, Math.round(Number(value) || 0));
        return count.toLocaleString('zh-CN');
    }

    function formatSecondsDuration(seconds) {
        const value = Math.max(0, Math.round(Number(seconds) || 0));
        if (value < 60) return `${value}秒`;
        const minutes = Math.floor(value / 60);
        const restSeconds = value % 60;
        return restSeconds ? `${minutes}分${String(restSeconds).padStart(2, '0')}秒` : `${minutes}分`;
    }

    function getTaskQueueEstimateLabel(task = {}) {
        if (!task || task.status !== 'queued') return '';
        const waitSeconds = Number(task.estimatedWaitSeconds);
        const position = Number(task.queuePosition);
        const positionText = Number.isFinite(position) && position > 1 ? `第 ${position} 位` : '即将开始';
        return Number.isFinite(waitSeconds) && waitSeconds > 0
            ? `预计等待 ${formatSecondsDuration(waitSeconds)} · ${positionText}`
            : positionText;
    }

    function getTaskTiming(task = {}) {
        const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
            ? task.metadata
            : {};
        const timing = metadata.timing && typeof metadata.timing === 'object' && !Array.isArray(metadata.timing)
            ? metadata.timing
            : {};
        const startedAt = normalizeDurationMs(task.startedAt);
        const completedAt = normalizeDurationMs(task.completedAt);
        const createdAt = normalizeDurationMs(task.createdAt);
        const queueMs = normalizeDurationMs(timing.queue_ms || timing.queueMs) || (startedAt && createdAt ? Math.max(0, startedAt - createdAt) : 0);
        const runMs = startedAt && completedAt ? Math.max(0, completedAt - startedAt) : 0;
        const totalMs = normalizeDurationMs(timing.total_ms || timing.totalMs)
            || (createdAt && completedAt ? Math.max(0, completedAt - createdAt) : 0)
            || (startedAt && completedAt ? Math.max(0, completedAt - startedAt) : 0);
        const upstreamMs = normalizeDurationMs(timing.upstream_ms || timing.upstreamMs || metadata.upstream_ms || metadata.upstreamMs);
        const postprocessMs = normalizeDurationMs(timing.postprocess_ms || timing.postprocessMs || metadata.postprocess_ms || metadata.postprocessMs);
        const insertResultsMs = normalizeDurationMs(timing.insert_results_ms || timing.insertResultsMs);
        const chargeMs = normalizeDurationMs(timing.charge_ms || timing.chargeMs);
        const usageMs = normalizeDurationMs(timing.usage_ms || timing.usageMs);
        const updateTaskMs = normalizeDurationMs(timing.update_task_ms || timing.updateTaskMs);
        const completeMs = normalizeDurationMs(timing.total_complete_ms || timing.totalCompleteMs);
        const preflightMs = normalizeDurationMs(timing.preflight_ms || timing.preflightMs);
        const configResolveMs = normalizeDurationMs(timing.config_resolve_ms || timing.configResolveMs);
        const referenceFetchMs = normalizeDurationMs(timing.reference_fetch_ms || timing.referenceFetchMs);
        const upstreamRequestMs = normalizeDurationMs(timing.upstream_request_ms || timing.upstreamRequestMs);
        const firstTokenMs = normalizeDurationMs(timing.first_token_ms || timing.firstTokenMs);
        const upstreamResponseMs = normalizeDurationMs(timing.upstream_response_ms || timing.upstreamResponseMs);
        const upstreamResponseTextMs = normalizeDurationMs(timing.upstream_response_text_ms || timing.upstreamResponseTextMs);
        const upstreamResponseParseMs = normalizeDurationMs(timing.upstream_response_parse_ms || timing.upstreamResponseParseMs);
        const finalizeMs = normalizeDurationMs(
            timing.finalize_ms
            || timing.finalizeMs
            || (postprocessMs + insertResultsMs + chargeMs + usageMs + updateTaskMs)
        );
        return {
            totalMs,
            queueMs,
            runMs,
            upstreamMs,
            upstreamRequestMs,
            firstTokenMs,
            upstreamResponseMs,
            upstreamResponseTextMs,
            upstreamResponseParseMs,
            preflightMs,
            configResolveMs,
            referenceFetchMs,
            postprocessMs,
            completeMs,
            insertResultsMs,
            chargeMs,
            usageMs,
            updateTaskMs,
            finalizeMs
        };
    }

    function getTaskTimingLabel(task = {}) {
        const timing = getTaskTiming(task);
        const preferredMs = timing.upstreamMs || timing.firstTokenMs || timing.runMs || timing.totalMs;
        if (!preferredMs) return '';
        if (timing.upstreamMs) return `生成 ${formatDuration(timing.upstreamMs)}`;
        if (timing.firstTokenMs) return `首字 ${formatDuration(timing.firstTokenMs)}`;
        return `耗时 ${formatDuration(preferredMs)}`;
    }

    function getTaskDurationMetaLabel(task = {}) {
        const timing = getTaskTiming(task);
        const preferredMs = timing.upstreamMs || timing.runMs || timing.totalMs || timing.firstTokenMs;
        return preferredMs ? `生成耗时 ${formatDuration(preferredMs)}` : '';
    }

    function getTaskTokenStats(task = {}) {
        const usage = task.tokenUsageRaw && typeof task.tokenUsageRaw === 'object' && !Array.isArray(task.tokenUsageRaw)
            ? task.tokenUsageRaw
            : (task.tokenUsage && typeof task.tokenUsage === 'object' && !Array.isArray(task.tokenUsage)
                ? task.tokenUsage
                : {});
        const inputTokenDetails = usage.input_tokens_details || usage.inputTokenDetails || usage.prompt_tokens_details || usage.promptTokenDetails || {};
        const normalizedInputTokenDetails = inputTokenDetails && typeof inputTokenDetails === 'object' && !Array.isArray(inputTokenDetails)
            ? inputTokenDetails
            : {};
        const numericTokenUsage = typeof task.tokenUsage === 'number' ? task.tokenUsage : 0;
        const inputTokens = Number(task.inputTokens ?? task.input_tokens ?? usage.input_tokens ?? usage.inputTokens ?? 0) || 0;
        const outputTokens = Number(task.outputTokens ?? task.output_tokens ?? usage.output_tokens ?? usage.outputTokens ?? 0) || 0;
        const totalTokens = Number(task.totalTokens ?? task.total_tokens ?? usage.total_tokens ?? usage.totalTokens ?? numericTokenUsage ?? 0) || (inputTokens + outputTokens);
        const cachedTokens = Number(task.cachedTokens ?? task.cached_tokens ?? usage.cached_tokens ?? usage.cachedTokens ?? normalizedInputTokenDetails.cached_tokens ?? normalizedInputTokenDetails.cachedTokens ?? 0) || 0;
        return {
            inputTokens: Math.max(0, Math.round(inputTokens)),
            outputTokens: Math.max(0, Math.round(outputTokens)),
            totalTokens: Math.max(0, Math.round(totalTokens)),
            cachedTokens: Math.max(0, Math.round(cachedTokens))
        };
    }

    function getTaskModelStats(task = {}) {
        const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
            ? task.metadata
            : {};
        const requestedModel = String(
            task.model
            || metadata.provider_model
            || metadata.providerModel
            || metadata.requested_model
            || metadata.requestedModel
            || ''
        ).trim();
        const upstreamModel = String(
            metadata.provider_response_model
            || metadata.providerResponseModel
            || metadata.upstream_model
            || metadata.upstreamModel
            || ''
        ).trim();
        return { requestedModel, upstreamModel };
    }

    function getTaskModelLabel(task = {}) {
        const { requestedModel } = getTaskModelStats(task);
        const modelId = requestedModel || String(task?.model || '').trim();
        return [...runtimeApiTextModels, ...runtimeApiImageModels, ...MODEL_OPTIONS].find((item) => item.id === modelId)?.label
            || modelId
            || '模型';
    }

    function getChatTaskQuestionText(task = {}) {
        return String(
            task?.prompt
            || task?.metadata?.prompt
            || task?.metadata?.user_prompt
            || task?.metadata?.userPrompt
            || task?.input
            || task?.question
            || ''
        ).trim();
    }

    function getChatTaskAnswerText(task = {}) {
        const resultText = String(task?.resultPrompt || '').trim();
        if (resultText) return resultText;
        if (task?.status === 'failed' || task?.status === 'cancelled') return getTaskFailureReason(task);
        return '';
    }

    function getChatTaskReasoningText(task = {}) {
        return String(task?.reasoningText || task?.metadata?.reasoning_content || task?.metadata?.reasoningContent || '').trim();
    }

    function getChatReasoningDurationMs(task = {}) {
        const startedAt = Number(task?.reasoningStartedAt || task?.reasoning_started_at || 0);
        const completedAt = Number(task?.reasoningCompletedAt || task?.reasoning_completed_at || 0);
        if (startedAt > 0 && completedAt >= startedAt) return completedAt - startedAt;

        const diagnostic = getTaskReasoningDiagnostic(task);
        const firstReasoningMs = Number(diagnostic.first_reasoning_ms ?? diagnostic.firstReasoningMs);
        const firstContentMs = Number(diagnostic.first_content_ms ?? diagnostic.firstContentMs);
        if (Number.isFinite(firstReasoningMs) && firstReasoningMs >= 0
            && Number.isFinite(firstContentMs) && firstContentMs >= firstReasoningMs) {
            return firstContentMs - firstReasoningMs;
        }

        const reasoningEndMs = Number(
            diagnostic.last_visible_ms
            ?? diagnostic.lastVisibleMs
            ?? diagnostic.protocol_done_ms
            ?? diagnostic.protocolDoneMs
        );
        if (Number.isFinite(firstReasoningMs) && firstReasoningMs >= 0
            && Number.isFinite(reasoningEndMs) && reasoningEndMs >= firstReasoningMs) {
            return reasoningEndMs - firstReasoningMs;
        }
        return 0;
    }

    function isChatReasoningActive(task = {}) {
        return Boolean(
            getChatTaskReasoningText(task)
            && isBusyTask(task)
            && !getChatTaskAnswerText(task)
            && !Number(task?.reasoningCompletedAt || task?.reasoning_completed_at || 0)
        );
    }

    function getChatReasoningPresentation(task = {}) {
        const active = isChatReasoningActive(task);
        const hasExplicitExpandedState = typeof task?.reasoningExpanded === 'boolean';
        const expanded = hasExplicitExpandedState ? task.reasoningExpanded : active;
        const durationMs = getChatReasoningDurationMs(task);
        const diagnostic = getTaskReasoningDiagnostic(task);
        const firstReasoningMs = Number(diagnostic.first_reasoning_ms ?? diagnostic.firstReasoningMs);
        const firstContentMs = Number(diagnostic.first_content_ms ?? diagnostic.firstContentMs);
        const hasCompletedTiming = Number(task?.reasoningCompletedAt || task?.reasoning_completed_at || 0) > 0
            || (Number.isFinite(firstReasoningMs) && firstReasoningMs >= 0
                && Number.isFinite(firstContentMs) && firstContentMs >= firstReasoningMs);
        const durationSeconds = hasCompletedTiming ? Math.max(1, Math.ceil(durationMs / 1000)) : 0;
        return {
            active,
            expanded,
            label: active ? '思考中' : (durationSeconds ? `思考了 ${durationSeconds} 秒` : '思考完成')
        };
    }

    function completeChatReasoning(task = {}, completedAt = Date.now(), { collapse = true } = {}) {
        if (!task || !getChatTaskReasoningText(task)) return false;
        if (!Number(task.reasoningStartedAt || 0)) task.reasoningStartedAt = completedAt;
        if (Number(task.reasoningCompletedAt || 0)) return false;
        task.reasoningCompletedAt = completedAt;
        if (collapse) task.reasoningExpanded = false;
        return true;
    }

    function renderChatReasoningBlock(task = {}) {
        const reasoningText = getChatTaskReasoningText(task);
        if (!reasoningText) return '';
        const presentation = getChatReasoningPresentation(task);
        const taskId = String(task?.id || task?.clientTaskId || '').trim();
        const bodyId = `aiw-chat-reasoning-${taskId || 'current'}`;
        return `
            <div class="ai-image-chat-reasoning ${presentation.expanded ? 'is-expanded' : 'is-collapsed'}">
                <button class="ai-image-chat-reasoning-head" type="button" data-aiw-reasoning-toggle data-task-id="${escapeHtml(taskId)}" aria-expanded="${presentation.expanded ? 'true' : 'false'}" aria-controls="${escapeHtml(bodyId)}">
                    <i class="fas fa-brain" aria-hidden="true"></i>
                    <span>${escapeHtml(presentation.label)}</span>
                    <i class="fas fa-chevron-down ai-image-chat-reasoning-chevron" aria-hidden="true"></i>
                </button>
                <div class="ai-image-chat-reasoning-body" id="${escapeHtml(bodyId)}" aria-hidden="${presentation.expanded ? 'false' : 'true'}">
                    <p>${escapeHtml(reasoningText)}</p>
                </div>
            </div>
        `;
    }

    function updateVisibleChatReasoning(task = {}) {
        if (!task) return false;
        const normalizedTaskId = String(task.id || task.clientTaskId || '').trim();
        const escapedTaskId = global.CSS?.escape
            ? global.CSS.escape(normalizedTaskId)
            : normalizedTaskId.replace(/"/g, '\\"');
        const turn = overlay?.querySelector?.(`[data-aiw-chat-turn-id="${escapedTaskId}"]`);
        const block = turn?.querySelector?.('.ai-image-chat-reasoning');
        const toggle = block?.querySelector?.('[data-aiw-reasoning-toggle]');
        const body = block?.querySelector?.('.ai-image-chat-reasoning-body');
        if (!block || !toggle || !body) return false;
        const presentation = getChatReasoningPresentation(task);
        block.classList.toggle('is-expanded', presentation.expanded);
        block.classList.toggle('is-collapsed', !presentation.expanded);
        toggle.setAttribute('aria-expanded', presentation.expanded ? 'true' : 'false');
        body.setAttribute('aria-hidden', presentation.expanded ? 'false' : 'true');
        const label = toggle.querySelector('span');
        if (label) label.textContent = presentation.label;
        const reasoningParagraph = body.querySelector('p');
        if (reasoningParagraph) reasoningParagraph.textContent = getChatTaskReasoningText(task);
        return true;
    }

    function renderChatLoadingDots() {
        return `
            <span class="chat-loading-dots chat-loading-dots--inline" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
            </span>
        `;
    }

    function renderChatCancelledNotice(task = {}) {
        if (task?.status !== 'cancelled') return '';
        return '<em class="ai-image-chat-cancelled-note">已取消生成</em>';
    }

    function getChatTaskStatsItems(task = {}, { showDuration = false } = {}) {
        const items = [];
        const generatedDateTime = formatGeneratedDateTime(task.completedAt || task.createdAt);
        if (generatedDateTime) items.push({ text: generatedDateTime });
        const durationLabel = showDuration ? getTaskDurationMetaLabel(task) : '';
        if (durationLabel) items.push({ text: durationLabel });
        const modelLabel = getTaskModelLabel(task);
        if (modelLabel) items.push({ text: `模型 ${modelLabel}` });
        const tokenStats = getTaskTokenStats(task);
        if (tokenStats.outputTokens) items.push({ text: `输出 Token ${formatTokenCount(tokenStats.outputTokens)}` });
        if (tokenStats.inputTokens) items.push({ text: `输入 Token ${formatTokenCount(tokenStats.inputTokens)}` });
        const chargeLabel = getTaskChargeMetaLabel(task);
        if (chargeLabel) items.push({ text: chargeLabel });
        return items;
    }

    function getTaskChargeMetaLabel(task = {}) {
        const billingMode = String(task.billingMode || task.billing_mode || '').trim();
        if (billingMode === 'api') return task.status === 'succeeded' ? '本站扣费 0 积分' : '';
        if (billingMode && billingMode !== 'points') return '';
        const chargedPoints = Number(task.chargedPoints ?? task.charged_points ?? 0);
        if (chargedPoints > 0) return `扣费 ${formatBillingPoints(chargedPoints)} 积分`;
        if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'refunded') {
            if (isSub2ApiActualCostTask(task)) return getTaskBillingSyncMetaLabel(task) || '扣费同步中';
            if (taskChargeMayHaveOccurred(task)) return '扣费待确认';
            return '未扣费';
        }
        if (task.status !== 'succeeded') return '';
        if (chargedPoints <= 0 && isSub2ApiActualCostTask(task)) return getTaskBillingSyncMetaLabel(task) || '扣费同步中';
        return `扣费 ${formatBillingPoints(chargedPoints)} 积分`;
    }

    function getTaskBillingSyncMetaLabel(task = {}) {
        const status = getTaskBillingSyncStatus(task);
        const message = String(
            task.billingSyncMessage
            || task.billing_sync_message
            || task.metadata?.sub2api_billing_sync?.message
            || task.metadata?.sub2apiBillingSync?.message
            || ''
        ).trim();
        if (message && !['pending', 'settled'].includes(status)) return message;
        if (status === 'not_found') return '未找到上游扣费明细';
        if (status === 'missing_request_id' || status === 'no_request_id') return '旧记录缺少扣费追踪ID';
        if (status === 'timeout' || status === 'unavailable') return '扣费暂未同步';
        if (status === 'settled') return '扣费 0 积分';
        if (status === 'pending') return '扣费同步中';
        return '';
    }

    function taskChargeMayHaveOccurred(task = {}) {
        const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
            ? task.metadata
            : {};
        const providerAsync = metadata.provider_async && typeof metadata.provider_async === 'object' && !Array.isArray(metadata.provider_async)
            ? metadata.provider_async
            : {};
        const providerTaskId = String(
            task.providerTaskId
            || task.provider_task_id
            || metadata.provider_task_id
            || metadata.providerTaskId
            || providerAsync.provider_task_id
            || providerAsync.providerTaskId
            || ''
        ).trim();
        const mediaType = String(metadata.media_type || metadata.mediaType || metadata.output || task.mode || '').trim().toLowerCase();
        const errorCode = String(task.errorCode || task.error_code || metadata.error_code || '').trim().toLowerCase();
        const message = String(task.errorMessage || task.error_message || task.remoteError || metadata.error_message || '').trim();
        if (metadata.charge_may_have_occurred === true || metadata.chargeMayHaveOccurred === true) return true;
        if (errorCode === 'ai_video_task_timeout_after_provider_accept') return true;
        if (providerTaskId && (mediaType === 'video' || isVideoMode(task.mode))) return true;
        return /上游任务已受理|可能已产生扣费|可能已扣费/.test(message);
    }

    function getTaskBillingSyncStatus(task = {}) {
        return String(
            task.billingSyncStatus
            || task.billing_sync_status
            || task.metadata?.sub2api_billing_sync?.status
            || task.metadata?.sub2apiBillingSync?.status
            || ''
        ).trim().toLowerCase();
    }

    function isTaskReloadableBillingRecord(task = {}) {
        if (!task || task.status !== 'failed') return false;
        const createdAt = normalizeTimestamp(task.createdAt || task.created_at, 0);
        const updatedAt = normalizeTimestamp(task.updatedAt || task.updated_at, 0);
        const completedAt = normalizeTimestamp(task.completedAt || task.completed_at, 0);
        const referenceAt = Math.max(createdAt, updatedAt, completedAt);
        if (referenceAt && Date.now() - referenceAt < RELOADABLE_BILLING_RECORD_MIN_AGE_MS) return false;
        if (String(task.clientTaskId || task.client_task_id || '').trim()) return false;
        const status = getTaskBillingSyncStatus(task);
        const reason = [
            status,
            task.errorCode,
            task.error_code,
            task.errorMessage,
            task.error_message,
            task.remoteError,
            task.billingSyncMessage,
            task.billing_sync_message,
            task.metadata?.sub2api_billing_sync?.message,
            task.metadata?.sub2apiBillingSync?.message
        ].map((value) => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase();
        const onlyBillingTraceMissing = /missing_request_id|no_request_id|旧记录缺少扣费追踪id/i.test(reason);
        if (!onlyBillingTraceMissing) return false;
        const errorCode = String(task.errorCode || task.error_code || '').trim().toLowerCase();
        return !/^ai_image_provider|^ai_image_generation|^user_cancelled/.test(errorCode);
    }

    function shouldHoldIncompleteSucceededImageResult(task = {}, visibleImageCount = 0) {
        if (!task || task.status !== 'succeeded' || isTextVisionTask(task) || isVideoMode(task.mode)) return false;
        const { total } = getTaskGenerationCount(task);
        if (Number(visibleImageCount || 0) >= total) return false;
        const createdAt = normalizeTimestamp(task.createdAt || task.created_at, 0);
        const updatedAt = normalizeTimestamp(task.updatedAt || task.updated_at, 0);
        const completedAt = normalizeTimestamp(task.completedAt || task.completed_at, 0);
        const referenceAt = Math.max(createdAt, updatedAt, completedAt);
        return !referenceAt || Date.now() - referenceAt < INCOMPLETE_SUCCEEDED_IMAGE_RESULT_GRACE_MS;
    }

    function isSub2ApiActualCostTask(task = {}) {
        const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
            ? task.metadata
            : {};
        const pricingCharge = metadata.pricing_charge && typeof metadata.pricing_charge === 'object' && !Array.isArray(metadata.pricing_charge)
            ? metadata.pricing_charge
            : {};
        const pricing = metadata.pricing && typeof metadata.pricing === 'object' && !Array.isArray(metadata.pricing)
            ? metadata.pricing
            : {};
        const matchedRule = pricing.matched_rule && typeof pricing.matched_rule === 'object' && !Array.isArray(pricing.matched_rule)
            ? pricing.matched_rule
            : {};
        const matchedMetadata = matchedRule.metadata && typeof matchedRule.metadata === 'object' && !Array.isArray(matchedRule.metadata)
            ? matchedRule.metadata
            : {};
        const matchedPricing = matchedMetadata.pricing && typeof matchedMetadata.pricing === 'object' && !Array.isArray(matchedMetadata.pricing)
            ? matchedMetadata.pricing
            : {};
        const strategy = normalizePricingText(
            pricingCharge.billing_strategy
            || pricingCharge.billingStrategy
            || pricingCharge.pricing?.billing_strategy
            || pricingCharge.pricing?.billingStrategy
            || matchedMetadata.billing_strategy
            || matchedMetadata.billingStrategy
            || matchedPricing.billing_strategy
            || matchedPricing.billingStrategy,
            40
        ).toLowerCase().replace(/-/g, '_');
        return strategy === 'token_sub2api';
    }

    function getTaskTimingSummary(task = {}) {
        const timing = getTaskTiming(task);
        const chunks = [];
        if (timing.totalMs) chunks.push(`总耗时 ${formatDuration(timing.totalMs)}`);
        if (timing.queueMs) chunks.push(`排队 ${formatDuration(timing.queueMs)}`);
        if (timing.preflightMs) {
            const preflightParts = [`预检 ${formatDuration(timing.preflightMs)}`];
            if (timing.configResolveMs) preflightParts.push(`配置 ${formatDuration(timing.configResolveMs)}`);
            if (timing.referenceFetchMs) preflightParts.push(`参考图 ${formatDuration(timing.referenceFetchMs)}`);
            chunks.push(preflightParts.join(' · '));
        }
        if (timing.upstreamMs) {
            const upstreamParts = [`接口等待 ${formatDuration(timing.upstreamMs)}`];
            if (timing.upstreamRequestMs) upstreamParts.push(`首响应 ${formatDuration(timing.upstreamRequestMs)}`);
            if (timing.firstTokenMs) upstreamParts.push(`首字 ${formatDuration(timing.firstTokenMs)}`);
            if (timing.upstreamResponseMs) upstreamParts.push(`上游耗时 ${formatDuration(timing.upstreamResponseMs)}`);
            if (!timing.upstreamResponseMs && timing.upstreamResponseTextMs) upstreamParts.push(`读响应 ${formatDuration(timing.upstreamResponseTextMs)}`);
            if (timing.upstreamResponseParseMs) upstreamParts.push(`解析 ${formatDuration(timing.upstreamResponseParseMs)}`);
            chunks.push(upstreamParts.join(' · '));
        }
        if (timing.postprocessMs) chunks.push(`后处理 ${formatDuration(timing.postprocessMs)}`);
        if (timing.insertResultsMs) chunks.push(`写结果 ${formatDuration(timing.insertResultsMs)}`);
        if (timing.chargeMs) chunks.push(`计费 ${formatDuration(timing.chargeMs)}`);
        if (timing.usageMs) chunks.push(`记用量 ${formatDuration(timing.usageMs)}`);
        if (timing.updateTaskMs) chunks.push(`收口 ${formatDuration(timing.updateTaskMs)}`);
        if (timing.finalizeMs && !timing.postprocessMs && !timing.insertResultsMs && !timing.chargeMs && !timing.usageMs && !timing.updateTaskMs) {
            chunks.push(`收尾 ${formatDuration(timing.finalizeMs)}`);
        }
        return chunks.join(' · ');
    }

    function formatGeneratedTime(timestamp) {
        const date = new Date(Number(timestamp) || Date.now());
        if (Number.isNaN(date.getTime())) return '';
        const now = new Date();
        const sameYear = date.getFullYear() === now.getFullYear();
        const sameDay = sameYear
            && date.getMonth() === now.getMonth()
            && date.getDate() === now.getDate();
        const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
        if (sameDay) return `生成于 ${time}`;
        const day = date.toLocaleDateString('zh-CN', sameYear
            ? { month: '2-digit', day: '2-digit' }
            : { year: 'numeric', month: '2-digit', day: '2-digit' });
        return `${day} ${time}`;
    }

    function formatGeneratedDateTime(timestamp) {
        const date = new Date(Number(timestamp) || Date.now());
        if (Number.isNaN(date.getTime())) return '';
        const day = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
        return `${day} ${time}`;
    }

    function getCurrentWindowScroll() {
        const doc = document.documentElement;
        const body = document.body;
        return {
            x: Number(global.scrollX || global.pageXOffset || doc?.scrollLeft || body?.scrollLeft || 0) || 0,
            y: Number(global.scrollY || global.pageYOffset || doc?.scrollTop || body?.scrollTop || 0) || 0
        };
    }

    function buildWorkbenchNoScaleViewportContent(content = '') {
        const existingParts = String(content || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
        const lockedParts = [];
        existingParts.forEach((part) => {
            const key = String(part.split('=')[0] || '').trim().toLowerCase();
            if (!key || key === 'maximum-scale' || key === 'user-scalable') return;
            lockedParts.push(part);
        });
        if (!lockedParts.some((part) => /^width\s*=/i.test(part))) {
            lockedParts.unshift('width=device-width');
        }
        if (!lockedParts.some((part) => /^initial-scale\s*=/i.test(part))) {
            lockedParts.push('initial-scale=1.0');
        }
        lockedParts.push('maximum-scale=1', 'user-scalable=no');
        return lockedParts.join(', ');
    }

    function lockWorkbenchViewportScale() {
        if (viewportScaleLockState || !isMobileWorkbenchViewport()) return;
        let meta = document.querySelector('meta[name="viewport"]');
        let created = false;
        if (!meta && document.head) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'viewport');
            document.head.appendChild(meta);
            created = true;
        }
        if (!meta) return;
        const content = meta.getAttribute('content') || '';
        viewportScaleLockState = { meta, content, created };
        meta.setAttribute('content', buildWorkbenchNoScaleViewportContent(content));
    }

    function unlockWorkbenchViewportScale() {
        const lock = viewportScaleLockState;
        viewportScaleLockState = null;
        if (!lock?.meta) return;
        if (lock.created && lock.meta.parentNode) {
            lock.meta.remove();
            return;
        }
        lock.meta.setAttribute('content', lock.content || '');
    }

    function syncWorkbenchViewportScaleLock() {
        if (state.open && isMobileWorkbenchViewport()) {
            lockWorkbenchViewportScale();
        } else {
            unlockWorkbenchViewportScale();
        }
    }

    function lockWorkbenchPageScroll() {
        const body = document.body;
        if (!body || bodyScrollLockState) return;
        const doc = document.documentElement;
        const scroll = getCurrentWindowScroll();
        const useFixedBodyLock = !isMobileWorkbenchViewport();
        bodyScrollLockState = {
            x: scroll.x,
            y: scroll.y,
            mode: useFixedBodyLock ? 'fixed-body' : 'overflow-only',
            style: {
                docOverflow: doc?.style?.overflow || '',
                docOverscrollBehavior: doc?.style?.overscrollBehavior || '',
                position: body.style.position,
                top: body.style.top,
                left: body.style.left,
                right: body.style.right,
                width: body.style.width,
                overflow: body.style.overflow,
                overscrollBehavior: body.style.overscrollBehavior
            }
        };
        if (doc?.style) {
            doc.style.overflow = 'hidden';
            doc.style.overscrollBehavior = 'none';
        }
        if (!useFixedBodyLock) {
            body.style.width = '100%';
            body.style.overflow = 'hidden';
            body.style.overscrollBehavior = 'none';
            return;
        }
        body.style.position = 'fixed';
        body.style.top = `-${scroll.y}px`;
        body.style.left = scroll.x ? `-${scroll.x}px` : '0';
        body.style.right = '0';
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        body.style.overscrollBehavior = 'none';
    }

    function unlockWorkbenchPageScroll() {
        const lock = bodyScrollLockState;
        bodyScrollLockState = null;
        if (!lock) return;
        const doc = document.documentElement;
        if (doc?.style) {
            doc.style.overflow = lock.style.docOverflow;
            doc.style.overscrollBehavior = lock.style.docOverscrollBehavior;
        }
        const body = document.body;
        if (body) {
            body.style.position = lock.style.position;
            body.style.top = lock.style.top;
            body.style.left = lock.style.left;
            body.style.right = lock.style.right;
            body.style.width = lock.style.width;
            body.style.overflow = lock.style.overflow;
            body.style.overscrollBehavior = lock.style.overscrollBehavior;
        }
        global.scrollTo?.(lock.x, lock.y);
    }

    function setBodyOpenState(open) {
        document.documentElement.classList.toggle('ai-image-workbench-open', open);
        document.body?.classList.toggle('ai-image-workbench-open', open);
        if (open) {
            lockWorkbenchPageScroll();
            syncWorkbenchViewportScaleLock();
        } else {
            syncWorkbenchViewportScaleLock();
            unlockWorkbenchPageScroll();
            setBodyImagePreviewState(false);
        }
        if (nativeToggle && nativeToggle.checked !== open) {
            nativeToggle.checked = open;
        }
    }

    function setBodyImagePreviewState(open) {
        document.documentElement.classList.toggle('ai-image-preview-open', open);
        document.body?.classList.toggle('ai-image-preview-open', open);
    }

    function isMobileWorkbenchViewport() {
        return Boolean(global.matchMedia?.(WORKBENCH_NARROW_QUERY)?.matches);
    }

    function isMobileKeyboardDevice() {
        const coarsePointer = Boolean(global.matchMedia?.('(any-pointer: coarse)')?.matches);
        const touchPoints = Number(global.navigator?.maxTouchPoints || 0);
        const userAgent = String(global.navigator?.userAgent || '');
        const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
        return isMobileWorkbenchViewport() && (coarsePointer || touchPoints > 0 || mobileUserAgent);
    }

    function resetMobileWorkbenchLayout() {
        mobileWorkbenchStaticHeight = 0;
        closeMobilePromptProxy({ blur: true, animate: false });
        root?.classList?.remove('is-mobile-prompt-proxy-active');
        document.body?.classList?.remove('ai-image-prompt-proxy-active');
        if (!root?.style) return;
        root.style.removeProperty('--aiw-mobile-layout-height');
        root.style.removeProperty('--aiw-mobile-composer-top');
        root.style.removeProperty('--aiw-mobile-history-panel-max-height');
    }

    function getMobileWorkbenchLayoutHeight() {
        return Math.round(Math.max(
            Number(document.documentElement?.clientHeight || 0),
            Number(global.innerHeight || 0),
            0
        ));
    }

    function getMobilePromptProxyViewport() {
        const visualViewport = global.visualViewport || null;
        return {
            top: Math.max(0, Math.round(Number(visualViewport?.offsetTop || 0))),
            height: Math.max(1, Math.round(Number(visualViewport?.height || global.innerHeight || 0)))
        };
    }

    function addMobilePromptProxyViewportListeners() {
        global.visualViewport?.addEventListener?.('resize', handleMobilePromptProxyViewportChange, { passive: true });
        global.visualViewport?.addEventListener?.('scroll', handleMobilePromptProxyViewportChange, { passive: true });
        global.addEventListener?.('resize', handleMobilePromptProxyViewportChange, { passive: true });
    }

    function removeMobilePromptProxyViewportListeners() {
        global.visualViewport?.removeEventListener?.('resize', handleMobilePromptProxyViewportChange);
        global.visualViewport?.removeEventListener?.('scroll', handleMobilePromptProxyViewportChange);
        global.removeEventListener?.('resize', handleMobilePromptProxyViewportChange);
        if (mobilePromptProxyViewportFrame) {
            global.cancelAnimationFrame?.(mobilePromptProxyViewportFrame);
            mobilePromptProxyViewportFrame = 0;
        }
    }

    function clearMobilePromptProxyBlurTimer() {
        if (!mobilePromptProxyBlurTimer) return;
        global.clearTimeout?.(mobilePromptProxyBlurTimer);
        mobilePromptProxyBlurTimer = 0;
    }

    function applyMobilePromptProxyViewport(viewport) {
        if (!mobilePromptProxy) return;
        const previous = mobilePromptProxyAppliedViewport;
        if (!previous || previous.top !== viewport.top) {
            root?.style?.setProperty('--aiw-mobile-visual-top', `${viewport.top}px`);
            mobilePromptProxy.style.setProperty('--aiw-mobile-proxy-top', `${viewport.top}px`);
        }
        if (!previous || previous.height !== viewport.height) {
            mobilePromptProxy.style.setProperty('--aiw-mobile-proxy-height', `${viewport.height}px`);
        }
        mobilePromptProxyAppliedViewport = viewport;
    }

    function handleMobilePromptProxyViewportChange() {
        if (!['opening', 'open', 'closing'].includes(mobilePromptProxyState)) return;
        syncMobilePromptProxyViewport();
    }

    function scheduleMobilePromptProxyViewportSync() {
        if (!['opening', 'open', 'closing'].includes(mobilePromptProxyState) || mobilePromptProxyViewportFrame) return;
        const sync = () => {
            mobilePromptProxyViewportFrame = 0;
            syncMobilePromptProxyViewport();
        };
        mobilePromptProxyViewportFrame = global.requestAnimationFrame?.(sync) || global.setTimeout?.(sync, 16) || 0;
    }

    function syncMobilePromptProxyViewport() {
        if (!mobilePromptProxy || !['opening', 'open', 'closing'].includes(mobilePromptProxyState)) return;
        const viewport = getMobilePromptProxyViewport();
        const keyboardThreshold = Math.max(32, Math.round(mobilePromptProxyBaselineHeight * 0.05));
        const keyboardVisible = mobilePromptProxyBaselineHeight - viewport.height >= keyboardThreshold;
        applyMobilePromptProxyViewport(viewport);
        if (mobilePromptProxyState === 'closing') {
            scheduleMobilePromptProxyViewportSync();
            return;
        }
        if (mobilePromptProxyState === 'opening') {
            const openingExpired = Date.now() - mobilePromptProxyStartedAt >= 1200;
            const minimumPlausibleHeight = Math.max(320, Math.round(mobilePromptProxyBaselineHeight * 0.42));
            if (!keyboardVisible || viewport.height < minimumPlausibleHeight) {
                if (openingExpired) {
                    closeMobilePromptProxy({ blur: true, animate: false });
                    return;
                }
                mobilePromptProxyCandidateViewport = null;
                mobilePromptProxyCandidateSince = 0;
                scheduleMobilePromptProxyViewportSync();
                return;
            }
            const geometryStable = mobilePromptProxyCandidateViewport
                && Math.abs(mobilePromptProxyCandidateViewport.height - viewport.height) <= 4
                && Math.abs(mobilePromptProxyCandidateViewport.top - viewport.top) <= 2;
            if (!geometryStable) mobilePromptProxyCandidateSince = Date.now();
            mobilePromptProxyCandidateViewport = viewport;
            if (!mobilePromptProxyCandidateSince || Date.now() - mobilePromptProxyCandidateSince < 80) {
                if (openingExpired) {
                    closeMobilePromptProxy({ blur: true, animate: false });
                    return;
                }
                scheduleMobilePromptProxyViewportSync();
                return;
            }
        }
        if (mobilePromptProxyState === 'open'
            && mobilePromptProxyOpenViewportHeight > 0
            && viewport.height < mobilePromptProxyOpenViewportHeight) {
            mobilePromptProxyOpenViewportHeight = viewport.height;
        }
        const keyboardDescentStarted = mobilePromptProxyOpenViewportHeight > 0
            && viewport.height >= mobilePromptProxyOpenViewportHeight + 4;
        if (mobilePromptProxyState === 'open'
            && mobilePromptProxyKeyboardVisible
            && (keyboardDescentStarted || !keyboardVisible)) {
            closeMobilePromptProxy({ blur: false, animate: true });
            return;
        }
        if (!keyboardVisible) {
            return;
        }

        mobilePromptProxyKeyboardVisible = true;
        if (mobilePromptProxyState === 'opening') {
            mobilePromptProxyState = 'open';
            mobilePromptProxyOpenViewportHeight = viewport.height;
            root?.classList?.add('is-mobile-prompt-proxy-active');
            document.body?.classList?.add('ai-image-prompt-proxy-active');
            mobilePromptProxy.classList.remove('is-opening');
            mobilePromptProxy.classList.add('is-open');
        }
        scheduleMobilePromptProxyViewportSync();
    }

    function syncMobilePromptProxySource(value, selectionStart, selectionEnd) {
        state.prompt = value;
        clearComposerError();
        const currentSource = mobilePromptProxySource instanceof HTMLTextAreaElement && mobilePromptProxySource.isConnected
            ? mobilePromptProxySource
            : root?.querySelector?.('.ai-image-main-prompt[data-aiw-prompt]');
        if (currentSource instanceof HTMLTextAreaElement) {
            currentSource.value = value;
            currentSource.setSelectionRange(
                Math.min(selectionStart, value.length),
                Math.min(selectionEnd, value.length)
            );
            syncPromptTextareaHeight(currentSource);
        }
        overlay?.querySelector?.('.ai-image-main-error')?.remove?.();
        const submitButton = overlay?.querySelector?.('.ai-image-main-submit[data-aiw-action="generate"]');
        if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = !canSubmitWorkbench(inferWorkbenchMode());
        }
        persistState();
    }

    function getMobilePromptProxyCount() {
        return mobilePromptProxy?.querySelector?.('[data-aiw-mobile-prompt-count]') || null;
    }

    function syncMobilePromptProxyHeight() {
        if (!(mobilePromptProxyInput instanceof HTMLTextAreaElement)) return;
        mobilePromptProxyInput.style.height = 'auto';
        mobilePromptProxyInput.style.height = `${Math.min(180, Math.max(92, mobilePromptProxyInput.scrollHeight || 0))}px`;
        const count = getMobilePromptProxyCount();
        if (count) count.textContent = `${mobilePromptProxyInput.value.length}/4000`;
    }

    function focusMobilePromptProxyInput({ restart = false } = {}) {
        if (!(mobilePromptProxyInput instanceof HTMLTextAreaElement)) return false;
        if (restart && document.activeElement === mobilePromptProxyInput) {
            mobilePromptProxyInput.blur();
        }
        try {
            mobilePromptProxyInput.focus({ preventScroll: true });
        } catch (_) {
            mobilePromptProxyInput.focus();
        }
        clearMobilePromptProxyBlurTimer();
        return document.activeElement === mobilePromptProxyInput;
    }

    function handleMobilePromptProxyBlur() {
        if (!['opening', 'open'].includes(mobilePromptProxyState)) return;
        clearMobilePromptProxyBlurTimer();
        if (mobilePromptProxyState === 'open') {
            closeMobilePromptProxy({ blur: false, animate: true });
            return;
        }
        mobilePromptProxyBlurTimer = global.setTimeout?.(() => {
            mobilePromptProxyBlurTimer = 0;
            if (mobilePromptProxyState !== 'opening') return;
            if (document.activeElement === mobilePromptProxyInput) return;
            const viewport = getMobilePromptProxyViewport();
            const keyboardThreshold = Math.max(32, Math.round(mobilePromptProxyBaselineHeight * 0.05));
            const keyboardVisible = mobilePromptProxyBaselineHeight - viewport.height >= keyboardThreshold;
            if (!keyboardVisible) {
                closeMobilePromptProxy({ blur: false, animate: false });
            }
        }, 240) || 0;
    }

    function openMobilePromptProxy(source = null) {
        if (!state.open || !isMobileKeyboardDevice()) return false;
        if (!(mobilePromptProxyInput instanceof HTMLTextAreaElement) || !mobilePromptProxy) return false;
        if (mobilePromptProxyState === 'open') {
            const viewport = getMobilePromptProxyViewport();
            const keyboardThreshold = Math.max(32, Math.round(mobilePromptProxyBaselineHeight * 0.05));
            const keyboardVisible = mobilePromptProxyBaselineHeight - viewport.height >= keyboardThreshold;
            if (keyboardVisible && document.activeElement === mobilePromptProxyInput) return true;
            mobilePromptProxyState = 'opening';
            mobilePromptProxyKeyboardVisible = false;
            mobilePromptProxyOpenViewportHeight = 0;
            mobilePromptProxyStartedAt = Date.now();
            mobilePromptProxyCandidateViewport = null;
            mobilePromptProxyCandidateSince = 0;
            root?.classList?.remove('is-mobile-prompt-proxy-active');
            document.body?.classList?.remove('ai-image-prompt-proxy-active');
            mobilePromptProxy.classList.remove('is-open', 'is-closing');
            mobilePromptProxy.classList.add('is-active', 'is-opening');
            const focused = focusMobilePromptProxyInput({ restart: true });
            if (focused) scheduleMobilePromptProxyViewportSync();
            return focused;
        }
        if (mobilePromptProxyState === 'opening') {
            const viewport = getMobilePromptProxyViewport();
            const keyboardThreshold = Math.max(32, Math.round(mobilePromptProxyBaselineHeight * 0.05));
            const keyboardVisible = mobilePromptProxyBaselineHeight - viewport.height >= keyboardThreshold;
            if (keyboardVisible || Date.now() - mobilePromptProxyStartedAt < 180) return true;
            mobilePromptProxyStartedAt = Date.now();
            mobilePromptProxyCandidateViewport = null;
            mobilePromptProxyCandidateSince = 0;
            const focused = focusMobilePromptProxyInput({ restart: true });
            if (focused) scheduleMobilePromptProxyViewportSync();
            return focused;
        }
        const promptSource = source instanceof HTMLTextAreaElement
            ? source
            : root?.querySelector?.('.ai-image-main-prompt[data-aiw-prompt]');
        mobilePromptProxySource = promptSource instanceof HTMLTextAreaElement ? promptSource : null;
        if (mobilePromptProxyCloseTimer) {
            global.clearTimeout?.(mobilePromptProxyCloseTimer);
            mobilePromptProxyCloseTimer = 0;
        }
        clearMobilePromptProxyBlurTimer();
        removeMobilePromptProxyViewportListeners();
        const value = String(mobilePromptProxySource?.value ?? state.prompt ?? '').slice(0, 4000);
        mobilePromptProxyInput.value = value;
        mobilePromptProxyInput.placeholder = mobilePromptProxySource?.placeholder || '输入你的想象';
        mobilePromptProxyBaselineHeight = getMobilePromptProxyViewport().height;
        mobilePromptProxyKeyboardVisible = false;
        mobilePromptProxyOpenViewportHeight = 0;
        mobilePromptProxyStartedAt = Date.now();
        mobilePromptProxyCandidateViewport = null;
        mobilePromptProxyCandidateSince = 0;
        mobilePromptProxyAppliedViewport = null;
        mobilePromptProxyState = 'opening';
        root?.classList?.remove('is-mobile-prompt-proxy-active');
        document.body?.classList?.remove('ai-image-prompt-proxy-active');
        mobilePromptProxy.classList.remove('is-open', 'is-closing');
        mobilePromptProxy.classList.add('is-active', 'is-opening');
        mobilePromptProxy.setAttribute('aria-hidden', 'false');
        if (!focusMobilePromptProxyInput()) {
            closeMobilePromptProxy({ blur: false, animate: false });
            return false;
        }
        const initialViewport = getMobilePromptProxyViewport();
        applyMobilePromptProxyViewport(initialViewport);
        syncMobilePromptProxyHeight();
        addMobilePromptProxyViewportListeners();
        const selectionStart = Math.min(value.length, Number(mobilePromptProxySource?.selectionStart ?? value.length));
        const selectionEnd = Math.min(value.length, Number(mobilePromptProxySource?.selectionEnd ?? selectionStart));
        mobilePromptProxyInput.setSelectionRange(selectionStart, selectionEnd);
        scheduleMobilePromptProxyViewportSync();
        return true;
    }

    function closeMobilePromptProxy({ blur = true, animate = true } = {}) {
        if (!mobilePromptProxy || mobilePromptProxyState === 'closed') return false;
        if (mobilePromptProxyState === 'closing') return true;
        const value = String(mobilePromptProxyInput?.value || '').slice(0, 4000);
        const selectionStart = Number(mobilePromptProxyInput?.selectionStart ?? value.length);
        const selectionEnd = Number(mobilePromptProxyInput?.selectionEnd ?? selectionStart);
        clearMobilePromptProxyBlurTimer();
        syncMobilePromptProxySource(value, selectionStart, selectionEnd);
        mobilePromptProxyState = 'closing';
        mobilePromptProxy.classList.remove('is-opening', 'is-open');
        mobilePromptProxy.classList.add('is-closing');
        if (blur && document.activeElement === mobilePromptProxyInput) {
            mobilePromptProxyInput.blur();
        }
        const finalize = () => {
            removeMobilePromptProxyViewportListeners();
            mobilePromptProxyCloseTimer = 0;
            mobilePromptProxyState = 'closed';
            mobilePromptProxy.classList.remove('is-active', 'is-closing');
            mobilePromptProxy.setAttribute('aria-hidden', 'true');
            mobilePromptProxy.style.removeProperty('--aiw-mobile-proxy-top');
            mobilePromptProxy.style.removeProperty('--aiw-mobile-proxy-height');
            root?.style?.removeProperty('--aiw-mobile-visual-top');
            mobilePromptProxyBaselineHeight = 0;
            mobilePromptProxyKeyboardVisible = false;
            mobilePromptProxyOpenViewportHeight = 0;
            mobilePromptProxyCandidateViewport = null;
            mobilePromptProxyCandidateSince = 0;
            mobilePromptProxyAppliedViewport = null;
            mobilePromptProxySource = null;
            root?.classList?.remove('is-mobile-prompt-proxy-active');
            document.body?.classList?.remove('ai-image-prompt-proxy-active');
        };
        if (!animate) {
            finalize();
            return true;
        }
        mobilePromptProxyCloseTimer = global.setTimeout?.(finalize, 120) || 0;
        return true;
    }

    function handleWorkbenchWindowResize() {
        syncWorkbenchViewportScaleLock();
        if (!state.open || !isMobileWorkbenchViewport() || mobileWorkbenchStaticHeight > 0) return;
        syncMobileComposerMenuAnchor();
    }

    function handleWorkbenchOrientationChange() {
        closeMobilePromptProxy({ blur: true, animate: false });
        resetMobileWorkbenchLayout();
        global.requestAnimationFrame?.(syncMobileComposerMenuAnchor);
    }

    function openWorkbench(payload = {}) {
        const wasOpen = state.open;
        applyPayload(payload);
        openSelect = '';
        state.open = true;
        if (!wasOpen) resetMobileWorkbenchLayout();
        render();
        setBodyOpenState(true);
        loadRemoteConfig();
        loadRemoteHistoryPrefs();
        loadRemoteRecords();
    }

    function resetConversationDraft({ preserveToolMode = false } = {}) {
        const preservedBillingMode = state.billingMode;
        const preservedToolMode = preserveToolMode ? getCurrentWorkbenchToolMode() : '';
        state.prompt = '';
        state.referenceImage = '';
        state.referenceTitle = '';
        state.referenceIntent = '';
        state.referenceImages = [];
        clearChatAttachments();
        state.continuationImage = null;
        state.agent = '';
        state.mode = 'text';
        if (preserveToolMode) {
            state.billingMode = preservedBillingMode;
            applyWorkbenchToolMode(preservedToolMode, { allowUnavailableVideo: true });
        }
        state.activeTaskId = '';
        clearComposerError();
        sidebarView = '';
        sidebarEnteredView = '';
        openSelect = '';
    }

    function openPromptAsNewConversation(payload = {}) {
        resetConversationDraft();
        openWorkbench(payload);
    }

    function openPromptForImageGeneration(payload = {}) {
        resetConversationDraft();
        state.apiImageTool = true;
        const requestedMode = String(payload.mode || '').trim();
        const generationMode = ['text', 'image', 'reverse'].includes(requestedMode) ? requestedMode : 'text';
        openWorkbench({
            ...payload,
            mode: generationMode
        });
    }

    function closeWorkbench() {
        openSelect = '';
        modelPricingView.open = false;
        clearDeferredImageLoadTimer();
        clearImagePreviewLoadTimer();
        imagePreview = null;
        setBodyImagePreviewState(false);
        state.open = false;
        syncOverlayOpenState();
        renderDock();
        setBodyOpenState(false);
        resetMobileWorkbenchLayout();
    }

    function toggleWorkbench() {
        if (state.open) {
            closeWorkbench();
        } else {
            openWorkbench();
        }
    }

    function applyPayload(payload = {}) {
        if (!payload || typeof payload !== 'object') return;
        const hasPromptPayload = ['mode', 'prompt', 'referenceImage', 'referenceTitle'].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
        if (hasPromptPayload) state.agent = '';
        if (MODE_META[payload.mode]) state.mode = payload.mode;
        if (RATIO_META[payload.ratio]) state.ratio = payload.ratio;
        if (payload.prompt !== undefined) state.prompt = String(payload.prompt || '').slice(0, 4000);
        if (payload.referenceImage !== undefined) state.referenceImage = String(payload.referenceImage || '');
        if (payload.referenceTitle !== undefined) state.referenceTitle = String(payload.referenceTitle || '').slice(0, 160);
        if (payload.referenceIntent !== undefined) state.referenceIntent = ['variation'].includes(payload.referenceIntent) ? payload.referenceIntent : '';
    }

    function getCurrentPromptModalPayload(mode = 'text') {
        const modal = document.getElementById('promptModal');
        const title = document.getElementById('modalTitle')?.textContent?.trim() || '';
        const promptTextNode = document.getElementById('modalPromptText');
        const promptText = promptTextNode?.classList.contains('blur-masked') ? '' : (promptTextNode?.innerText || '').trim();
        const image = modal?.querySelector('.modal-image-col img.active, .modal-image-col img#modalImg, .modal-image-col img')?.src || '';
        const isImageVariation = mode === 'image';
        const isReversePrompt = mode === 'reverse';
        return {
            mode,
            prompt: isImageVariation || isReversePrompt ? '' : (promptText || title),
            referenceImage: mode === 'text' ? '' : image,
            referenceTitle: title,
            referenceIntent: isImageVariation ? 'variation' : ''
        };
    }

    function getPromptActionCopy(key, zhFallback, enFallback) {
        const lang = global.i18n?.getCurrentLanguage?.() || document.documentElement.lang || global.localStorage?.getItem('zaoyoe_language') || 'zh';
        return global.i18n?.t?.(`gallery.${key}`) || (String(lang).startsWith('en') ? enFallback : zhFallback);
    }

    function getPromptActionLabel(action) {
        const labels = {
            text: getPromptActionCopy('aiImageGenerateFromPrompt', '用此提示词生成', 'Generate from prompt'),
            image: getPromptActionCopy('aiImageVariateFromImage', '用这张图发散', 'Create variations'),
            reverse: getPromptActionCopy('aiImageReversePrompt', '反推图片提示词', 'Reverse prompt')
        };
        return labels[action] || labels.text;
    }

    function syncPromptModalActionLabels() {
        document.querySelectorAll('[data-aiw-prompt-action]').forEach((button) => {
            const label = getPromptActionLabel(button.getAttribute('data-aiw-prompt-action') || 'text');
            button.setAttribute('aria-label', label);
            button.setAttribute('data-tooltip', label);
        });
    }

    function injectPromptModalActions() {
        const slot = document.getElementById('promptActionAiImageSlot');
        if (!slot || slot.querySelector('.ai-image-prompt-actions')) return;

        const wrap = document.createElement('span');
        wrap.className = 'ai-image-prompt-actions';
        wrap.innerHTML = `
            <button class="ai-image-prompt-action-btn" type="button" data-aiw-prompt-action="text">
                <svg class="ai-image-wand-sparkles-icon" viewBox="0 0 576 512" aria-hidden="true" focusable="false">
                    <path class="ai-image-wand-sparkles-icon__sparkles" fill="currentColor" d="M234.7 42.7L197 56.8c-3 1.1-5 4-5 7.2s2 6.1 5 7.2l37.7 14.1L248.8 123c1.1 3 4 5 7.2 5s6.1-2 7.2-5l14.1-37.7L315 71.2c3-1.1 5-4 5-7.2s-2-6.1-5-7.2L277.3 42.7 263.2 5c-1.1-3-4-5-7.2-5s-6.1 2-7.2 5L234.7 42.7zM7.5 117.2C3 118.9 0 123.2 0 128s3 9.1 7.5 10.8L64 160l21.2 56.5c1.7 4.5 6 7.5 10.8 7.5s9.1-3 10.8-7.5L128 160l56.5-21.2c4.5-1.7 7.5-6 7.5-10.8s-3-9.1-7.5-10.8L128 96 106.8 39.5C105.1 35 100.8 32 96 32s-9.1 3-10.8 7.5L64 96 7.5 117.2zm352 256c-4.5 1.7-7.5 6-7.5 10.8s3 9.1 7.5 10.8L416 416l21.2 56.5c1.7 4.5 6 7.5 10.8 7.5s9.1-3 10.8-7.5L480 416l56.5-21.2c4.5-1.7 7.5-6 7.5-10.8s-3-9.1-7.5-10.8L480 352l-21.2-56.5c-1.7-4.5-6-7.5-10.8-7.5s-9.1 3-10.8 7.5L416 352l-56.5 21.2z"></path>
                    <path class="ai-image-wand-sparkles-icon__wand" fill="currentColor" d="M46.1 395.4c-18.7 18.7-18.7 49.1 0 67.9l34.6 34.6c18.7 18.7 49.1 18.7 67.9 0L529.9 116.5c18.7-18.7 18.7-49.1 0-67.9L495.3 14.1c-18.7-18.7-49.1-18.7-67.9 0L46.1 395.4zM484.6 82.6l-105 105-23.3-23.3 105-105 23.3 23.3z"></path>
                </svg>
            </button>
            <button class="ai-image-prompt-action-btn" type="button" data-aiw-prompt-action="image">
                <svg class="ai-image-images-icon" viewBox="0 0 576 512" aria-hidden="true" focusable="false">
                    <path class="ai-image-images-icon__front" fill="currentColor" d="M160 32c-35.3 0-64 28.7-64 64V320c0 35.3 28.7 64 64 64H512c35.3 0 64-28.7 64-64V96c0-35.3-28.7-64-64-64H160zM396 138.7l96 144c4.9 7.4 5.4 16.8 1.2 24.6S480.9 320 472 320H328 280 200c-9.2 0-17.6-5.3-21.6-13.6s-2.9-18.2 2.9-25.4l64-80c4.6-5.7 11.4-9 18.7-9s14.2 3.3 18.7 9l17.3 21.6 56-84C360.5 132 368 128 376 128s15.5 4 20 10.7zM192 128a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"></path>
                    <path class="ai-image-images-icon__back" fill="currentColor" d="M48 120c0-13.3-10.7-24-24-24S0 106.7 0 120V344c0 75.1 60.9 136 136 136H456c13.3 0 24-10.7 24-24s-10.7-24-24-24H136c-48.6 0-88-39.4-88-88V120z"></path>
                </svg>
            </button>
            <button class="ai-image-prompt-action-btn ai-image-prompt-action-btn--reverse" type="button" data-aiw-prompt-action="reverse">
                <span class="ai-image-reverse-prompt-mark" aria-hidden="true">
                    <span class="ai-image-reverse-prompt-mark__image"></span>
                    <span class="ai-image-reverse-prompt-mark__lines"></span>
                </span>
            </button>
        `;
        slot.appendChild(wrap);
        syncPromptModalActionLabels();
    }

    function createRoot() {
        root = document.createElement('div');
        root.className = 'ai-image-workbench-root';
        root.innerHTML = `
            <input class="ai-image-toggle" id="aiImageWorkbenchToggle" type="checkbox" aria-hidden="true" tabindex="-1">
            <div class="ai-image-dock" data-aiw-dock></div>
            <div class="ai-image-overlay" data-aiw-overlay aria-hidden="true"></div>
        `;
        document.body.appendChild(root);
        mobilePromptProxy = document.createElement('div');
        mobilePromptProxy.className = 'ai-image-mobile-prompt-proxy';
        mobilePromptProxy.setAttribute('data-aiw-mobile-prompt-proxy', '');
        mobilePromptProxy.setAttribute('aria-hidden', 'true');
        mobilePromptProxy.innerHTML = `
            <div class="ai-image-mobile-prompt-proxy-panel">
                <textarea class="ai-image-mobile-prompt-proxy-input" data-aiw-mobile-prompt-input rows="1" maxlength="4000" placeholder="输入你的想象" aria-label="输入提示词"></textarea>
                <div class="ai-image-mobile-prompt-proxy-footer">
                    <span data-aiw-mobile-prompt-count>0/4000</span>
                    <button type="button" data-aiw-mobile-prompt-done>完成</button>
                </div>
            </div>
        `;
        document.body.appendChild(mobilePromptProxy);
        nativeToggle = root.querySelector('#aiImageWorkbenchToggle');
        dock = root.querySelector('[data-aiw-dock]');
        overlay = root.querySelector('[data-aiw-overlay]');
        mobilePromptProxyInput = mobilePromptProxy.querySelector('[data-aiw-mobile-prompt-input]');
        mobilePromptProxyInput?.addEventListener('input', syncMobilePromptProxyHeight);
        mobilePromptProxyInput?.addEventListener('blur', handleMobilePromptProxyBlur);
        mobilePromptProxy?.querySelector?.('[data-aiw-mobile-prompt-done]')?.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMobilePromptProxy({ blur: true });
        });

        nativeToggle?.addEventListener('change', () => {
            state.open = Boolean(nativeToggle.checked);
            setBodyOpenState(state.open);
            render();
        });
        root.addEventListener('click', handleRootClick);
        root.addEventListener('pointerover', handleRootPointerOver);
        root.addEventListener('pointerout', handleRootPointerOut);
        root.addEventListener('pointerdown', handleRootPointerDown, true);
        root.addEventListener('pointermove', handleRootPointerMove);
        root.addEventListener('pointerup', handleRootPointerUp);
        root.addEventListener('pointercancel', handleRootPointerUp);
        root.addEventListener('input', handleRootInput);
        root.addEventListener('change', handleRootChange);
        root.addEventListener('focusin', handleRootFocusIn);
        root.addEventListener('focusout', handleRootFocusOut);
        root.addEventListener('keydown', handleRootKeydown);
        root.addEventListener('error', handleRootError, true);
        root.addEventListener('load', handleRootLoad, true);
        root.addEventListener('loadedmetadata', handleRootVideoProgress, true);
        root.addEventListener('durationchange', handleRootVideoProgress, true);
        root.addEventListener('progress', handleRootVideoProgress, true);
        root.addEventListener('loadeddata', handleRootVideoLoaded, true);
        root.addEventListener('canplay', handleRootVideoLoaded, true);
        root.addEventListener('canplaythrough', handleRootVideoLoaded, true);
        window.addEventListener('resize', handleWorkbenchWindowResize, { passive: true });
        window.addEventListener('orientationchange', handleWorkbenchOrientationChange, { passive: true });
        global.addEventListener?.('gesturestart', handleWorkbenchViewportGesture, { passive: false });
        global.addEventListener?.('gesturechange', handleWorkbenchViewportGesture, { passive: false });
        global.addEventListener?.('gestureend', handleWorkbenchViewportGesture, { passive: false });

        document.body.classList.add('ai-image-workbench-ready');
    }

    function handleWorkbenchViewportGesture(event) {
        if (!state.open || !isMobileWorkbenchViewport()) return;
        const eventType = String(event?.type || '');
        const isGestureEvent = /^gesture/i.test(eventType);
        const touchCount = Number(event?.touches?.length || 0);
        if (!isGestureEvent && touchCount < 2) return;
        event.preventDefault?.();
    }

    function getCssPixelValue(value, fallback = 0) {
        const number = Number.parseFloat(String(value || ''));
        return Number.isFinite(number) ? number : fallback;
    }

    function syncPromptTextareaHeight(textarea) {
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        const styles = global.getComputedStyle?.(textarea);
        const minHeight = getCssPixelValue(styles?.minHeight, 34);
        const maxHeight = getCssPixelValue(styles?.maxHeight, 132);
        const lineHeight = getCssPixelValue(styles?.lineHeight, 20);
        const hasExplicitLineBreak = /\n/.test(String(textarea.value || ''));
        textarea.style.height = 'auto';
        const scrollHeight = Math.ceil(Number(textarea.scrollHeight || 0));
        const shouldGrow = hasExplicitLineBreak || scrollHeight > minHeight + Math.max(4, Math.round(lineHeight * 0.45));
        if (!shouldGrow) {
            textarea.style.height = '';
            textarea.scrollTop = 0;
            return;
        }
        textarea.style.height = `${Math.min(maxHeight, Math.max(minHeight, scrollHeight))}px`;
    }

    function syncMainPromptHeight() {
        root?.querySelectorAll?.('.ai-image-main-prompt')?.forEach(syncPromptTextareaHeight);
    }

    function exposeWorkbenchOpenHandlers() {
        global.__AI_IMAGE_WORKBENCH_TOGGLE__ = () => toggleWorkbench();
        global.__AI_IMAGE_WORKBENCH_OPEN__ = () => openWorkbench();
    }

    function handleRootClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const mainPrompt = target.closest?.('.ai-image-main-prompt[data-aiw-prompt]');
        if (mainPrompt instanceof HTMLTextAreaElement && isMobileKeyboardDevice()) {
            event.preventDefault();
            return;
        }

        const fullPreview = target.closest('[data-aiw-full-preview]');
        if (fullPreview && (target === fullPreview || target.closest('[data-aiw-preview-close]'))) {
            event.preventDefault();
            closeImagePreview();
            return;
        }

        if (target === overlay) {
            event.preventDefault();
            if (imagePreview) {
                closeImagePreview();
            } else {
                closeWorkbench();
            }
            return;
        }

        const downloadLink = target.closest('[data-aiw-download]');
        if (downloadLink) {
            if (downloadLink.getAttribute('aria-disabled') === 'true') {
                event.preventDefault();
                return;
            }
            recordImageDownload(downloadLink);
            return;
        }

        const previewTrigger = target.closest('[data-aiw-preview-open]');
        if (previewTrigger && !target.closest('[data-aiw-action]')) {
            event.preventDefault();
            openImagePreview(previewTrigger);
            return;
        }

        const composerReferencePreview = target.closest('[data-aiw-reference-preview]');
        if (composerReferencePreview && !target.closest('[data-aiw-action]')) {
            event.preventDefault();
            const kind = composerReferencePreview.getAttribute('data-aiw-reference-preview') || 'reference';
            if (kind === 'continuation') {
                scrollToResultImage(
                    composerReferencePreview.getAttribute('data-task-id') || '',
                    composerReferencePreview.getAttribute('data-result-id') || '',
                    composerReferencePreview.getAttribute('data-result-index') || ''
                );
                return;
            }
            openImagePreview({
                previewSrc: composerReferencePreview.getAttribute('data-aiw-preview-src') || '',
                originalSrc: composerReferencePreview.getAttribute('data-aiw-preview-original-src') || '',
                originalReady: composerReferencePreview.getAttribute('data-aiw-original-ready') === 'true',
                originalStatus: composerReferencePreview.getAttribute('data-aiw-original-status') || '',
                title: composerReferencePreview.getAttribute('data-aiw-preview-title') || '参考图片',
                meta: composerReferencePreview.getAttribute('data-aiw-preview-meta') || '参考图片',
                previewBytes: normalizeByteCount(composerReferencePreview.getAttribute('data-aiw-preview-bytes')),
                originalBytes: normalizeByteCount(composerReferencePreview.getAttribute('data-aiw-original-bytes'))
            });
            return;
        }

        const historyNavButton = target.closest('[data-aiw-history-nav-id]');
        if (historyNavButton) {
            event.preventDefault();
            scrollToHistoryRow(historyNavButton.getAttribute('data-aiw-history-nav-id') || '');
            return;
        }

        const chatNavButton = target.closest('[data-aiw-chat-nav-id]');
        if (chatNavButton) {
            event.preventDefault();
            if (suppressNextChatNavigationClick) {
                suppressNextChatNavigationClick = false;
                return;
            }
            scrollToChatTurn(chatNavButton.getAttribute('data-aiw-chat-nav-id') || '');
            return;
        }

        const reasoningToggle = target.closest('[data-aiw-reasoning-toggle]');
        if (reasoningToggle) {
            event.preventDefault();
            const taskId = String(reasoningToggle.getAttribute('data-task-id') || '').trim();
            const reasoningTask = state.tasks.find((item) => item.id === taskId || item.clientTaskId === taskId);
            if (!reasoningTask) return;
            const presentation = getChatReasoningPresentation(reasoningTask);
            reasoningTask.reasoningExpanded = !presentation.expanded;
            persistState();
            if (!updateVisibleChatReasoning(reasoningTask)) renderPreservingStageScroll();
            return;
        }

        const selectToggle = target.closest('[data-aiw-select-toggle]');
        if (selectToggle) {
            event.preventDefault();
            if (selectToggle instanceof HTMLButtonElement && selectToggle.disabled) return;
            const field = selectToggle.getAttribute('data-aiw-select-toggle') || '';
            openSelect = openSelect === field ? '' : field;
            const isComposerToggle = Boolean(selectToggle.closest('.ai-image-main-composer'));
            if ((field === 'model' || field === 'apiModel') && openSelect === field) {
                openModelProvider = getActiveModelProviderId(inferWorkbenchMode());
            } else if (field === 'model' || field === 'apiModel') {
                openModelProvider = '';
            }
            if (field === 'imageSettings' && openSelect === 'imageSettings' && !openImageSettingsSection) {
                openImageSettingsSection = 'ratio';
            }
            if (field === 'videoSettings' && openSelect === 'videoSettings' && !openVideoSettingsSection) {
                openVideoSettingsSection = 'videoRatio';
            }
            if (field === 'chatSettings' && openSelect === 'chatSettings' && !openChatSettingsSection) {
                openChatSettingsSection = 'memory';
            }
            if (isComposerToggle && isComposerLocalSelectField(field)) {
                renderMainComposerOnly();
            } else {
                renderPreservingStageScroll();
            }
            return;
        }

        const modelProviderToggle = target.closest('.ai-image-model-provider-trigger');
        if (modelProviderToggle) {
            const provider = modelProviderToggle.closest('[data-aiw-model-provider]');
            const select = modelProviderToggle.closest('[data-aiw-select]');
            if (provider && select) {
                event.preventDefault();
                openSelect = select.getAttribute('data-aiw-select') || openSelect;
                const providerId = provider.getAttribute('data-aiw-model-provider') || '';
                openModelProvider = openModelProvider === providerId ? '' : providerId;
                if (modelProviderToggle.closest('.ai-image-main-composer')) {
                    renderMainComposerOnly();
                } else {
                    renderPreservingStageScroll();
                }
                return;
            }
        }

        const chatSettingsSectionToggle = target.closest('[data-aiw-chat-settings-section]');
        if (chatSettingsSectionToggle) {
            event.preventDefault();
            const section = chatSettingsSectionToggle.getAttribute('data-aiw-chat-settings-section') || 'memory';
            openSelect = 'chatSettings';
            openChatSettingsSection = openChatSettingsSection === section ? '' : section;
            renderMainComposerOnly();
            return;
        }

        const imageSettingsSectionToggle = target.closest('[data-aiw-image-settings-section]');
        if (imageSettingsSectionToggle) {
            event.preventDefault();
            const section = imageSettingsSectionToggle.getAttribute('data-aiw-image-settings-section') || 'ratio';
            openSelect = 'imageSettings';
            openImageSettingsSection = openImageSettingsSection === section ? '' : section;
            renderMainComposerOnly();
            return;
        }

        const videoSettingsSectionToggle = target.closest('[data-aiw-video-settings-section]');
        if (videoSettingsSectionToggle) {
            event.preventDefault();
            const section = videoSettingsSectionToggle.getAttribute('data-aiw-video-settings-section') || 'videoRatio';
            openSelect = 'videoSettings';
            openVideoSettingsSection = openVideoSettingsSection === section ? '' : section;
            renderMainComposerOnly();
            return;
        }

	        const memoryToggle = target.closest('[data-aiw-memory-toggle]');
	        if (memoryToggle) {
	            event.preventDefault();
	            openSelect = openSelect === 'memory' ? '' : 'memory';
	            renderPreservingStageScroll();
	            return;
	        }

	        const capabilityToggle = target.closest('[data-aiw-capability-toggle]');
	        if (capabilityToggle) {
	            event.preventDefault();
	            const capability = capabilityToggle.getAttribute('data-aiw-capability-toggle') || '';
	            openSelect = openSelect === capability ? '' : capability;
	            renderPreservingStageScroll();
	            return;
	        }

        const selectOption = target.closest('[data-aiw-select-option]');
        if (selectOption) {
            event.preventDefault();
            clearComposerError();
            const field = selectOption.getAttribute('data-aiw-select-field') || '';
            const value = selectOption.getAttribute('data-aiw-select-value') || '';
            const isComposerOption = Boolean(selectOption.closest('.ai-image-main-composer'));
            if (field === 'ratio' && RATIO_META[value]) state.ratio = value;
            if (field === 'resolution' && RESOLUTION_META[value]) state.resolution = value;
            if (field === 'videoRatio' && VIDEO_RATIO_META[value]) state.videoRatio = value;
            if (field === 'videoResolution' && VIDEO_RESOLUTION_META[value]) state.videoResolution = value;
            if (field === 'videoDuration' && VIDEO_DURATION_META[String(value)]) state.videoDuration = String(value);
            if (field === 'videoAudio' && VIDEO_AUDIO_META[String(value)]) state.videoAudio = String(value);
            if (field === 'videoWatermark' && VIDEO_WATERMARK_META[String(value)]) state.videoWatermark = String(value);
            if (field === 'videoCameraFixed' && VIDEO_CAMERA_FIXED_META[String(value)]) state.videoCameraFixed = String(value);
            if (field === 'quantity') state.quantity = clampNumber(value, 1, 4, 2);
            if (field === 'model') {
                const activeMode = inferWorkbenchMode();
                const activeModelOptions = getRuntimeModelGroupOptions(activeMode);
                if (isTextVisionMode(activeMode) && activeModelOptions.some((model) => model.id === value)) {
                    state.pointsTextModel = value;
                } else if (isVideoMode(activeMode) && activeModelOptions.some((model) => model.id === value)) {
                    state.pointsVideoModel = value;
                } else if (activeModelOptions.some((model) => model.id === value)) {
                    state.model = value;
                }
            }
            if (field === 'apiModel') {
                const activeMode = inferWorkbenchMode();
                const activeModelOptions = getRuntimeModelGroupOptions(activeMode);
                if (isVideoMode(activeMode) && activeModelOptions.some((model) => model.id === value)) state.apiVideoModel = value;
                if (!isTextVisionMode(activeMode) && !isVideoMode(activeMode) && activeModelOptions.some((model) => model.id === value)) state.apiImageModel = value;
                if (isTextVisionMode(activeMode) && activeModelOptions.some((model) => model.id === value)) state.apiTextModel = value;
            }
            if (field === 'model' || field === 'apiModel') openModelProvider = '';
            openSelect = target.closest('[data-aiw-image-settings]') ? 'imageSettings' : (target.closest('[data-aiw-video-settings]') ? 'videoSettings' : (target.closest('[data-aiw-chat-settings]') ? 'chatSettings' : ''));
            if (openSelect === 'imageSettings') {
                openImageSettingsSection = field || openImageSettingsSection;
            } else if (openSelect === 'videoSettings') {
                openVideoSettingsSection = field || openVideoSettingsSection;
            } else if (openSelect === 'chatSettings') {
                openChatSettingsSection = field || openChatSettingsSection;
            }
            if (isComposerOption || openSelect === 'imageSettings' || openSelect === 'videoSettings' || openSelect === 'chatSettings') {
                renderMainComposerOnly();
            } else {
                renderPreservingStageScroll();
            }
            persistState();
            return;
        }

        const closingSelect = openSelect;
        const shouldCloseSelectLocally = shouldCloseSelectFromComposer(closingSelect);
	        const shouldCloseSelect = Boolean(openSelect && !target.closest('.ai-image-custom-select') && !target.closest('.ai-image-memory-control') && !target.closest('.ai-image-capability-control') && !target.closest('[data-aiw-image-settings]') && !target.closest('[data-aiw-video-settings]') && !target.closest('[data-aiw-chat-settings]'));
        if (shouldCloseSelect) {
            openSelect = '';
            if (closingSelect === 'model' || closingSelect === 'apiModel') openModelProvider = '';
        }
        const shouldCloseMobileSidebar = shouldCloseMobileSidebarFromBlankClick(target);

        const action = target.closest('[data-aiw-action]')?.getAttribute('data-aiw-action');
        if (action) {
            if (action.startsWith('native-')) return;
            event.preventDefault();
            handleAction(action, target.closest('[data-aiw-action]'));
            return;
        }

        const modeButton = target.closest('[data-aiw-mode]');
        if (modeButton) {
            event.preventDefault();
            state.mode = modeButton.getAttribute('data-aiw-mode') || state.mode;
            state.agent = '';
            openSelect = '';
            render();
            persistState();
            return;
        }

        const chip = target.closest('[data-aiw-chip]');
        if (chip) {
            event.preventDefault();
            const [field, value] = String(chip.getAttribute('data-aiw-chip') || '').split(':');
            if (field === 'ratio' && RATIO_META[value]) state.ratio = value;
            if (field === 'resolution' && RESOLUTION_META[value]) state.resolution = value;
            if (field === 'videoRatio' && VIDEO_RATIO_META[value]) state.videoRatio = value;
            if (field === 'videoResolution' && VIDEO_RESOLUTION_META[value]) state.videoResolution = value;
            if (field === 'videoDuration' && VIDEO_DURATION_META[String(value)]) state.videoDuration = String(value);
            if (field === 'videoAudio' && VIDEO_AUDIO_META[String(value)]) state.videoAudio = String(value);
            if (field === 'videoWatermark' && VIDEO_WATERMARK_META[String(value)]) state.videoWatermark = String(value);
            if (field === 'videoCameraFixed' && VIDEO_CAMERA_FIXED_META[String(value)]) state.videoCameraFixed = String(value);
	            if (field === 'quantity') state.quantity = clampNumber(value, 1, 4, 2);
	            if (field === 'billing' && ['points', 'api'].includes(value)) state.billingMode = value;
	            if (field === 'apiTool') setWorkbenchToolMode(value);
	            if (field === 'memory' && CHAT_MEMORY_OPTIONS.some((option) => option.id === value)) state.chatMemoryMode = value;
	            if (field === 'reasoning' && [...OPENAI_REASONING_EFFORT_OPTIONS, ...DEEPSEEK_REASONING_EFFORT_OPTIONS, ...GLM_REASONING_EFFORT_OPTIONS, ...XAI_REASONING_EFFORT_OPTIONS].some((option) => option.id === value)) state.chatReasoningEffort = value;
	            if (field === 'geminiThinking' && GEMINI_THINKING_LEVEL_OPTIONS.some((option) => option.id === value)) state.chatGeminiThinkingLevel = value;
	            if (field === 'claudeThinkingBudget' && CLAUDE_THINKING_BUDGET_OPTIONS.some((option) => option.id === value)) state.chatClaudeThinkingBudget = value;
	            if (field === 'serviceTier' && OPENAI_SERVICE_TIER_OPTIONS.some((option) => option.id === value)) state.chatServiceTier = value;
	            if (field === 'thinking' && [...DEEPSEEK_THINKING_OPTIONS, ...KIMI_THINKING_OPTIONS, ...CLAUDE_THINKING_OPTIONS, ...QWEN_ENABLE_THINKING_OPTIONS, ...GLM_THINKING_OPTIONS, ...MINIMAX_THINKING_OPTIONS, ...DOUBAO_THINKING_OPTIONS, ...GROK_THINKING_OPTIONS, ...OPENAI_THINKING_OPTIONS, ...GEMINI_THINKING_OPTIONS].some((option) => option.id === value)) state.chatThinkingMode = value;
            if (field === 'imageInput' && OPENAI_IMAGE_INPUT_OPTIONS.some((option) => option.id === value)) state.chatImageInput = value;
            openSelect = target.closest('[data-aiw-chat-settings]') ? 'chatSettings' : '';
            if (openSelect === 'chatSettings') openChatSettingsSection = field || openChatSettingsSection;
            if (openSelect === 'chatSettings') {
                renderMainComposerOnly();
            } else {
                render();
            }
            persistState();
            return;
        }

        const taskButton = target.closest('[data-aiw-task-id]');
        if (taskButton) {
            event.preventDefault();
            const taskId = taskButton.getAttribute('data-aiw-task-id') || '';
            if (historySelectionMode || target.closest('[data-aiw-history-select]')) {
                toggleHistorySelection(taskId);
                syncHistorySelectionUi();
                return;
            }
            modelPricingView.open = false;
            state.activeTaskId = taskId;
            markTaskThreadSeen(taskId);
            openSelect = '';
            renderPreservingHistoryScroll(() => render({ preserveStageScroll: false, preservePromptFocus: false }));
            persistState();
            return;
        }

        if (shouldCloseSelect || shouldCloseMobileSidebar) {
            if (shouldCloseMobileSidebar) {
                sidebarView = '';
                sidebarEnteredView = '';
                renderSidebarTransition();
            }
            if (shouldCloseSelect) {
                if (shouldCloseSelectLocally) {
                    renderMainComposerOnly();
                } else {
                    renderPreservingStageScroll();
                }
            }
        }
    }

    function handleRootPointerOver(event) {
        const target = event.target instanceof Element ? event.target : null;
        const historyNavButton = target?.closest?.('[data-aiw-history-nav-id]');
        if (historyNavButton) {
            showHistoryLocatorPreview(historyNavButton);
            return;
        }
        const navButton = target?.closest?.('[data-aiw-chat-nav-id]');
        if (!navButton) return;
        showChatNavigationPreview(navButton);
    }

    function handleRootPointerOut(event) {
        const target = event.target instanceof Element ? event.target : null;
        const historyNavButton = target?.closest?.('[data-aiw-history-nav-id]');
        if (historyNavButton) {
            const relatedTarget = event.relatedTarget instanceof Element ? event.relatedTarget : null;
            if (relatedTarget?.closest?.('[data-aiw-history-locator]') === historyNavButton.closest('[data-aiw-history-locator]')) return;
            hideHistoryLocatorPreview();
            return;
        }
        const historyLocator = target?.closest?.('[data-aiw-history-locator]');
        if (historyLocator) {
            const relatedTarget = event.relatedTarget instanceof Element ? event.relatedTarget : null;
            if (relatedTarget?.closest?.('[data-aiw-history-locator]') !== historyLocator) {
                hideHistoryLocatorPreview();
            }
            return;
        }
        const navButton = target?.closest?.('[data-aiw-chat-nav-id]');
        if (!navButton) return;
        const relatedTarget = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        if (relatedTarget?.closest?.('[data-aiw-chat-nav-id]') === navButton) return;
        hideChatNavigationPreview();
    }

    function handleRootPointerDown(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || event.button !== 0) return;
        const mainPrompt = target.closest?.('.ai-image-main-prompt[data-aiw-prompt]');
        if (mainPrompt instanceof HTMLTextAreaElement && isMobileKeyboardDevice()) {
            openMobilePromptProxy(mainPrompt);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const navButton = target.closest('[data-aiw-chat-nav-id]');
        const rail = target.closest('[data-aiw-chat-nav-rail]');
        if (!navButton || !rail) return;

        const taskId = navButton.getAttribute('data-aiw-chat-nav-id') || '';
        chatNavigationDragState = {
            pointerId: event.pointerId,
            startY: event.clientY,
            lastTaskId: taskId,
            moved: false,
            captureTarget: navButton
        };
        rail.classList.add('is-dragging');
        navButton.setPointerCapture?.(event.pointerId);
    }

    function handleRootPointerMove(event) {
        const dragState = chatNavigationDragState;
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const rail = overlay?.querySelector?.('[data-aiw-chat-nav-rail]');
        const navItems = Array.from(rail?.querySelectorAll?.('[data-aiw-chat-nav-id]') || []);
        if (!rail || !navItems.length) return;
        event.preventDefault();
        if (Math.abs(event.clientY - dragState.startY) > 3) {
            dragState.moved = true;
        }

        let closestButton = null;
        let closestDistance = Infinity;
        navItems.forEach((button) => {
            const rect = button.getBoundingClientRect();
            const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
            if (distance < closestDistance) {
                closestDistance = distance;
                closestButton = button;
            }
        });

        const nextTaskId = closestButton?.getAttribute?.('data-aiw-chat-nav-id') || '';
        if (nextTaskId && nextTaskId !== dragState.lastTaskId) {
            dragState.lastTaskId = nextTaskId;
            scrollToChatTurn(nextTaskId, { behavior: 'auto' });
        }
    }

    function handleRootWheel(event) {
        const target = event.target instanceof Element ? event.target : null;
        const historyLocator = target?.closest?.('[data-aiw-history-locator]');
        if (historyLocator) {
            const track = historyLocator.querySelector('[data-aiw-history-locator-track]');
            if (!track) return;
            const delta = Math.abs(event.deltaY || 0) >= Math.abs(event.deltaX || 0)
                ? event.deltaY
                : event.deltaX;
            if (!delta) return;
            event.preventDefault();
            event.stopPropagation();
            if (track.scrollWidth > track.clientWidth) {
                track.scrollLeft += delta;
            }
            return;
        }

        const chatRail = target?.closest?.('[data-aiw-chat-nav-rail]');
        if (!chatRail || !isMobileWorkbenchViewport()) return;
        const list = chatRail.querySelector('.ai-image-chat-nav-list');
        if (!list) return;
        const delta = Math.abs(event.deltaY || 0) >= Math.abs(event.deltaX || 0)
            ? event.deltaY
            : event.deltaX;
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        if (list.scrollWidth > list.clientWidth) {
            list.scrollLeft += delta;
        }
    }

    function syncNavigationWheelListeners() {
        const nextChatTarget = state.open
            ? overlay?.querySelector?.('.ai-image-chat-nav-list') || null
            : null;
        const nextHistoryTarget = state.open
            ? overlay?.querySelector?.('[data-aiw-history-locator-track]') || null
            : null;
        if (chatNavigationWheelTarget !== nextChatTarget) {
            chatNavigationWheelTarget?.removeEventListener('wheel', handleRootWheel);
            chatNavigationWheelTarget = nextChatTarget;
            chatNavigationWheelTarget?.addEventListener('wheel', handleRootWheel, { passive: false });
        }
        if (historyLocatorWheelTarget !== nextHistoryTarget) {
            historyLocatorWheelTarget?.removeEventListener('wheel', handleRootWheel);
            historyLocatorWheelTarget = nextHistoryTarget;
            historyLocatorWheelTarget?.addEventListener('wheel', handleRootWheel, { passive: false });
        }
    }

    function handleRootPointerUp(event) {
        const dragState = chatNavigationDragState;
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        chatNavigationDragState = null;
        overlay?.querySelector?.('[data-aiw-chat-nav-rail]')?.classList.remove('is-dragging');
        if (dragState.captureTarget?.hasPointerCapture?.(event.pointerId)) {
            dragState.captureTarget.releasePointerCapture?.(event.pointerId);
        }
        suppressNextChatNavigationClick = Boolean(dragState.moved);
        if (suppressNextChatNavigationClick) {
            global.setTimeout?.(() => {
                suppressNextChatNavigationClick = false;
            }, 80);
        }
    }

    function handleRootError(event) {
        const video = event.target instanceof HTMLVideoElement ? event.target : null;
        if (video) {
            const videoSrc = video.currentSrc || video.src || video.getAttribute('src') || '';
            const media = video.closest('.ai-image-result-media');
            if (!media) return;
            if (hasLoadedVideo(videoSrc)) {
                media.classList.add('is-video-ready', 'is-image-loaded');
                media.classList.remove('is-video-loading', 'is-video-broken', 'is-image-broken');
                return;
            }
            scheduleVideoErrorConfirmation(video, videoSrc);
            return;
        }

        const image = event.target instanceof HTMLImageElement ? event.target : null;
        if (!image) return;
        const imageSrc = image.currentSrc || image.src || '';
        const taskThumb = image.closest('.ai-image-task-thumb');
        if (taskThumb) {
            if (hasLoadedImage(imageSrc)) {
                taskThumb.classList.add('is-image-loaded');
                taskThumb.classList.remove('is-image-loading', 'is-image-broken');
                return;
            }
            rememberImageFailed(imageSrc);
            forgetStableImageUrl(taskThumb.getAttribute('data-aiw-image-key') || '');
            taskThumb.classList.add('is-image-loading');
            taskThumb.classList.remove('is-image-loaded', 'is-image-broken');
            image.setAttribute('aria-hidden', 'true');
            syncDeferredImageLoading();
            return;
        }
        const media = image.closest('.ai-image-result-media');
        if (!media) return;

        const fallbackSrc = [
            media.getAttribute('data-aiw-preview-thumb'),
            media.getAttribute('data-aiw-preview-src')
        ].map((value) => String(value || '').trim()).find((value) => value && value !== imageSrc);
        if (fallbackSrc && image.dataset.aiwFallbackTried !== 'true') {
            image.dataset.aiwFallbackTried = 'true';
            image.src = fallbackSrc;
            if (media.getAttribute('data-aiw-preview-src') === imageSrc) {
                media.setAttribute('data-aiw-preview-src', fallbackSrc);
            }
            return;
        }

        if (hasLoadedImage(imageSrc)) {
            media.classList.add('is-image-loaded');
            media.classList.remove('is-image-loading', 'is-image-broken');
            return;
        }
        rememberImageFailed(imageSrc);
        forgetStableImageUrl(media.getAttribute('data-aiw-image-key') || '');
        media.classList.add('is-image-loading');
        media.classList.remove('is-image-loaded', 'is-image-broken');
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        syncDeferredImageLoading();
    }

    function handleRootVideoLoaded(event) {
        const video = event.target instanceof HTMLVideoElement ? event.target : null;
        if (!video) return;
        const videoSrc = video.currentSrc || video.src || video.getAttribute('src') || '';
        updateVideoLoadingProgress(video, { forceComplete: true });
        rememberVideoLoaded(videoSrc);
        const media = video.closest?.('.ai-image-result-media');
        if (media) {
            media.classList.add('is-video-ready', 'is-image-loaded');
            media.classList.remove('is-video-loading', 'is-video-broken', 'is-image-broken');
        }
    }

    function handleRootVideoProgress(event) {
        const video = event.target instanceof HTMLVideoElement ? event.target : null;
        if (!video) return;
        updateVideoLoadingProgress(video);
    }

    function handleRootLoad(event) {
        const image = event.target instanceof HTMLImageElement ? event.target : null;
        if (!image) return;
        const imageSrc = image.currentSrc || image.src || '';
        rememberImageLoaded(imageSrc);
        const taskThumb = image?.closest?.('.ai-image-task-thumb');
        if (taskThumb) {
            rememberStableImageUrl(taskThumb.getAttribute('data-aiw-image-key') || '', imageSrc);
            taskThumb.classList.add('is-image-loaded');
            taskThumb.classList.remove('is-image-loading', 'is-image-broken');
            image.removeAttribute('aria-hidden');
        }
        const media = image.closest?.('.ai-image-result-media');
        if (media) {
            rememberStableImageUrl(media.getAttribute('data-aiw-image-key') || '', imageSrc);
            media.classList.add('is-image-loaded');
            media.classList.remove('is-image-loading', 'is-image-broken');
            image.removeAttribute('aria-hidden');
        }
        syncDeferredImageLoading();
    }

    function handleDocumentWorkbenchClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const actionButton = target?.closest?.('[data-aiw-action]');
        if (!actionButton || !root?.contains(actionButton)) return;

        const action = actionButton.getAttribute('data-aiw-action') || '';
        if (!action) return;
        if (action.startsWith('native-')) return;

        event.preventDefault();
        event.stopPropagation();
        handleAction(action, actionButton);
    }

    function handleAction(action, element) {
        openSelect = '';
        if (action === 'toggle-history') {
            setSidebarView(sidebarView === 'history' ? '' : 'history');
            renderSidebarTransition();
            return;
        }
        if (action === 'open-history') {
            setSidebarView('history');
            renderSidebarTransition();
            return;
        }
        if (action === 'close-history') {
            setSidebarView('');
            renderSidebarTransition();
            return;
        }
        if (action === 'toggle-billing') {
            setSidebarView(sidebarView === 'billing' ? '' : 'billing');
            renderSidebarTransition();
            return;
        }
        if (action === 'open-model-pricing') {
            openModelPricingView();
            return;
        }
        if (action === 'close-model-pricing') {
            modelPricingView.open = false;
            render({ preserveStageScroll: false, preservePromptFocus: false });
            return;
        }
        if (action === 'retry-model-pricing') {
            loadModelPricing({ force: true });
            return;
        }
        if (action === 'set-model-pricing-tab') {
            const tab = String(element?.dataset?.pricingTab || '').trim();
            if (['chat', 'image', 'video'].includes(tab)) {
                modelPricingView.tab = tab;
                render({ preserveStageScroll: false, preservePromptFocus: false });
            }
            return;
        }
        if (action === 'toggle-sidebar') {
            setSidebarView(sidebarView ? '' : 'history');
            renderSidebarTransition();
            return;
        }
        if (action === 'toggle-history-selection') {
            setHistorySelectionMode(!historySelectionMode);
            renderPreservingHistoryScroll(renderHistoryPanelOnly);
            return;
        }
        if (action === 'select-all-history') {
            toggleAllHistorySelections();
            renderPreservingHistoryScroll(renderHistoryPanelOnly);
            return;
        }
        if (action === 'delete-history-selection') {
            deleteSelectedHistoryTasks();
            return;
        }
        if (action === 'pin-history-selection') {
            pinSelectedHistoryTasks();
            return;
        }
        if (action === 'unpin-history-selection') {
            unpinSelectedHistoryTasks();
            return;
        }
        if (action === 'toggle-history-accent-menu') {
            openHistoryAccentMenu = !openHistoryAccentMenu;
            renderPreservingHistoryScroll(renderHistoryPanelOnly);
            return;
        }
        if (action === 'clear-history-search') {
            historySearchQuery = '';
            renderHistoryPanelOnly({ focusSearch: true });
            return;
        }
        if (action === 'set-history-accent') {
            setSelectedHistoryAccent(element?.dataset?.accent || '');
            return;
        }
        if (action === 'new-chat') {
            modelPricingView.open = false;
            resetConversationDraft({ preserveToolMode: true });
            render();
            persistState();
            const prompt = root?.querySelector?.('.ai-image-main-prompt');
            if (prompt instanceof HTMLTextAreaElement && isMobileKeyboardDevice()) {
                openMobilePromptProxy(prompt);
            } else {
                prompt?.focus?.();
            }
            return;
        }
        if (action === 'discover-api-models') {
            discoverRuntimeApiModels();
            return;
        }
        if (action === 'toggle') toggleWorkbench();
        if (action === 'open') openWorkbench();
        if (action === 'minimize') closeWorkbench();
        if (action === 'close') closeWorkbench();
        if (action === 'generate') submitWorkbenchTask();
        if (action === 'cancel-task') {
            cancelTask(element?.dataset?.taskId || state.activeTaskId);
            return;
        }
        if (action === 'copy-task-prompt') {
            copyTaskPrompt(element);
            return;
        }
        if (action === 'copy-chat-text') {
            copyChatText(element);
            return;
        }
        if (action === 'clear-reference') {
            state.referenceImage = '';
            state.referenceTitle = '';
            state.referenceIntent = '';
            state.referenceImages = [];
            state.continuationImage = null;
            clearComposerError();
            render();
            persistState();
            return;
        }
        if (action === 'remove-reference-image') {
            const index = Number(element?.dataset?.referenceIndex ?? -1);
            if (Number.isFinite(index) && index >= 0) {
                state.referenceImages.splice(index, 1);
                clearComposerError();
                render();
                persistState();
            }
            return;
        }
        if (action === 'remove-chat-attachment') {
            const index = Number(element?.dataset?.attachmentIndex ?? -1);
            const attachments = normalizeChatAttachmentList(state.chatAttachments);
            if (Number.isFinite(index) && index >= 0 && index < attachments.length) {
                attachments.splice(index, 1);
                state.chatAttachments = attachments;
                clearComposerError();
                render();
                persistState();
            }
            return;
        }
        if (action === 'upload-reference') {
            clearComposerError();
            openHiddenFilePicker();
            return;
        }
        if (action === 'recharge') {
            openRecharge();
            return;
        }
        if (action === 'reuse-task') {
            const task = state.tasks.find((item) => item.id === element?.dataset?.taskId);
            if (task) {
                state.prompt = task.prompt || task.resultPrompt || state.prompt;
                state.referenceImage = getTaskPrimaryImage(task) || state.referenceImage;
                state.referenceTitle = getTaskTitle(task);
                state.referenceIntent = '';
                state.referenceImages = [];
                state.continuationImage = null;
                state.mode = task.mode === 'reverse' ? 'text' : 'image';
                state.agent = '';
                clearComposerError();
                render();
                persistState();
            }
            return;
        }
        if (action === 'continue-image') {
            const taskId = String(element?.dataset?.taskId || '').trim();
            const resultId = String(element?.dataset?.resultId || '').trim();
            const resultIndex = String(element?.dataset?.resultIndex ?? '').trim();
            const matched = getResultImageByIdentity(taskId, resultId, resultIndex);
            const sourceTask = matched?.task || state.tasks.find((task) => task.id === taskId) || null;
            const image = matched?.image || null;
            const continuationImage = normalizeReferenceItem({
                image: getImagePreviewUrl(image) || element?.dataset?.referenceImage || getImageUrl(image) || '',
                title: sourceTask ? getTaskTitle(sourceTask) : '续作图片',
                taskId: sourceTask?.id || taskId,
                resultId,
                resultIndex,
                role: 'base'
            });
            if (continuationImage?.image) {
                const rootTask = sourceTask ? getTaskThreadRoot(sourceTask) : null;
                state.continuationImage = continuationImage;
                state.referenceImage = '';
                state.referenceTitle = '';
                state.referenceIntent = '';
                state.mode = 'image';
                state.agent = '';
                state.activeTaskId = rootTask?.id || sourceTask?.id || state.activeTaskId;
                clearComposerError();
                renderPreservingStageScroll();
                persistState();
            }
            return;
        }
    }

    async function copyTextToClipboard(text) {
        if (global.navigator?.clipboard?.writeText) {
            await global.navigator.clipboard.writeText(text);
            return;
        }
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.top = '-999px';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
    }

    function copyTaskPrompt(element) {
        const task = state.tasks.find((item) => item.id === element?.dataset?.taskId);
        const text = getTaskPromptText(task).trim();
        if (!text) return;
        copyTextToClipboard(text).then(() => {
            element?.classList?.add('is-copied');
            element?.setAttribute?.('aria-label', '已复制提示词');
            const icon = element?.querySelector?.('i');
            if (icon) icon.className = 'fas fa-check';
            global.setTimeout(() => {
                element?.classList?.remove('is-copied');
                element?.setAttribute?.('aria-label', '复制提示词');
                if (icon) icon.className = 'fas fa-copy';
            }, 1200);
        }).catch((error) => {
            console.warn('[AIImageWorkbench] Copy prompt failed:', error?.message || error);
        });
    }

    function copyChatText(element) {
        const task = state.tasks.find((item) => item.id === element?.dataset?.taskId);
        const kind = String(element?.dataset?.copyKind || '').trim();
        const text = (kind === 'question' ? getChatTaskQuestionText(task) : getChatTaskAnswerText(task)).trim();
        if (!text) return;
        copyTextToClipboard(text).then(() => {
            element?.classList?.add('is-copied');
            element?.setAttribute?.('aria-label', kind === 'question' ? '已复制提问' : '已复制回答');
            const icon = element?.querySelector?.('i');
            if (icon) icon.className = 'fas fa-check';
            global.setTimeout(() => {
                element?.classList?.remove('is-copied');
                element?.setAttribute?.('aria-label', kind === 'question' ? '复制提问' : '复制回答');
                if (icon) icon.className = 'fas fa-copy';
            }, 1200);
        }).catch((error) => {
            console.warn('[AIImageWorkbench] Copy chat text failed:', error?.message || error);
        });
    }

    function setSidebarView(nextView = '') {
        sidebarEnteredView = sidebarView !== nextView ? nextView : '';
        sidebarView = nextView;
    }

    function getLayoutClasses() {
        return [
            'ai-image-layout',
            sidebarView ? 'is-history-open' : 'is-history-collapsed'
        ].filter(Boolean).join(' ');
    }

    function renderSidebarTransition() {
        const layout = overlay?.querySelector('.ai-image-layout');
        if (!layout) {
            render();
            return;
        }

        layout.className = getLayoutClasses();
        const sidebar = layout.querySelector('.ai-image-history-sidebar');
        if (sidebar) {
            const replacement = document.createElement('div');
            replacement.innerHTML = renderHistoryPanel().trim();
            const nextSidebar = replacement.firstElementChild;
            if (nextSidebar) {
                sidebar.className = nextSidebar.className;
                sidebar.setAttribute('aria-label', nextSidebar.getAttribute('aria-label') || '生成记录');
                sidebar.innerHTML = nextSidebar.innerHTML;
            }
        }
        sidebarEnteredView = '';
        scheduleChatNavigationPosition();
    }

    function renderHistoryPanelOnly({ focusSearch = false } = {}) {
        const sidebar = overlay?.querySelector?.('.ai-image-history-sidebar');
        if (!sidebar) {
            render();
            return;
        }
        const replacement = document.createElement('div');
        replacement.innerHTML = renderHistoryPanel().trim();
        const nextSidebar = replacement.firstElementChild;
        if (!nextSidebar) return;
        sidebar.className = nextSidebar.className;
        sidebar.setAttribute('aria-label', nextSidebar.getAttribute('aria-label') || '生成记录');
        sidebar.innerHTML = nextSidebar.innerHTML;
        if (focusSearch) {
            const searchInput = sidebar.querySelector('[data-aiw-history-search]');
            if (searchInput instanceof HTMLInputElement) {
                searchInput.focus();
                const end = searchInput.value.length;
                searchInput.setSelectionRange(end, end);
            }
        }
    }

    function renderPreservingHistoryScroll(renderFn = render) {
        const scroller = overlay?.querySelector?.('.ai-image-history-scroll');
        const scrollTop = Number(scroller?.scrollTop || 0);
        const scrollLeft = Number(scroller?.scrollLeft || 0);
        renderFn();
        if (!scrollTop && !scrollLeft) return;
        window.requestAnimationFrame(() => {
            const nextScroller = overlay?.querySelector?.('.ai-image-history-scroll');
            if (!nextScroller) return;
            nextScroller.scrollTop = scrollTop;
            nextScroller.scrollLeft = scrollLeft;
        });
    }

    function renderHistoryResultsOnly() {
        const container = overlay?.querySelector?.('[data-aiw-history-results]');
        if (!container) {
            renderHistoryPanelOnly({ focusSearch: true });
            return;
        }
        container.innerHTML = renderHistoryResultsPanel(getHistoryThreadRows());
    }

    function syncHistorySelectionUi() {
        const sidebar = overlay?.querySelector?.('.ai-image-history-sidebar');
        if (!sidebar) return;
        const historyRows = getHistoryThreadRows();
        const { filteredRows } = getHistorySearchViewState(historyRows);
        const selectedCount = getSelectedHistoryIds().length;
        const allSelected = Boolean(filteredRows.length && filteredRows.every((row) => selectedHistoryTaskIds.has(row.id)));

        const summary = sidebar.querySelector('[data-aiw-history-selection-summary]');
        if (summary) {
            const busyCount = getBusyTasks().length;
            const statusText = busyCount ? `${busyCount} 个生成中` : (historyRows.length ? `${historyRows.length} 个对话` : '还没有记录');
            summary.textContent = historySelectionMode ? `已选择 ${selectedCount} 个` : statusText;
        }

        sidebar.querySelectorAll('[data-aiw-task-id]').forEach((row) => {
            const taskId = row.getAttribute('data-aiw-task-id') || '';
            const selected = selectedHistoryTaskIds.has(taskId);
            row.classList.toggle('is-selected', selected);
            const selectButton = row.querySelector('[data-aiw-history-select]');
            if (selectButton) {
                const title = row.querySelector('.ai-image-task-copy strong')?.textContent?.trim() || '记录';
                selectButton.setAttribute('aria-label', `${selected ? '取消选择' : '选择'} ${title}`);
            }
        });

        const selectAll = sidebar.querySelector('[data-aiw-action="select-all-history"]');
        if (selectAll) {
            const icon = selectAll.querySelector('i');
            const label = selectAll.querySelector('span');
            if (icon) icon.className = `fas ${allSelected ? 'fa-square-check' : 'fa-check-double'}`;
            if (label) label.textContent = allSelected ? '取消全选' : '全选';
        }

        sidebar.querySelectorAll('[data-aiw-action="pin-history-selection"], [data-aiw-action="unpin-history-selection"], [data-aiw-action="toggle-history-accent-menu"], [data-aiw-action="delete-history-selection"]').forEach((button) => {
            if (button instanceof HTMLButtonElement) {
                button.disabled = !selectedCount;
            }
        });
    }

    function handleRootInput(event) {
        const target = event.target;
        if (target instanceof HTMLTextAreaElement && target.matches('[data-aiw-prompt]')) {
            state.prompt = target.value.slice(0, 4000);
            clearComposerError();
            syncPromptTextareaHeight(target);
            syncMobileComposerMenuAnchor();
            persistState();
            return;
        }
        if (target instanceof HTMLInputElement && target.matches('[data-aiw-api-key]')) {
            state.apiKey = target.value.slice(0, 300);
            return;
        }
        if (target instanceof HTMLInputElement && target.matches('[data-aiw-history-search]')) {
            historySearchQuery = target.value.slice(0, 120);
            renderHistoryResultsOnly();
            return;
        }
    }

    function handleRootFocusIn(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.matches?.('.ai-image-main-prompt[data-aiw-prompt]')) {
            if (isMobileKeyboardDevice()) {
                target.blur?.();
                openMobilePromptProxy(target);
                return;
            }
        }
        const historyNavButton = target?.closest?.('[data-aiw-history-nav-id]');
        if (historyNavButton) {
            showHistoryLocatorPreview(historyNavButton);
            return;
        }
        const navButton = target?.closest?.('[data-aiw-chat-nav-id]');
        if (!navButton) return;
        showChatNavigationPreview(navButton);
    }

    function handleRootFocusOut(event) {
        const target = event.target instanceof Element ? event.target : null;
        const historyNavButton = target?.closest?.('[data-aiw-history-nav-id]');
        if (historyNavButton) {
            window.requestAnimationFrame(() => {
                const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
                if (activeElement?.closest?.('[data-aiw-history-nav-id]')) return;
                hideHistoryLocatorPreview();
            });
            return;
        }
        const navButton = target?.closest?.('[data-aiw-chat-nav-id]');
        if (!navButton) return;
        window.requestAnimationFrame(() => {
            const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
            if (activeElement?.closest?.('[data-aiw-chat-nav-id]')) return;
            hideChatNavigationPreview();
        });
    }

    function handleRootKeydown(event) {
        const target = event.target;
        if (target instanceof Element) {
            const composerReferencePreview = target.closest('[data-aiw-reference-preview]');
            if (composerReferencePreview && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                composerReferencePreview.click?.();
                return;
            }
            if (!target.closest('[data-aiw-download]')) {
                const previewTrigger = target.closest('[data-aiw-preview-open]');
                if (previewTrigger && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    openImagePreview(previewTrigger);
                    return;
                }
            }
            const chatNavButton = target.closest('[data-aiw-chat-nav-id]');
            if (chatNavButton && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                scrollToChatTurn(chatNavButton.getAttribute('data-aiw-chat-nav-id') || '');
                return;
            }
            const historyNavButton = target.closest('[data-aiw-history-nav-id]');
            if (historyNavButton && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                scrollToHistoryRow(historyNavButton.getAttribute('data-aiw-history-nav-id') || '');
                return;
            }
            const taskRow = target.closest('[data-aiw-task-id]');
            if (taskRow && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                const taskId = taskRow.getAttribute('data-aiw-task-id') || '';
                if (historySelectionMode) {
                    toggleHistorySelection(taskId);
                    syncHistorySelectionUi();
                    return;
                }
                modelPricingView.open = false;
                state.activeTaskId = taskId;
                markTaskThreadSeen(taskId);
                openSelect = '';
                renderPreservingHistoryScroll();
                persistState();
                return;
            }
        }

        if (!(target instanceof HTMLTextAreaElement)) return;
        if (target.matches('[data-aiw-prompt]')) {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            submitWorkbenchTask();
            return;
        }
    }

    function handleRootChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) return;
        if (target.matches('[data-aiw-model]')) {
            state.model = target.value;
            render();
            persistState();
        }
    }

    function bindGlobalEvents() {
        document.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const promptAction = target?.closest('[data-aiw-prompt-action]');
            if (!promptAction) return;
            event.preventDefault();
            event.stopPropagation();
            const mode = promptAction.getAttribute('data-aiw-prompt-action') || 'text';
            openPromptForImageGeneration(getCurrentPromptModalPayload(mode));
        }, true);

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && state.open) {
                if (historySelectionMode) {
                    event.preventDefault();
                    setHistorySelectionMode(false);
                    renderPreservingHistoryScroll(renderHistoryPanelOnly);
                    return;
                }
                if (imagePreview) {
                    event.preventDefault();
                    closeImagePreview();
                    return;
                }
                if (modelPricingView.open) {
                    event.preventDefault();
                    modelPricingView.open = false;
                    render({ preserveStageScroll: false, preservePromptFocus: false });
                    return;
                }
                if (openSelect) {
                    event.preventDefault();
                    openSelect = '';
                    render();
                    return;
                }
                closeWorkbench();
            }
        });

        const observer = new MutationObserver(() => {
            if (document.getElementById('promptActionAiImageSlot')) {
                injectPromptModalActions();
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        document.addEventListener('click', handleDocumentWorkbenchClick, true);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                refreshBusyTasksNow();
            }
        });
        try {
            global.supabaseClient?.auth?.onAuthStateChange?.((event, session) => {
                if (event === 'SIGNED_OUT') {
                    currentAuthSession = null;
                    resetUserScopedWorkbenchData({ persistAfter: false });
                }
                if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                    currentAuthSession = normalizeSessionCandidate(session);
                    restoreUserScopedState(currentAuthSession);
                    remoteRecordsLoaded = false;
                    remoteHistoryPrefsLoaded = false;
                    render();
                    loadRemoteHistoryPrefs({ force: true });
                    loadRemoteRecords({ force: true });
                }
            });
        } catch (_) {
            // Auth event binding is best effort; API calls still guard user data.
        }
        global.addEventListener?.('focus', refreshBusyTasksNow);
        global.addEventListener?.('languageChanged', syncPromptModalActionLabels);
    }

    function openHiddenFilePicker() {
        let input = root.querySelector('[data-aiw-file-input]');
        if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.hidden = true;
            input.dataset.aiwFileInput = '1';
            input.addEventListener('change', async () => {
                const files = Array.from(input.files || []);
                if (!files.length) return;
                const inferredMode = inferWorkbenchMode();
                const canAttachDocuments = inferredMode === 'chat';
                const canAttachImages = inferredMode !== 'chat' || shouldExposeChatImageInput();
                const imageFiles = canAttachImages ? files.filter(isImageFile) : [];
                const documentFiles = canAttachDocuments ? files.filter((file) => !isImageFile(file) && isChatDocumentFile(file)) : [];
                const unsupportedFiles = files.filter((file) => !imageFiles.includes(file) && !documentFiles.includes(file));
                if (unsupportedFiles.length) {
                    const firstName = unsupportedFiles[0]?.name || '文件';
                    setComposerError(`${firstName} 暂不支持；对话支持图片、TXT/Markdown/CSV/JSON/HTML/XML/LOG/PDF`);
                    input.value = '';
                    render();
                    return;
                }
                const uploadImageContext = getCurrentImageContext();
                const appendUploadsAsExtraReferences = Boolean(imageFiles.length && uploadImageContext?.isContinuation && uploadImageContext?.image);
                if (appendUploadsAsExtraReferences && !state.continuationImage) {
                    const continuationImage = normalizeReferenceItem({
                        image: uploadImageContext.image,
                        title: uploadImageContext.title || '续作图片',
                        taskId: uploadImageContext.sourceTask?.id || '',
                        resultId: uploadImageContext.resultId || '',
                        resultIndex: uploadImageContext.resultIndex || '',
                        role: 'base'
                    });
                    if (continuationImage?.image) {
                        state.continuationImage = continuationImage;
                    }
                }
                const availableSlots = Math.max(0, MAX_REFERENCE_IMAGE_INPUTS - getReferenceInputCount());
                if (imageFiles.length && availableSlots <= 0) {
                    input.value = '';
                    setComposerError(`参考图最多 ${MAX_REFERENCE_IMAGE_INPUTS} 张（包含续作基底图）`);
                    render();
                    return;
                }
                const remainingAttachmentSlots = Math.max(0, MAX_CHAT_ATTACHMENT_COUNT - normalizeChatAttachmentList(state.chatAttachments).length);
                if (documentFiles.length && remainingAttachmentSlots <= 0) {
                    input.value = '';
                    setComposerError(`文档/PDF 最多 ${MAX_CHAT_ATTACHMENT_COUNT} 个`);
                    render();
                    return;
                }
                const selectedFiles = imageFiles.slice(0, availableSlots);
                const selectedDocumentFiles = documentFiles.slice(0, remainingAttachmentSlots);
                const promoteFirstUploadToPrimary = !appendUploadsAsExtraReferences && !state.referenceImage && !state.referenceImages.length;
                referenceUploadBusy = true;
                clearComposerError();
                if (promoteFirstUploadToPrimary && selectedFiles[0]) {
                    state.referenceTitle = selectedFiles[0].name || '参考图片';
                    state.referenceIntent = '';
                }
                render();
                try {
                    const uploadedItems = [];
                    for (const file of selectedFiles) {
                        const uploaded = await uploadReferenceImageFile(file);
                        if (uploaded?.imageUrl) {
                            uploadedItems.push({
                                image: uploaded.imageUrl,
                                title: uploaded.title || file.name || '参考图片',
                                role: 'reference'
                            });
                        }
                    }
                    if (uploadedItems.length && promoteFirstUploadToPrimary) {
                        const first = uploadedItems.shift();
                        state.referenceImage = first.image;
                        state.referenceTitle = first.title;
                        state.referenceIntent = '';
                    }
                    if (uploadedItems.length) {
                        state.referenceImages = normalizeReferenceList([
                            ...state.referenceImages,
                            ...uploadedItems
                        ]);
                    }
                    if (selectedDocumentFiles.length) {
                        const attachments = [];
                        for (const file of selectedDocumentFiles) {
                            // eslint-disable-next-line no-await-in-loop
                            const attachment = await readChatAttachmentFile(file);
                            if (attachment) attachments.push(attachment);
                        }
                        state.chatAttachments = normalizeChatAttachmentList([
                            ...state.chatAttachments,
                            ...attachments
                        ]);
                    }
                    render();
                    persistState();
                } catch (error) {
                    console.warn('[AIImageWorkbench] Attachment upload/read failed:', error?.message || error);
                    setComposerError(error?.message || '附件读取失败，请稍后重试');
                    render();
                } finally {
                    referenceUploadBusy = false;
                    input.value = '';
                    render();
                }
            });
            root.appendChild(input);
        }
        input.accept = inferWorkbenchMode() === 'chat'
            ? (shouldExposeChatImageInput() ? CHAT_ATTACHMENT_ACCEPT : CHAT_DOCUMENT_ACCEPT)
            : 'image/*';
        input.click();
    }

    async function openRecharge() {
        try {
            if (global.ZaoyoeWalletModalBootstrap?.open) {
                await global.ZaoyoeWalletModalBootstrap.open('recharge', { entry: 'ai_image_workbench' });
                return;
            }
            if (global.WalletModal?.open) {
                global.WalletModal.open('recharge', { entry: 'ai_image_workbench' });
            }
        } catch (error) {
            console.warn('[AIImageWorkbench] Wallet open failed:', error?.message || error);
        }
    }

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
            reader.readAsDataURL(file);
        });
    }

    function isImageFile(file) {
        return /^image\/(png|jpe?g|webp)$/i.test(file?.type || '')
            || /\.(png|jpe?g|webp)$/i.test(file?.name || '');
    }

    function isPdfFile(file) {
        return /application\/pdf/i.test(file?.type || '') || /\.pdf$/i.test(file?.name || '');
    }

    function isTextDocumentFile(file) {
        const name = String(file?.name || '');
        const type = String(file?.type || '');
        return /^text\//i.test(type)
            || /application\/(json|xml|x-ndjson|csv)/i.test(type)
            || /\.(txt|md|csv|json|html?|xml|log)$/i.test(name);
    }

    function isChatDocumentFile(file) {
        return isPdfFile(file) || isTextDocumentFile(file);
    }

    async function loadPdfJs() {
        if (global.pdfjsLib?.getDocument) return global.pdfjsLib;
        if (!pdfJsModulePromise) {
            pdfJsModulePromise = import(PDFJS_CDN_URL)
                .then((module) => {
                    const pdfjsLib = module?.default?.getDocument ? module.default : module;
                    if (pdfjsLib?.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;
                    }
                    return pdfjsLib;
                });
        }
        return pdfJsModulePromise;
    }

    async function extractPdfText(file) {
        const pdfjsLib = await loadPdfJs();
        if (!pdfjsLib?.getDocument) {
            throw new Error('PDF 解析器加载失败，请稍后重试');
        }
        const data = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;
        const parts = [];
        let totalChars = 0;
        try {
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
                // eslint-disable-next-line no-await-in-loop
                const page = await pdf.getPage(pageNumber);
                // eslint-disable-next-line no-await-in-loop
                const textContent = await page.getTextContent();
                const pageText = (textContent.items || [])
                    .map((item) => String(item?.str || '').trim())
                    .filter(Boolean)
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (pageText) {
                    const chunk = `第 ${pageNumber} 页\n${pageText}`;
                    const remaining = MAX_CHAT_ATTACHMENT_TEXT_CHARS - totalChars;
                    if (remaining <= 0) break;
                    parts.push(chunk.slice(0, remaining));
                    totalChars += Math.min(chunk.length, remaining);
                }
                page.cleanup?.();
                if (totalChars >= MAX_CHAT_ATTACHMENT_TEXT_CHARS) break;
            }
        } finally {
            if (typeof loadingTask.destroy === 'function') {
                try {
                    await loadingTask.destroy();
                } catch (_) {
                    // PDF.js cleanup is best effort after text extraction.
                }
            }
        }
        const text = parts.join('\n\n').trim();
        if (!text) throw new Error('这个 PDF 没有可提取文本，暂不支持扫描件/OCR');
        return text;
    }

    async function readChatAttachmentFile(file) {
        if (!file) return null;
        if (!isChatDocumentFile(file)) {
            throw new Error(`${file.name || '文件'} 暂不支持；当前支持 TXT/Markdown/CSV/JSON/HTML/XML/LOG/PDF`);
        }
        if (file.size > MAX_CHAT_ATTACHMENT_FILE_BYTES) {
            throw new Error(`${file.name || '文件'} 超出限制，请上传 ${formatFileSize(MAX_CHAT_ATTACHMENT_FILE_BYTES)} 以内的文档/PDF`);
        }
        const rawText = isPdfFile(file)
            ? await extractPdfText(file)
            : await file.text();
        const text = String(rawText || '')
            .replace(/\u0000/g, '')
            .replace(/\r\n/g, '\n')
            .trim()
            .slice(0, MAX_CHAT_ATTACHMENT_TEXT_CHARS);
        if (!text) {
            throw new Error(`${file.name || '文件'} 没有可读取的文本内容`);
        }
        return normalizeChatAttachmentItem({
            id: getNowId('file'),
            name: file.name || '附件',
            mimeType: file.type || (isPdfFile(file) ? 'application/pdf' : 'text/plain'),
            size: file.size || 0,
            text
        });
    }

    async function uploadReferenceImageFile(file) {
        if (!file) return null;
        if (!/^image\/(png|jpe?g|webp)$/i.test(file.type || '')) {
            throw new Error('仅支持 JPG、PNG、WebP 图片');
        }
        if (file.size > 12 * 1024 * 1024) {
            throw new Error('图片大小超出限制，请上传 12MB 以内的图片');
        }

        const imageData = await fileToDataUrl(file);
        const payload = await requestAiImage('upload', {
            method: 'POST',
            body: {
                site: getRuntimeSite(),
                imageData,
                mimeType: file.type,
                title: file.name || '参考图片'
            },
            auth: true
        });
        const imageUrl = String(payload.imageUrl || payload.image_url || '').trim();
        if (!imageUrl) {
            throw new Error('图片上传失败，请稍后重试');
        }
        if (isTransientImageUrl(imageUrl)) {
            throw new Error('图片存储未返回正式地址，请检查 R2 配置后重试');
        }

        return {
            imageUrl,
            title: String(payload.title || file.name || '参考图片').slice(0, 160)
        };
    }

    async function uploadReferenceImageDataUrl(imageData, title = '续作图片') {
        const normalized = String(imageData || '').trim();
        if (!isDataImageUrl(normalized)) {
            throw new Error('续作底图仍在准备，请稍后刷新后再试');
        }
        const mimeType = normalized.match(/^data:([^;,]+)/i)?.[1] || 'image/png';
        const payload = await requestAiImage('upload', {
            method: 'POST',
            body: {
                site: getRuntimeSite(),
                imageData: normalized,
                mimeType,
                title
            },
            auth: true
        });
        const imageUrl = String(payload.imageUrl || payload.image_url || '').trim();
        if (!imageUrl) {
            throw new Error('续作底图上传失败，请稍后重试');
        }
        if (isTransientImageUrl(imageUrl)) {
            throw new Error('续作底图上传后仍是临时地址，请检查 R2 配置后重试');
        }

        return {
            imageUrl,
            title: String(payload.title || title || '续作图片').slice(0, 160)
        };
    }

    async function resolveSubmittableReferenceItem(item = null) {
        const reference = normalizeReferenceItem(item);
        if (!reference?.image || !isTransientImageUrl(reference.image)) return reference;
        if (reference.role === 'base' && (reference.resultId || reference.taskId)) return reference;

        if (isDataImageUrl(reference.image)) {
            const uploaded = await uploadReferenceImageDataUrl(reference.image, reference.title || '续作图片');
            return {
                ...reference,
                image: uploaded.imageUrl,
                title: uploaded.title || reference.title
            };
        }

        try {
            const response = await withTimeout(fetch(reference.image), 12000);
            if (!response.ok) throw new Error('续作底图读取失败');
            const blob = await response.blob();
            if (!/^image\/(png|jpe?g|webp)$/i.test(blob.type || '')) {
                throw new Error('续作底图格式不可用');
            }
            const imageData = await fileToDataUrl(blob);
            const uploaded = await uploadReferenceImageDataUrl(imageData, reference.title || '续作图片');
            return {
                ...reference,
                image: uploaded.imageUrl,
                title: uploaded.title || reference.title
            };
        } catch (error) {
            console.warn('[AIImageWorkbench] Continuation base upload failed:', error?.message || error);
            throw new Error('续作底图仍在准备，请稍后刷新记录后再试');
        }
    }

    async function recordImageDownload(element) {
        if (!element) return;
        const href = String(element.getAttribute('href') || '').trim();
        try {
            const payload = await requestAiImage('download', {
                method: 'POST',
                body: {
                    site: getRuntimeSite(),
                    resultId: element.dataset.resultId || '',
                    taskId: element.dataset.taskId || '',
                    resultIndex: element.dataset.resultIndex || 0,
                    source: 'result-card'
                },
                auth: true
            });
            const originalUrl = String(payload.originalImageUrl || payload.original_image_url || payload.imageUrl || payload.image_url || '').trim();
            if (originalUrl && originalUrl !== href) {
                element.setAttribute('href', originalUrl);
            }
            activitySummary = {
                ...activitySummary,
                downloads: activitySummary.downloads + 1
            };
            render();
        } catch (error) {
            if (String(error?.code || '').trim() === 'original_image_pending') {
                loadRemoteRecords({ force: true }).finally(scheduleRemoteRecordsPoll);
                return;
            }
            console.warn('[AIImageWorkbench] Download record failed:', error?.message || error);
        }
    }

    function clearImagePreviewLoadTimer() {
        if (!imagePreviewLoadTimer) return;
        global.clearInterval(imagePreviewLoadTimer);
        imagePreviewLoadTimer = null;
    }

    function preloadImagePreviewOriginal() {
        clearImagePreviewLoadTimer();
        if (!imagePreview?.originalReady || !imagePreview.originalSrc || imagePreview.originalLoaded || imagePreview.loadToken) return;
        const previewToken = `${imagePreview.taskId}:${imagePreview.resultId}:${imagePreview.resultIndex}:${Date.now()}`;
        imagePreview = {
            ...imagePreview,
            loadToken: previewToken,
            openedAt: imagePreview.openedAt || Date.now()
        };
        imagePreviewLoadTimer = global.setInterval(() => {
            if (!imagePreview || imagePreview.loadToken !== previewToken || imagePreview.originalLoaded) {
                clearImagePreviewLoadTimer();
                return;
            }
            render();
        }, 450);

        const loader = new Image();
        loader.onload = () => {
            if (!imagePreview || imagePreview.loadToken !== previewToken) return;
            clearImagePreviewLoadTimer();
            imagePreview = {
                ...imagePreview,
                src: imagePreview.originalSrc,
                originalLoaded: true,
                loadToken: ''
            };
            render();
        };
        loader.onerror = () => {
            if (!imagePreview || imagePreview.loadToken !== previewToken) return;
            clearImagePreviewLoadTimer();
            imagePreview = {
                ...imagePreview,
                originalLoaded: false,
                originalStatus: 'failed',
                loadToken: ''
            };
            render();
        };
        loader.src = imagePreview.originalSrc;
    }

    function openImagePreview(elementOrPayload) {
        if (!elementOrPayload) return;
        const isElement = typeof elementOrPayload.getAttribute === 'function';
        const previewSrc = isElement
            ? String(elementOrPayload.getAttribute('data-aiw-preview-thumb') || elementOrPayload.getAttribute('data-aiw-preview-src') || '').trim()
            : String(elementOrPayload.previewSrc || elementOrPayload.src || '').trim();
        const originalSrc = isElement
            ? String(elementOrPayload.getAttribute('data-aiw-preview-original-src') || '').trim()
            : String(elementOrPayload.originalSrc || '').trim();
        if (!previewSrc && !originalSrc) return;
        const originalReady = isElement
            ? elementOrPayload.getAttribute('data-aiw-original-ready') === 'true'
            : Boolean(elementOrPayload.originalReady && originalSrc);
        const previewBytes = isElement
            ? normalizeByteCount(elementOrPayload.getAttribute('data-aiw-preview-bytes'))
            : normalizeByteCount(elementOrPayload.previewBytes ?? elementOrPayload.preview_bytes);
        const originalBytes = isElement
            ? normalizeByteCount(elementOrPayload.getAttribute('data-aiw-original-bytes'))
            : normalizeByteCount(elementOrPayload.originalBytes ?? elementOrPayload.original_bytes);
        clearImagePreviewLoadTimer();
        imagePreview = {
            src: previewSrc || originalSrc,
            previewSrc: previewSrc || originalSrc,
            title: String(isElement ? elementOrPayload.getAttribute('data-aiw-preview-title') : elementOrPayload.title || '生成图片').trim(),
            meta: String(isElement ? elementOrPayload.getAttribute('data-aiw-preview-meta') : elementOrPayload.meta || '高清原图').trim(),
            originalReady,
            originalStatus: String(isElement ? elementOrPayload.getAttribute('data-aiw-original-status') : elementOrPayload.originalStatus || '').trim(),
            originalSrc: originalReady ? originalSrc : '',
            previewBytes,
            originalBytes,
            originalLoaded: false,
            openedAt: Date.now(),
            loadToken: '',
            resultId: String(isElement ? elementOrPayload.getAttribute('data-result-id') : elementOrPayload.resultId || '').trim(),
            taskId: String(isElement ? elementOrPayload.getAttribute('data-task-id') : elementOrPayload.taskId || '').trim(),
            resultIndex: String(isElement ? elementOrPayload.getAttribute('data-result-index') || '0' : elementOrPayload.resultIndex || '0').trim()
        };
        syncImagePreviewFromTasks();
        if (imagePreview.originalReady) {
            preloadImagePreviewOriginal();
        } else {
            loadRemoteRecords({ force: true }).finally(scheduleRemoteRecordsPoll);
        }
        setBodyImagePreviewState(true);
        render();
    }

    function closeImagePreview() {
        if (!imagePreview) return;
        clearImagePreviewLoadTimer();
        imagePreview = null;
        setBodyImagePreviewState(false);
        render();
    }

	    function buildSubmitPayload(task, { chatAttachments = [] } = {}) {
	        const providerId = normalizePricingProviderId(task.modelProviderId || task.model_provider_id || task.providerId || task.provider_id || getActiveModelProviderId(task.mode));
	        const chatCapabilities = getChatModelCapabilities(task.model || getActiveModelValue('chat'));
	        const getCapabilityValue = (id, storedValue) => {
	            const control = chatCapabilities.controls.find((item) => item.id === id);
	            if (!control) return '';
	            return getEffectiveChatCapabilityValue(storedValue, control.options);
	        };
	        const payload = {
	            site: getRuntimeSite(),
	            billingMode: task.billingMode,
            apiBaseUrl: task.billingMode === 'api' ? task.apiBaseUrl : '',
            prompt: task.prompt,
            mode: task.mode,
            parentTaskId: serverUuidOrEmpty(task.parentTaskId),
            referenceTaskId: serverUuidOrEmpty(task.referenceTaskId),
            referenceResultId: serverUuidOrEmpty(task.referenceResultId),
            referenceResultIndex: task.referenceResultIndex,
            referenceImageUrl: task.referenceImage,
            referenceTitle: task.referenceTitle,
            referenceImages: task.referenceImages,
            ratio: task.ratio,
            resolution: task.resolution,
            videoSettings: isVideoMode(task.mode) ? {
                ratio: task.ratio,
                aspectRatio: task.ratio,
                resolution: task.resolution,
                duration: task.videoDuration || DEFAULT_STATE.videoDuration,
                generateAudio: task.videoAudio !== 'false',
                watermark: task.videoWatermark === 'true',
                cameraFixed: task.videoCameraFixed === 'true'
            } : null,
            videoDuration: isVideoMode(task.mode) ? (task.videoDuration || DEFAULT_STATE.videoDuration) : '',
            videoAudio: isVideoMode(task.mode) ? (task.videoAudio || DEFAULT_STATE.videoAudio) : '',
            videoWatermark: isVideoMode(task.mode) ? (task.videoWatermark || DEFAULT_STATE.videoWatermark) : '',
            videoCameraFixed: isVideoMode(task.mode) ? (task.videoCameraFixed || DEFAULT_STATE.videoCameraFixed) : '',
	            quantity: task.quantity,
	            model: task.model,
		            apiModelGroup: task.apiModelGroup,
		            modelProviderId: providerId,
		            model_provider_id: providerId,
		            providerId,
		            provider_id: providerId,
		            memoryMode: state.chatMemoryMode,
	            memoryMessageLimit: getChatMemoryOption().messageLimit,
	            memoryTokenBudget: getChatMemoryOption().tokenBudget,
	            clientTaskId: task.id,
	            output: isTextVisionMode(task.mode) ? 'text' : (isVideoMode(task.mode) ? 'video' : 'image')
	        };
	        if (task.billingMode === 'points') {
	            const pricingRule = findRuntimePricingRule({
	                site: getRuntimeSite(),
	                mode: task.mode,
	                billingMode: task.billingMode,
	                model: task.model,
	                providerId,
	                resolution: task.resolution,
	                ratio: task.ratio,
	                quantity: task.quantity
	            });
	            const pricingRuleId = String(pricingRule?.id || '').trim();
	            const pricingRuleUpdatedAt = String(pricingRule?.updated_at || pricingRule?.updatedAt || '').trim();
	            if (pricingRuleId && pricingRuleUpdatedAt) {
	                payload.pricingRuleId = pricingRuleId;
	                payload.pricing_rule_id = pricingRuleId;
	                payload.pricingRuleUpdatedAt = pricingRuleUpdatedAt;
	                payload.pricing_rule_updated_at = pricingRuleUpdatedAt;
	            }
	        }
	        const reasoningEffort = getCapabilityValue('reasoning', state.chatReasoningEffort);
	        const geminiThinkingLevel = getCapabilityValue('geminiThinking', state.chatGeminiThinkingLevel);
	        const claudeThinkingBudget = getCapabilityValue('claudeThinkingBudget', state.chatClaudeThinkingBudget);
	        const serviceTier = getCapabilityValue('serviceTier', state.chatServiceTier);
	        const thinkingMode = getCapabilityValue('thinking', state.chatThinkingMode);
	        const imageInputMode = getCapabilityValue('imageInput', state.chatImageInput);
	        const chatModelOption = task.mode === 'chat' ? getChatModelOption(task.model || getActiveModelValue('chat')) : null;
	        if (chatModelOption?.vendor) payload.modelVendor = chatModelOption.vendor;
	        if (chatModelOption?.protocol) payload.modelProtocol = chatModelOption.protocol;
	        if (chatModelOption?.providerLabel) payload.modelProviderLabel = chatModelOption.providerLabel;
	        if (reasoningEffort) payload.reasoningEffort = reasoningEffort;
	        if (geminiThinkingLevel && thinkingMode !== 'disabled') payload.geminiThinkingLevel = geminiThinkingLevel;
	        if (claudeThinkingBudget) payload.claudeThinkingBudget = claudeThinkingBudget;
	        if (serviceTier) payload.serviceTier = serviceTier;
	        if (thinkingMode) payload.thinkingMode = thinkingMode;
	        if (imageInputMode) payload.imageInputMode = imageInputMode;
	        if (chatModelOption?.supportsImageInput !== null && chatModelOption?.supportsImageInput !== undefined) {
	            payload.supportsImageInput = Boolean(chatModelOption.supportsImageInput);
	        }
	        const normalizedChatAttachments = task.mode === 'chat'
	            ? normalizeChatAttachmentList(chatAttachments)
	            : [];
	        if (normalizedChatAttachments.length) {
	            payload.chatAttachments = normalizedChatAttachments.map((item) => ({
	                name: item.name,
	                mimeType: item.mimeType,
	                size: item.size,
	                text: item.text
	            }));
	        }
        const apiKey = String(state.apiKey || '').trim();
        if (task.billingMode === 'api' && apiKey) {
            payload.apiKey = apiKey;
        }
        return payload;
    }

    function replaceTask(localTaskId, remoteTaskPayload) {
        const remoteTask = normalizeTask(remoteTaskPayload);
        if (!remoteTask) return null;
        const index = state.tasks.findIndex((task) => (
            task.id === localTaskId
            || task.id === remoteTask.id
            || (remoteTask.clientTaskId && (task.id === remoteTask.clientTaskId || task.clientTaskId === remoteTask.clientTaskId))
        ));
        const previous = index >= 0 ? state.tasks[index] : null;
        const nextTask = mergeTaskSnapshots(previous || {}, remoteTask);
        maybeRememberKimiThinkingCapability(nextTask);
        const clearedComposerReferences = maybeClearComposerReferencesAfterTaskSuccess(nextTask, previous || {});
        if (index >= 0) {
            state.tasks.splice(index, 1, nextTask);
        } else {
            state.tasks.unshift(nextTask);
        }
        if (state.activeTaskId === localTaskId) {
            state.activeTaskId = nextTask.parentTaskId || nextTask.id;
        }
        state.tasks.forEach((task) => {
            if (task.parentTaskId === localTaskId) task.parentTaskId = nextTask.id;
        });
        if (clearedComposerReferences) {
            clearComposerError();
        } else {
            syncCannotCancelComposerWarning();
        }
        return nextTask;
    }

    async function recoverSubmitTimeout(localTask) {
        const task = state.tasks.find((item) => item.id === localTask.id || item.clientTaskId === localTask.id);
        if (!task || task.status === 'cancelled') return;
        task.remoteError = getFriendlyTaskError('AI image request timeout');
        task.resultPrompt = '';
        task.status = task.status === 'failed' ? 'queued' : task.status;
        task.progressKnown = false;
        task.completedAt = 0;
        persistState();
        render();
        await loadRemoteRecords({ force: true });
        if (getBusyTasks().length) {
            await recoverBusyTasksByClientId();
        }
        scheduleRemoteRecordsPoll();
    }

    async function submitRemoteTask(localTask) {
        try {
            const localWasCancelledBeforeSubmit = state.tasks.find((item) => item.id === localTask.id)?.status === 'cancelled';
            const payload = await requestAiImage('submit', {
                method: 'POST',
                body: buildSubmitPayload(localTask),
                auth: true,
                allowTaskOnFailure: true
            });
            const localWasCancelled = localWasCancelledBeforeSubmit
                || state.tasks.find((item) => item.id === localTask.id || item.clientTaskId === localTask.id)?.status === 'cancelled';
            const storedApiKeyChanged = applyStoredApiKeyFromPayload(payload);
            const remoteTask = replaceTask(localTask.id, payload.task);
            if (remoteTask) {
                persistState();
                render();
                if (localWasCancelled) {
                    cancelRemoteTask(remoteTask, localTask.clientTaskId || localTask.id)
                        .then((cancelPayload) => {
                            if (cancelPayload?.task) applyCancelResponse(remoteTask.id, cancelPayload);
                        })
                        .catch((error) => {
                            const restoredTask = error?.payload?.task ? applyCancelResponse(remoteTask.id, error.payload) : null;
                            const targetTask = restoredTask || remoteTask;
                            targetTask.remoteError = getFriendlyTaskError(error?.message || error || '', '', targetTask.mode).slice(0, 240);
                            if (error?.code === 'task_not_cancellable') setComposerError(CANNOT_CANCEL_CHARGED_MESSAGE);
                        })
                        .finally(() => {
                            persistState();
                            render();
                        });
                    return;
                }
                if (isImageGenerationMode(remoteTask.mode)) {
                    requestFastRemoteRecordsPoll();
                }
                loadRemoteRecords({ force: true, includeUsage: !isImageGenerationMode(remoteTask.mode) }).finally(scheduleRemoteRecordsPoll);
            } else if (storedApiKeyChanged) {
                persistState();
                render();
            }
        } catch (error) {
            console.warn('[AIImageWorkbench] Remote submit failed:', {
                message: error?.message || String(error || ''),
                code: error?.code || '',
                status: error?.status || 0,
                mode: localTask?.mode || '',
                billingMode: localTask?.billingMode || '',
                model: localTask?.model || '',
                apiModelGroup: localTask?.apiModelGroup || '',
                payload: error?.payload || null
            });
            await refreshPricingAfterChange(error);
            if (isRequestTimeoutError(error)) {
                recoverSubmitTimeout(localTask).catch((recoverError) => {
                    console.warn('[AIImageWorkbench] Submit timeout recovery failed:', recoverError?.message || recoverError);
                });
                return;
            }
            const task = state.tasks.find((item) => item.id === localTask.id);
            if (task) {
                task.errorCode = String(error?.code || '').slice(0, 120);
                task.errorStatus = Number(error?.status || 0);
                task.remoteError = getFriendlyTaskError(error?.message || error || '', '', task.mode).slice(0, 240);
                if (task.status === 'cancelled') {
                    persistState();
                    render();
                    return;
                }
                task.status = 'failed';
                task.progress = 0;
                task.completedAt = Date.now();
                task.resultPrompt = task.remoteError;
                task.errorMessage = task.remoteError;
                persistState();
                render();
            }
        }
    }

    function getModelLabel(modelId = '', mode = inferWorkbenchMode()) {
        return getActiveModelOptions(mode).find((item) => item.id === modelId)?.label || modelId || '';
    }

    async function submitChatStreamTask(localTask, threadRoot = null, chatThreadMessages = null, chatAttachments = []) {
        const task = localTask;
        if (task?.id) activeChatStreamTaskIds.add(task.id);
        if (task?.clientTaskId) activeChatStreamTaskIds.add(task.clientTaskId);
        try {
            let finalTaskFromStream = null;
            let receivedText = '';
            let displayedText = '';
            let hasPaintedVisibleText = false;
            let unpaintedCharCount = 0;
            let persistTimer = 0;
            const persistStreamState = ({ immediate = false } = {}) => {
                if (persistTimer) {
                    global.clearTimeout?.(persistTimer);
                    persistTimer = 0;
                }
                if (immediate) {
                    persistState();
                    return;
                }
                persistTimer = global.setTimeout?.(() => {
                    persistTimer = 0;
                    persistState();
                }, CHAT_STREAM_PERSIST_DELAY_MS) || 0;
            };
            const updateVisibleChatAnswer = (currentTask, text) => {
                if (!currentTask) return false;
                const normalizedTaskId = String(currentTask.id || '').trim();
                const escapedTaskId = global.CSS?.escape
                    ? global.CSS.escape(normalizedTaskId)
                    : normalizedTaskId.replace(/"/g, '\\"');
                const turn = overlay?.querySelector?.(`[data-aiw-chat-turn-id="${escapedTaskId}"]`);
                const output = turn?.querySelector?.('[data-aiw-chat-output]');
                const answer = output?.querySelector?.('[data-aiw-chat-answer-text]');
                if (!answer) return false;
                output.querySelector?.('.chat-loading-dots')?.remove();
                answer.hidden = false;
                answer.textContent = text;
                const actions = output.querySelector?.('[data-aiw-chat-answer-actions]');
                if (actions) actions.hidden = !text;
                return true;
            };
            const revealChatDelta = async (currentTask, delta) => {
                const chunks = splitProgressiveChatDelta(delta);
                for (let index = 0; index < chunks.length; index += 1) {
                    displayedText += chunks[index];
                    unpaintedCharCount += Array.from(chunks[index]).length;
                    if (currentTask) {
                        currentTask.resultPrompt = displayedText;
                        if (!updateVisibleChatAnswer(currentTask, displayedText)) {
                            render();
                        }
                        scrollChatStageToBottom();
                    }
                    const shouldYieldForPaint = !hasPaintedVisibleText
                        || index < chunks.length - 1
                        || unpaintedCharCount >= CHAT_STREAM_PROGRESSIVE_TARGET_CHARS;
                    if (shouldYieldForPaint) {
                        await waitForChatStreamPaint();
                        hasPaintedVisibleText = hasPaintedVisibleText || displayedText.trim() !== '';
                        unpaintedCharCount = 0;
                    }
                }
            };
            const normalizedChatAttachments = normalizeChatAttachmentList(chatAttachments);
            const messages = Array.isArray(chatThreadMessages) ? chatThreadMessages : getChatThreadMessages(threadRoot);
            await requestAiImageStream('chat-stream', {
                method: 'POST',
                body: {
                    ...buildSubmitPayload(task, { chatAttachments: normalizedChatAttachments }),
                    modelLabel: getModelLabel(task.model, 'chat'),
                    messages
                },
                auth: true,
                async onEvent(eventName, payload = {}) {
                    if (eventName === 'task' && payload.task) {
                        const storedApiKeyChanged = applyStoredApiKeyFromPayload(payload);
                        const remoteTask = replaceTask(task.id, payload.task);
                        if (remoteTask) {
                            if (remoteTask.id) activeChatStreamTaskIds.add(remoteTask.id);
                            if (remoteTask.clientTaskId) activeChatStreamTaskIds.add(remoteTask.clientTaskId);
                            if (remoteTask.status !== 'cancelled') {
                                remoteTask.status = 'streaming';
                                remoteTask.resultPrompt = receivedText || remoteTask.resultPrompt || '';
                            }
                            persistState();
                            render();
                            if (remoteTask.status !== 'cancelled') scrollChatStageToBottom();
                        } else if (storedApiKeyChanged) {
                            persistState();
                            render();
                        }
                        return;
                    }
                    const currentTask = state.tasks.find((item) => item.id === task.id || item.clientTaskId === task.id || item.clientTaskId === task.clientTaskId);
                    if (eventName === 'reasoning') {
                        const delta = String(payload.delta || '');
                        if (!delta) return;
                        if (currentTask) {
                            if (currentTask.status === 'cancelled') return;
                            const isFirstReasoningDelta = !getChatTaskReasoningText(currentTask);
                            if (isFirstReasoningDelta) {
                                currentTask.reasoningStartedAt = Date.now();
                                currentTask.reasoningCompletedAt = 0;
                                currentTask.reasoningExpanded = true;
                            }
                            currentTask.status = 'streaming';
                            currentTask.progress = Math.min(96, Math.max(currentTask.progress || 12, 12 + Math.round((currentTask.reasoningText || '').length / 18)));
                            currentTask.progressKnown = true;
                            currentTask.reasoningText = `${currentTask.reasoningText || ''}${delta}`;
                            currentTask.metadata = {
                                ...(currentTask.metadata || {}),
                                reasoning_content: currentTask.reasoningText
                            };
                            maybeRememberKimiThinkingCapability(currentTask);
                            currentTask.completedAt = 0;
                            persistStreamState();
                            if (!updateVisibleChatReasoning(currentTask)) render();
                            scrollChatStageToBottom();
                        }
                        return;
                    }
                    if (eventName === 'delta') {
                        const delta = String(payload.delta || '');
                        if (!delta) return;
                        receivedText += delta;
                        if (currentTask) {
                            if (currentTask.status === 'cancelled') return;
                            const reasoningWasCompleted = completeChatReasoning(currentTask, Date.now());
                            currentTask.status = 'streaming';
                            currentTask.progress = Math.min(96, Math.max(currentTask.progress || 12, 16 + Math.round(receivedText.length / 12)));
                            currentTask.progressKnown = true;
                            currentTask.completedAt = 0;
                            if (reasoningWasCompleted && !updateVisibleChatReasoning(currentTask)) render();
                        }
                        await revealChatDelta(currentTask, delta);
                        persistStreamState();
                        return;
                    }
                    if (eventName === 'content_done') {
                        if (!currentTask || currentTask.status === 'cancelled') return;
                        persistStreamState({ immediate: true });
                        const contentCompletedAt = normalizeTimestamp(
                            payload.contentCompletedAt || payload.content_completed_at,
                            Date.now()
                        );
                        currentTask.generationCompletedAt = contentCompletedAt;
                        const reasoningWasCompleted = completeChatReasoning(currentTask, contentCompletedAt);
                        currentTask.progress = Math.max(Number(currentTask.progress || 0), 97);
                        currentTask.progressKnown = true;
                        currentTask.metadata = {
                            ...(currentTask.metadata || {}),
                            stream_finalizing: true,
                            content_completed_at: payload.content_completed_at || payload.contentCompletedAt || new Date(contentCompletedAt).toISOString(),
                            generation_elapsed_ms: Number(payload.generation_elapsed_ms ?? payload.generationElapsedMs ?? 0) || 0,
                            protocol_done_signal: String(payload.terminal_signal || '')
                        };
                        persistState();
                        if (reasoningWasCompleted && !updateVisibleChatReasoning(currentTask)) render();
                        return;
                    }
                    if (eventName === 'billing') {
                        if (!currentTask) return;
                        persistStreamState({ immediate: true });
                        const chargedPoints = Number(payload.chargedPoints ?? payload.charged_points);
                        if (Number.isFinite(chargedPoints)) {
                            currentTask.chargedPoints = Math.max(0, chargedPoints);
                            currentTask.cost = currentTask.chargedPoints;
                        }
                        const pricingCharge = payload.pricingCharge || payload.pricing_charge;
                        if (pricingCharge && typeof pricingCharge === 'object' && !Array.isArray(pricingCharge)) {
                            currentTask.metadata = {
                                ...(currentTask.metadata || {}),
                                pricing_charge: pricingCharge
                            };
                        }
                        const tokenUsage = payload.token_usage || payload.tokenUsage;
                        if (tokenUsage && typeof tokenUsage === 'object' && !Array.isArray(tokenUsage)) {
                            currentTask.tokenUsageRaw = {
                                ...(currentTask.tokenUsageRaw || {}),
                                ...tokenUsage
                            };
                            currentTask.inputTokens = Number(tokenUsage.input_tokens ?? tokenUsage.inputTokens ?? currentTask.inputTokens ?? 0) || 0;
                            currentTask.outputTokens = Number(tokenUsage.output_tokens ?? tokenUsage.outputTokens ?? currentTask.outputTokens ?? 0) || 0;
                            currentTask.tokenUsage = Number(tokenUsage.total_tokens ?? tokenUsage.totalTokens ?? currentTask.tokenUsage ?? 0) || 0;
                        }
                        persistState();
                        render();
                        return;
                    }
                    if (eventName === 'done' && payload.task) {
                        persistStreamState({ immediate: true });
                        finalTaskFromStream = payload.task;
                        const storedApiKeyChanged = applyStoredApiKeyFromPayload(payload);
                        const localTask = state.tasks.find((item) => item.id === task.id || item.clientTaskId === task.id || item.clientTaskId === task.clientTaskId);
                        const wasCancelled = localTask?.status === 'cancelled';
                        const remoteTask = replaceTask(task.id, payload.task);
                        if (remoteTask) {
                            completeChatReasoning(remoteTask, remoteTask.generationCompletedAt || remoteTask.completedAt || Date.now());
                            if (!wasCancelled && remoteTask.status === 'succeeded') {
                                remoteTask.resultPrompt = payload.text || remoteTask.resultPrompt || receivedText;
                            }
                            persistState();
                            render();
                            if (isBusyTask(remoteTask)) scheduleRemoteRecordsPoll();
                            if (!wasCancelled && remoteTask.status !== 'cancelled') scrollChatStageToBottom();
                        } else if (storedApiKeyChanged) {
                            persistState();
                            render();
                            scrollChatStageToBottom();
                        }
                        return;
                    }
                    if (eventName === 'error') {
                        persistStreamState({ immediate: true });
                        const message = payload.message || '对话生成失败，请稍后重试';
                        if (payload.task) {
                            replaceTask(task.id, payload.task);
                        }
                        const streamError = new Error(message);
                        streamError.code = payload.code || '';
                        streamError.payload = payload;
                        throw streamError;
                    }
                }
            });
            if (finalTaskFromStream) {
                loadRemoteRecords({ force: true });
            }
        } catch (error) {
            console.warn('[AIImageWorkbench] Chat stream failed:', error?.message || error);
            await refreshPricingAfterChange(error);
            if (shouldRecoverChatStreamError(error)) {
                const recoveredTask = await recoverChatStreamTask(task);
                if (recoveredTask && recoveredTask.status !== 'failed') {
                    if (isBusyTask(recoveredTask)) scheduleRemoteRecordsPoll();
                    persistState();
                    render();
                    scrollChatStageToBottom();
                    return;
                }
            }
            const currentTask = state.tasks.find((item) => item.id === task.id || item.clientTaskId === task.id || item.clientTaskId === task.clientTaskId);
            if (currentTask) {
                currentTask.remoteError = getFriendlyTaskError(error?.message || error || '', '', currentTask.mode).slice(0, 240);
                if (currentTask.status !== 'cancelled') {
                    completeChatReasoning(currentTask, Date.now());
                    currentTask.status = 'failed';
                    currentTask.progress = 0;
                    currentTask.progressKnown = true;
                    currentTask.completedAt = Date.now();
                    currentTask.errorMessage = currentTask.remoteError;
                    currentTask.resultPrompt = currentTask.resultPrompt || currentTask.remoteError;
                }
                persistState();
                render();
                scrollChatStageToBottom();
            }
        } finally {
            const currentTask = state.tasks.find((item) => (
                item.id === task.id
                || item.clientTaskId === task.id
                || item.id === task.clientTaskId
                || item.clientTaskId === task.clientTaskId
            ));
            [task.id, task.clientTaskId, currentTask?.id, currentTask?.clientTaskId]
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .forEach((value) => activeChatStreamTaskIds.delete(value));
            if (shouldPollRemoteRecords()) scheduleRemoteRecordsPoll();
        }
    }

    async function submitWorkbenchTask() {
        const prompt = String(state.prompt || '').trim();
        const inferredMode = inferWorkbenchMode();
        const draftChatAttachments = inferredMode === 'chat'
            ? normalizeChatAttachmentList(state.chatAttachments)
            : [];
        let imageContext = getCurrentImageContext();
        const continuationSource = imageContext.sourceTask;
        const explicitContinuationTaskId = String(state.continuationImage?.taskId || '').trim();
        const fallbackContinuationTask = explicitContinuationTaskId
            ? state.tasks.find((item) => item.id === explicitContinuationTaskId)
            : null;
        const activeChatThreadRoot = inferredMode === 'chat' ? getActiveChatThreadRoot() : null;
        const shouldThreadFromCurrentImage = Boolean((continuationSource || fallbackContinuationTask || state.continuationImage) && inferredMode === 'image');
        const threadRoot = inferredMode === 'chat'
            ? activeChatThreadRoot
            : (shouldThreadFromCurrentImage ? getTaskThreadRoot(continuationSource || fallbackContinuationTask) : null);
        const chatParentTask = inferredMode === 'chat' ? getLastChatThreadTask(threadRoot) : null;
        state.mode = inferredMode;
        clearComposerError();
        if (!state.billingMode) {
            setSidebarView('billing');
            render();
            persistState();
            return;
        }
        if (state.billingMode === 'points' && !remoteConfigLoaded) {
            const loaded = await loadRemoteConfig();
            if (!loaded) {
                setComposerError('模型与价格配置加载失败，请刷新页面后重试。');
                render();
                return;
            }
        }
        if (state.billingMode === 'points' && !remoteConfigAvailable) {
            setComposerError('模型与价格配置暂不可用，请刷新页面后重试。');
            render();
            return;
        }
        if (state.billingMode === 'points' && inferredMode === 'reverse' && !getRuntimePointPricingRule(inferredMode)) {
            setComposerError('当前模型没有可用的反推价格配置，请切换模型后重试。');
            render();
            return;
        }
        if (state.billingMode === 'api' && !hasUsableApiKey()) {
            setSidebarView('billing');
            setComposerError('请先输入 Sub2API Key；保存后后续对话可留空使用。');
            render();
            const input = root.querySelector('[data-aiw-api-key]');
            input?.focus?.();
            input?.setAttribute('aria-invalid', 'true');
            setTimeout(() => input?.removeAttribute('aria-invalid'), 1200);
            return;
        }
        if (inferredMode !== 'reverse' && !prompt && !(inferredMode === 'chat' && draftChatAttachments.length)) {
            state.prompt = '';
            setComposerError('请输入提示词');
            render();
            const input = root.querySelector('[data-aiw-prompt]');
            if (input instanceof HTMLTextAreaElement && isMobileKeyboardDevice()) {
                openMobilePromptProxy(input);
            } else {
                input?.focus?.();
            }
            input?.setAttribute('aria-invalid', 'true');
            setTimeout(() => input?.removeAttribute('aria-invalid'), 1200);
            return;
        }

        if (state.billingMode !== 'api' && (inferredMode === 'image' || inferredMode === 'reverse') && !imageContext.image) {
            openHiddenFilePicker();
            return;
        }

        let extraReferenceImages = getExtraReferenceImages();
        const shouldResolveReferences = Boolean(
            inferredMode === 'image'
            || inferredMode === 'reverse'
            || (isVideoMode(inferredMode) && (imageContext.image || extraReferenceImages.length))
        );
        const canResolveContinuationOnServer = Boolean(
            imageContext.isContinuation
            && imageContext.image
            && isTransientImageUrl(imageContext.image)
            && (state.continuationImage?.resultId || imageContext.resultId || imageContext.sourceTask?.id || explicitContinuationTaskId)
        );
        const hasTransientReferences = Boolean(
            imageContext.image && isTransientImageUrl(imageContext.image) && !canResolveContinuationOnServer
            || extraReferenceImages.some((item) => isTransientImageUrl(item.image))
        );

        if (shouldResolveReferences && hasTransientReferences) {
            referenceUploadBusy = true;
            render();
            try {
                if (imageContext.image && isTransientImageUrl(imageContext.image)) {
                    const resolvedReference = await resolveSubmittableReferenceItem({
                        image: imageContext.image,
                        title: imageContext.title || '续作图片',
                        taskId: imageContext.sourceTask?.id || explicitContinuationTaskId,
                        resultId: state.continuationImage?.resultId || imageContext.resultId || '',
                        resultIndex: state.continuationImage?.resultIndex || imageContext.resultIndex || '',
                        role: imageContext.isContinuation ? 'base' : 'reference'
                    });
                    imageContext = {
                        ...imageContext,
                        image: resolvedReference.image,
                        title: resolvedReference.title || imageContext.title
                    };
                    if (imageContext.isContinuation) {
                        state.continuationImage = normalizeReferenceItem({
                            ...resolvedReference,
                            taskId: imageContext.sourceTask?.id || explicitContinuationTaskId,
                            resultId: state.continuationImage?.resultId || imageContext.resultId || resolvedReference.resultId || '',
                            resultIndex: state.continuationImage?.resultIndex || imageContext.resultIndex || resolvedReference.resultIndex || '',
                            role: 'base'
                        });
                    } else {
                        state.referenceImage = resolvedReference.image;
                        state.referenceTitle = resolvedReference.title || imageContext.title || '参考图片';
                        if (state.referenceIntent !== 'variation') state.referenceIntent = '';
                    }
                }
                extraReferenceImages = normalizeReferenceList((await Promise.all(extraReferenceImages.map(resolveSubmittableReferenceItem))).filter(Boolean));
                state.referenceImages = extraReferenceImages;
                persistState();
            } catch (error) {
                referenceUploadBusy = false;
                setComposerError(error?.message || '续作底图上传失败，请稍后重试');
                render();
                return;
            } finally {
                referenceUploadBusy = false;
                render();
            }
        }
        const estimatedCost = getCostEstimate(inferredMode);
        const chatThreadMessages = inferredMode === 'chat' ? getChatThreadMessages(threadRoot) : [];
        const submittedAt = Date.now();
        const taskId = getNowId('aiw');
        const activeModelValue = getActiveModelValue(inferredMode);
        const activeModelProviderId = normalizePricingProviderId(getActiveModelProviderId(inferredMode));
        const activeModelGroup = isTextVisionMode(inferredMode) ? 'chat' : (isVideoMode(inferredMode) ? 'video' : (state.billingMode === 'api' ? 'image' : ''));
        const activeTool = isVideoMode(state.mode) && getActiveModelOptions('video').length
            ? 'video'
            : (state.apiImageTool ? 'image' : 'chat');
        const task = {
            id: taskId,
            clientTaskId: '',
            parentTaskId: inferredMode === 'chat'
                ? (chatParentTask?.id || threadRoot?.id || '')
                : (threadRoot?.id || explicitContinuationTaskId || ''),
            mode: inferredMode,
            status: inferredMode === 'chat' ? 'streaming' : 'queued',
            progress: inferredMode === 'chat' ? 10 : (isVideoMode(inferredMode) ? 8 : 0),
            progressKnown: inferredMode === 'chat',
            prompt,
            referenceImage: imageContext.image,
            referenceTitle: imageContext.title,
            referenceTaskId: imageContext.sourceTask?.id || explicitContinuationTaskId || '',
            referenceResultId: state.continuationImage?.resultId || imageContext.resultId || '',
            referenceResultIndex: state.continuationImage?.resultIndex || imageContext.resultIndex || '',
            referenceImages: extraReferenceImages,
            ratio: getActiveRatio(inferredMode),
            resolution: getActiveResolution(inferredMode),
            videoDuration: isVideoMode(inferredMode) ? state.videoDuration : '',
            videoAudio: isVideoMode(inferredMode) ? state.videoAudio : '',
            videoWatermark: isVideoMode(inferredMode) ? state.videoWatermark : '',
            videoCameraFixed: isVideoMode(inferredMode) ? state.videoCameraFixed : '',
            model: activeModelValue,
            modelProviderId: activeModelProviderId,
            providerId: activeModelProviderId,
            billingMode: state.billingMode,
            apiBaseUrl: state.billingMode === 'api' ? normalizeApiBaseUrl(state.apiBaseUrl) : '',
            apiProvider: state.billingMode === 'api' ? (getApiBaseProfile()?.label || '') : '',
	            apiModelGroup: activeModelGroup,
            apiKeyTail: state.billingMode === 'api' ? getApiKeyTail() : '',
            tokenUsage: 0,
	            quantity: inferredMode === 'reverse' || isVideoMode(inferredMode) ? 1 : state.quantity,
            agent: '',
            cost: estimatedCost,
            estimatedPoints: estimatedCost,
            chargedPoints: 0,
            queuePosition: getBusyTasks().filter((item) => item.status === 'queued').length + 1,
            estimatedWaitSeconds: getBusyTasks().length ? estimateLocalQueueSeconds({
                mode: inferredMode,
                resolution: getActiveResolution(inferredMode),
	                quantity: inferredMode === 'reverse' || isVideoMode(inferredMode) ? 1 : state.quantity
            }) : 0,
            createdAt: submittedAt,
            startedAt: inferredMode === 'chat' ? submittedAt : 0,
            completedAt: 0,
            images: [],
            resultPrompt: '',
            reasoningText: '',
            reasoningStartedAt: 0,
            reasoningCompletedAt: 0,
            reasoningExpanded: false,
            source: 'local-preview',
            seen: false
        };
        task.clientTaskId = task.id;

        console.info('[AIImageWorkbench] Submit intent:', {
            inferredMode,
            stateMode: state.mode,
            billingMode: state.billingMode,
            model: activeModelValue,
            modelProviderId: activeModelProviderId,
            apiModelGroup: activeModelGroup,
            clientTaskId: task.clientTaskId,
            activeTool,
            promptLen: prompt.length,
            videoModelsCount: getActiveModelOptions('video').length,
            textModelsCount: getActiveModelOptions('chat').length,
            imageModelsCount: getActiveModelOptions('text').length,
            ratio: task.ratio,
            resolution: task.resolution
        });

        state.tasks.unshift(task);
        state.tasks = state.tasks.slice(0, MAX_LOCAL_TASKS);
        state.activeTaskId = threadRoot?.id || explicitContinuationTaskId || task.id;
        state.prompt = '';
        if (inferredMode === 'chat') {
            clearChatAttachments();
        }
        if (shouldThreadFromCurrentImage) {
            state.referenceImage = '';
            state.referenceTitle = '';
            state.referenceIntent = '';
            state.continuationImage = null;
        }
        render();
        if (inferredMode === 'chat') scrollChatStageToBottom({ force: true });
        persistState();
        if (inferredMode === 'chat') {
            submitChatStreamTask(task, threadRoot, chatThreadMessages, draftChatAttachments);
            return;
        }
        if (isImageGenerationMode(inferredMode)) {
            requestFastRemoteRecordsPoll();
        }
        scheduleRemoteRecordsPoll();
        submitRemoteTask(task);
    }

    function findTaskByIdOrActive(taskId = '') {
        const normalized = String(taskId || '').trim();
        if (normalized) {
            const direct = state.tasks.find((task) => task.id === normalized);
            if (direct) return direct;
        }
        const displayTask = getActiveDisplayTask();
        return displayTask && isBusyTask(displayTask) ? displayTask : getActiveTask();
    }

    async function cancelRemoteTask(task, clientTaskId = '') {
        if (!task?.id) return null;
        const fallbackClientTaskId = String(clientTaskId || task.clientTaskId || (String(task.id || '').startsWith('aiw_') ? task.id : '') || '').trim();
        return requestAiImage('cancel', {
            method: 'POST',
            body: {
                site: getRuntimeSite(),
                taskId: task.id,
                clientTaskId: fallbackClientTaskId
            },
            auth: true,
            allowTaskOnFailure: true
        });
    }

    function applyCancelResponse(taskId = '', payload = {}) {
        if (payload?.task) {
            const remoteTask = normalizeTask(payload.task);
            const isNotCancellable = payload.success === false && payload.code === 'task_not_cancellable';
            if (isNotCancellable) {
                const localTask = state.tasks.find((item) => (
                    item.id === taskId
                    || item.id === remoteTask.id
                    || item.clientTaskId === remoteTask.clientTaskId
                    || item.clientTaskId === taskId
                ));
                if (localTask) {
                    localTask.status = remoteTask.status || 'processing';
                    localTask.completedAt = 0;
                }
            }
            const nextTask = replaceTask(taskId || remoteTask.id, {
                ...remoteTask,
                ...(isNotCancellable ? { remoteError: CANNOT_CANCEL_CHARGED_MESSAGE } : {})
            });
            if (isNotCancellable) {
                setComposerError(CANNOT_CANCEL_CHARGED_MESSAGE);
            }
            return nextTask;
        }
        return null;
    }

    async function cancelTask(taskId = '') {
        const task = findTaskByIdOrActive(taskId);
        if (!task || !isBusyTask(task)) return;

        if (isTaskPastCancelableGenerationStage(task)) {
            task.remoteError = CANNOT_CANCEL_CHARGED_MESSAGE;
            setComposerError(CANNOT_CANCEL_CHARGED_MESSAGE);
            persistState();
            render();
            return;
        }

        task.status = 'cancelled';
        task.progress = clampNumber(task.progress, 0, 100, 0);
        task.completedAt = Date.now();
        completeChatReasoning(task, task.completedAt);
        task.resultPrompt = task.resultPrompt || '';
        task.metadata = {
            ...(task.metadata || {}),
            cancelled_by_user: true,
            cancelled_at: new Date(task.completedAt).toISOString()
        };
        task.remoteError = '';
        persistState();
        render();

        try {
            const payload = await cancelRemoteTask(task, task.clientTaskId || task.id);
            if (payload?.task) {
                applyCancelResponse(task.id, payload);
                persistState();
                render();
            }
        } catch (error) {
            const remoteTask = error?.payload?.task ? applyCancelResponse(task.id, error.payload) : null;
            const targetTask = remoteTask || task;
            targetTask.remoteError = getFriendlyTaskError(error?.message || error || '', '', targetTask.mode).slice(0, 240);
            if (error?.code === 'task_not_cancellable') setComposerError(CANNOT_CANCEL_CHARGED_MESSAGE);
            persistState();
            render();
        }
    }

    function resumeBusyTasks() {
        if (shouldPollRemoteRecords()) {
            scheduleRemoteRecordsPoll();
        }
    }

    function refreshBusyTasksNow() {
        if (!shouldPollRemoteRecords()) return;
        loadRemoteRecords({ force: true }).then(() => recoverBusyTasksByClientId()).finally(() => {
            if (shouldPollRemoteRecords()) {
                scheduleRemoteRecordsPoll();
            }
        });
    }

    function scheduleRemoteRecordsPoll() {
        const pendingOriginals = getPendingOriginalTasks();
        const shouldContinueOriginalPolling = pendingOriginals.some((task) => {
            const count = originalReadyPollCounts.get(task.id) || 0;
            return count < ORIGINAL_READY_POLL_LIMIT;
        });
        if (!getRemotePollBusyTasks().length && !shouldContinueOriginalPolling) return;
        const nextDelayMs = getRemoteRecordsPollDelayMs();
        const nextDueAt = Date.now() + nextDelayMs;
        if (remotePollTimer) {
            if (!remotePollDueAt || remotePollDueAt <= nextDueAt + 25) return;
            global.clearTimeout(remotePollTimer);
            remotePollTimer = null;
        }
        const scheduledDelayMs = getRemoteRecordsPollDelayMs({ consume: true });
        remotePollDueAt = Date.now() + scheduledDelayMs;
        pendingOriginals.forEach((task) => {
            originalReadyPollCounts.set(task.id, (originalReadyPollCounts.get(task.id) || 0) + 1);
        });
        remotePollTimer = global.setTimeout(async () => {
            remotePollTimer = null;
            remotePollDueAt = 0;
            const beforeBusyCount = getRemotePollBusyTasks().length;
            await loadRemoteRecords({
                force: true,
                includeUsage: shouldIncludeUsageForRemotePoll(scheduledDelayMs)
            });
            if (getRemotePollBusyTasks().length) {
                await recoverBusyTasksByClientId();
            }
            const afterBusyCount = getRemotePollBusyTasks().length;
            if (shouldPollRemoteRecords()) {
                scheduleRemoteRecordsPoll();
            } else if (beforeBusyCount > 0) {
                await loadRemoteRecords({ force: true });
                if (!state.open && getCompletedUnreadTasks().length) {
                    showDoneNotice();
                } else {
                    render();
                }
            }
        }, scheduledDelayMs);
    }

    function buildChatResponse(task) {
        const profile = task.apiProvider || getApiBaseProfile(task.apiBaseUrl)?.label || 'Sub2API';
        const model = runtimeApiTextModels.find((item) => item.id === task.model)?.label || task.model || 'API 模型';
        const prompt = truncateText(task.prompt || '你的创作指令', 120);
        return `已通过 ${profile} 的 ${model} 处理这段指令：“${prompt}”。系统会记录 Sub2API 返回的真实 token usage。`;
    }

    function buildReversePrompt(task) {
        if (task.mode !== 'reverse') return '';
        const name = task.referenceTitle || 'reference image';
        return `A polished commercial image inspired by ${name}, with clear subject separation, cinematic natural light, rich material detail, balanced composition, refined color grading, realistic texture, and an editorial visual style suitable for an AI prompt gallery.`;
    }

    function showDoneNotice() {
        renderDock();
    }

    function getRenderContinuitySnapshot() {
        const stage = overlay?.querySelector?.('.ai-image-stage');
        const stageScrollState = stage ? updateChatStageScrollState(stage) : null;
        const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
        const prompt = activeElement instanceof HTMLTextAreaElement && activeElement.matches('[data-aiw-prompt]')
            ? activeElement
            : null;
        return {
            stage: stage ? {
                scrollTop: Number(stage.scrollTop || 0),
                scrollLeft: Number(stage.scrollLeft || 0),
                wasNearBottom: Boolean(stageScrollState?.nearBottom)
            } : null,
            prompt: prompt ? {
                focused: true,
                value: prompt.value,
                selectionStart: Number(prompt.selectionStart ?? prompt.value.length),
                selectionEnd: Number(prompt.selectionEnd ?? prompt.value.length),
                selectionDirection: prompt.selectionDirection || 'none'
            } : null
        };
    }

    function restoreRenderContinuity(snapshot = null, { preserveStageScroll = true, preservePromptFocus = true } = {}) {
        if (!snapshot) return;
        if (preserveStageScroll && snapshot.stage) {
            const restoreStage = () => {
                const nextStage = overlay?.querySelector?.('.ai-image-stage');
                if (!nextStage) return;
                nextStage.scrollTop = snapshot.stage.scrollTop;
                nextStage.scrollLeft = snapshot.stage.scrollLeft;
            };
            restoreStage();
            window.requestAnimationFrame(restoreStage);
        }
        if (preservePromptFocus && snapshot.prompt?.focused) {
            const restorePrompt = () => {
                const nextPrompt = root?.querySelector?.('[data-aiw-prompt]');
                if (!(nextPrompt instanceof HTMLTextAreaElement)) return;
                if (String(nextPrompt.value || '') !== String(snapshot.prompt.value || '')) return;
                nextPrompt.focus({ preventScroll: true });
                const max = nextPrompt.value.length;
                const start = Math.min(Math.max(0, snapshot.prompt.selectionStart), max);
                const end = Math.min(Math.max(start, snapshot.prompt.selectionEnd), max);
                nextPrompt.setSelectionRange(start, end, snapshot.prompt.selectionDirection || 'none');
            };
            restorePrompt();
            window.requestAnimationFrame(restorePrompt);
        }
    }

    function render({ preserveStageScroll = true, preservePromptFocus = true, forceChatBottom = false } = {}) {
        if (!root) return;
        const continuitySnapshot = getRenderContinuitySnapshot();
        const reusableImages = collectReusableRenderedImages();
        const reusableVideos = collectReusableRenderedVideos();
        renderDock();
        renderOverlay();
        syncChatStageScrollListener();
        syncNavigationWheelListeners();
        restoreReusableRenderedImages(reusableImages);
        restoreReusableRenderedVideos(reusableVideos);
        syncRenderedImageLoadStates();
        syncRenderedVideoLoadStates();
        syncMainPromptHeight();
        syncMobileComposerMenuAnchor();
        syncRenderedProgressBars();
        syncChatNavigationRail();
        syncLiveElapsedLabels();
        syncLiveElapsedTimer();
        syncDeferredImageLoading();
        injectPromptModalActions();
        restoreRenderContinuity(continuitySnapshot, { preserveStageScroll, preservePromptFocus });
        if (shouldKeepChatStagePinnedToBottom(continuitySnapshot, { force: forceChatBottom })) {
            scrollChatStageToBottom({ force: forceChatBottom, wasNearBottom: Boolean(continuitySnapshot?.stage?.wasNearBottom) });
        }
    }

    function syncOverlayOpenState() {
        if (!overlay) return;
        overlay.classList.toggle('is-open', state.open);
        overlay.setAttribute('aria-hidden', state.open ? 'false' : 'true');
    }

    function getRenderedImageReuseKey(image) {
        if (!(image instanceof HTMLImageElement)) return '';
        const imageHost = image.closest?.('[data-aiw-image-key]');
        const identityKey = imageHost?.getAttribute?.('data-aiw-image-key') || '';
        if (identityKey) return identityKey;
        return getImageLoadKey(image.currentSrc || image.src || '');
    }

    function getRenderedVideoSrc(video) {
        if (!(video instanceof HTMLVideoElement)) return '';
        return video.currentSrc || video.src || video.getAttribute('src') || '';
    }

    function getRenderedVideoReuseKey(video) {
        if (!(video instanceof HTMLVideoElement)) return '';
        const mediaHost = video.closest?.('[data-aiw-image-key]');
        const identityKey = mediaHost?.getAttribute?.('data-aiw-image-key') || '';
        if (identityKey) return identityKey;
        return getImageLoadKey(getRenderedVideoSrc(video));
    }

    function collectReusableRenderedImages() {
        const reusableImages = new Map();
        if (!root?.querySelectorAll) return reusableImages;
        root.querySelectorAll('.ai-image-task-thumb img, .ai-image-result-media img').forEach((image) => {
            if (!(image instanceof HTMLImageElement)) return;
            if (!image.complete || image.naturalWidth <= 0) return;
            const key = getRenderedImageReuseKey(image);
            if (!key || reusableImages.has(key)) return;
            rememberImageLoaded(image.currentSrc || image.src || '');
            rememberStableImageUrl(key, image.currentSrc || image.src || '');
            reusableImages.set(key, image);
        });
        return reusableImages;
    }

    function restoreReusableRenderedImages(reusableImages) {
        if (!reusableImages?.size || !root?.querySelectorAll) return;
        root.querySelectorAll('.ai-image-task-thumb img, .ai-image-result-media img').forEach((image) => {
            if (!(image instanceof HTMLImageElement)) return;
            const key = getRenderedImageReuseKey(image);
            const reusableImage = key ? reusableImages.get(key) : null;
            if (!reusableImage || reusableImage === image) return;
            const imageSrc = reusableImage.currentSrc || reusableImage.src || '';
            if (!imageSrc) return;
            reusableImage.alt = image.alt;
            reusableImage.loading = image.loading;
            reusableImage.decoding = image.decoding;
            image.replaceWith(reusableImage);
            rememberImageLoaded(imageSrc);
            rememberStableImageUrl(key, imageSrc);
            reusableImages.delete(key);
        });
    }

    function collectReusableRenderedVideos() {
        const reusableVideos = new Map();
        if (!root?.querySelectorAll) return reusableVideos;
        root.querySelectorAll('.ai-image-result-media video').forEach((video) => {
            if (!(video instanceof HTMLVideoElement)) return;
            const videoSrc = getRenderedVideoSrc(video);
            if (!videoSrc || video.error) return;
            updateVideoLoadingProgress(video);
            if (video.readyState < 2 && !hasLoadedVideo(videoSrc)) return;
            const key = getRenderedVideoReuseKey(video);
            if (!key || reusableVideos.has(key)) return;
            rememberVideoLoaded(videoSrc);
            reusableVideos.set(key, video);
        });
        return reusableVideos;
    }

    function restoreReusableRenderedVideos(reusableVideos) {
        if (!reusableVideos?.size || !root?.querySelectorAll) return;
        root.querySelectorAll('.ai-image-result-media video').forEach((video) => {
            if (!(video instanceof HTMLVideoElement)) return;
            const key = getRenderedVideoReuseKey(video);
            const reusableVideo = key ? reusableVideos.get(key) : null;
            if (!reusableVideo || reusableVideo === video) return;
            const reusableSrc = getRenderedVideoSrc(reusableVideo);
            const nextSrc = getRenderedVideoSrc(video);
            if (!reusableSrc || (nextSrc && getImageLoadKey(reusableSrc) !== getImageLoadKey(nextSrc))) return;
            reusableVideo.controls = video.controls;
            reusableVideo.preload = video.preload;
            reusableVideo.playsInline = video.playsInline;
            reusableVideo.removeAttribute('aria-hidden');
            video.replaceWith(reusableVideo);
            rememberVideoLoaded(reusableSrc);
            const media = reusableVideo.closest?.('.ai-image-result-media');
            media?.classList.add('is-video-ready', 'is-image-loaded');
            media?.classList.remove('is-video-loading', 'is-video-broken', 'is-image-broken');
            reusableVideos.delete(key);
        });
    }

    function renderPreservingStageScroll() {
        render({ preserveStageScroll: true, preservePromptFocus: true });
    }

    function isComposerLocalSelectField(field = '') {
        return ['model', 'apiModel', 'imageSettings', 'videoSettings', 'chatSettings'].includes(field);
    }

    function shouldCloseSelectFromComposer(field = '') {
        return isComposerLocalSelectField(field)
            && Boolean(overlay?.querySelector?.(`.ai-image-main-composer [data-aiw-select="${field}"], .ai-image-main-composer [data-aiw-${field === 'imageSettings' ? 'image' : field === 'videoSettings' ? 'video' : 'chat'}-settings]`));
    }

    function shouldCloseMobileSidebarFromBlankClick(target) {
        if (!sidebarView) return false;
        if (!isMobileWorkbenchViewport()) return false;
        if (!(target instanceof Element)) return false;
        if (target.closest('.ai-image-history-rail, .ai-image-history-expanded, [data-aiw-action], [data-aiw-task-id], input, button, a, textarea, select')) return false;
        if (target.closest('.ai-image-main-composer')) return false;
        return true;
    }

    function getActiveModelProviderId(mode = inferWorkbenchMode()) {
        const groups = getRuntimeModelGroups(mode);
        const selected = getActiveModelValue(mode);
        const selectedGroup = groups.find((group) => group.models.some((model) => model.id === selected));
        const selectedModel = selectedGroup?.models?.find((model) => model.id === selected);
        return selectedModel?.providerId
            || selectedGroup?.providerId
            || groups[0]?.models?.[0]?.providerId
            || groups[0]?.providerId
            || '';
    }

    function renderMainComposerOnly() {
        const composer = overlay?.querySelector?.('.ai-image-main-composer');
        if (!composer) {
            renderPreservingStageScroll();
            return;
        }
        const continuitySnapshot = getRenderContinuitySnapshot();
        const replacement = document.createElement('div');
        replacement.innerHTML = renderMainComposer().trim();
        const nextComposer = replacement.firstElementChild;
        if (!nextComposer) return;
        composer.replaceWith(nextComposer);
        syncMainPromptHeight();
        syncMobileComposerMenuAnchor();
        syncLiveElapsedLabels();
        syncLiveElapsedTimer();
        restoreRenderContinuity(continuitySnapshot, {
            preserveStageScroll: true,
            preservePromptFocus: true
        });
    }

    function scrollChatStageToBottom({ force = false, wasNearBottom = null } = {}) {
        const stage = overlay?.querySelector?.('.ai-image-stage');
        if (!stage) return;
        const shouldScroll = force || (typeof wasNearBottom === 'boolean' ? wasNearBottom : isChatStageNearBottom(stage));
        if (!shouldScroll) return;
        if (chatStagePinFrame) return;
        const pinToBottom = () => {
            chatStagePinFrame = 0;
            const nextStage = overlay?.querySelector?.('.ai-image-stage');
            if (!nextStage) return;
            nextStage.scrollTop = Math.max(0, nextStage.scrollHeight - nextStage.clientHeight);
            updateChatStageScrollState(nextStage);
        };
        if (typeof global.requestAnimationFrame === 'function') {
            chatStagePinFrame = global.requestAnimationFrame(pinToBottom);
        } else {
            chatStagePinFrame = global.setTimeout?.(pinToBottom, 16) || 0;
        }
    }

    function syncRenderedImageLoadStates() {
        if (!root?.querySelectorAll) return;
        root.querySelectorAll('.ai-image-task-thumb img, .ai-image-result-media img').forEach((image) => {
            if (!(image instanceof HTMLImageElement)) return;
            const imageSrc = image.currentSrc || image.src || '';
            const loaded = image.complete && image.naturalWidth > 0;
            const taskThumb = image.closest('.ai-image-task-thumb');
            const media = image.closest('.ai-image-result-media');
            const identityKey = getRenderedImageReuseKey(image);
            if (loaded) {
                rememberImageLoaded(imageSrc);
                rememberStableImageUrl(identityKey, imageSrc);
                taskThumb?.classList.add('is-image-loaded');
                taskThumb?.classList.remove('is-image-loading', 'is-image-broken');
                media?.classList.add('is-image-loaded');
                media?.classList.remove('is-image-loading', 'is-image-broken');
            } else if (hasFailedImage(imageSrc)) {
                taskThumb?.classList.add('is-image-loading');
                taskThumb?.classList.remove('is-image-broken');
                media?.classList.add('is-image-loading');
                media?.classList.remove('is-image-broken');
            } else {
                if (hasLoadedImage(imageSrc)) {
                    taskThumb?.classList.add('is-image-loaded');
                    media?.classList.add('is-image-loaded');
                }
            }
        });
    }

    function syncRenderedVideoLoadStates() {
        if (!root?.querySelectorAll) return;
        root.querySelectorAll('.ai-image-result-media video').forEach((video) => {
            if (!(video instanceof HTMLVideoElement)) return;
            const videoSrc = getRenderedVideoSrc(video);
            const media = video.closest('.ai-image-result-media');
            updateVideoLoadingProgress(video);
            const loaded = video.readyState >= 2;
            const awaitingReady = isMediaAwaitingVideoReady(media);
            if (loaded) {
                rememberVideoLoaded(videoSrc);
                updateVideoLoadingProgress(video, { forceComplete: true });
                media?.classList.add('is-video-ready', 'is-image-loaded');
                media?.classList.remove('is-video-loading', 'is-video-broken', 'is-image-broken');
            } else if (hasFailedVideo(videoSrc) && !awaitingReady) {
                media?.classList.add('is-video-broken');
                media?.classList.remove('is-video-loading', 'is-video-ready', 'is-image-broken', 'is-image-loaded');
            } else if (hasLoadedVideo(videoSrc)) {
                media?.classList.add('is-video-ready', 'is-image-loaded');
                media?.classList.remove('is-video-loading', 'is-video-broken', 'is-image-broken');
            } else {
                media?.classList.add('is-video-loading');
                media?.classList.remove('is-video-ready', 'is-video-broken', 'is-image-broken', 'is-image-loaded');
                ensureVideoPreviewLoading(video);
            }
        });
    }

    function syncLiveElapsedLabels() {
        if (!root?.querySelectorAll) return;
        root.querySelectorAll('[data-aiw-live-status-task-id]').forEach((element) => {
            const taskId = String(element.getAttribute('data-aiw-live-status-task-id') || '').trim();
            const kind = String(element.getAttribute('data-aiw-live-status-kind') || '').trim();
            const slotSequence = Number(element.getAttribute('data-aiw-live-status-slot') || '');
            const fixedStepLabel = String(element.getAttribute('data-aiw-live-status-step-label') || '').trim();
            const task = state.tasks.find((item) => item.id === taskId);
            if (!task) return;
            let nextText = '';
            if (kind === 'badge') {
                nextText = getTaskProgressBadge(task);
            } else if (kind === 'generation') {
                nextText = getTaskGenerationLabel(task);
            } else if (kind === 'step') {
                nextText = fixedStepLabel || getTaskCurrentStepLabel(task);
            } else if (kind === 'image') {
                nextText = Number.isFinite(slotSequence) && slotSequence > 0
                    ? getTaskSlotImageLabel(task, slotSequence)
                    : getTaskCurrentImageLabel(task);
            } else if (kind === 'elapsed') {
                nextText = getTaskElapsedLabel(task);
            } else if (kind === 'detail') {
                nextText = getTaskProgressDetail(task);
            } else if (kind === 'composer') {
                nextText = task.mode === 'chat' ? getComposerBusyLabel(task) : getStatusLabel(task);
            }
            if (nextText && element.textContent !== nextText) {
                element.textContent = nextText;
            }
        });
    }

    function syncLiveElapsedTimer() {
        const shouldRun = getBusyTasks().length > 0 && Boolean(root?.querySelector?.('[data-aiw-live-status-task-id]'));
        if (!shouldRun) {
            if (liveElapsedTimer) {
                global.clearInterval(liveElapsedTimer);
                liveElapsedTimer = null;
            }
            return;
        }
        if (liveElapsedTimer) return;
        liveElapsedTimer = global.setInterval(() => {
            if (!getBusyTasks().length || !root?.querySelector?.('[data-aiw-live-status-task-id]')) {
                syncLiveElapsedTimer();
                return;
            }
            syncLiveElapsedLabels();
            syncLiveElapsedTimer();
        }, 1000);
    }

    function syncMobileComposerMenuAnchor() {
        const shell = overlay?.querySelector?.('.ai-image-shell');
        const composer = overlay?.querySelector?.('.ai-image-main-composer');
        if (!shell || !composer) return;
        if (!isMobileWorkbenchViewport() || !state.open) {
            shell.style.removeProperty('--aiw-mobile-composer-top');
            shell.style.removeProperty('--aiw-mobile-history-panel-max-height');
            if (!isMobileWorkbenchViewport()) mobileWorkbenchStaticHeight = 0;
            return;
        }

        if (mobilePromptProxyState !== 'closed') return;
        const measuredHeight = getMobileWorkbenchLayoutHeight();
        if (!mobileWorkbenchStaticHeight && measuredHeight > 0) {
            mobileWorkbenchStaticHeight = measuredHeight;
        }
        const layoutHeight = Math.max(320, mobileWorkbenchStaticHeight || measuredHeight || 0);
        root?.style?.setProperty('--aiw-mobile-layout-height', `${layoutHeight}px`);

        const shellRect = shell.getBoundingClientRect?.();
        const composerRect = composer.getBoundingClientRect?.();
        if (!shellRect || !composerRect) return;
        const composerTop = Math.max(12, Math.round(composerRect.top - shellRect.top));
        const historyPanelMaxHeight = Math.max(60, composerTop - MOBILE_HISTORY_PANEL_COMPOSER_GAP_PX);
        root?.style?.setProperty('--aiw-mobile-composer-top', `${composerTop}px`);
        shell.style.setProperty('--aiw-mobile-composer-top', `${composerTop}px`);
        root?.style?.setProperty('--aiw-mobile-history-panel-max-height', `${historyPanelMaxHeight}px`);
        shell.style.setProperty('--aiw-mobile-history-panel-max-height', `${historyPanelMaxHeight}px`);
    }

    function syncRenderedProgressBars() {
        root?.querySelectorAll?.('.ai-image-progress[data-progress]')?.forEach((bar) => {
            const renderedProgress = clampNumber(bar.getAttribute('data-progress'), 0, 100, 0) / 100;
            const key = String(bar.getAttribute('data-progress-key') || '').trim();
            const fill = bar.querySelector('span');
            if (!fill) return;
            const cachedProgress = key ? progressVisualCache.get(key) : null;
            const progress = Number.isFinite(cachedProgress)
                ? Math.max(renderedProgress, cachedProgress)
                : renderedProgress;
            if (progress > renderedProgress) {
                bar.style.setProperty('--aiw-progress', progress);
                bar.setAttribute('data-progress', String(Math.round(progress * 100)));
            }
            const previous = Number.isFinite(cachedProgress)
                ? cachedProgress
                : (clampNumber(bar.getAttribute('data-previous-progress'), 0, 100, Math.max(0, progress * 100 - 6)) / 100);
            fill.style.transition = 'none';
            fill.style.transform = `scaleX(${Math.min(progress, previous)})`;
            window.requestAnimationFrame(() => {
                fill.style.transition = '';
                fill.style.transform = '';
            });
            if (key) progressVisualCache.set(key, progress);
            bar.setAttribute('data-previous-progress', String(Math.round(progress * 100)));
        });
    }

    function disconnectChatNavigationRail() {
        if (chatNavigationObserver) {
            chatNavigationObserver.disconnect();
            chatNavigationObserver = null;
        }
        if (chatNavigationResizeObserver) {
            chatNavigationResizeObserver.disconnect();
            chatNavigationResizeObserver = null;
        }
        if (chatNavigationScrollTarget) {
            chatNavigationScrollTarget.removeEventListener('scroll', scheduleChatNavigationPosition);
            chatNavigationScrollTarget = null;
        }
        if (chatNavigationPositionFrame) {
            window.cancelAnimationFrame(chatNavigationPositionFrame);
            chatNavigationPositionFrame = 0;
        }
        hideChatNavigationPreview();
    }

    function setActiveChatNavigationItem(taskId = '') {
        const normalizedTaskId = String(taskId || '').trim();
        root?.querySelectorAll?.('[data-aiw-chat-nav-id]')?.forEach((button) => {
            const active = Boolean(normalizedTaskId && button.getAttribute('data-aiw-chat-nav-id') === normalizedTaskId);
            button.classList.toggle('is-active', active);
            if (active) {
                button.setAttribute('aria-current', 'true');
            } else {
                button.removeAttribute('aria-current');
            }
        });
    }

    function scheduleChatNavigationPosition() {
        if (chatNavigationPositionFrame) return;
        chatNavigationPositionFrame = window.requestAnimationFrame(() => {
            chatNavigationPositionFrame = 0;
            positionChatNavigationRail();
            const activePreviewButton = overlay?.querySelector?.('[data-aiw-chat-nav-id].is-previewing');
            if (activePreviewButton) positionChatNavigationPreview(activePreviewButton);
        });
    }

    function ensureChatNavigationResizeListener() {
        if (chatNavigationResizeBound) return;
        chatNavigationResizeBound = true;
        window.addEventListener('resize', scheduleChatNavigationPosition, { passive: true });
    }

    function observeChatNavigationLayout() {
        if (typeof ResizeObserver === 'undefined') return;
        if (chatNavigationResizeObserver) {
            chatNavigationResizeObserver.disconnect();
        }
        chatNavigationResizeObserver = new ResizeObserver(scheduleChatNavigationPosition);
        [
            overlay?.querySelector?.('.ai-image-shell'),
            overlay?.querySelector?.('.ai-image-stage'),
            overlay?.querySelector?.('.ai-image-history-sidebar'),
            overlay?.querySelector?.('.ai-image-result-view')
        ].filter(Boolean).forEach((node) => chatNavigationResizeObserver.observe(node));
    }

    function positionChatNavigationRail() {
        const shell = overlay?.querySelector?.('.ai-image-shell');
        const stage = overlay?.querySelector?.('.ai-image-stage');
        const canvas = overlay?.querySelector?.('.ai-image-canvas');
        const chatView = overlay?.querySelector?.('.ai-image-result-view');
        const rail = overlay?.querySelector?.('[data-aiw-chat-nav-rail]');
        if (!shell || !stage || !canvas || !chatView || !rail) return false;
        if (window.getComputedStyle?.(rail)?.display === 'none') {
            shell.style.setProperty('--aiw-chat-nav-avoid-left', '0px');
            shell.style.removeProperty('--aiw-chat-nav-composer-width');
            shell.style.removeProperty('--aiw-chat-nav-composer-margin-left');
            rail.classList.toggle('is-floating-ready', false);
            return false;
        }
        if (isMobileWorkbenchViewport()) {
            shell.style.setProperty('--aiw-chat-nav-avoid-left', '0px');
            shell.style.removeProperty('--aiw-chat-nav-composer-width');
            shell.style.removeProperty('--aiw-chat-nav-composer-margin-left');
            rail.style.removeProperty('--aiw-chat-nav-left');
            rail.style.removeProperty('--aiw-chat-nav-top');
            rail.style.removeProperty('--aiw-chat-nav-max-height');
            rail.classList.toggle('is-floating-ready', true);
            return true;
        }

        const shellRect = shell.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const chatRect = chatView.getBoundingClientRect();
        const sidebarRect = overlay?.querySelector?.('.ai-image-history-sidebar')?.getBoundingClientRect?.();
        const railWidth = 64;
        const sidebarRight = sidebarRect ? Math.max(0, sidebarRect.right - shellRect.left) : 0;
        const chatLeft = chatRect.left - shellRect.left;
        const railLeftOffset = 4;
        const gapStart = sidebarRight + railLeftOffset;
        const gapEnd = chatLeft - railWidth - 20;
        const fallbackLeft = Math.max(sidebarRight + railLeftOffset, chatLeft - railWidth - 116);
        const left = gapEnd >= gapStart ? gapStart : fallbackLeft;
        const avoidOffset = Math.max(0, Math.ceil(left + railWidth + 18 - chatLeft));
        const viewportTop = stageRect.top + stageRect.height / 2;
        const top = Math.max(76, viewportTop - shellRect.top);
        const maxHeight = Math.max(180, Math.min(stageRect.height - 144, 560));
        const composerSideBleed = 30;
        const visibleChatLeft = chatRect.left + avoidOffset;
        const visibleChatRight = chatRect.right;
        const composerLeft = Math.max(canvasRect.left, visibleChatLeft - composerSideBleed);
        const composerRight = Math.min(canvasRect.right, visibleChatRight + composerSideBleed);
        const composerWidth = Math.max(0, composerRight - composerLeft);
        const composerMarginLeft = Math.max(0, composerLeft - canvasRect.left);

        rail.style.setProperty('--aiw-chat-nav-left', `${Math.round(left)}px`);
        rail.style.setProperty('--aiw-chat-nav-top', `${Math.round(top)}px`);
        rail.style.setProperty('--aiw-chat-nav-max-height', `${Math.round(maxHeight)}px`);
        shell.style.setProperty('--aiw-chat-nav-avoid-left', `${avoidOffset}px`);
        shell.style.setProperty('--aiw-chat-nav-composer-width', `${Math.round(composerWidth)}px`);
        shell.style.setProperty('--aiw-chat-nav-composer-margin-left', `${Math.round(composerMarginLeft)}px`);
        rail.classList.toggle('is-floating-ready', true);
        return true;
    }

    function positionChatNavigationPreview(button) {
        const shell = overlay?.querySelector?.('.ai-image-shell');
        const rail = overlay?.querySelector?.('[data-aiw-chat-nav-rail]');
        const preview = overlay?.querySelector?.('[data-aiw-chat-nav-preview]');
        if (!shell || !rail || !preview || !button) return false;

        const shellRect = shell.getBoundingClientRect();
        const railRect = rail.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const previewWidth = Math.min(360, Math.max(240, shellRect.width - 180));
        const left = Math.min(shellRect.width - previewWidth - 18, Math.max(72, railRect.right - shellRect.left + 16));
        const top = Math.min(shellRect.height - 104, Math.max(70, buttonRect.top + buttonRect.height / 2 - shellRect.top));

        preview.style.setProperty('--aiw-chat-nav-preview-left', `${Math.round(left)}px`);
        preview.style.setProperty('--aiw-chat-nav-preview-top', `${Math.round(top)}px`);
        preview.style.setProperty('--aiw-chat-nav-preview-width', `${Math.round(previewWidth)}px`);
        return true;
    }

    function syncChatNavigationProximity(button = null) {
        const navItems = Array.from(overlay?.querySelectorAll?.('[data-aiw-chat-nav-id]') || []);
        const rail = overlay?.querySelector?.('[data-aiw-chat-nav-rail]');
        const activeIndex = button ? navItems.indexOf(button) : -1;
        rail?.classList.toggle('is-previewing-rail', activeIndex >= 0);
        navItems.forEach((item, index) => {
            item.classList.remove('is-previewing', 'is-near-1', 'is-near-2', 'is-near-3');
            if (activeIndex < 0) return;
            const distance = Math.abs(index - activeIndex);
            if (distance === 0) {
                item.classList.add('is-previewing');
            } else if (distance <= 3) {
                item.classList.add(`is-near-${distance}`);
            }
        });
    }

    function showChatNavigationPreview(button) {
        const preview = overlay?.querySelector?.('[data-aiw-chat-nav-preview]');
        if (!preview || !button) return;
        const title = button.getAttribute('data-aiw-chat-nav-title') || '';
        const summary = button.getAttribute('data-aiw-chat-nav-summary') || '';
        const meta = button.getAttribute('data-aiw-chat-nav-meta') || '';
        preview.querySelector('[data-aiw-chat-nav-preview-title]').textContent = title;
        const summaryNode = preview.querySelector('[data-aiw-chat-nav-preview-summary]');
        summaryNode.textContent = summary;
        summaryNode.hidden = !summary;
        preview.querySelector('[data-aiw-chat-nav-preview-meta]').textContent = meta;
        syncChatNavigationProximity(button);
        positionChatNavigationPreview(button);
        preview.hidden = false;
        preview.classList.add('is-visible');
    }

    function hideChatNavigationPreview() {
        const preview = overlay?.querySelector?.('[data-aiw-chat-nav-preview]');
        syncChatNavigationProximity(null);
        if (!preview) return;
        preview.classList.remove('is-visible');
        preview.hidden = true;
    }

    function syncChatNavigationRail() {
        disconnectChatNavigationRail();
        const stage = overlay?.querySelector?.('.ai-image-stage');
        const rail = overlay?.querySelector?.('[data-aiw-chat-nav-rail]');
        const turnNodes = Array.from(overlay?.querySelectorAll?.('[data-aiw-chat-turn-id]') || []);
        if (!stage || !rail || !turnNodes.length) return;
        ensureChatNavigationResizeListener();
        positionChatNavigationRail();
        observeChatNavigationLayout();

        const visibleIds = new Set();
        const orderedIds = turnNodes
            .map((node) => String(node.getAttribute('data-aiw-chat-turn-id') || '').trim())
            .filter(Boolean);
        const updateActive = () => {
            const firstVisibleId = orderedIds.find((id) => visibleIds.has(id));
            setActiveChatNavigationItem(firstVisibleId || orderedIds[orderedIds.length - 1] || '');
        };

        if (typeof IntersectionObserver === 'undefined') {
            setActiveChatNavigationItem(orderedIds[orderedIds.length - 1] || '');
            return;
        }

        chatNavigationObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const id = String(entry.target.getAttribute('data-aiw-chat-turn-id') || '').trim();
                if (!id) return;
                if (entry.isIntersecting) {
                    visibleIds.add(id);
                } else {
                    visibleIds.delete(id);
                }
            });
            updateActive();
        }, {
            root: stage,
            rootMargin: '-16px 0px -42% 0px',
            threshold: [0, 0.08, 0.24]
        });

        turnNodes.forEach((node) => chatNavigationObserver.observe(node));
        window.requestAnimationFrame(updateActive);
    }

    function scrollToChatTurn(taskId = '', { behavior = 'smooth' } = {}) {
        const normalizedTaskId = String(taskId || '').trim();
        if (!normalizedTaskId) return false;
        const escapedId = global.CSS?.escape
            ? global.CSS.escape(normalizedTaskId)
            : normalizedTaskId.replace(/"/g, '\\"');
        const target = overlay?.querySelector?.(`[data-aiw-chat-turn-id="${escapedId}"]`);
        if (!target) return false;
        const stage = overlay?.querySelector?.('.ai-image-stage');
        if (stage?.scrollTo && target.getBoundingClientRect && stage.getBoundingClientRect) {
            const stageRect = stage.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const mobileOffset = isMobileWorkbenchViewport() ? 88 : 12;
            const nextTop = stage.scrollTop + targetRect.top - stageRect.top - mobileOffset;
            const maxTop = Math.max(0, Number(stage.scrollHeight || 0) - Number(stage.clientHeight || 0));
            stage.scrollTo({ top: Math.min(maxTop, Math.max(0, nextTop)), behavior });
        } else {
            target.scrollIntoView?.({ behavior, block: 'start', inline: 'nearest' });
        }
        target.classList.remove('is-located');
        void target.offsetWidth;
        target.classList.add('is-located');
        setActiveChatNavigationItem(normalizedTaskId);
        return true;
    }

    function setActiveHistoryLocatorItem(taskId = '') {
        const normalizedTaskId = String(taskId || '').trim();
        root?.querySelectorAll?.('[data-aiw-history-nav-id]')?.forEach((button) => {
            const active = Boolean(normalizedTaskId && button.getAttribute('data-aiw-history-nav-id') === normalizedTaskId);
            button.classList.toggle('is-active', active);
        });
    }

    function showHistoryLocatorPreview(button) {
        const locator = button?.closest?.('[data-aiw-history-locator]');
        const preview = locator?.querySelector?.('[data-aiw-history-locator-preview]');
        if (!preview) return;
        const title = button.getAttribute('data-aiw-history-nav-title') || '';
        const meta = button.getAttribute('data-aiw-history-nav-meta') || '';
        const titleNode = preview.querySelector('[data-aiw-history-locator-title]');
        const metaNode = preview.querySelector('[data-aiw-history-locator-meta]');
        if (titleNode) titleNode.textContent = title;
        if (metaNode) metaNode.textContent = meta;
        locator.querySelectorAll('[data-aiw-history-nav-id]').forEach((item) => {
            item.classList.toggle('is-previewing', item === button);
        });
        preview.setAttribute('aria-hidden', 'false');
        preview.classList.add('is-visible');
    }

    function hideHistoryLocatorPreview() {
        const locator = overlay?.querySelector?.('[data-aiw-history-locator]');
        const preview = locator?.querySelector?.('[data-aiw-history-locator-preview]');
        locator?.querySelectorAll?.('[data-aiw-history-nav-id]')?.forEach((item) => item.classList.remove('is-previewing'));
        if (!preview) return;
        preview.classList.remove('is-visible');
        preview.setAttribute('aria-hidden', 'true');
    }

    function scrollToHistoryRow(taskId = '') {
        const normalizedTaskId = String(taskId || '').trim();
        if (!normalizedTaskId) return false;
        const escapedId = global.CSS?.escape
            ? global.CSS.escape(normalizedTaskId)
            : normalizedTaskId.replace(/"/g, '\\"');
        const target = overlay?.querySelector?.(`.ai-image-history [data-aiw-task-id="${escapedId}"]`);
        if (!target) return false;
        const scroller = target.closest?.('.ai-image-history-scroll');
        if (scroller?.scrollTo && target.getBoundingClientRect && scroller.getBoundingClientRect) {
            const scrollerRect = scroller.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const nextTop = scroller.scrollTop + targetRect.top - scrollerRect.top - 152;
            const maxTop = Math.max(0, Number(scroller.scrollHeight || 0) - Number(scroller.clientHeight || 0));
            scroller.scrollTo({ top: Math.min(maxTop, Math.max(0, nextTop)), behavior: 'smooth' });
        } else {
            target.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }
        target.classList.remove('is-located');
        void target.offsetWidth;
        target.classList.add('is-located');
        global.setTimeout?.(() => target.classList.remove('is-located'), 1300);
        setActiveHistoryLocatorItem(normalizedTaskId);
        return true;
    }

    function isDockTerminalTask(task = {}) {
        return ['succeeded', 'failed', 'cancelled'].includes(task?.status);
    }

    function isDockVisibleTerminalTask(task = {}) {
        if (!isDockTerminalTask(task) || isTaskSeen(task)) return false;
        if (task.status === 'succeeded') return true;
        const happenedAt = Number(task.completedAt || task.updatedAt || task.createdAt || 0);
        return !happenedAt || Date.now() - happenedAt < 24 * 60 * 60 * 1000;
    }

    function getDockQueueTasks() {
        const candidateTasks = [];
        const addTask = (task) => {
            if (!task?.id || candidateTasks.some((item) => item.id === task.id)) return;
            if (isBusyTask(task) || isDockVisibleTerminalTask(task)) candidateTasks.push(task);
        };
        const activeTask = getActiveDisplayTask();
        const activeRoot = getTaskThreadRoot(activeTask) || activeTask;
        getTaskThread(activeRoot).forEach(addTask);
        state.tasks.forEach(addTask);
        return candidateTasks.sort((a, b) => {
            const priority = (task) => {
                if (task.status === 'processing' || task.status === 'streaming') return 0;
                if (task.status === 'queued') return 1;
                if (isTaskReloadableBillingRecord(task)) return 2;
                if (task.status === 'failed' || task.status === 'cancelled') return 3;
                return 3;
            };
            const priorityDiff = priority(a) - priority(b);
            if (priorityDiff) return priorityDiff;
            return (b.createdAt || 0) - (a.createdAt || 0);
        });
    }

    function getDockQueueProgress(tasks = []) {
        return tasks.reduce((acc, task) => {
            const count = getTaskGenerationCount(task);
            const total = Math.max(1, Number(count.total || 1));
            const completed = Math.min(total, Math.max(0, Number(count.completed || 0)));
            acc.total += total;
            acc.completed += isDockTerminalTask(task) ? Math.max(completed, total) : completed;
            return acc;
        }, { completed: 0, total: 0 });
    }

    function getDockTaskStage(task) {
        if (!task) return 'idle';
        if (task.status === 'queued') return 'queued';
        if (task.status === 'succeeded') return 'complete';
        if (isTaskReloadableBillingRecord(task)) return 'reloading';
        if (task.status === 'failed' || task.status === 'cancelled') return 'failed';
        if (task.status === 'processing' || task.status === 'streaming') {
            const stepLabel = getTaskCurrentStepLabel(task);
            if (/保存|同步/.test(stepLabel)) return 'saving';
            return 'generating';
        }
        return 'idle';
    }

    function getDockEstimatedProgressByElapsed(task, { min = 12, max = 86, expectedSeconds = 90 } = {}) {
        const seconds = getTaskElapsedSeconds(task);
        const expected = Math.max(1, Number(expectedSeconds || 1));
        const eased = 1 - Math.exp(-Math.max(0, seconds) / expected);
        return Math.round(clampNumber(min + (max - min) * eased, min, max, min));
    }

    function getDockTextTaskProgressPercent(task, stage) {
        const knownProgress = getTaskProgressPercent(task);
        if (knownProgress !== null) {
            return Math.round(clampNumber(knownProgress, stage === 'queued' ? 8 : 12, 96, 12));
        }
        if (stage === 'queued') return 10;
        const receivedLength = String(task?.resultPrompt || '').length;
        const reasoningLength = String(task?.reasoningText || '').length;
        if (receivedLength > 0) {
            return Math.round(clampNumber(26 + Math.sqrt(receivedLength) * 4.6, 28, 94, 42));
        }
        if (reasoningLength > 0) {
            return Math.round(clampNumber(14 + Math.sqrt(reasoningLength) * 3.2, 16, 76, 28));
        }
        return getDockEstimatedProgressByElapsed(task, { min: 12, max: 48, expectedSeconds: 24 });
    }

    function getDockVideoTaskProgressPercent(task, stage) {
        const knownProgress = getTaskProgressPercent(task);
        if (knownProgress !== null) {
            return Math.round(clampNumber(knownProgress, stage === 'queued' ? 8 : 12, 92, 12));
        }
        if (stage === 'queued') return 10;
        const resolutionMultiplier = {
            '480p': 0.72,
            '720p': 1,
            '1080p': 1.55,
            '1k': 1,
            '2k': 1.45,
            '4k': 2.2
        }[String(task?.resolution || '').toLowerCase()] || 1;
        const durationMultiplier = Math.max(1, Number(task?.videoDuration || 5) / 5);
        return getDockEstimatedProgressByElapsed(task, {
            min: 14,
            max: 86,
            expectedSeconds: 120 * resolutionMultiplier * durationMultiplier
        });
    }

    function getDockTaskProgressPercent(task, stage = getDockTaskStage(task)) {
        if (!task) return 0;
        if (stage === 'complete' || stage === 'failed') return 100;
        if (isTextVisionTask(task)) return getDockTextTaskProgressPercent(task, stage);
        if (isVideoMode(task?.mode)) return getDockVideoTaskProgressPercent(task, stage);
        return getImageTaskStageProgressPercent(task, stage);
    }

    function getDockStatusIcon(stage = 'idle') {
        if (stage === 'queued') return 'fa-clock';
        if (stage === 'saving') return 'fa-cloud-arrow-up';
        if (stage === 'complete') return 'fa-check';
        if (stage === 'reloading') return 'fa-rotate-right';
        if (stage === 'failed') return 'fa-triangle-exclamation';
        if (stage === 'generating') return 'fa-circle-notch fa-spin';
        return 'fa-wand-magic-sparkles';
    }

    function getDockStageLabel(task, stage = getDockTaskStage(task)) {
        if (stage === 'queued') return getTaskQueuedBadgeLabel(task);
        if (stage === 'saving') return '保存结果中';
        if (stage === 'complete') return '全部完成';
        if (stage === 'reloading') return '重新加载中';
        if (stage === 'failed') return task?.status === 'cancelled' ? '已取消' : '生成失败';
        if (stage === 'generating') return '生成中';
        return 'AI 工作台';
    }

    function getDockTaskBadge(task) {
        const stage = getDockTaskStage(task);
        if (stage === 'reloading') return '加载';
        if (stage === 'failed') return task?.status === 'cancelled' ? '取消' : '失败';
        if (stage === 'complete') return '完成';
        return `${getDockTaskProgressPercent(task, stage)}%`;
    }

    function renderDockTaskBadge(task) {
        const stage = getDockTaskStage(task);
        if (stage === 'complete') {
            return '<span class="ai-image-dock-task-badge is-icon" aria-label="完成" title="完成"><i class="fas fa-check"></i></span>';
        }
        return `<span class="ai-image-dock-task-badge">${escapeHtml(getDockTaskBadge(task))}</span>`;
    }

    function renderDockTaskProgress(task) {
        if (!isBusyTask(task)) return '';
        const stage = getDockTaskStage(task);
        const percent = getDockTaskProgressPercent(task, stage);
        const className = [
            'ai-image-dock-task-progress'
        ].filter(Boolean).join(' ');
        return `<span class="${className}" style="--aiw-dock-task-progress:${percent / 100}" aria-label="${escapeHtml(`任务进度 ${percent}%`)}"><i></i></span>`;
    }

    function getDockTaskSummary(task) {
        const stage = getDockTaskStage(task);
        if (stage === 'complete') return getStatusLabel(task);
        if (stage === 'reloading') return '刷新后重新加载记录';
        if (stage === 'failed') return task?.status === 'cancelled'
            ? `已取消 · ${getTaskChargeMetaLabel(task) || '未扣费'}`
            : `生成失败 · ${getTaskChargeMetaLabel(task) || '未扣费'}`;
        if (stage === 'queued') return getTaskQueuedStepLabel(task);
        if (stage === 'saving') return '保存结果中';
        return getTaskCurrentStepLabel(task);
    }

    function getDockTaskClass(task, activeTask) {
        const stage = getDockTaskStage(task);
        return [
            'ai-image-dock-task',
            isBusyTask(task) ? 'is-active' : '',
            stage === 'complete' ? 'is-success' : '',
            stage === 'reloading' ? 'is-reloading' : '',
            stage === 'failed' ? 'is-failed' : '',
            activeTask?.id === task?.id || state.activeTaskId === task?.id ? 'is-current' : ''
        ].filter(Boolean).join(' ');
    }

    function renderDockIcon() {
        return `
            <span class="ai-image-fab-core" aria-hidden="true">
                <span class="ai-image-fab-particles">
                    <span></span><span></span><span></span><span></span>
                    <span></span><span></span><span></span><span></span>
                    <span></span><span></span><span></span><span></span>
                    <span></span><span></span><span></span><span></span>
                </span>
                <span class="ai-image-fab-depth"></span>
                <span class="ai-image-fab-orbit"></span>
                <span class="ai-image-fab-glass"></span>
                <span class="ai-image-fab-core-inner">
                    <span class="ai-image-fab-mark">
                        <i class="fas fa-wand-magic-sparkles"></i>
                    </span>
                </span>
            </span>
        `;
    }

    function renderDockTaskList(tasks = [], activeTask = null, queueProgress = { completed: 0, total: 0 }, stage = getDockTaskStage(activeTask), progressPercent = 0) {
        if (!tasks.length) return '';
        const visibleTasks = tasks.slice(0, 4);
        const queueTotal = Math.max(queueProgress.total || 0, queueProgress.completed || 0, 1);
        const queueCompleted = Math.min(queueTotal, Math.max(0, Number(queueProgress.completed || 0)));
        const queuePercent = Math.round((queueCompleted / queueTotal) * 100);
        const showSummaryProgress = Boolean(activeTask && isBusyTask(activeTask));
        const summaryProgressPercent = showSummaryProgress ? clampNumber(progressPercent, 0, 100, queuePercent) : 0;
        const stageLabel = getDockStageLabel(activeTask, stage);
        const elapsedMarkup = activeTask?.id && !isDockTerminalTask(activeTask)
            ? ` · <span data-aiw-live-status-task-id="${escapeHtml(activeTask.id)}" data-aiw-live-status-kind="elapsed">${escapeHtml(getTaskElapsedLabel(activeTask))}</span>`
            : '';
        const summaryStatusMarkup = showSummaryProgress
            ? `${escapeHtml(stageLabel)} · 当前任务 ${escapeHtml(progressPercent)}%${elapsedMarkup}`
            : escapeHtml(stageLabel);
        const summaryClass = [
            'ai-image-dock-summary',
            stage === 'complete' ? 'is-success' : '',
            stage === 'failed' ? 'is-failed' : ''
        ].filter(Boolean).join(' ');
        return `
            <div class="ai-image-dock-popover-head">
                <span>任务队列</span>
            </div>
            <div class="${summaryClass}">
                <div class="ai-image-dock-summary-main">
                    <strong>队列 ${escapeHtml(queueCompleted)}/${escapeHtml(queueTotal)}</strong>
                    <span>${summaryStatusMarkup}</span>
                </div>
                ${showSummaryProgress ? `<div class="ai-image-dock-summary-progress" style="--aiw-dock-summary-progress:${summaryProgressPercent / 100}" aria-hidden="true"></div>` : ''}
            </div>
            <div class="ai-image-dock-task-list">
                ${visibleTasks.map((task) => `
                    <div class="ai-image-dock-task-enter">
                        <div class="${getDockTaskClass(task, activeTask)}">
                            <button class="ai-image-dock-task-main" type="button" data-aiw-dock-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(`打开 ${getTaskTitle(task)}`)}">
                                <span class="ai-image-dock-task-icon"><i class="fas ${escapeHtml(MODE_META[task.mode]?.icon || getStatusIcon(task))}"></i></span>
                                <span class="ai-image-dock-task-copy">
                                    <strong>${escapeHtml(getTaskTitle(task))}</strong>
                                    <span>${escapeHtml(getDockTaskSummary(task))}</span>
                                </span>
                            </button>
                            <span class="ai-image-dock-task-actions">
                                ${renderDockTaskBadge(task)}
                                ${isDockTerminalTask(task) ? `
                                    <button class="ai-image-dock-task-dismiss" type="button" data-aiw-dock-dismiss-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(`从队列移除 ${getTaskTitle(task)}`)}" title="从队列移除">
                                        <i class="fas fa-xmark"></i>
                                    </button>
                                ` : ''}
                            </span>
                            ${renderDockTaskProgress(task)}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function openDockTask(taskId = '') {
        const task = state.tasks.find((item) => item.id === taskId);
        if (!task) {
            openWorkbench();
            return;
        }
        state.activeTaskId = task.id;
        markTaskThreadSeen(task.id);
        openSelect = '';
        openWorkbench();
        persistState();
        const locateTask = () => {
            if (scrollToChatTurn(task.id)) return;
            const rootTask = getTaskThreadRoot(task);
            if (rootTask?.id && rootTask.id !== task.id) scrollToChatTurn(rootTask.id);
        };
        window.requestAnimationFrame(() => window.requestAnimationFrame(locateTask));
    }

    function dismissDockTask(taskId = '') {
        const task = state.tasks.find((item) => item.id === taskId);
        if (!task) return;
        markTaskThreadSeen(task);
        persistState();
        render();
    }

    function setDockIconAnimationRate(fab, targetRate = 1, duration = 220) {
        if (!fab?.getAnimations || typeof performance === 'undefined') return;
        const animations = fab.getAnimations({ subtree: true }).filter((animation) => {
            const target = animation?.effect?.target;
            return target?.closest?.('.ai-image-fab-core');
        });
        if (!animations.length) return;
        if (dockAnimationRateFrame) {
            window.cancelAnimationFrame(dockAnimationRateFrame);
            dockAnimationRateFrame = 0;
        }
        const start = performance.now();
        const fromRates = animations.map((animation) => {
            const currentRate = Number(animation.playbackRate);
            return Number.isFinite(currentRate) && currentRate > 0 ? currentRate : 1;
        });
        const ease = (value) => 1 - Math.pow(1 - value, 3);
        const step = (now) => {
            const progress = duration > 0 ? clampNumber((now - start) / duration, 0, 1, 1) : 1;
            const eased = ease(progress);
            animations.forEach((animation, index) => {
                if (!animation?.playbackRate && animation?.playbackRate !== 0) return;
                animation.playbackRate = fromRates[index] + (targetRate - fromRates[index]) * eased;
            });
            if (progress < 1) {
                dockAnimationRateFrame = window.requestAnimationFrame(step);
            } else {
                dockAnimationRateFrame = 0;
            }
        };
        dockAnimationRateFrame = window.requestAnimationFrame(step);
    }

    function bindDockAnimationHover(fab) {
        if (!fab) return;
        if (fab.dataset.aiwAnimationHoverBound === '1') return;
        fab.dataset.aiwAnimationHoverBound = '1';
        const speedUp = () => setDockIconAnimationRate(fab, 2, 240);
        const slowDown = () => setDockIconAnimationRate(fab, 1, 300);
        fab.addEventListener('pointerenter', speedUp);
        fab.addEventListener('pointerleave', slowDown);
        fab.addEventListener('focusin', speedUp);
        fab.addEventListener('focusout', slowDown);
    }

    function bindDockNativeHit(fab) {
        const nativeHit = fab?.querySelector?.('[data-aiw-native-hit]');
        if (!nativeHit || nativeHit.dataset.aiwNativeBound === '1') return;
        nativeHit.dataset.aiwNativeBound = '1';
        nativeHit.addEventListener('change', (event) => {
            state.open = Boolean(event.target.checked);
            setBodyOpenState(state.open);
            render();
        });
    }

    function bindDockTaskButtons() {
        dock.querySelectorAll('[data-aiw-dock-task-id]').forEach((button) => {
            if (button.dataset.aiwDockTaskBound === '1') return;
            button.dataset.aiwDockTaskBound = '1';
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openDockTask(button.getAttribute('data-aiw-dock-task-id') || '');
            });
        });
        dock.querySelectorAll('[data-aiw-dock-dismiss-task-id]').forEach((button) => {
            if (button.dataset.aiwDockDismissBound === '1') return;
            button.dataset.aiwDockDismissBound = '1';
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                dismissDockTask(button.getAttribute('data-aiw-dock-dismiss-task-id') || '');
            });
        });
    }

    function playDockPopoverEnter() {
        if (!dock || dockPopoverSessionActive) return;
        dockPopoverSessionActive = true;
        dockPopoverEnterActive = true;
        dock.classList.add('is-popover-entering');
        if (dockPopoverEnterTimer) window.clearTimeout(dockPopoverEnterTimer);
        dockPopoverEnterTimer = window.setTimeout(() => {
            dockPopoverEnterActive = false;
            dock?.classList.remove('is-popover-entering');
            dockPopoverEnterTimer = 0;
        }, 520);
    }

    function clearDockPopoverEnter() {
        dockPopoverEnterActive = false;
        dockPopoverSessionActive = false;
        if (dockPopoverEnterTimer) {
            window.clearTimeout(dockPopoverEnterTimer);
            dockPopoverEnterTimer = 0;
        }
        dock?.classList.remove('is-popover-entering');
    }

    function bindDockPopoverEnter() {
        if (!dock || dock.dataset.aiwPopoverEnterBound === '1') return;
        dock.dataset.aiwPopoverEnterBound = '1';
        dock.addEventListener('pointerenter', () => {
            dockPopoverPointerInside = true;
            playDockPopoverEnter();
        });
        dock.addEventListener('pointerleave', () => {
            dockPopoverPointerInside = false;
            if (!dockPopoverFocusInside) clearDockPopoverEnter();
        });
        dock.addEventListener('focusin', () => {
            dockPopoverFocusInside = true;
            playDockPopoverEnter();
        });
        dock.addEventListener('focusout', (event) => {
            if (event.currentTarget?.contains?.(event.relatedTarget)) return;
            dockPopoverFocusInside = false;
            if (!dockPopoverPointerInside) clearDockPopoverEnter();
        });
        dockPopoverPointerInside = dock.matches(':hover');
        dockPopoverFocusInside = dock.matches(':focus-within');
        if (dockPopoverPointerInside || dockPopoverFocusInside) playDockPopoverEnter();
    }

    function renderDockPopover(popoverMarkup = '') {
        const existingPopover = dock.querySelector('.ai-image-dock-popover');
        if (!popoverMarkup) {
            existingPopover?.remove();
            clearDockPopoverEnter();
            return;
        }
        if (existingPopover) {
            existingPopover.innerHTML = popoverMarkup;
            return;
        }
        const wrapper = document.createElement('section');
        wrapper.className = 'ai-image-dock-popover';
        wrapper.setAttribute('aria-label', '生成任务快速定位');
        wrapper.innerHTML = popoverMarkup;
        const fab = dock.querySelector('.ai-image-fab');
        if (fab) {
            fab.insertAdjacentElement('beforebegin', wrapper);
        } else {
            dock.appendChild(wrapper);
        }
    }

    function renderDock() {
        const dockTasks = getDockQueueTasks();
        const busyTasks = dockTasks.filter(isBusyTask);
        const reloadingTasks = dockTasks.filter(isTaskReloadableBillingRecord);
        const failedTasks = dockTasks.filter((task) => (task.status === 'failed' || task.status === 'cancelled') && !isTaskReloadableBillingRecord(task));
        const completeTasks = dockTasks.filter((task) => task.status === 'succeeded');
        const activeDisplayTask = getActiveDisplayTask();
        const activeTask = busyTasks.find((task) => task.id === activeDisplayTask?.id)
            || busyTasks[0]
            || reloadingTasks[0]
            || failedTasks[0]
            || completeTasks[0]
            || null;
        const stage = getDockTaskStage(activeTask);
        const progressPercent = getDockTaskProgressPercent(activeTask, stage);
        const queueProgress = getDockQueueProgress(dockTasks);
        const isIdle = !dockTasks.length;
        const terminalSignature = !isIdle && (stage === 'complete' || stage === 'failed')
            ? `${stage}:${dockTasks.map((task) => `${task.id}:${task.status}:${task.completedAt || ''}`).join('|')}`
            : '';
        const shouldFlashTerminal = Boolean(terminalSignature && terminalSignature !== lastDockTerminalSignature);
        if (terminalSignature) lastDockTerminalSignature = terminalSignature;
        if (!terminalSignature && (busyTasks.length || isIdle)) lastDockTerminalSignature = '';
        const fabClass = [
            'ai-image-fab',
            'is-idle',
            `is-${stage}`,
            !isIdle ? 'has-status-dot' : '',
            busyTasks.length ? 'is-busy' : '',
            completeTasks.length && !busyTasks.length && !failedTasks.length ? 'is-complete' : '',
            failedTasks.length && !busyTasks.length ? 'is-failed' : '',
            shouldFlashTerminal ? 'is-terminal-flash' : ''
        ].filter(Boolean).join(' ');
        dock.className = [
            'ai-image-dock',
            `is-${stage}`,
            isIdle ? 'is-idle' : '',
            isIdle ? '' : 'has-tasks',
            failedTasks.length && !busyTasks.length ? 'has-failed' : '',
            completeTasks.length && !busyTasks.length && !failedTasks.length ? 'has-complete' : '',
            dockPopoverEnterActive ? 'is-popover-entering' : ''
        ].filter(Boolean).join(' ');

        const popoverMarkup = renderDockTaskList(dockTasks, activeTask, queueProgress, stage, progressPercent);
        let fab = dock.querySelector('.ai-image-fab');
        if (!fab) {
            dock.innerHTML = `
                ${popoverMarkup ? `<section class="ai-image-dock-popover" aria-label="生成任务快速定位">${popoverMarkup}</section>` : ''}
                <div class="${fabClass}" role="button" data-aiw-action="native-open" aria-label="打开 AI 图片工作台" style="--aiw-dock-progress:${progressPercent / 100}">
                    <input class="ai-image-native-hit" type="checkbox" data-aiw-native-hit aria-label="打开 AI 图片工作台" ${state.open ? 'checked' : ''}>
                    ${renderDockIcon()}
                    ${isIdle ? '' : '<span class="ai-image-fab-status-dot" aria-hidden="true"></span>'}
                </div>
            `;
            fab = dock.querySelector('.ai-image-fab');
        } else {
            renderDockPopover(popoverMarkup);
            fab.className = fabClass;
            fab.setAttribute('role', 'button');
            fab.setAttribute('data-aiw-action', 'native-open');
            fab.setAttribute('aria-label', '打开 AI 图片工作台');
            fab.style.setProperty('--aiw-dock-progress', progressPercent / 100);
            const nativeHit = fab.querySelector('[data-aiw-native-hit]');
            if (nativeHit) nativeHit.checked = state.open;
            const statusDot = fab.querySelector('.ai-image-fab-status-dot');
            if (isIdle) {
                statusDot?.remove();
            } else if (!statusDot) {
                fab.insertAdjacentHTML('beforeend', '<span class="ai-image-fab-status-dot" aria-hidden="true"></span>');
            }
        }

        bindDockAnimationHover(fab);
        bindDockPopoverEnter();
        bindDockNativeHit(fab);
        bindDockTaskButtons();
        syncLiveElapsedTimer();
    }

    function renderOverlay() {
        syncOverlayOpenState();
        if (!state.open) {
            openSelect = '';
            clearImagePreviewLoadTimer();
            imagePreview = null;
            setBodyImagePreviewState(false);
            disconnectChatNavigationRail();
            return;
        }

        overlay.innerHTML = `
            <section class="ai-image-shell ${modelPricingView.open ? 'is-model-pricing' : ''}" role="dialog" aria-modal="true" aria-label="AI 图片工作台">
                <button class="ai-image-shell-close" type="button" data-aiw-action="${modelPricingView.open ? 'close-model-pricing' : 'close'}" aria-label="${modelPricingView.open ? '关闭模型价格' : '关闭 AI 工作台'}" title="${modelPricingView.open ? '关闭模型价格' : '关闭'}">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
                <div class="${getLayoutClasses()}">
                    ${renderHistoryPanel()}
                    ${renderStage()}
                </div>
                ${renderChatNavigationLayer()}
            </section>
            ${renderImagePreview()}
        `;
    }

    function renderImagePreview() {
        if (!imagePreview?.src) return '';
        const title = imagePreview.title || '生成图片';
        const originalAvailable = imagePreview.originalReady !== false && Boolean(imagePreview.originalSrc);
        const originalLoaded = originalAvailable && Boolean(imagePreview.originalLoaded);
        const sizeLabel = formatPreviewFileSize(
            (originalAvailable && imagePreview.originalBytes)
                ? imagePreview.originalBytes
                : (imagePreview.previewBytes || imagePreview.originalBytes)
        );
        const meta = [imagePreview.meta || '高清原图', sizeLabel].filter(Boolean).join(' · ');
        const originalStatus = String(imagePreview.originalStatus || '').trim().toLowerCase();
        const originalFailed = originalStatus === 'failed' || originalStatus === 'missing';
        const originalProgress = getPreviewOriginalProgress(imagePreview);
        const pendingCopy = originalFailed
            ? '高清原图转存失败，当前显示可用预览图'
            : `${originalAvailable ? '高清原图加载中' : '高清原图准备中'} ${originalProgress}% · 当前先显示预览图，加载完成后自动切换`;
        const downloadAttrs = originalAvailable
            ? `href="${escapeHtml(imagePreview.originalSrc)}" download target="_blank" rel="noopener noreferrer"`
            : `href="${escapeHtml(imagePreview.previewSrc || imagePreview.src)}" aria-disabled="true"`;
        const downloadClass = originalAvailable ? '' : ' is-disabled';
        const downloadTitle = originalAvailable ? '下载原图' : '原图转存中';
        return `
            <div class="ai-image-full-preview" data-aiw-full-preview role="dialog" aria-modal="true" aria-label="全分辨率图片预览">
                <div class="ai-image-full-preview__toolbar">
                    <div class="ai-image-full-preview__copy">
                        <strong>${escapeHtml(title)}</strong>
                        <span>${escapeHtml(meta)}</span>
                    </div>
                    <div class="ai-image-full-preview__actions">
                        <a class="ai-image-full-preview__icon${downloadClass}" ${downloadAttrs} aria-label="${escapeHtml(downloadTitle)}" title="${escapeHtml(downloadTitle)}" data-aiw-download="original" data-result-id="${escapeHtml(imagePreview.resultId)}" data-task-id="${escapeHtml(imagePreview.taskId)}" data-result-index="${escapeHtml(imagePreview.resultIndex)}">
                            <i class="fas fa-download"></i>
                        </a>
                        <button class="ai-image-full-preview__icon" type="button" data-aiw-preview-close aria-label="关闭预览" title="关闭预览">
                            <i class="fas fa-xmark"></i>
                        </button>
                    </div>
                </div>
                <div class="ai-image-full-preview__body">
                    <img class="${originalLoaded ? 'is-original-ready' : 'is-preview-only'}" src="${escapeHtml(imagePreview.src)}" alt="${escapeHtml(title)}">
                    ${originalLoaded ? '' : `
                        <div class="ai-image-full-preview__pending ${originalFailed ? 'is-failed' : ''}">
                            <div class="ai-image-full-preview__pending-head">
                                <i class="fas ${originalFailed ? 'fa-triangle-exclamation' : 'fa-circle-notch fa-spin'}"></i>
                                <span>${escapeHtml(pendingCopy)}</span>
                            </div>
                            ${originalFailed ? '' : `<div class="ai-image-full-preview__pending-bar" style="--aiw-original-progress:${originalProgress / 100}"><span></span></div>`}
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    function renderCreatorPanel() {
        const isTextMode = state.mode === 'text';
        const isImageMode = state.mode === 'image';
        const isReverseMode = state.mode === 'reverse';
        const isVideo = state.mode === 'video';
        const modelOptions = getActiveModelOptions(state.mode).map((model) => ({ value: model.id, label: model.label }));
        const visibleModes = Object.entries(MODE_META).filter(([id]) => id !== 'video' || getActiveModelOptions('video').length);

        return `
            <aside class="ai-image-panel ai-image-panel--creator">
                <div class="ai-image-section">
                    <div class="ai-image-label">创作模式 <span>${escapeHtml(getModeLabel())}</span></div>
                    <div class="ai-image-segment">
                        ${visibleModes.map(([id, meta]) => `
                            <button class="ai-image-mode-btn ${state.mode === id ? 'is-active' : ''}" type="button" data-aiw-mode="${escapeHtml(id)}">
                                <i class="fas ${escapeHtml(meta.icon)}"></i>
                                <strong>${escapeHtml(meta.label)}</strong>
                                <span>${escapeHtml(meta.sub)}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>

                ${!isReverseMode ? `
                    <div class="ai-image-section">
                        <label class="ai-image-label" for="aiImagePromptInput">提示词 <span>${state.prompt.length}/4000</span></label>
                        <textarea id="aiImagePromptInput" class="ai-image-prompt-input" data-aiw-prompt placeholder="${escapeHtml(isVideo ? '描述视频主体、镜头运动、节奏、场景与风格' : (isImageMode ? '描述希望基于参考图发散出的方向、风格、光线与细节' : '描述你想生成的画面、主体、风格、光线与细节'))}">${escapeHtml(state.prompt)}</textarea>
                    </div>
                ` : ''}

                ${!isTextMode ? `
                    <div class="ai-image-section">
                        <div class="ai-image-label">${isReverseMode ? '待反推图片' : '参考图片'} <span>${referenceUploadBusy ? '上传中' : (state.referenceImage ? '已载入' : (isVideo ? '可选' : '必选'))}</span></div>
                        ${renderReferenceBox()}
                    </div>
                ` : ''}

                ${!isReverseMode ? `
                    <div class="ai-image-section ai-image-section--compact">
                        <div class="ai-image-compact-controls">
                            ${isVideo ? renderVideoComposerControls() : `
                            ${renderCustomSelect({
                                field: 'ratio',
                                label: '画幅比例',
                                icon: 'fa-crop-simple',
                                value: state.ratio,
                                options: Object.entries(RATIO_META).map(([id, meta]) => ({ value: id, label: meta.label }))
                            })}
                            ${renderCustomSelect({
                                field: 'resolution',
                                label: '分辨率',
                                icon: 'fa-expand',
                                value: state.resolution,
                                options: Object.entries(RESOLUTION_META).map(([id, meta]) => ({ value: id, label: meta.label }))
                            })}
                            ${isVideo ? '' : renderCustomSelect({
                                field: 'quantity',
                                label: '生成数量',
                                icon: 'fa-layer-group',
                                value: String(state.quantity),
                                options: [1, 2, 4].map((value) => ({ value: String(value), label: `${value} 张` }))
                            })}
                            `}
                        </div>
                    </div>
                ` : ''}

                <div class="ai-image-section">
                    ${renderModelProviderSelect({
                        field: 'model',
                        label: '模型',
                        icon: 'fa-microchip',
                        value: getActiveModelValue(state.mode),
                        wide: true,
                        disabled: !modelOptions.length,
                        options: modelOptions
                    })}
                </div>
                ${renderCreatorActions()}
            </aside>
        `;
    }

	    function renderChatMemoryControl() {
	        const activeOption = getChatMemoryOption();
	        const isOpen = openSelect === 'memory';
        return `
            <div class="ai-image-memory-control ${isOpen ? 'is-open' : ''}" data-aiw-chat-settings-source="memory" aria-label="对话记忆范围">
                <button class="ai-image-memory-trigger" type="button" data-aiw-memory-toggle aria-haspopup="menu" aria-expanded="${isOpen ? 'true' : 'false'}">
                    <i class="fas fa-brain"></i>
                    <span>${escapeHtml(activeOption.shortLabel)}</span>
                    <i class="fas fa-chevron-down"></i>
                </button>
                ${isOpen ? `<div class="ai-image-memory-menu" role="menu" aria-label="选择对话记忆范围">
                    ${CHAT_MEMORY_OPTIONS.map((option) => `
                        <button class="${option.id === activeOption.id ? 'is-active' : ''}" type="button" data-aiw-chip="memory:${escapeHtml(option.id)}" role="menuitemradio" aria-checked="${option.id === activeOption.id ? 'true' : 'false'}">
                            <strong>${escapeHtml(option.label)}</strong>
                            <em>${escapeHtml(option.hint)}</em>
                        </button>
                    `).join('')}
                </div>` : ''}
            </div>
	        `;
	    }

	    function renderChatCapabilityControl({ id, icon, activeOption, options = [], ariaLabel = '' }) {
	        if (!options.length) return '';
	        const isOpen = openSelect === id;
	        const settingsSourceAttribute = CHAT_SETTINGS_CAPABILITY_IDS.includes(id)
	            ? ` data-aiw-chat-settings-source="${escapeHtml(id)}"`
	            : '';
	        return `
	            <div class="ai-image-capability-control ${isOpen ? 'is-open' : ''}"${settingsSourceAttribute} aria-label="${escapeHtml(ariaLabel || activeOption.label || id)}">
	                <button class="ai-image-capability-trigger" type="button" data-aiw-capability-toggle="${escapeHtml(id)}" aria-haspopup="menu" aria-expanded="${isOpen ? 'true' : 'false'}">
	                    <i class="fas ${escapeHtml(icon)}"></i>
	                    <span>${escapeHtml(activeOption.shortLabel || activeOption.label || id)}</span>
	                    <i class="fas fa-chevron-down"></i>
	                </button>
	                ${isOpen ? `<div class="ai-image-capability-menu" role="menu" aria-label="${escapeHtml(ariaLabel || activeOption.label || id)}">
	                    ${options.map((option) => `
	                        <button class="${option.id === activeOption.id ? 'is-active' : ''}" type="button" data-aiw-chip="${escapeHtml(id)}:${escapeHtml(option.id)}" role="menuitemradio" aria-checked="${option.id === activeOption.id ? 'true' : 'false'}">
	                            <strong>${escapeHtml(option.label)}</strong>
	                            <em>${escapeHtml(option.hint)}</em>
	                        </button>
	                    `).join('')}
	                </div>` : ''}
	            </div>
	        `;
	    }

	    function renderChatModelCapabilityControls() {
	        const capabilities = getChatModelCapabilities(getActiveModelValue('chat'));
	        const controlValueById = {
	            reasoning: state.chatReasoningEffort,
	            geminiThinking: state.chatGeminiThinkingLevel,
	            serviceTier: state.chatServiceTier,
	            thinking: state.chatThinkingMode,
	            imageInput: state.chatImageInput
	        };

	        return `
	            ${capabilities.controls.map((control) => {
	                const activeOption = control.options.find((option) => option.id === controlValueById[control.id])
	                    || control.options[0];
	                return renderChatCapabilityControl({
	                    id: control.id,
	                    icon: control.icon,
	                    activeOption,
	                    options: control.options,
	                    ariaLabel: control.label
	                });
	            }).join('')}
	        `;
    }

    function getChatCapabilityControlValueById(id, fallbackValue = '') {
        if (id === 'reasoning') return state.chatReasoningEffort;
        if (id === 'geminiThinking') return state.chatGeminiThinkingLevel;
        if (id === 'claudeThinkingBudget') return state.chatClaudeThinkingBudget;
        if (id === 'thinking') return state.chatThinkingMode;
        return fallbackValue;
    }

    function getChatSettingsSectionTitle(control = {}) {
        if (control.id === 'memory') return '上下文强度';
        if (control.id === 'thinking' || control.id === 'geminiThinking') return '思考展示';
        if (control.id === 'reasoning' || control.id === 'claudeThinkingBudget') return '推理强度';
        return control.label || '对话参数';
    }

    function getChatSettingsSections() {
        const capabilities = getChatModelCapabilities(getActiveModelValue('chat'));
        return [
            {
                title: getChatSettingsSectionTitle({ id: 'memory' }),
                field: 'memory',
                value: state.chatMemoryMode,
                options: CHAT_MEMORY_OPTIONS.map((option) => ({
                    value: option.id,
                    label: option.label,
                    summaryLabel: option.shortLabel || option.label
                }))
            },
            ...capabilities.controls
                .filter((control) => CHAT_SETTINGS_CAPABILITY_IDS.includes(control.id))
                .map((control) => ({
                    title: getChatSettingsSectionTitle(control),
                    field: control.id,
                    value: getChatCapabilityControlValueById(control.id, control.activeValue),
                    options: control.options.map((option) => ({
                        value: option.id,
                        label: option.label || option.shortLabel || option.id,
                        summaryLabel: option.shortLabel || option.label || option.id
                    }))
                }))
        ];
    }

    function renderChatSettingsSummary() {
        return getChatSettingsSections().map((section) => {
            const selected = section.options.find((option) => String(option.value) === String(section.value)) || section.options[0];
            return selected?.summaryLabel || selected?.label || section.value;
        }).filter(Boolean).join(' / ');
    }

    function renderChatSettingsSelect() {
        const isOpen = openSelect === 'chatSettings';
        const sections = getChatSettingsSections();
        const activeSection = openChatSettingsSection && sections.some((section) => section.field === openChatSettingsSection)
            ? openChatSettingsSection
            : '';

        return `
            <div class="ai-image-composer-settings-select ai-image-chat-settings-select ${isOpen ? 'is-open' : ''}" data-aiw-chat-settings>
                <button class="ai-image-composer-settings-trigger ai-image-chat-settings-trigger" type="button" data-aiw-select-toggle="chatSettings" aria-haspopup="menu" aria-expanded="${isOpen ? 'true' : 'false'}">
                    <i class="fas fa-sliders"></i>
                    <span>对话参数</span>
                    <em>${escapeHtml(renderChatSettingsSummary())}</em>
                    <i class="fas fa-chevron-down ai-image-select-chevron"></i>
                </button>
                ${isOpen ? `
                    <div class="ai-image-composer-settings-menu ai-image-chat-settings-menu" role="menu" aria-label="对话参数">
                        ${sections.map((section) => renderComposerSettingsSection({ ...section, group: 'chat', openSection: activeSection, valueAttribute: 'data-aiw-chip' })).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderComposerUploadButton(inferredMode = inferWorkbenchMode()) {
        const isChatMode = inferredMode === 'chat';
	        const label = isChatMode
	            ? (shouldExposeChatImageInput() ? '上传图片或文档/PDF' : '上传文档/PDF')
	            : '上传图片';
	        return `
                    <button class="ai-image-main-plus" type="button" data-aiw-action="upload-reference" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
                        <i class="fas fa-plus"></i>
                    </button>
	        `;
	    }

	    function renderChatAttachmentChips(chatAttachments = []) {
	        const attachments = normalizeChatAttachmentList(chatAttachments);
	        if (!attachments.length) return '';
	        return `
	            <div class="ai-image-main-file-list" aria-label="已添加的文档/PDF">
	                ${attachments.map((item, index) => `
	                    <span class="ai-image-main-file-chip" title="${escapeHtml(`${item.name} · ${item.chars} 字符`)}">
	                        <i class="fas ${isPdfFile({ name: item.name, type: item.mimeType }) ? 'fa-file-pdf' : 'fa-file-lines'}"></i>
	                        <em>${escapeHtml(truncateText(item.name, 28))}</em>
	                        <small>${escapeHtml(`${item.chars} 字符${item.size ? ` · ${formatFileSize(item.size)}` : ''}`)}</small>
	                        <button type="button" data-aiw-action="remove-chat-attachment" data-attachment-index="${escapeHtml(index)}" aria-label="${escapeHtml(`移除 ${item.name}`)}">
	                            <i class="fas fa-xmark"></i>
	                        </button>
	                    </span>
	                `).join('')}
	            </div>
	        `;
	    }

    function renderCustomSelect({ field, label, icon, value, options, disabled = false, wide = false }) {
        const normalizedValue = String(value || '');
        const hasOptions = options.length > 0;
        const selected = options.find((option) => option.value === normalizedValue) || options[0] || { value: '', label: '暂无可用选项' };
        const isDisabled = disabled || !hasOptions;
        const isOpen = openSelect === field && !isDisabled;
        const classes = [
            'ai-image-custom-select',
            wide ? 'ai-image-custom-select--wide' : '',
            isDisabled ? 'is-disabled' : '',
            isOpen ? 'is-open' : ''
        ].filter(Boolean).join(' ');

        return `
            <div class="${classes}" data-aiw-select="${escapeHtml(field)}">
                <button class="ai-image-select-trigger" type="button" data-aiw-select-toggle="${escapeHtml(field)}" aria-haspopup="listbox" aria-expanded="${isOpen ? 'true' : 'false'}" ${isDisabled ? 'disabled' : ''}>
                    <span class="ai-image-select-icon"><i class="fas ${escapeHtml(icon)}"></i></span>
                    <span class="ai-image-select-copy">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(selected.label)}</strong>
                    </span>
                    <i class="fas fa-chevron-down ai-image-select-chevron"></i>
                </button>
                ${isOpen ? `
                    <div class="ai-image-select-menu" role="listbox" aria-label="${escapeHtml(label)}">
                        ${options.map((option) => `
                            <button class="ai-image-select-option ${option.value === selected.value ? 'is-active' : ''}" type="button" role="option" aria-selected="${option.value === selected.value ? 'true' : 'false'}" data-aiw-select-option data-aiw-select-field="${escapeHtml(field)}" data-aiw-select-value="${escapeHtml(option.value)}">
                                <span>${escapeHtml(option.label)}</span>
                                ${option.value === selected.value ? '<i class="fas fa-check"></i>' : ''}
                            </button>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderVideoComposerControls({ compactLabels = false } = {}) {
        const videoModelId = getActiveModelValue('video');
        const showCameraFixed = supportsVideoCameraFixed(videoModelId);
        return `
            ${renderCustomSelect({
                field: 'videoRatio',
                label: compactLabels ? '比例' : '画幅比例',
                icon: 'fa-crop-simple',
                value: state.videoRatio,
                options: Object.entries(VIDEO_RATIO_META).map(([id, meta]) => ({ value: id, label: meta.label }))
            })}
            ${renderCustomSelect({
                field: 'videoResolution',
                label: '分辨率',
                icon: 'fa-expand',
                value: state.videoResolution,
                options: Object.entries(VIDEO_RESOLUTION_META).map(([id, meta]) => ({ value: id, label: meta.label }))
            })}
            ${renderCustomSelect({
                field: 'videoDuration',
                label: '时长',
                icon: 'fa-clock',
                value: state.videoDuration,
                options: Object.entries(VIDEO_DURATION_META).map(([id, meta]) => ({ value: id, label: meta.shortLabel || meta.label }))
            })}
            ${renderCustomSelect({
                field: 'videoAudio',
                label: '音频',
                icon: 'fa-volume-high',
                value: state.videoAudio,
                options: Object.entries(VIDEO_AUDIO_META).map(([id, meta]) => ({ value: id, label: meta.label }))
            })}
            ${renderCustomSelect({
                field: 'videoWatermark',
                label: '水印',
                icon: 'fa-stamp',
                value: state.videoWatermark,
                options: Object.entries(VIDEO_WATERMARK_META).map(([id, meta]) => ({ value: id, label: meta.label }))
            })}
            ${showCameraFixed ? renderCustomSelect({
                field: 'videoCameraFixed',
                label: '镜头',
                icon: 'fa-video',
                value: state.videoCameraFixed,
                options: Object.entries(VIDEO_CAMERA_FIXED_META).map(([id, meta]) => ({ value: id, label: meta.label }))
            }) : ''}
        `;
    }

    function renderComposerSettingsSection({ title, field, options, value, group, openSection, valueAttribute = 'data-aiw-select-value' }) {
        const normalizedValue = String(value);
        const selected = options.find((option) => String(option.value) === normalizedValue) || options[0] || { value: '', label: '未设置' };
        const isOpen = openSection === field;
        const groupClass = ['image', 'video', 'chat'].includes(group) ? group : 'video';
        return `
            <section class="ai-image-composer-settings-section ai-image-${groupClass}-settings-section ${isOpen ? 'is-open' : ''}">
                <button class="ai-image-composer-settings-section-head ai-image-${groupClass}-settings-section-head" type="button" data-aiw-${groupClass}-settings-section="${escapeHtml(field)}" aria-expanded="${isOpen ? 'true' : 'false'}">
                    <span>${escapeHtml(title)}</span>
                    <strong>${escapeHtml(selected.label)}</strong>
                    <i class="fas fa-chevron-right"></i>
                </button>
                ${isOpen ? `
                    <div class="ai-image-composer-settings-options ai-image-${groupClass}-settings-options" role="group" aria-label="${escapeHtml(title)}">
                        ${options.map((option) => {
                            const optionValue = String(option.value);
                            const isActive = optionValue === normalizedValue;
                            const optionAttribute = valueAttribute === 'data-aiw-chip'
                                ? `data-aiw-chip="${escapeHtml(`${field}:${optionValue}`)}"`
                                : `data-aiw-select-option data-aiw-select-field="${escapeHtml(field)}" data-aiw-select-value="${escapeHtml(optionValue)}"`;
                            return `
                                <button class="ai-image-composer-settings-option ai-image-${groupClass}-settings-option ${isActive ? 'is-active' : ''}" type="button" role="menuitemradio" aria-checked="${isActive ? 'true' : 'false'}" ${optionAttribute}>
                                    <span>${escapeHtml(option.label)}</span>
                                    ${isActive ? '<i class="fas fa-check"></i>' : ''}
                                </button>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
            </section>
        `;
    }

    function renderImageSettingsSummary() {
        return [
            RATIO_META[state.ratio]?.label || state.ratio,
            RESOLUTION_META[state.resolution]?.label || state.resolution,
            `${clampNumber(state.quantity, 1, 4, 2)}张`
        ].filter(Boolean).join(' / ');
    }

    function renderImageSettingsSelect() {
        const isOpen = openSelect === 'imageSettings';
        const sections = [
            {
                title: '比例',
                field: 'ratio',
                value: state.ratio,
                options: Object.entries(RATIO_META).map(([id, meta]) => ({ value: id, label: meta.label }))
            },
            {
                title: '分辨率',
                field: 'resolution',
                value: state.resolution,
                options: Object.entries(RESOLUTION_META).map(([id, meta]) => ({ value: id, label: meta.label }))
            },
            {
                title: '张数',
                field: 'quantity',
                value: String(state.quantity),
                options: [1, 2, 4].map((value) => ({ value: String(value), label: `${value} 张` }))
            }
        ];

        return `
            <div class="ai-image-composer-settings-select ai-image-image-settings-select ${isOpen ? 'is-open' : ''}" data-aiw-image-settings>
                <button class="ai-image-composer-settings-trigger ai-image-image-settings-trigger" type="button" data-aiw-select-toggle="imageSettings" aria-haspopup="menu" aria-expanded="${isOpen ? 'true' : 'false'}">
                    <i class="fas fa-sliders"></i>
                    <span>图片参数</span>
                    <em>${escapeHtml(renderImageSettingsSummary())}</em>
                    <i class="fas fa-chevron-down ai-image-select-chevron"></i>
                </button>
                ${isOpen ? `
                    <div class="ai-image-composer-settings-menu ai-image-image-settings-menu" role="menu" aria-label="图片参数">
                        ${sections.map((section) => renderComposerSettingsSection({ ...section, group: 'image', openSection: openImageSettingsSection })).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderVideoSettingsSummary() {
        const parts = [
            VIDEO_RATIO_META[state.videoRatio]?.label || state.videoRatio,
            VIDEO_RESOLUTION_META[state.videoResolution]?.label || state.videoResolution,
            VIDEO_DURATION_META[String(state.videoDuration)]?.shortLabel || VIDEO_DURATION_META[String(state.videoDuration)]?.label || state.videoDuration,
            VIDEO_AUDIO_META[String(state.videoAudio)]?.shortLabel || VIDEO_AUDIO_META[String(state.videoAudio)]?.label || '',
            VIDEO_WATERMARK_META[String(state.videoWatermark)]?.shortLabel || VIDEO_WATERMARK_META[String(state.videoWatermark)]?.label || ''
        ].filter(Boolean);
        return parts.join(' / ');
    }

    function renderVideoSettingsSelect() {
        const videoModelId = getActiveModelValue('video');
        const showCameraFixed = supportsVideoCameraFixed(videoModelId);
        const isOpen = openSelect === 'videoSettings';
        const sections = [
            {
                title: '画面比例',
                field: 'videoRatio',
                value: state.videoRatio,
                options: Object.entries(VIDEO_RATIO_META).map(([id, meta]) => ({ value: id, label: meta.label }))
            },
            {
                title: '分辨率',
                field: 'videoResolution',
                value: state.videoResolution,
                options: Object.entries(VIDEO_RESOLUTION_META).map(([id, meta]) => ({ value: id, label: meta.label }))
            },
            {
                title: '时长',
                field: 'videoDuration',
                value: state.videoDuration,
                options: Object.entries(VIDEO_DURATION_META).map(([id, meta]) => ({ value: id, label: meta.shortLabel || meta.label }))
            },
            {
                title: '音频',
                field: 'videoAudio',
                value: state.videoAudio,
                options: Object.entries(VIDEO_AUDIO_META).map(([id, meta]) => ({ value: id, label: meta.shortLabel || meta.label }))
            },
            {
                title: '水印',
                field: 'videoWatermark',
                value: state.videoWatermark,
                options: Object.entries(VIDEO_WATERMARK_META).map(([id, meta]) => ({ value: id, label: meta.shortLabel || meta.label }))
            },
            showCameraFixed ? {
                title: '镜头',
                field: 'videoCameraFixed',
                value: state.videoCameraFixed,
                options: Object.entries(VIDEO_CAMERA_FIXED_META).map(([id, meta]) => ({ value: id, label: meta.shortLabel || meta.label }))
            } : null
        ].filter(Boolean);

        return `
            <div class="ai-image-composer-settings-select ai-image-video-settings-select ${isOpen ? 'is-open' : ''}" data-aiw-video-settings>
                <button class="ai-image-composer-settings-trigger ai-image-video-settings-trigger" type="button" data-aiw-select-toggle="videoSettings" aria-haspopup="menu" aria-expanded="${isOpen ? 'true' : 'false'}">
                    <i class="fas fa-sliders"></i>
                    <span>视频参数</span>
                    <em>${escapeHtml(renderVideoSettingsSummary())}</em>
                    <i class="fas fa-chevron-down ai-image-select-chevron"></i>
                </button>
                ${isOpen ? `
                    <div class="ai-image-composer-settings-menu ai-image-video-settings-menu" role="menu" aria-label="视频参数">
                        ${sections.map((section) => renderComposerSettingsSection({ ...section, group: 'video', openSection: openVideoSettingsSection })).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderModelProviderSelect({ field, label, icon, value, mode = inferWorkbenchMode(), disabled = false, wide = false }) {
        const groups = getRuntimeModelGroups(mode);
        const options = getRuntimeModelGroupOptions(mode);
        const normalizedValue = String(value || '');
        const isLoading = isModelOptionsLoading(mode);
        const emptyModelLabel = isLoading ? '模型加载中' : '模型未配置';
        const selected = options.find((option) => option.id === normalizedValue) || options[0] || { id: '', label: emptyModelLabel };
        const selectedGroup = groups.find((group) => group.models.some((model) => model.id === selected.id));
        const hasOptions = options.length > 0;
        const isDisabled = disabled || !hasOptions;
        const isOpen = openSelect === field && !isDisabled;
        const chevronIcon = isLoading && !hasOptions ? 'fa-circle-notch fa-spin' : 'fa-chevron-down';
        const classes = [
            'ai-image-custom-select',
            'ai-image-model-cascade',
            wide ? 'ai-image-custom-select--wide' : '',
            isDisabled ? 'is-disabled' : '',
            isOpen ? 'is-open' : ''
        ].filter(Boolean).join(' ');

        return `
            <div class="${classes}" data-aiw-select="${escapeHtml(field)}">
                <button class="ai-image-select-trigger" type="button" data-aiw-select-toggle="${escapeHtml(field)}" aria-haspopup="menu" aria-expanded="${isOpen ? 'true' : 'false'}" ${isDisabled ? 'disabled' : ''}>
                    <span class="ai-image-select-icon"><i class="fas ${escapeHtml(icon)}"></i></span>
                    <span class="ai-image-select-copy">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(selected.label || selected.id || label)}</strong>
                    </span>
                    <i class="fas ${escapeHtml(chevronIcon)} ai-image-select-chevron"></i>
                </button>
                ${isOpen ? `
                    <div class="ai-image-select-menu ai-image-model-menu" role="menu" aria-label="${escapeHtml(label)}">
                        ${groups.map((group, index) => {
                            const groupActive = group.providerId === selectedGroup?.providerId;
                            const groupOpen = openModelProvider === group.providerId;
                            return `
                                <div class="ai-image-model-provider ${groupActive ? 'is-active' : ''} ${groupOpen ? 'is-open' : ''}" tabindex="0" role="menuitem" data-aiw-model-provider="${escapeHtml(group.providerId)}">
                                    <button class="ai-image-model-provider-trigger" type="button" tabindex="-1" aria-expanded="${groupOpen ? 'true' : 'false'}">
                                        <span>${escapeHtml(group.label)}</span>
                                        <i class="fas fa-chevron-right"></i>
                                    </button>
                                    <div class="ai-image-model-submenu" role="menu" aria-label="${escapeHtml(group.label)}">
                                        ${group.models.map((model) => `
                                            <button class="ai-image-select-option ${model.id === selected.id ? 'is-active' : ''}" type="button" role="menuitemradio" aria-checked="${model.id === selected.id ? 'true' : 'false'}" data-aiw-select-option data-aiw-select-field="${escapeHtml(field)}" data-aiw-select-value="${escapeHtml(model.id)}">
                                                <span>${escapeHtml(model.label || model.id)}</span>
                                                ${model.id === selected.id ? '<i class="fas fa-check"></i>' : ''}
                                            </button>
                                        `).join('')}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderReferenceBox() {
        const hasImage = Boolean(state.referenceImage);
        return `
            <div class="ai-image-reference">
                <div class="ai-image-reference-preview">
                    ${hasImage ? `<img src="${escapeHtml(state.referenceImage)}" alt="参考图片">` : '<i class="fas fa-image"></i>'}
                </div>
                <div class="ai-image-reference-copy">
                    <strong>${escapeHtml(referenceUploadBusy ? '正在上传参考图...' : (hasImage ? (state.referenceTitle || '参考图片') : '上传或从提示词作品带入'))}</strong>
                    <span>${escapeHtml(referenceUploadBusy ? '上传完成后即可用于真实模型处理' : (hasImage ? '用于图像发散、反推或智能体处理' : '图片会先安全上传到 CDN'))}</span>
                    <div class="ai-image-reference-actions">
                        <button class="ai-image-reference-btn" type="button" data-aiw-action="upload-reference"><i class="fas fa-upload"></i> 上传</button>
                        ${hasImage ? '<button class="ai-image-reference-btn" type="button" data-aiw-action="clear-reference"><i class="fas fa-xmark"></i> 清除</button>' : ''}
                    </div>
                </div>
            </div>
        `;
    }

    function renderMainComposer() {
        const inferredMode = inferWorkbenchMode();
        const imageContext = getCurrentImageContext();
        const extraReferences = getExtraReferenceImages();
        const hasImage = Boolean(imageContext.image);
        const isImplicitContinuation = Boolean(imageContext.isContinuation);
        const modeLabel = getModeLabel(inferredMode);
        const canSubmit = canSubmitWorkbench(inferredMode);
        const isVariationReference = Boolean(state.referenceIntent === 'variation' && state.referenceImage && !isImplicitContinuation);
        const modelField = state.billingMode === 'api' ? 'apiModel' : 'model';
        const modelOptions = getActiveModelOptions(inferredMode).map((model) => ({ value: model.id, label: model.label }));
        const submitLabel = inferredMode === 'chat' ? '发送消息' : modeLabel;
        const busyTask = getActiveDisplayTask();
        const canCancel = Boolean(busyTask && isBusyTask(busyTask));
        const promptPlaceholder = hasImage
            ? (inferredMode === 'chat'
                ? '围绕已上传图片提问，或继续输入你的问题'
                : (isImplicitContinuation ? '基于上方生成图继续描述你的调整方向' : (isVariationReference ? '描述你希望基于这张图发散出的方向' : '描述你想如何处理这张图，或输入“反推提示词”')))
            : '输入你的想象';
        const continuationMatch = isImplicitContinuation
            ? getResultImageByIdentity(imageContext.sourceTask?.id || state.continuationImage?.taskId || '', imageContext.resultId || state.continuationImage?.resultId || '', imageContext.resultIndex || state.continuationImage?.resultIndex || '')
            : null;
        const continuationPreview = isImplicitContinuation
            ? getResultPreviewPayload(continuationMatch?.task || imageContext.sourceTask, continuationMatch?.image, imageContext.image)
            : null;
        const uploadButtonHtml = renderComposerUploadButton(inferredMode);
        const chatAttachments = inferredMode === 'chat' ? normalizeChatAttachmentList(state.chatAttachments) : [];
        return `
            <div class="ai-image-main-composer">
                ${hasImage || extraReferences.length || chatAttachments.length ? `
                    <div class="ai-image-main-attachments">
                        ${hasImage ? `
                            <div class="ai-image-main-reference ${isImplicitContinuation ? 'is-implicit' : ''}" role="button" tabindex="0" data-aiw-reference-preview="${isImplicitContinuation ? 'continuation' : 'reference'}" data-aiw-preview-src="${escapeHtml(continuationPreview?.previewSrc || imageContext.image)}" data-aiw-preview-original-src="${escapeHtml(continuationPreview?.originalSrc || imageContext.image)}" data-aiw-preview-bytes="${escapeHtml(continuationPreview?.previewBytes || 0)}" data-aiw-original-bytes="${escapeHtml(continuationPreview?.originalBytes || 0)}" data-aiw-original-ready="${continuationPreview?.originalReady ? 'true' : 'false'}" data-aiw-original-status="${escapeHtml(continuationPreview?.originalStatus || '')}" data-aiw-preview-title="${escapeHtml(continuationPreview?.title || imageContext.title || '参考图片')}" data-aiw-preview-meta="${escapeHtml(continuationPreview?.meta || '参考图片')}" data-task-id="${escapeHtml(imageContext.sourceTask?.id || state.continuationImage?.taskId || '')}" data-result-id="${escapeHtml(imageContext.resultId || state.continuationImage?.resultId || '')}" data-result-index="${escapeHtml(imageContext.resultIndex || state.continuationImage?.resultIndex || '')}" aria-label="${escapeHtml(isImplicitContinuation ? '定位自动续作底图' : '预览参考图片')}" title="${escapeHtml(isImplicitContinuation ? '定位自动续作底图' : '预览参考图片')}">
                                <span><img src="${escapeHtml(imageContext.image)}" alt="参考图片"></span>
                                ${isImplicitContinuation ? '' : `<strong>${escapeHtml(isVariationReference ? '图像发散' : (imageContext.title || '参考图片'))}</strong>`}
                                ${isImplicitContinuation ? '<em>自动续作</em>' : '<button type="button" data-aiw-action="clear-reference" aria-label="清除参考图片"><i class="fas fa-xmark"></i></button>'}
                            </div>
                        ` : ''}
                        ${extraReferences.length ? `
                            <div class="ai-image-main-reference-list" aria-label="额外参考图">
                                ${extraReferences.map((item, index) => `
                                    <span class="ai-image-main-reference-chip" role="button" tabindex="0" data-aiw-reference-preview="reference" data-aiw-preview-src="${escapeHtml(item.image)}" data-aiw-preview-original-src="${escapeHtml(item.image)}" data-aiw-original-ready="true" data-aiw-preview-title="${escapeHtml(`参考 ${index + 1}`)}" data-aiw-preview-meta="参考图片" aria-label="预览参考图 ${index + 1}" title="预览参考图 ${index + 1}">
                                        <img src="${escapeHtml(item.image)}" alt="参考图 ${index + 1}">
                                        <em>${escapeHtml(`参考 ${index + 1}`)}</em>
                                        <button type="button" data-aiw-action="remove-reference-image" data-reference-index="${escapeHtml(index)}" aria-label="移除参考图 ${index + 1}">
                                            <i class="fas fa-xmark"></i>
                                        </button>
                                    </span>
                                `).join('')}
                            </div>
                        ` : ''}
                        ${renderChatAttachmentChips(chatAttachments)}
                    </div>
                ` : ''}
                ${state.composerError ? `
                    <div class="ai-image-main-error" role="status">
                        <i class="fas fa-circle-exclamation"></i>
                        <span>${escapeHtml(state.composerError)}</span>
                    </div>
                ` : ''}
                <div class="ai-image-main-composer-input ${uploadButtonHtml ? '' : 'has-no-upload'}">
                    <div class="ai-image-main-attach-action">
                        ${uploadButtonHtml}
                    </div>
                    <textarea class="ai-image-main-prompt" data-aiw-prompt rows="1" placeholder="${escapeHtml(promptPlaceholder)}"${isMobileKeyboardDevice() ? ' readonly inputmode="none" tabindex="-1" role="button" aria-haspopup="dialog"' : ''}>${escapeHtml(state.prompt)}</textarea>
                    <div class="ai-image-main-submit-action">
                        <button class="ai-image-main-submit ${canCancel ? 'is-cancel' : ''}" type="button" data-aiw-action="${canCancel ? 'cancel-task' : 'generate'}" data-task-id="${escapeHtml(busyTask?.id || '')}" aria-label="${escapeHtml(canCancel ? '取消生成' : submitLabel)}" ${canCancel || canSubmit ? '' : 'disabled'}>
                            <i class="fas ${canCancel ? 'fa-stop' : 'fa-arrow-up'}"></i>
                        </button>
                    </div>
                </div>
                <div class="ai-image-main-tools">
                    <span class="ai-image-main-billing ${state.billingMode ? '' : 'is-missing'}" data-aiw-action="toggle-billing"><i class="fas fa-gem"></i>${escapeHtml(getActiveBillingLabel())}</span>
                    ${isVideoMode(inferredMode) ? `${renderVideoComposerControls({ compactLabels: true })}${renderVideoSettingsSelect()}` : ''}
                    ${!isTextVisionMode(inferredMode) && !isVideoMode(inferredMode) ? renderImageSettingsSelect() : ''}
                    ${!isTextVisionMode(inferredMode) && !isVideoMode(inferredMode) ? renderCustomSelect({
                        field: 'ratio',
                        label: '比例',
                        icon: 'fa-crop-simple',
                        value: state.ratio,
                        options: Object.entries(RATIO_META).map(([id, meta]) => ({ value: id, label: meta.label }))
                    }) : ''}
                    ${!isTextVisionMode(inferredMode) && !isVideoMode(inferredMode) ? renderCustomSelect({
                        field: 'resolution',
                        label: '分辨率',
                        icon: 'fa-expand',
                        value: state.resolution,
                        options: Object.entries(RESOLUTION_META).map(([id, meta]) => ({ value: id, label: meta.label }))
                    }) : ''}
                    ${!isTextVisionMode(inferredMode) && !isVideoMode(inferredMode) ? renderCustomSelect({
                        field: 'quantity',
                        label: '数量',
                        icon: 'fa-layer-group',
                        value: String(state.quantity),
                        options: [1, 2, 4].map((value) => ({ value: String(value), label: `${value} 张` }))
                    }) : ''}
                    ${renderModelProviderSelect({
                        field: modelField,
                        label: '模型',
                        icon: 'fa-microchip',
                        value: getActiveModelValue(inferredMode),
                        mode: inferredMode,
                        disabled: !modelOptions.length,
	                    })}
                    ${inferredMode === 'chat' ? renderChatSettingsSelect() : ''}
                    ${inferredMode === 'chat' ? renderChatMemoryControl() : ''}
                    ${inferredMode === 'chat' ? renderChatModelCapabilityControls() : ''}
                    <span class="ai-image-main-cost"${canCancel && busyTask?.id ? ` data-aiw-live-status-task-id="${escapeHtml(busyTask.id)}" data-aiw-live-status-kind="composer"` : ''}>${escapeHtml(canCancel ? (busyTask?.mode === 'chat' ? getComposerBusyLabel(busyTask) : getStatusLabel(busyTask)) : getComposerCostValue(inferredMode))}</span>
                </div>
            </div>
        `;
    }

    function getModelPricingTabForCurrentTool() {
        const tool = getCurrentWorkbenchToolMode();
        return ['chat', 'image', 'video'].includes(tool) ? tool : 'chat';
    }

    function openModelPricingView() {
        modelPricingView.open = true;
        modelPricingView.tab = getModelPricingTabForCurrentTool();
        openSelect = '';
        if (isMobileWorkbenchViewport()) {
            sidebarView = '';
            sidebarEnteredView = '';
        }
        render({ preserveStageScroll: false, preservePromptFocus: false });
        loadRemoteConfig();
        loadModelPricing();
    }

    async function loadModelPricing({ force = false } = {}) {
        if (modelPricingView.loading || (modelPricingView.loaded && !force)) return;
        modelPricingView.loading = true;
        modelPricingView.error = '';
        render({ preserveStageScroll: false, preservePromptFocus: false });
        try {
            const payload = await requestAiImage('model-prices', {
                query: { site: getRuntimeSite() },
                auth: false
            });
            modelPricingView.textPrices = Array.isArray(payload?.textModelPrices)
                ? payload.textModelPrices
                : (Array.isArray(payload?.text_model_prices) ? payload.text_model_prices : []);
            modelPricingView.providerStatuses = Array.isArray(payload?.providerStatuses)
                ? payload.providerStatuses
                : (Array.isArray(payload?.provider_statuses) ? payload.provider_statuses : []);
            modelPricingView.loaded = true;
        } catch (error) {
            modelPricingView.error = String(error?.message || '模型价格加载失败');
        } finally {
            modelPricingView.loading = false;
            if (modelPricingView.open) {
                render({ preserveStageScroll: false, preservePromptFocus: false });
            }
        }
    }

    function formatModelPriceValue(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) return '--';
        const maximumFractionDigits = number >= 100 ? 2 : (number >= 1 ? 4 : 6);
        return number.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits
        });
    }

    function shouldShowModelTechnicalName(displayLabel = '', technicalName = '') {
        const label = String(displayLabel || '').trim().toLowerCase();
        const name = String(technicalName || '').trim().toLowerCase();
        return Boolean(name && name !== label);
    }

    function getPricingModelOption(group = 'chat', modelId = '', providerId = '') {
        const normalizedModel = String(modelId || '').trim().toLowerCase();
        const normalizedProvider = String(providerId || '').trim().toLowerCase();
        const options = group === 'chat'
            ? runtimeAdminTextModels
            : (group === 'video' ? runtimeAdminVideoModels : runtimeAdminImageModels);
        return options.find((model) => (
            String(model?.id || '').trim().toLowerCase() === normalizedModel
            && (!normalizedProvider || String(model?.providerId || '').trim().toLowerCase() === normalizedProvider)
        )) || options.find((model) => String(model?.id || '').trim().toLowerCase() === normalizedModel) || null;
    }

    function getTextModelPricingRows() {
        const prices = Array.isArray(modelPricingView.textPrices) ? modelPricingView.textPrices : [];
        const configured = runtimeAdminTextModels.length
            ? runtimeAdminTextModels
            : prices.map((price) => ({
                id: price.id,
                label: price.label || price.id,
                providerId: price.providerId || price.provider_id,
                providerLabel: price.providerLabel || price.provider_label
            }));
        const rows = [];
        const seen = new Set();
        configured.forEach((model) => {
            const id = String(model?.id || '').trim();
            const providerId = String(model?.providerId || '').trim();
            const key = `${providerId.toLowerCase()}:${id.toLowerCase()}`;
            if (!id || seen.has(key)) return;
            seen.add(key);
            const exact = prices.find((price) => (
                String(price?.id || '').toLowerCase() === id.toLowerCase()
                && String(price?.providerId || price?.provider_id || '').toLowerCase() === providerId.toLowerCase()
            ));
            const sameModelPrices = prices.filter((price) => String(price?.id || '').toLowerCase() === id.toLowerCase());
            const price = exact || (sameModelPrices.length === 1 ? sameModelPrices[0] : null);
            rows.push({
                id,
                label: model.label || price?.label || id,
                providerId,
                providerLabel: model.providerLabel || price?.providerLabel || price?.provider_label || '',
                price
            });
        });
        return rows;
    }

    function getTextPriceVariants(price = null) {
        if (!price) return [{ label: '', price: null }];
        const intervals = Array.isArray(price.intervals) ? price.intervals : [];
        if (!intervals.length) return [{ label: '', price }];
        return intervals.map((interval) => {
            const min = Number(interval?.min_tokens || 0);
            const max = interval?.max_tokens === null || interval?.max_tokens === undefined
                ? ''
                : formatCompactNumber(interval.max_tokens);
            const range = interval?.tier_label
                || (max ? `${formatCompactNumber(min)}-${max} Token` : `${formatCompactNumber(min)}+ Token`);
            return { label: range, price: interval };
        });
    }

    function renderTextModelPricing() {
        const rows = getTextModelPricingRows();
        if (!rows.length) {
            return renderModelPricingEmpty('fa-comments', '暂无文本模型价格');
        }
        return `
            <div class="ai-image-model-price-table ai-image-model-price-table--text" role="table" aria-label="文本对话模型价格">
                <div class="ai-image-model-price-table-head" role="row">
                    <span role="columnheader">模型</span>
                    <span role="columnheader">输入（积分 / 百万 Token）</span>
                    <span role="columnheader">输出（积分 / 百万 Token）</span>
                    <span role="columnheader">缓存读取（积分 / 百万 Token）</span>
                </div>
                ${rows.map((row) => getTextPriceVariants(row.price).map((variant) => {
                    const price = variant.price;
                    const billingModel = String(row.price?.billingModel || row.price?.billing_model || row.id).trim();
                    const displayLabel = String(row.label || row.id).trim();
                    const showBillingModel = shouldShowModelTechnicalName(displayLabel, billingModel);
                    const isAvailable = Boolean(price) && row.price?.available !== false;
                    return `
                        <div class="ai-image-model-price-row ${isAvailable ? '' : 'is-unavailable'}" role="row">
                            <div class="ai-image-model-price-name" role="cell">
                                <strong>${escapeHtml(displayLabel)}</strong>
                                ${showBillingModel ? `<span>${escapeHtml(billingModel)}</span>` : ''}
                                ${variant.label ? `<em>${escapeHtml(variant.label)}</em>` : ''}
                            </div>
                            ${isAvailable ? `
                                <span role="cell" data-label="输入（积分 / 百万 Token）">${escapeHtml(formatModelPriceValue(price?.input_price_per_million))}</span>
                                <span role="cell" data-label="输出（积分 / 百万 Token）">${escapeHtml(formatModelPriceValue(price?.output_price_per_million))}</span>
                                <span role="cell" data-label="缓存读取（积分 / 百万 Token）">${escapeHtml(formatModelPriceValue(price?.cache_read_price_per_million))}</span>
                            ` : '<span class="ai-image-model-price-unavailable" role="cell">价格未配置</span>'}
                        </div>
                    `;
                }).join('')).join('')}
            </div>
        `;
    }

    function getAdminPricingRows(group = 'image') {
        const site = getRuntimeSite();
        const allowedModes = group === 'video' ? new Set(['video']) : new Set(['text', 'image', 'agent']);
        const seen = new Set();
        return (Array.isArray(runtimePricingRules) ? runtimePricingRules : [])
            .filter((rule) => {
                const ruleSite = String(rule?.site || 'all').trim().toLowerCase();
                const billingMode = String(rule?.billing_mode || rule?.billingMode || '').trim().toLowerCase();
                const mode = String(rule?.mode || '').trim().toLowerCase();
                return rule?.is_active !== false
                    && (ruleSite === 'all' || ruleSite === site)
                    && billingMode === 'points'
                    && allowedModes.has(mode);
            })
            .map((rule) => {
                const modelId = String(rule.model || '*').trim() || '*';
                const providerId = getPricingRuleProviderId(rule);
                const model = modelId === '*' ? null : getPricingModelOption(group, modelId, providerId);
                const metadata = rule?.metadata && typeof rule.metadata === 'object' ? rule.metadata : {};
                const resolution = String(rule.resolution || '*').trim().toLowerCase();
                const ratio = String(rule.ratio || '*').trim();
                const quantity = clampNumber(rule.quantity, 1, 8, 1);
                const duration = String(metadata.duration || metadata.video_duration || metadata.seconds || '').trim();
                const variant = [
                    resolution !== '*' ? resolution.toUpperCase() : '',
                    ratio !== '*' ? ratio : '',
                    duration ? `${duration}s` : '',
                    quantity > 1 ? `${quantity}${group === 'video' ? ' 次' : ' 张'}` : ''
                ].filter(Boolean).join(' · ') || '标准';
                const key = [group, providerId, modelId.toLowerCase(), variant, rule.points].join(':');
                if (seen.has(key)) return null;
                seen.add(key);
                return {
                    id: modelId,
                    label: model?.label || (modelId === '*' ? '默认价格' : modelId),
                    providerLabel: model?.providerLabel || '',
                    variant,
                    points: getRuntimePricingRuleEstimate(rule, quantity)
                };
            })
            .filter(Boolean);
    }

    function renderAdminModelPricing(group = 'image') {
        const rows = getAdminPricingRows(group);
        if (!rows.length) {
            return renderModelPricingEmpty(group === 'video' ? 'fa-film' : 'fa-image', group === 'video' ? '暂无视频模型价格' : '暂无图片模型价格');
        }
        return `
            <div class="ai-image-model-price-table ai-image-model-price-table--points" role="table" aria-label="${group === 'video' ? '视频' : '图片'}模型价格">
                <div class="ai-image-model-price-table-head" role="row">
                    <span role="columnheader">模型</span>
                    <span role="columnheader">规格</span>
                    <span role="columnheader">价格</span>
                </div>
                ${rows.map((row) => {
                    const showModelId = shouldShowModelTechnicalName(row.label, row.id);
                    return `
                        <div class="ai-image-model-price-row" role="row">
                            <div class="ai-image-model-price-name" role="cell">
                                <strong>${escapeHtml(row.label)}</strong>
                                ${showModelId ? `<span>${escapeHtml(row.id)}</span>` : ''}
                            </div>
                            <span role="cell" data-label="规格">${escapeHtml(row.variant)}</span>
                            <strong class="ai-image-model-price-points" role="cell" data-label="价格">${escapeHtml(formatPoints(row.points))} 积分</strong>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderModelPricingEmpty(icon, copy) {
        return `
            <div class="ai-image-model-price-empty">
                <i class="fas ${escapeHtml(icon)}"></i>
                <span>${escapeHtml(copy)}</span>
            </div>
        `;
    }

    function renderModelPricingView() {
        const tabs = [
            { id: 'chat', label: '文本对话', icon: 'fa-comments' },
            { id: 'image', label: '图片生成', icon: 'fa-image' },
            { id: 'video', label: '视频生成', icon: 'fa-film' }
        ];
        const hasPartialTextPricing = modelPricingView.providerStatuses.some((status) => status?.available === false);
        let content = '';
        if (modelPricingView.tab === 'chat' && modelPricingView.loading && !modelPricingView.loaded) {
            content = renderModelPricingEmpty('fa-circle-notch fa-spin', '正在读取模型价格');
        } else if (modelPricingView.tab === 'chat' && modelPricingView.error) {
            content = `
                <div class="ai-image-model-price-empty is-error">
                    <i class="fas fa-circle-exclamation"></i>
                    <span>${escapeHtml(modelPricingView.error)}</span>
                    <button type="button" data-aiw-action="retry-model-pricing" aria-label="重新加载" title="重新加载"><i class="fas fa-rotate-right"></i></button>
                </div>
            `;
        } else if (modelPricingView.tab === 'chat') {
            content = `${hasPartialTextPricing ? '<div class="ai-image-model-price-status"><i class="fas fa-circle-info"></i><span>部分文本模型价格暂不可用</span></div>' : ''}${renderTextModelPricing()}`;
        } else {
            content = renderAdminModelPricing(modelPricingView.tab);
        }
        return `
            <section class="ai-image-model-pricing-view" aria-label="模型价格">
                <header class="ai-image-model-pricing-head">
                    <div>
                        <span><i class="fas fa-tags"></i></span>
                        <div><strong>模型价格</strong><em>${escapeHtml(modelPricingView.tab === 'chat' ? '实际价格' : '积分价格')}</em></div>
                    </div>
                </header>
                <div class="ai-image-model-pricing-tabs" role="tablist" aria-label="模型类型">
                    ${tabs.map((tab) => `
                        <button class="${modelPricingView.tab === tab.id ? 'is-active' : ''}" type="button" role="tab" aria-selected="${modelPricingView.tab === tab.id ? 'true' : 'false'}" data-aiw-action="set-model-pricing-tab" data-pricing-tab="${escapeHtml(tab.id)}">
                            <i class="fas ${escapeHtml(tab.icon)}"></i><span>${escapeHtml(tab.label)}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="ai-image-model-pricing-content">${content}</div>
            </section>
        `;
    }

    function renderStage() {
        if (modelPricingView.open) {
            return `
                <main class="ai-image-canvas is-model-pricing">
                    <div class="ai-image-stage">
                        <div class="ai-image-stage-inner is-model-pricing">
                            ${renderModelPricingView()}
                        </div>
                    </div>
                </main>
            `;
        }
        const activeTask = getTaskThreadRoot(getActiveTask()) || getActiveTask();
        const stageStateClass = activeTask ? 'has-task' : 'is-empty';
        return `
            <main class="ai-image-canvas">
                <div class="ai-image-stage">
                    <div class="ai-image-stage-inner ${stageStateClass}">
                        ${activeTask ? renderTaskStage(activeTask) : renderEmptyStage()}
                    </div>
                </div>
                ${renderMainComposer()}
            </main>
        `;
    }

    function renderEmptyStage() {
        return `
            <div class="ai-image-empty-state">
                <span class="ai-image-empty-icon ai-image-fab is-idle">${renderDockIcon()}</span>
                <p>
                    <span class="ai-image-empty-copy-line">生成期间可关闭工作台</span>
                    <span class="ai-image-empty-copy-line">系统将在后台继续工作，悬停于 AI 图标可预览生成进度</span>
                </p>
            </div>
        `;
    }

    function hasTaskDisplayableResult(task = {}) {
        if (!task) return false;
        if (task.mode === 'chat') {
            return Boolean(String(task.resultPrompt || '').trim() || String(task.reasoningText || '').trim());
        }
        if (task.mode === 'reverse') {
            return Boolean(String(task.resultPrompt || '').trim() || getTaskReferencePreviewImage(task));
        }
        return getTaskThread(getTaskThreadRoot(task) || task)
            .some((item) => buildTaskImageEntries(item).length > 0);
    }

    function renderTaskStage(task) {
        if (isTaskReloadableBillingRecord(task) && !hasTaskDisplayableResult(task)) {
            return renderTaskReloading(task);
        }
        if (task.mode === 'chat') {
            return renderChatThread(task);
        }
        if (task.status === 'succeeded' || isTaskReloadableBillingRecord(task)) {
            return renderTaskResult(task);
        }
        if ((task.status === 'cancelled' || task.status === 'failed') && isTextVisionTask(task) && !isTaskReloadableBillingRecord(task)) {
            return renderTaskStopped(task);
        }
        if (isTextVisionTask(task)) {
            return `
            <div class="ai-image-result-view ai-image-result-view--centered">
                <div class="ai-image-chat-result">
                    <div class="ai-image-chat-result-head">
                        <span><i class="fas ${task.mode === 'reverse' ? 'fa-quote-left' : 'fa-comments'}"></i></span>
                        <div>
                            <strong>${escapeHtml(getTaskTitle(task))}</strong>
                            <em>${escapeHtml(getTaskSubtitle(task))}</em>
                        </div>
                    </div>
                    <p data-aiw-live-status-task-id="${escapeHtml(task.id)}" data-aiw-live-status-kind="detail">${escapeHtml(getTaskProgressDetail(task))}</p>
                </div>
            </div>
            `;
        }
        const progress = Math.max(0, Math.min(100, task.progress || 0));
        const progressBadgeClass = task.progressKnown ? '' : ' is-unknown';
        const partialImageEntries = buildTaskImageEntries(task);
        const hasPartialImages = partialImageEntries.length > 0;
        const isStopped = ['failed', 'cancelled'].includes(task.status) && !isTaskReloadableBillingRecord(task);
        const { total } = getTaskGenerationCount(task);
        const missingPreviewSlots = getMissingResultSlotIndexes(partialImageEntries, total);
        const pendingPreviewCount = missingPreviewSlots.length;
        const showPendingPreview = !isStopped && !isTaskReloadableBillingRecord(task) && task.status !== 'succeeded' && pendingPreviewCount > 0;
        const showStoppedPreview = isStopped && pendingPreviewCount > 0;
        const pendingPreviewEntries = showPendingPreview
            ? buildTaskPlaceholderEntries(task, {
                type: 'pending',
                sequenceStart: 0,
                slotIndexes: missingPreviewSlots,
                count: pendingPreviewCount
            })
            : [];
        const stoppedPreviewEntries = showStoppedPreview
            ? buildTaskPlaceholderEntries(task, {
                type: 'stopped',
                sequenceStart: 0,
                slotIndexes: missingPreviewSlots,
                count: pendingPreviewCount
            })
            : [];
        const previewEntries = sortTaskPreviewEntries([
            ...partialImageEntries,
            ...pendingPreviewEntries,
            ...stoppedPreviewEntries
        ]);
        const previewCardCount = previewEntries.length;
        const resultGridModeClass = isVideoMode(task.mode) ? 'ai-image-result-grid--video' : '';
        const resultGridRatioClass = getResultGridRatioClass(task);
        return `
            <div class="ai-image-result-view ai-image-result-view--image">
                <div class="ai-image-result-content">
                    <div class="ai-image-live-copy">
                        <div>
                            <strong>${escapeHtml(getTaskTitle(task))}</strong><br>
                            <span>${escapeHtml(getTaskSubtitle(task))}</span>
                        </div>
                    <div class="ai-image-live-status">
                        <span class="ai-image-progress-badge${progressBadgeClass}" data-aiw-live-status-task-id="${escapeHtml(task.id)}" data-aiw-live-status-kind="badge">${escapeHtml(getTaskProgressBadge(task))}</span>
                        <span class="ai-image-progress-count" data-aiw-live-status-task-id="${escapeHtml(task.id)}" data-aiw-live-status-kind="generation">${escapeHtml(getTaskGenerationLabel(task))}</span>
                    </div>
                </div>
                <div class="ai-image-result-prompt">
                    <p>${escapeHtml(getTaskPromptText(task))}</p>
                    <button class="ai-image-result-prompt-copy" type="button" data-aiw-action="copy-task-prompt" data-task-id="${escapeHtml(task.id)}" aria-label="复制提示词" title="复制提示词">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
                <div class="ai-image-result-grid ${resultGridModeClass} ${resultGridRatioClass} ${previewCardCount === 1 ? 'ai-image-result-grid--single' : ''} ${hasPartialImages ? 'ai-image-result-grid--partial' : ''}">
                        ${previewEntries.map((entry, index) => entry.type === 'image'
                            ? renderTaskImageEntry(entry, index, getRatioAspect(task.ratio, task.mode), { navigationAnchor: index === 0 })
                            : renderInlineTaskPreview(entry.task, entry.type === 'stopped' ? (task.status === 'cancelled' ? '生成已取消' : '生成失败') : '生成中', { showPrompt: false, navigationAnchor: index === 0, imageSlot: entry.slotSequence })
                        ).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function renderTaskReloading(task) {
        const suggestion = getTaskFailureReason(task) || '刷新后正在重新加载记录';
        return `
                <div class="ai-image-result-view ai-image-result-view--centered">
                <div class="ai-image-reload-dot" tabindex="0" aria-label="${escapeHtml(`记录重新加载中：${suggestion}`)}">
                    <span>记录重新加载中</span>
                </div>
            </div>
        `;
    }

    function renderTaskStopped(task) {
        const isCancelled = task.status === 'cancelled';
        const title = isCancelled ? '生成已取消' : '生成失败';
        const suggestion = isCancelled
            ? '这次生成已经停止。你可以继续调整提示词后重新发送。'
            : getTaskFailureReason(task);
        return `
                <div class="ai-image-result-view ai-image-result-view--centered">
                <div class="ai-image-failure-dot" tabindex="0" aria-label="${escapeHtml(`${title}：${suggestion}`)}" data-aiw-tip="${escapeHtml(suggestion)}">
                    <i class="fas ${isCancelled ? 'fa-ban' : 'fa-triangle-exclamation'}"></i>
                    <span>${escapeHtml(title)}</span>
                </div>
            </div>
        `;
    }

    function renderInlineTaskPreview(task, label = '继续生成', { showPrompt = true, forceBusy = false, navigationAnchor = false, imageSlot = null, stepLabel = '' } = {}) {
        const aspect = getRatioAspect(task.ratio, task.mode);
        const isBusy = forceBusy || ['queued', 'processing'].includes(task.status) || task.status === 'streaming';
        const isStopped = ['failed', 'cancelled'].includes(task.status) && !isTaskReloadableBillingRecord(task);
        const isCancelled = task.status === 'cancelled';
        const stoppedReason = isStopped ? getTaskFailureReason(task) : '';
        const progress = getTaskStageProgressPercent(task);
        const statusItems = [
            { kind: 'step', text: stepLabel || getTaskCurrentStepLabel(task), stepLabel },
            { kind: 'image', text: getTaskSlotImageLabel(task, imageSlot), slotSequence: imageSlot },
            { kind: 'elapsed', text: getTaskElapsedLabel(task) }
        ];
        const navigationAttrs = navigationAnchor && task?.id
            ? ` data-task-id="${escapeHtml(task.id)}" data-aiw-chat-turn-id="${escapeHtml(task.id)}"`
            : '';
        return `
            <article class="ai-image-thread-step ${isBusy ? 'is-pending' : 'is-stopped'}"${navigationAttrs}>
                ${showPrompt ? `<div class="ai-image-thread-prompt">
                    <span>${escapeHtml(label)}</span>
                    <p>${escapeHtml(getTaskPromptText(task))}</p>
                    <em>${escapeHtml(getTaskImageMeta(task))}</em>
                </div>` : ''}
                <div class="ai-image-result ${isBusy ? 'ai-image-result--pending' : 'ai-image-result--stopped'}" style="--aiw-result-aspect:${escapeHtml(aspect)}">
                    <div class="ai-image-result-main">
                        <div class="ai-image-result-media">
                            ${isBusy ? `
                                <div class="ai-image-live-visual ai-image-live-visual--inline">
                                    <span class="ai-image-live-beam"></span>
                                </div>
                            ` : `
                                <div class="ai-image-inline-stopped-visual">
                                    <i class="fas ${isCancelled ? 'fa-ban' : 'fa-triangle-exclamation'}"></i>
                                </div>
                            `}
		                            <span class="ai-image-result-resolution">${escapeHtml(getTaskResolutionLabel(task))}</span>
		                            ${isBusy ? `<div class="ai-image-result-pending-overlay">
		                                <div class="ai-image-result-pending-meta">
                                            ${statusItems.map((item, itemIndex) => `<span class="${itemIndex === 0 ? 'is-step' : ''}" data-aiw-live-status-task-id="${escapeHtml(task.id)}" data-aiw-live-status-kind="${escapeHtml(item.kind)}"${Number.isFinite(Number(item.slotSequence)) && Number(item.slotSequence) > 0 ? ` data-aiw-live-status-slot="${escapeHtml(item.slotSequence)}"` : ''}${item.stepLabel ? ` data-aiw-live-status-step-label="${escapeHtml(item.stepLabel)}"` : ''}>${escapeHtml(item.text)}</span>`).join('')}
		                                </div>
		                                <div class="ai-image-progress" data-progress-key="inline-${escapeHtml(task.id)}" data-progress="${escapeHtml(Math.round(progress))}" style="--aiw-progress:${progress / 100}"><span></span></div>
		                            </div>` : (stoppedReason ? `<div class="ai-image-result-failure-reason">${escapeHtml(stoppedReason)}</div>` : '')}
		                        </div>
                    </div>
                </div>
            </article>
        `;
    }

    function renderInlineTaskReloadingPreview(task, label = '记录重新加载中', { showPrompt = true, navigationAnchor = false } = {}) {
        const aspect = getRatioAspect(task.ratio, task.mode);
        const navigationAttrs = navigationAnchor && task?.id
            ? ` data-task-id="${escapeHtml(task.id)}" data-aiw-chat-turn-id="${escapeHtml(task.id)}"`
            : '';
        return `
            <article class="ai-image-thread-step is-reloading"${navigationAttrs}>
                ${showPrompt ? `<div class="ai-image-thread-prompt">
                    <span>${escapeHtml(label)}</span>
                    <p>${escapeHtml(getTaskPromptText(task))}</p>
                    <em>${escapeHtml(getTaskImageMeta(task))}</em>
                </div>` : ''}
                <div class="ai-image-result ai-image-result--reloading" style="--aiw-result-aspect:${escapeHtml(aspect)}">
                    <div class="ai-image-result-main">
                        <div class="ai-image-result-media">
                            <div class="ai-image-inline-reloading-visual">
                                <span>记录重新加载中</span>
                            </div>
                            <span class="ai-image-result-resolution">${escapeHtml(getTaskResolutionLabel(task))}</span>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }

    function renderTaskContinuationPrompt(entry, { navigationAnchor = false } = {}) {
        const navigationAttrs = navigationAnchor && entry.task?.id
            ? ` data-task-id="${escapeHtml(entry.task.id)}" data-aiw-chat-turn-id="${escapeHtml(entry.task.id)}"`
            : '';
        return `
                                    <article class="ai-image-thread-step ai-image-thread-step--prompt"${navigationAttrs}>
                                        <div class="ai-image-thread-prompt">
                                            <span>${escapeHtml(entry.baseSequence ? `基于序列 ${entry.baseSequence} 续作` : '续作提示词')}</span>
                                            <p>${escapeHtml(getTaskPromptText(entry.task))}</p>
                                            <em class="ai-image-thread-meta">
                                                <span>${escapeHtml(getTaskImageMeta(entry.task))}</span>
                                            </em>
                                        </div>
                                    </article>
                        `;
    }

    function renderTaskImageEntry(entry, index = 0, aspect = '1 / 1', { navigationAnchor = false, imageLoading = 'eager', imageFetchPriority = 'high' } = {}) {
        const previewTitle = getTaskTitle(entry.task);
        const isVideo = isVideoMode(entry.task?.mode) || isVideoResultImage(entry.image);
        const videoAwaitingReady = isVideo && isVideoImageAwaitingReady(entry.image);
        const originalReady = isVideo
            ? (!videoAwaitingReady && Boolean(entry.originalSrc || entry.src))
            : Boolean(entry.image?.originalReady && entry.originalSrc);
        const originalStatusLabel = isVideo
            ? (videoAwaitingReady ? '视频转存中' : '视频')
            : getImageOriginalStatusLabel(entry.image);
        const imageIdentityKey = getImageIdentityKey({
            taskId: entry.image?.taskId || entry.task.id,
            resultId: entry.image?.resultId || '',
            resultIndex: entry.image?.index ?? entry.imageIndex,
            src: entry.src,
            context: 'result'
        });
        const previewSrc = isVideo ? entry.src : getStableImageUrl(imageIdentityKey, entry.src);
        if (isVideo) warmVideoPreviewConnection(previewSrc);
        const previewMeta = [getTaskImageMeta(entry.task), isVideo ? '视频' : originalStatusLabel, formatGeneratedTime(entry.task.completedAt || entry.task.createdAt)].filter(Boolean).join(' · ');
        const videoFailed = isVideo && !videoAwaitingReady && hasFailedVideo(previewSrc);
        const mediaStateClass = [
            isVideo ? 'is-video-result' : '',
            isVideo && hasLoadedVideo(previewSrc) ? 'is-video-ready is-image-loaded' : '',
            videoFailed ? 'is-video-broken' : '',
            isVideo && !hasLoadedVideo(previewSrc) && !videoFailed ? 'is-video-loading' : '',
            !isVideo && hasLoadedImage(previewSrc) ? 'is-image-loaded' : '',
            !isVideo && hasFailedImage(previewSrc) ? 'is-image-loading' : ''
        ].filter(Boolean).join(' ');
        const videoProgressLabel = isVideo ? (videoAwaitingReady ? '转存中' : getVideoProgressLabel(previewSrc)) : '';
        const videoProgressStyle = isVideo ? `--aiw-video-progress:${escapeHtml(getVideoProgressCss(previewSrc))};` : '';
        const downloadAttrs = originalReady
            ? `href="${escapeHtml(entry.originalSrc || previewSrc)}" download target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(isVideo ? '下载视频' : '下载原图')}" title="${escapeHtml(isVideo ? '下载视频' : '下载原图')}"`
            : `href="${escapeHtml(previewSrc)}" aria-disabled="true" class="ai-image-result-action is-disabled" aria-label="${escapeHtml(originalStatusLabel)}" title="${escapeHtml(originalStatusLabel)}"`;
        const downloadClass = originalReady ? 'ai-image-result-action' : '';
        const downloadIcon = originalReady ? 'fa-download' : 'fa-clock';
        const navigationAttrs = navigationAnchor && entry.task?.id
            ? ` data-task-id="${escapeHtml(entry.task.id)}" data-aiw-chat-turn-id="${escapeHtml(entry.task.id)}"`
            : '';
        return `
                                    <article class="ai-image-thread-step"${navigationAttrs}>
                                        <div class="ai-image-result" style="--aiw-result-aspect:${escapeHtml(getRatioAspect(entry.task.ratio, entry.task.mode) || aspect)}">
                                            <div class="ai-image-result-main">
                                                <div class="ai-image-result-media ${mediaStateClass}" ${isVideo ? 'aria-label="生成视频预览"' : `role="button" tabindex="0" aria-label="打开全分辨率预览" title="${escapeHtml(originalReady ? '打开全分辨率预览' : '打开预览图，原图转存中')}" data-aiw-preview-open`} data-aiw-media-type="${escapeHtml(isVideo ? 'video' : 'image')}" data-aiw-image-key="${escapeHtml(imageIdentityKey)}" data-aiw-preview-src="${escapeHtml(previewSrc)}" data-aiw-preview-thumb="${escapeHtml(previewSrc)}" data-aiw-preview-original-src="${escapeHtml(entry.originalSrc || '')}" data-aiw-preview-bytes="${escapeHtml(getResultImagePreviewBytes(entry.image))}" data-aiw-original-bytes="${escapeHtml(getResultImageOriginalBytes(entry.image))}" data-aiw-original-ready="${originalReady ? 'true' : 'false'}" data-aiw-original-status="${escapeHtml(entry.image?.originalStatus || '')}" data-aiw-preview-title="${escapeHtml(previewTitle)}" data-aiw-preview-meta="${escapeHtml(previewMeta)}" data-result-id="${escapeHtml(entry.image?.resultId || '')}" data-task-id="${escapeHtml(entry.image?.taskId || entry.task.id)}" data-result-index="${escapeHtml(entry.image?.index ?? entry.imageIndex)}" style="${videoProgressStyle}">
                                                    ${isVideo ? `<video src="${escapeHtml(previewSrc)}" data-aiw-video-src="${escapeHtml(previewSrc)}" controls playsinline preload="auto"></video>` : `<img src="${escapeHtml(previewSrc)}" alt="生成结果 ${index + 1}" loading="${escapeHtml(imageLoading)}" fetchpriority="${escapeHtml(imageFetchPriority)}" decoding="async">`}
                                                        <div class="ai-image-result-broken" aria-hidden="true">
                                                            <i class="fas fa-triangle-exclamation"></i>
                                                            <strong>${escapeHtml(isVideo ? '视频暂不可用' : '预览图暂不可用')}</strong>
                                                            <span>${escapeHtml(isVideo ? '请稍后刷新或重新生成' : '请重新生成或稍后再试')}</span>
                                                        </div>
                                                        ${isVideo ? `<span class="ai-image-video-progress" data-aiw-video-progress aria-label="${escapeHtml(videoProgressLabel === '转存中' ? '视频转存中' : (videoProgressLabel === '加载中' ? '视频加载中' : `视频已缓冲 ${videoProgressLabel}`))}">${escapeHtml(videoProgressLabel)}</span>` : ''}
                                                        ${isVideo ? '' : `<button class="ai-image-result-continue" type="button" data-aiw-action="continue-image" data-task-id="${escapeHtml(entry.image?.taskId || entry.task.id)}" data-result-id="${escapeHtml(entry.image?.resultId || '')}" data-result-index="${escapeHtml(entry.image?.index ?? entry.imageIndex)}" data-reference-image="${escapeHtml(entry.originalSrc || previewSrc)}" aria-label="基于这张图续作">
                                                                <i class="fas fa-wand-magic-sparkles"></i>
                                                                <span>续作</span>
                                                            </button>`}
                                                        <span class="ai-image-result-sequence">${escapeHtml(isVideo ? `视频 ${entry.sequence}` : `序列 ${entry.sequence}`)}</span>
                                                        <span class="ai-image-result-resolution">${escapeHtml(getTaskResolutionLabel(entry.task))}</span>
                                                            ${originalReady ? '' : `<span class="ai-image-result-original-status"><i class="fas fa-clock"></i>${escapeHtml(originalStatusLabel)}</span>`}
                                                    <div class="ai-image-result-actions">
                                                        <a ${downloadAttrs} ${downloadClass ? `class="${downloadClass}"` : ''} data-aiw-download="original" data-result-id="${escapeHtml(entry.image?.resultId || '')}" data-task-id="${escapeHtml(entry.image?.taskId || entry.task.id)}" data-result-index="${escapeHtml(entry.image?.index ?? entry.imageIndex)}">
                                                            <i class="fas ${downloadIcon}"></i>
                                                        </a>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </article>
                        `;
    }

    function renderChatThread(rootTask) {
        const threadRoot = getTaskThreadRoot(rootTask) || rootTask;
        const chatTasks = getTaskThread(threadRoot)
            .filter((task) => task.mode === 'chat')
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        return `
            <div class="ai-image-result-view ai-image-result-view--image ai-image-result-view--chat">
                <div class="ai-image-result-content ai-image-result-content--chat">
                    <div class="ai-image-result-grid ai-image-result-grid--thread ai-image-result-grid--chat">
                        ${chatTasks.map((task, index) => renderChatTurn(task, index, { showDuration: index === chatTasks.length - 1 })).join('')}
                        <div class="ai-image-chat-spacer" aria-hidden="true"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function getActiveChatNavigationTasks() {
        const activeTask = getActiveTask();
        if (!activeTask || activeTask.mode === 'reverse') return [];
        const threadRoot = getTaskThreadRoot(activeTask) || activeTask;
        return getTaskThread(threadRoot)
            .filter((task) => {
                if (!task?.id || task.mode === 'reverse') return false;
                return activeTask.mode === 'chat'
                    ? task.mode === 'chat'
                    : task.mode !== 'chat';
            })
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    function renderChatNavigationLayer() {
        const rail = renderChatNavigationRail(getActiveChatNavigationTasks());
        if (!rail) return '';
        return `
            <div class="ai-image-chat-nav-layer" data-aiw-chat-nav-layer>
                ${rail}
                <div class="ai-image-chat-nav-preview" data-aiw-chat-nav-preview role="tooltip" hidden>
                    <strong data-aiw-chat-nav-preview-title></strong>
                    <span data-aiw-chat-nav-preview-summary></span>
                    <em data-aiw-chat-nav-preview-meta></em>
                </div>
            </div>
        `;
    }

    function renderChatNavigationRail(chatTasks = []) {
        const items = chatTasks.filter((task, index) => task?.id && getChatNavigationTitle(task, index));
        if (items.length < CHAT_NAVIGATION_MIN_ITEMS) return '';
        return `
            <nav class="ai-image-chat-nav-rail" data-aiw-chat-nav-rail aria-label="工作台快速定位">
                <div class="ai-image-chat-nav-list">
                    ${items.map((task, index) => renderChatNavigationItem(task, index, items.length)).join('')}
                </div>
            </nav>
        `;
    }

    function renderChatNavigationItem(task, index = 0, total = 0) {
        const question = truncateText(getChatNavigationTitle(task, index), 96);
        const answer = truncateText(getChatNavigationSummary(task), 170);
        const meta = getChatNavigationMeta(task, index, total);
        const unit = getChatNavigationUnit(task);
        const fallbackTitle = task.mode === 'chat' ? `第 ${index + 1} 条提问` : `第 ${index + 1} 个生成`;
        return `
            <button class="ai-image-chat-nav-item" type="button" data-aiw-chat-nav-id="${escapeHtml(task.id)}" data-aiw-chat-nav-title="${escapeHtml(question || fallbackTitle)}" data-aiw-chat-nav-summary="${escapeHtml(answer)}" data-aiw-chat-nav-meta="${escapeHtml(meta)}" aria-label="${escapeHtml(`跳转到第 ${index + 1} ${unit}：${question || fallbackTitle}`)}">
                <span class="ai-image-chat-nav-marker" aria-hidden="true"></span>
            </button>
        `;
    }

    function getChatNavigationTitle(task = {}, index = 0) {
        if (task.mode === 'chat') return getChatTaskQuestionText(task);
        return getTaskPromptText(task) || getTaskTitle(task) || `第 ${index + 1} 个生成`;
    }

    function getChatNavigationSummary(task = {}) {
        if (task.mode === 'chat') {
            return getChatTaskAnswerText(task) || getTaskProgressDetail(task);
        }
        if (isTaskReloadableBillingRecord(task)) {
            return '记录重新加载中';
        }
        if (task.status === 'failed' || task.status === 'cancelled') {
            return getTaskFailureReason(task);
        }
        return [getTaskImageMeta(task), getStatusLabel(task)].filter(Boolean).join(' · ');
    }

    function getChatNavigationUnit(task = {}) {
        if (task.mode === 'chat') return '条';
        if (isVideoMode(task.mode)) return '段';
        return '项';
    }

    function getChatNavigationMeta(task = {}, index = 0, total = 0) {
        const status = getStatusLabel(task);
        const timing = getTaskDurationMetaLabel(task);
        const unit = getChatNavigationUnit(task);
        const parts = [
            `第 ${index + 1}/${Math.max(total, index + 1)} ${unit}`,
            status,
            timing
        ].filter(Boolean);
        return parts.join(' · ');
    }

    function renderChatTurn(task, index = 0, { showDuration = false } = {}) {
        const statsItems = getChatTaskStatsItems(task, { showDuration });
        const questionText = getChatTaskQuestionText(task);
        const outputText = getChatTaskAnswerText(task);
        const reasoningBlock = renderChatReasoningBlock(task);
        const showLoadingDots = isBusyTask(task) && !outputText && !reasoningBlock;
        const showAnswerActions = Boolean(outputText);
        return `
            <article class="ai-image-thread-step ai-image-chat-step ${isBusyTask(task) ? 'is-pending' : ''}" data-task-id="${escapeHtml(task.id)}" data-aiw-chat-turn-id="${escapeHtml(task.id)}">
                ${questionText ? `
                    <div class="ai-image-chat-question">
                        <p>${escapeHtml(questionText)}</p>
                        <button class="ai-image-chat-copy ai-image-chat-copy--question" type="button" data-aiw-action="copy-chat-text" data-task-id="${escapeHtml(task.id)}" data-copy-kind="question" aria-label="复制提问" title="复制提问">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                ` : ''}
                <div class="ai-image-chat-result ${isBusyTask(task) ? 'is-pending' : ''}">
                    <div class="ai-image-chat-answer-head">
                        ${statsItems.length ? `
                            <div class="ai-image-chat-meta">
                                ${statsItems.map((item) => `<em${item.live ? ` data-aiw-live-status-task-id="${escapeHtml(task.id)}" data-aiw-live-status-kind="${escapeHtml(item.kind)}"` : ''}>${escapeHtml(item.text)}</em>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                    <div class="ai-image-chat-output" data-aiw-chat-output>
                        ${reasoningBlock}
                        ${showLoadingDots ? renderChatLoadingDots() : ''}
                        <p data-aiw-chat-answer-text ${outputText ? '' : 'hidden'}>${escapeHtml(outputText)}</p>
                        ${renderChatCancelledNotice(task)}
                        <div class="ai-image-chat-actions ai-image-chat-actions--answer" data-aiw-chat-answer-actions ${showAnswerActions ? '' : 'hidden'}>
	                                <button class="ai-image-chat-copy ai-image-chat-copy--answer" type="button" data-aiw-action="copy-chat-text" data-task-id="${escapeHtml(task.id)}" data-copy-kind="answer" aria-label="复制回答" title="复制回答">
	                                    <i class="fas fa-copy"></i>
	                                </button>
	                        </div>
                    </div>
                </div>
            </article>
        `;
    }

    function buildTaskImageEntries(task = {}, {
        taskIndex = 0,
        sequenceStart = 0,
        baseSequence = 0
    } = {}) {
        return (task.images || [])
            .map((image, imageIndex) => {
                const slotIndex = getResultSlotIndex(image, imageIndex);
                return {
                    type: 'image',
                    task,
                    image,
                    src: getImagePreviewUrl(image) || getImageUrl(image),
                    originalSrc: getImageUrl(image),
                    imageIndex,
                    slotIndex,
                    slotSequence: slotIndex + 1,
                    taskIndex,
                    sequence: sequenceStart + slotIndex + 1,
                    baseSequence
                };
            })
            .filter((entry) => entry.src)
            .sort(compareTaskPreviewEntries);
    }

    function getResultSlotIndex(image = {}, fallbackIndex = 0) {
        const parsed = Number(image?.index ?? image?.resultIndex ?? image?.result_index ?? fallbackIndex);
        return Number.isFinite(parsed) && parsed >= 0
            ? Math.max(0, Math.min(3, Math.round(parsed)))
            : Math.max(0, Math.min(3, Math.round(Number(fallbackIndex) || 0)));
    }

    function compareTaskPreviewEntries(left = {}, right = {}) {
        const leftSequence = Number(left.sequence || 0);
        const rightSequence = Number(right.sequence || 0);
        if (leftSequence !== rightSequence) return leftSequence - rightSequence;
        if (left.type !== right.type) return left.type === 'image' ? -1 : 1;
        return Number(left.imageIndex || 0) - Number(right.imageIndex || 0);
    }

    function sortTaskPreviewEntries(entries = []) {
        return (Array.isArray(entries) ? entries : []).slice().sort(compareTaskPreviewEntries);
    }

    function getMissingResultSlotIndexes(entries = [], total = 1) {
        const normalizedTotal = Math.max(0, Math.min(4, Math.round(Number(total) || 0)));
        const usedSlots = new Set((Array.isArray(entries) ? entries : [])
            .map((entry) => Number(entry.slotIndex))
            .filter((slotIndex) => Number.isFinite(slotIndex) && slotIndex >= 0 && slotIndex < normalizedTotal));
        return Array.from({ length: normalizedTotal }, (_, index) => index).filter((index) => !usedSlots.has(index));
    }

    function buildTaskPlaceholderEntries(task = {}, {
        type = 'pending',
        taskIndex = 0,
        sequenceStart = 0,
        slotIndexStart = sequenceStart,
        slotIndexes = null,
        count = 0,
        baseSequence = 0,
        forceBusy = false
    } = {}) {
        const explicitSlotIndexes = Array.isArray(slotIndexes)
            ? slotIndexes.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0).slice(0, 4)
            : null;
        const length = explicitSlotIndexes
            ? explicitSlotIndexes.length
            : Math.max(0, Math.min(4, Math.round(Number(count) || 0)));
        return Array.from({ length }, (_, index) => {
            const slotIndex = explicitSlotIndexes ? Math.max(0, Math.min(3, Math.round(explicitSlotIndexes[index]))) : slotIndexStart + index;
            const sequence = explicitSlotIndexes ? sequenceStart + slotIndex + 1 : sequenceStart + index + 1;
            const slotSequence = slotIndex + 1;
            return {
                type,
                task,
                taskIndex,
                slotIndex,
                sequence,
                slotSequence,
                baseSequence: index === 0 ? baseSequence : sequence - 1,
                forceBusy
            };
        }).sort(compareTaskPreviewEntries);
    }

    function renderTaskResult(task) {
        if (task.mode === 'chat') {
            const threadRoot = getTaskThreadRoot(task) || task;
            const chatTasks = getTaskThread(threadRoot)
                .filter((item) => item.mode === 'chat')
                .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            const latestChatTask = chatTasks[chatTasks.length - 1] || task;
            const statsItems = getChatTaskStatsItems(task, { showDuration: latestChatTask.id === task.id });
            const questionText = getChatTaskQuestionText(task);
            const reasoningBlock = renderChatReasoningBlock(task);
            const outputText = getChatTaskAnswerText(task) || (isBusyTask(task) && reasoningBlock ? '' : buildChatResponse(task));
            const showLoadingDots = isBusyTask(task) && !String(task?.resultPrompt || '').trim() && !reasoningBlock;
            const showAnswerActions = Boolean(outputText);
            return `
                <div class="ai-image-result-view ai-image-result-view--centered">
                    <div class="ai-image-chat-result">
                        ${questionText ? `
                            <div class="ai-image-chat-question">
                                <p>${escapeHtml(questionText)}</p>
                                <button class="ai-image-chat-copy ai-image-chat-copy--question" type="button" data-aiw-action="copy-chat-text" data-task-id="${escapeHtml(task.id)}" data-copy-kind="question" aria-label="复制提问" title="复制提问">
                                    <i class="fas fa-copy"></i>
                                </button>
                            </div>
                        ` : ''}
                        <div class="ai-image-chat-answer-head">
                            ${statsItems.length ? `
                                <div class="ai-image-chat-meta">
                                    ${statsItems.map((item) => `<em>${escapeHtml(item.text)}</em>`).join('')}
                                </div>
                            ` : ''}
                        </div>
                        <div class="ai-image-chat-output">
                            ${reasoningBlock}
                            ${showLoadingDots ? renderChatLoadingDots() : (outputText ? `<p>${escapeHtml(outputText)}</p>` : '')}
                            ${renderChatCancelledNotice(task)}
                            ${showAnswerActions ? `
	                                <div class="ai-image-chat-actions ai-image-chat-actions--answer">
	                                    <button class="ai-image-chat-copy ai-image-chat-copy--answer" type="button" data-aiw-action="copy-chat-text" data-task-id="${escapeHtml(task.id)}" data-copy-kind="answer" aria-label="复制回答" title="复制回答">
	                                        <i class="fas fa-copy"></i>
	                                    </button>
	                                </div>
	                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }

        if (task.mode === 'reverse') {
            const referenceImage = getTaskReferencePreviewImage(task);
            const referenceTitle = task.referenceTitle || normalizeReferenceItem(task.referenceImages?.[0])?.title || '待反推图片';
            const generatedDateTime = formatGeneratedDateTime(task.completedAt || task.createdAt);
            const reverseMeta = [getTaskSubtitle(task), generatedDateTime ? `生成时间 ${generatedDateTime}` : ''].filter(Boolean).join(' · ');
            return `
                <div class="ai-image-result-view ai-image-result-view--reverse">
                    <div class="ai-image-reverse-result">
                        ${referenceImage ? `
                            <figure class="ai-image-reverse-reference">
                                <img src="${escapeHtml(referenceImage)}" alt="${escapeHtml(referenceTitle)}">
                            </figure>
                        ` : ''}
                        <span class="ai-image-reverse-meta">${escapeHtml(reverseMeta)}</span>
                        <div class="ai-image-reverse-output">
                            <p>${escapeHtml(task.resultPrompt || buildReversePrompt(task))}</p>
                        </div>
                        <button class="ai-image-text-btn" type="button" data-aiw-action="reuse-task" data-task-id="${escapeHtml(task.id)}">
                            <i class="fas fa-wand-magic-sparkles"></i>
                            用这段提示词生成
                        </button>
                    </div>
                </div>
            `;
        }

        const aspect = isVideoMode(task.mode)
            ? (VIDEO_RATIO_META[task.ratio]?.aspect || '16 / 9')
            : (RATIO_META[task.ratio]?.aspect || '1 / 1');
        const promptText = getTaskPromptText(task);
        const promptOverflowClass = promptText.length > 72 ? ' is-overflowing' : '';
        const generatedTime = formatGeneratedTime(task.completedAt || task.createdAt);
        const threadRoot = getTaskThreadRoot(task) || task;
        const threadTasks = getTaskThread(threadRoot).filter((item) => item.mode !== 'chat' && item.mode !== 'reverse');
        const hasThreadChildren = threadTasks.length > 1;
        let sequenceCursor = 0;
        const taskSequenceMap = new Map();
        const imageEntries = threadTasks.flatMap((item, taskIndex) => {
            const baseSequence = taskSequenceMap.get(item.parentTaskId) || 0;
            if (item.status !== 'succeeded') {
                const isReloadingRecord = isTaskReloadableBillingRecord(item);
                const imageEntriesForTask = buildTaskImageEntries(item, {
                    taskIndex,
                    sequenceStart: sequenceCursor,
                    baseSequence
                });
                const { total } = getTaskGenerationCount(item);
                const missingSlotIndexes = getMissingResultSlotIndexes(imageEntriesForTask, total);
                const pendingEntryCount = missingSlotIndexes.length;
                if (imageEntriesForTask.length && (pendingEntryCount <= 0 || isReloadingRecord)) {
                    const lastEntry = imageEntriesForTask[imageEntriesForTask.length - 1];
                    taskSequenceMap.set(item.id, lastEntry.sequence);
                    sequenceCursor = lastEntry.sequence;
                    return imageEntriesForTask;
                }
                const pendingSequence = sequenceCursor + (missingSlotIndexes[0] ?? imageEntriesForTask.length) + 1;
                const pendingBaseSequence = pendingSequence - 1;
                const placeholderEntries = buildTaskPlaceholderEntries(item, {
                    type: isReloadingRecord ? 'reloading' : 'pending',
                    taskIndex,
                    sequenceStart: sequenceCursor,
                    slotIndexes: pendingEntryCount ? missingSlotIndexes : [imageEntriesForTask.length],
                    count: pendingEntryCount || 1,
                    baseSequence: pendingBaseSequence
                });
                const combinedEntries = sortTaskPreviewEntries([
                    ...imageEntriesForTask,
                    ...placeholderEntries
                ]);
                const lastPlaceholder = combinedEntries[combinedEntries.length - 1];
                taskSequenceMap.set(item.id, lastPlaceholder?.sequence || pendingSequence);
                sequenceCursor = lastPlaceholder?.sequence || pendingSequence;
                if (isReloadingRecord) {
                    return imageEntriesForTask.length
                        ? imageEntriesForTask
                        : placeholderEntries;
                }
                return combinedEntries;
            }

            const entries = buildTaskImageEntries(item, {
                taskIndex,
                sequenceStart: sequenceCursor,
                baseSequence
            });
            const { total } = getTaskGenerationCount(item);
            const missingSlotIndexes = getMissingResultSlotIndexes(entries, total);
            const missingResultCount = missingSlotIndexes.length;
            if (entries.length && missingResultCount > 0 && !isVideoMode(item.mode)) {
                const holdMissingResults = shouldHoldIncompleteSucceededImageResult(item, entries.length);
                const placeholderEntries = buildTaskPlaceholderEntries(item, {
                    type: holdMissingResults ? 'pending' : 'reloading',
                    taskIndex,
                    sequenceStart: sequenceCursor,
                    slotIndexes: missingSlotIndexes,
                    count: missingResultCount,
                    baseSequence: sequenceCursor + (missingSlotIndexes[0] ?? entries.length),
                    forceBusy: holdMissingResults
                });
                const combinedEntries = sortTaskPreviewEntries([
                    ...entries,
                    ...placeholderEntries
                ]);
                const lastPlaceholder = combinedEntries[combinedEntries.length - 1];
                taskSequenceMap.set(item.id, lastPlaceholder?.sequence || entries[entries.length - 1].sequence);
                sequenceCursor = lastPlaceholder?.sequence || entries[entries.length - 1].sequence;
                return combinedEntries;
            }
            if (!entries.length) {
                const awaitingVideoResult = isVideoMode(item.mode) && item.status === 'succeeded';
                const awaitingImageReload = !awaitingVideoResult && item.status === 'succeeded';
                const holdMissingResults = awaitingImageReload && shouldHoldIncompleteSucceededImageResult(item, 0);
                const missingIndexes = getMissingResultSlotIndexes([], awaitingImageReload ? Math.max(1, total) : 1);
                const placeholderEntries = buildTaskPlaceholderEntries(item, {
                    type: holdMissingResults ? 'pending' : (awaitingImageReload ? 'reloading' : 'pending'),
                    taskIndex,
                    sequenceStart: sequenceCursor,
                    slotIndexes: missingIndexes,
                    count: awaitingImageReload ? Math.max(1, total) : 1,
                    baseSequence,
                    forceBusy: awaitingVideoResult || holdMissingResults
                });
                const lastPlaceholder = placeholderEntries[placeholderEntries.length - 1];
                taskSequenceMap.set(item.id, lastPlaceholder?.sequence || sequenceCursor + 1);
                sequenceCursor = lastPlaceholder?.sequence || sequenceCursor + 1;
                return placeholderEntries;
            }
            entries.forEach((entry) => {
                taskSequenceMap.set(item.id, entry.sequence);
            });
            sequenceCursor = entries[entries.length - 1].sequence;
            return entries;
        });
        const imageCount = imageEntries.length;
        const resultGridModeClass = threadTasks.some((item) => isVideoMode(item.mode)) ? 'ai-image-result-grid--video' : '';
        const resultGridRatioClass = threadTasks.some((item) => getResultGridRatioClass(item) === 'ai-image-result-grid--wide') ? 'ai-image-result-grid--wide' : '';
        const anchoredTaskIds = new Set();
        return `
            <div class="ai-image-result-view ai-image-result-view--image">
			                <div class="ai-image-result-content">
                    <div class="ai-image-live-copy">
                        <div>
                            <strong>${escapeHtml(getTaskTitle(task))}</strong><br>
                            <span>${escapeHtml([getTaskSubtitle(task), generatedTime].filter(Boolean).join(' · '))}</span>
                        </div>
                    </div>
                    <div class="ai-image-result-prompt${promptOverflowClass}">
                        <p>${escapeHtml(promptText)}</p>
                        <button class="ai-image-result-prompt-copy" type="button" data-aiw-action="copy-task-prompt" data-task-id="${escapeHtml(threadRoot.id)}" aria-label="复制提示词" title="复制提示词">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                    <div class="ai-image-result-grid ${resultGridModeClass} ${resultGridRatioClass} ${imageCount === 1 ? 'ai-image-result-grid--single' : ''} ${hasThreadChildren ? 'ai-image-result-grid--thread' : ''} ${imageEntries.some((entry) => entry.type === 'pending' || entry.type === 'reloading') ? 'ai-image-result-grid--partial' : ''}">
                        ${imageEntries.map((entry, index) => {
                            const taskId = String(entry.task?.id || '').trim();
                            const navigationAnchor = Boolean(taskId && !anchoredTaskIds.has(taskId));
                            if (taskId) anchoredTaskIds.add(taskId);
                            if (entry.type === 'pending') {
                                return renderInlineTaskPreview(entry.task, '生成中', {
                                    showPrompt: false,
                                    forceBusy: Boolean(entry.forceBusy),
                                    navigationAnchor,
                                    imageSlot: entry.slotSequence,
                                    stepLabel: entry.forceBusy && entry.task?.status === 'succeeded' ? '结果同步中' : ''
                                });
                            }
                            if (entry.type === 'reloading') {
                                return renderInlineTaskReloadingPreview(entry.task, '记录重新加载中', { showPrompt: false, navigationAnchor });
                            }
                            if (entry.taskIndex && navigationAnchor) {
                                return [
                                    renderTaskContinuationPrompt(entry, { navigationAnchor }),
                                    renderTaskImageEntry(entry, index, aspect, { navigationAnchor: false })
                                ].join('');
                            }
                            return renderTaskImageEntry(entry, index, aspect, { navigationAnchor });
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function renderHistoryPanel() {
        const busyCount = getBusyTasks().length;
        const statusIcon = busyCount ? 'fa-spinner' : 'fa-clock-rotate-left';
        const historyRows = getHistoryThreadRows();
        const statusText = busyCount ? `${busyCount} 个生成中` : (historyRows.length ? `${historyRows.length} 个对话` : '还没有记录');
        const badgeValue = busyCount || '';
        const isHistoryView = sidebarView === 'history';
        const isBillingView = sidebarView === 'billing';

        return `
            <aside class="ai-image-history-sidebar ${sidebarView ? 'is-expanded' : 'is-collapsed'}" aria-label="${isBillingView ? '计费方式' : '生成记录'}">
                <div class="ai-image-history-rail">
                    ${sidebarView ? `
                        <button class="ai-image-rail-brand is-sidebar-open" type="button" data-aiw-action="toggle-sidebar" aria-label="收起生成记录" title="收起">
                            <i class="fas fa-chevron-left ai-image-sidebar-toggle-chevron ai-image-sidebar-toggle-chevron--wide" aria-hidden="true"></i>
                            <i class="fas fa-chevron-up ai-image-sidebar-toggle-chevron ai-image-sidebar-toggle-chevron--narrow" aria-hidden="true"></i>
                            <span class="ai-image-sidebar-toggle-tip" aria-hidden="true">收起</span>
                        </button>
                    ` : ''}
                    <button class="ai-image-rail-btn ai-image-rail-btn--new" type="button" data-aiw-action="new-chat" aria-label="新建对话" title="新建对话" data-rail-label="新建">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button class="ai-image-rail-btn is-primary ${busyCount ? 'is-busy' : ''} ${isHistoryView ? 'is-active' : ''}" type="button" data-aiw-action="toggle-history" aria-label="${isHistoryView ? '收起生成记录' : '展开生成记录'}" aria-expanded="${isHistoryView ? 'true' : 'false'}" title="${isHistoryView ? '收起生成记录' : '生成记录'}" data-rail-label="记录">
                        <i class="fas ${escapeHtml(statusIcon)}"></i>
                        ${badgeValue ? `<span>${escapeHtml(badgeValue)}</span>` : ''}
                    </button>
                    <nav class="ai-image-rail-legal ai-image-rail-legal--desktop" aria-label="平台政策">
                        <a class="ai-image-rail-legal-link" href="/terms.html" target="_blank" rel="noopener noreferrer" aria-label="查看服务条款" title="服务条款" data-rail-label="条款">
                            <i class="fas fa-file-contract" aria-hidden="true"></i>
                        </a>
                    </nav>
                    <button class="ai-image-rail-btn ai-image-rail-wallet ${isBillingView ? 'is-active' : ''}" type="button" data-aiw-action="toggle-billing" aria-label="${isBillingView ? '收起计费方式' : '展开计费方式'}" aria-expanded="${isBillingView ? 'true' : 'false'}" title="计费方式" data-rail-label="计费">
                        <i class="fas fa-gem"></i>
                    </button>
                    <button class="ai-image-rail-btn ai-image-rail-close" type="button" data-aiw-action="close" aria-label="关闭 AI 工作台" title="关闭" data-rail-label="关闭">
                        <i class="fas fa-xmark"></i>
                    </button>
                </div>

                <div class="ai-image-history-expanded">
                    <nav class="ai-image-rail-legal ai-image-rail-legal--mobile" aria-label="平台政策">
                        <a class="ai-image-rail-legal-link" href="/terms.html" target="_blank" rel="noopener noreferrer" aria-label="查看服务条款" title="服务条款" data-rail-label="条款">
                            <i class="fas fa-file-contract" aria-hidden="true"></i>
                        </a>
                    </nav>
                    ${isBillingView ? renderBillingPanel() : renderHistoryListPanel(statusText, historyRows)}
                </div>
            </aside>
        `;
    }

    function renderBillingPanel() {
        const normalizedBaseUrl = normalizeApiBaseUrl(state.apiBaseUrl || getDefaultApiBaseUrl());
        const apiProfile = getApiBaseProfile(normalizedBaseUrl);
        const apiBaseConfigured = Boolean(apiProfile && normalizedBaseUrl);
        const typedApiKey = String(state.apiKey || '').trim();
        const storedApiKey = getStoredApiKeyStatus(normalizedBaseUrl);
        const apiKeyTail = getApiKeyTail();
        const hasTypedApiKey = Boolean(typedApiKey);
        const keyStatusTitle = hasTypedApiKey
            ? `将保存新 Key · ${escapeHtml(apiKeyTail)}`
            : (storedApiKey ? `已保存 API Key · ${escapeHtml(storedApiKey.apiKeyTail)}` : 'API Key 待保存');
        const keyStatusCopy = hasTypedApiKey
            ? '本次提交会把新 Key 加密保存到后端，之后可留空继续使用。'
            : (storedApiKey ? '留空会使用后端已加密保存的 Key；前端只显示尾号，不返回明文。' : '首次使用需要输入 Sub2API Key，提交后由后端加密保存。');
        const discoveryMessage = String(modelDiscoveryState.message || '').trim();
        const discoveryToneClass = modelDiscoveryState.tone ? ` is-${modelDiscoveryState.tone}` : '';
        const canDiscoverModels = apiBaseConfigured && (hasTypedApiKey || Boolean(storedApiKey));
        const currentToolMode = getCurrentWorkbenchToolMode();
        const toolChatCopy = state.billingMode === 'api'
            ? '使用当前 API Key 的对话模型，消耗 API token。'
            : '使用后台对话模型，按积分规则计费。';
        const toolImageCopy = state.billingMode === 'api'
            ? '使用当前 API Key 的生图模型，消耗 API 图片额度。'
            : '使用后台生图模型，按积分规则计费。';
        const toolVideoCopy = state.billingMode === 'api'
            ? '使用当前 API Key 的视频模型，消耗 API 视频额度。'
            : '使用后台视频模型，按积分规则计费。';
        const toolCards = [
            {
                id: 'chat',
                icon: 'fa-comments',
                label: '文本对话',
                copy: toolChatCopy,
                visible: getActiveModelOptions('chat').length > 0 || !isRuntimeModelSourceLockedForBillingMode()
            },
            {
                id: 'image',
                icon: 'fa-image',
                label: '生成图片',
                copy: toolImageCopy,
                visible: getActiveModelOptions('text').length > 0 || !isRuntimeModelSourceLockedForBillingMode()
            },
            {
                id: 'video',
                icon: 'fa-film',
                label: '生成视频',
                copy: toolVideoCopy,
                visible: getActiveModelOptions('video').length > 0
            }
        ].filter((item) => item.visible);
        return `
            <div class="ai-image-history-scroll">
                <div class="ai-image-history-head">
                    <span class="ai-image-history-head-icon"><i class="fas fa-gem"></i></span>
                    <span class="ai-image-history-head-copy">
                        <strong>计费方式</strong>
                        <span>${escapeHtml(getActiveBillingLabel())}</span>
                    </span>
                    <button class="ai-image-icon-btn" type="button" data-aiw-action="close-history" aria-label="收起计费方式">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                </div>

                <div class="ai-image-billing-panel">
                    <div class="ai-image-billing-choice">
                        <div class="ai-image-billing-card-shell">
                            <button class="ai-image-billing-card ${state.billingMode === 'points' ? 'is-active' : ''}" type="button" data-aiw-chip="billing:points">
                                <span><i class="fas fa-coins"></i></span>
                                <strong>积分计费</strong>
                                <em>使用本站后台定价，任务成功后扣除积分。</em>
                            </button>
                            <button class="ai-image-model-pricing-link" type="button" data-aiw-action="open-model-pricing">
                                <i class="fas fa-tags"></i><span>模型价格</span><i class="fas fa-chevron-right"></i>
                            </button>
                        </div>
                        <button class="ai-image-billing-card ${state.billingMode === 'api' ? 'is-active' : ''}" type="button" data-aiw-chip="billing:api">
                            <span><i class="fas fa-key"></i></span>
                            <strong>我的 API</strong>
                            <em>只走允许的 Sub2API，本站不扣积分。</em>
                        </button>
                    </div>

                    ${state.billingMode === 'points' ? `
                        <div class="ai-image-billing-note">
                            <i class="fas fa-circle-info"></i>
                            <span>积分模式按后台价格规则计费，任务成功后扣除积分，失败不扣费。</span>
                        </div>
                    ` : ''}

                    ${state.billingMode ? `
                        <div class="ai-image-billing-choice ai-image-billing-choice--tool">
                            ${toolCards.map((item) => `
                                <button class="ai-image-billing-card ${currentToolMode === item.id ? 'is-active' : ''}" type="button" data-aiw-chip="apiTool:${escapeHtml(item.id)}">
                                    <span><i class="fas ${escapeHtml(item.icon)}"></i></span>
                                    <strong>${escapeHtml(item.label)}</strong>
                                    <em>${escapeHtml(item.copy)}</em>
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}

                    ${state.billingMode === 'api' ? `
                        <div class="ai-image-billing-api">
                            <div class="ai-image-api-base-fixed ${apiBaseConfigured ? 'is-valid' : 'is-invalid'}">
                                <span>Base URL</span>
                                <strong>${escapeHtml(normalizedBaseUrl || '后台未配置')}</strong>
                                <em>${apiBaseConfigured ? `${escapeHtml(apiProfile.label)} · 由管理员后台配置` : '请先在后台配置可用的 Sub2API 地址'}</em>
                            </div>
                            <label class="ai-image-api-field ${apiKeyTail ? 'is-valid' : ''}">
                                <span>API Key</span>
                                <input type="password" data-aiw-api-key value="${escapeHtml(state.apiKey)}" placeholder="${storedApiKey ? '留空使用已保存 Key，输入新 Key 以更换' : '输入你的 Sub2API Key'}" autocomplete="off" spellcheck="false">
                                <em>${apiKeyTail ? `${hasTypedApiKey ? '新 Key' : '已保存 Key'} 尾号：${escapeHtml(apiKeyTail)}` : '首次提交会由后端加密保存，前端不持久化明文 Key'}</em>
                            </label>
                            <div class="ai-image-api-key-status">
                                <span><i class="fas fa-key"></i></span>
                                <div>
                                    <strong>${keyStatusTitle}</strong>
                                    <em>${keyStatusCopy}</em>
                                </div>
                            </div>
                            <div class="ai-image-api-model-discovery${discoveryToneClass}">
                                <button class="ai-image-api-model-discovery-btn" type="button" data-aiw-action="discover-api-models" ${canDiscoverModels && !modelDiscoveryState.loading ? '' : 'disabled'}>
                                    <i class="fas ${modelDiscoveryState.loading ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'}"></i>
                                    <span>${modelDiscoveryState.loading ? '检测中...' : '检测上游支持模型'}</span>
                                </button>
                                <em>${escapeHtml(discoveryMessage || '点击后会用当前 API Key 读取当前上游模型列表，并更新输入框里的模型选项。')}</em>
                            </div>
                            <div class="ai-image-billing-note">
                                <i class="fas fa-shield-halved"></i>
                                <span>Base URL 由管理员后台统一配置并校验，用户只能输入 Sub2API Key，不可传入任意上游地址。</span>
                            </div>
                        </div>
                    ` : ''}

                    ${!state.billingMode ? `
                        <div class="ai-image-billing-note is-warning">
                            <i class="fas fa-triangle-exclamation"></i>
                            <span>请选择计费方式后再发送指令。</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    function getHistorySearchViewState(historyRows = getHistoryThreadRows()) {
        const totalRows = historyRows;
        const filteredRows = getFilteredHistoryRows(totalRows);
        const hasSearch = Boolean(normalizeHistorySearchText(historySearchQuery));
        return { totalRows, filteredRows, hasSearch };
    }

    function renderHistoryResultsPanel(historyRows = getHistoryThreadRows()) {
        const { totalRows, filteredRows, hasSearch } = getHistorySearchViewState(historyRows);
        const deferHistoryImages = hasPendingActiveThreadImages();
        return `
            <div class="ai-image-activity-summary" aria-label="AI 图片活动摘要">
                <span><strong>${escapeHtml(formatCompactNumber(hasSearch ? filteredRows.length : totalRows.length))}</strong><em>${hasSearch ? '结果' : '对话'}</em></span>
                <span><strong>${escapeHtml(formatCompactNumber(activitySummary.apiTokens))}</strong><em>tokens</em></span>
                <span><strong>${escapeHtml(formatCompactNumber(activitySummary.downloads))}</strong><em>下载</em></span>
            </div>
            ${renderHistoryLocator(filteredRows)}
            <div class="ai-image-history">
                ${filteredRows.length ? filteredRows.map((row) => renderTaskRow(row, { deferHistoryImages })).join('') : `<div class="ai-image-empty-list">${hasSearch ? '没有匹配的对话' : '还没有生成记录'}</div>`}
            </div>
        `;
    }

    function getHistoryLocatorTask(row = {}) {
        const tasks = (row.tasks || []).filter(Boolean);
        return tasks.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0]
            || row.rootTask
            || row.displayTask
            || {};
    }

    function getHistoryLocatorTitle(row = {}, index = 0) {
        const task = getHistoryLocatorTask(row);
        return truncateText(getTaskPromptText(task) || getTaskTitle(task) || `第 ${index + 1} 个对话`, 70);
    }

    function getHistoryLocatorMeta(row = {}, index = 0, total = 0) {
        const task = getHistoryLocatorTask(row);
        const happenedAt = Number(task.completedAt || task.updatedAt || task.createdAt || 0);
        const generatedTime = happenedAt ? formatGeneratedTime(happenedAt) : '';
        return [`${index + 1}/${total}`, generatedTime].filter(Boolean).join(' · ');
    }

    function renderHistoryLocator(historyRows = []) {
        const items = historyRows.filter((row) => row?.id);
        if (items.length < CHAT_NAVIGATION_MIN_ITEMS) return '';
        return `
            <div class="ai-image-history-locator" data-aiw-history-locator aria-label="生成记录快速定位">
                <div class="ai-image-history-locator-track" data-aiw-history-locator-track>
                    ${items.map((row, index) => {
                        const title = getHistoryLocatorTitle(row, index);
                        const meta = getHistoryLocatorMeta(row, index, items.length);
                        return `
                            <button class="ai-image-history-locator-item ${row.isActive ? 'is-active' : ''}" type="button" data-aiw-history-nav-id="${escapeHtml(row.id)}" data-aiw-history-nav-title="${escapeHtml(title)}" data-aiw-history-nav-meta="${escapeHtml(meta)}" aria-label="${escapeHtml(`定位到第 ${index + 1} 个对话：${title}`)}">
                                <span class="ai-image-history-locator-marker" aria-hidden="true"></span>
                            </button>
                        `;
                    }).join('')}
                </div>
                <div class="ai-image-history-locator-preview" data-aiw-history-locator-preview role="tooltip" aria-hidden="true">
                    <strong data-aiw-history-locator-title></strong>
                    <em data-aiw-history-locator-meta></em>
                </div>
            </div>
        `;
    }

    function renderHistoryListPanel(statusText, historyRows = getHistoryThreadRows()) {
        const { filteredRows, hasSearch } = getHistorySearchViewState(historyRows);
        const selectedCount = getSelectedHistoryIds().length;
        const allSelected = Boolean(filteredRows.length && filteredRows.every((row) => selectedHistoryTaskIds.has(row.id)));
        return `
            <div class="ai-image-history-scroll">
                <div class="ai-image-history-head">
                    <span class="ai-image-history-head-icon"><i class="fas fa-clock-rotate-left"></i></span>
                    <span class="ai-image-history-head-copy">
                        <strong>生成记录</strong>
                        <span data-aiw-history-selection-summary>${escapeHtml(historySelectionMode ? `已选择 ${selectedCount} 个` : statusText)}</span>
                    </span>
                    <button class="ai-image-icon-btn ${historySelectionMode ? 'is-active' : ''}" type="button" data-aiw-action="toggle-history-selection" aria-label="${historySelectionMode ? '退出多选' : '多选记录'}" title="${historySelectionMode ? '退出多选' : '多选'}">
                        <i class="fas ${historySelectionMode ? 'fa-xmark' : 'fa-list-check'}"></i>
                    </button>
                </div>
                <div class="ai-image-history-search">
                    <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                    <input type="search" data-aiw-history-search value="${escapeHtml(historySearchQuery)}" placeholder="搜索" autocomplete="off" spellcheck="false" aria-label="搜索生成记录">
                    ${hasSearch ? `
                        <button type="button" data-aiw-action="clear-history-search" aria-label="清空搜索">
                            <i class="fas fa-xmark"></i>
                        </button>
                    ` : ''}
                </div>
                ${historySelectionMode ? `
                    <div class="ai-image-history-bulkbar">
                        <button class="ai-image-history-bulk-btn" type="button" data-aiw-action="select-all-history">
                            <i class="fas ${allSelected ? 'fa-square-check' : 'fa-check-double'}"></i>
                            <span>${allSelected ? '取消全选' : '全选'}</span>
                        </button>
                        <button class="ai-image-history-bulk-btn" type="button" data-aiw-action="pin-history-selection" ${selectedCount ? '' : 'disabled'}>
                            <i class="fas fa-thumbtack"></i>
                            <span>置顶</span>
                        </button>
                        <button class="ai-image-history-bulk-btn" type="button" data-aiw-action="unpin-history-selection" ${selectedCount ? '' : 'disabled'}>
                            <i class="fas fa-arrow-down"></i>
                            <span>取消置顶</span>
                        </button>
                        <div class="ai-image-history-accent-picker ${openHistoryAccentMenu ? 'is-open' : ''}">
                            <button class="ai-image-history-bulk-btn" type="button" data-aiw-action="toggle-history-accent-menu" ${selectedCount ? '' : 'disabled'}>
                                <i class="fas fa-palette"></i>
                                <span>标色</span>
                            </button>
                            ${openHistoryAccentMenu ? `
                                <div class="ai-image-history-accent-menu">
                                    ${HISTORY_ACCENTS.map((accent) => `
                                        <button class="ai-image-history-accent-option" type="button" data-aiw-action="set-history-accent" data-accent="${escapeHtml(accent.id)}" data-accent-color="${escapeHtml(accent.id)}" aria-label="${escapeHtml(accent.label)}">
                                            <span></span>
                                            <strong>${escapeHtml(accent.label)}</strong>
                                        </button>
                                    `).join('')}
                                    <button class="ai-image-history-accent-option" type="button" data-aiw-action="set-history-accent" data-accent="" aria-label="清除标色">
                                        <span></span>
                                        <strong>清除</strong>
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                        <button class="ai-image-history-bulk-btn is-danger" type="button" data-aiw-action="delete-history-selection" ${selectedCount ? '' : 'disabled'}>
                            <i class="fas fa-trash"></i>
                            <span>删除</span>
                        </button>
                    </div>
                ` : ''}
                <div data-aiw-history-results>
                    ${renderHistoryResultsPanel(historyRows)}
                </div>
            </div>
        `;
    }

    function renderTaskRow(row, { deferHistoryImages = false } = {}) {
        const task = row?.displayTask || row || {};
        const rootTask = row?.rootTask || getTaskThreadRoot(task) || task;
        const rootId = rootTask.id || task.id || '';
        const threadTasks = row?.tasks || getTaskThread(rootTask || task);
        const latestTask = row?.latestTask || threadTasks.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || task;
        const hasUnreadSuccess = threadTasks.some((item) => item?.status === 'succeeded' && !isTaskSeen(item));
        const hasFailedTask = latestTask?.status === 'failed' && !isTaskReloadableBillingRecord(latestTask);
        const thumbTask = row?.imageTask || task;
        const thumbMedia = getTaskPrimaryMedia(thumbTask);
        const thumb = thumbMedia.isVideo ? '' : thumbMedia.src;
        const thumbImage = thumbMedia.record || {};
        const isVideoThumb = Boolean(thumbMedia.isVideo);
        const thumbIdentityKey = thumb
            ? getImageIdentityKey({
                taskId: thumbImage?.taskId || thumbTask.id || rootId,
                resultId: thumbImage?.resultId || '',
                resultIndex: thumbImage?.index ?? 0,
                src: thumb,
                context: 'thumb'
            })
            : '';
        const thumbSrc = thumb ? getStableImageUrl(thumbIdentityKey, thumb) : '';
        const threadCount = Number(row?.count || 1);
        const subtitle = threadCount > 1
            ? `${getTaskSubtitle(task)} · ${threadCount} 步`
            : getTaskSubtitle(task);
        const selected = selectedHistoryTaskIds.has(rootId);
        const accent = row?.accent || getHistoryTaskAccent(rootTask);
        const rowClasses = [
            'ai-image-task-row',
            row?.isActive || state.activeTaskId === task.id ? 'is-active' : '',
            historySelectionMode ? 'is-selecting' : '',
            selected ? 'is-selected' : '',
            row?.isPinned ? 'is-pinned' : '',
            hasUnreadSuccess ? 'is-unread' : '',
            hasFailedTask ? 'is-failed-thread' : '',
            isVideoThumb ? 'is-video-thread' : '',
            accent ? `has-accent-${accent}` : ''
        ].filter(Boolean).join(' ');
        const thumbFallbackIcon = isVideoThumb ? 'fa-film' : (MODE_META[thumbTask.mode]?.icon || MODE_META[task.mode]?.icon || 'fa-image');
        const thumbStateClass = thumbSrc
            ? [
                hasLoadedImage(thumbSrc) ? 'is-image-loaded' : '',
                hasFailedImage(thumbSrc) ? 'is-image-loading' : ''
            ].filter(Boolean).join(' ')
            : '';
        const deferThumb = shouldDeferHistoryThumbnail(row, thumbSrc, deferHistoryImages);
        const thumbLoading = row?.isActive ? 'eager' : 'lazy';
        const thumbPriority = row?.isActive ? 'high' : 'low';
        const thumbImageMarkup = thumbSrc
            ? `<i class="fas ${escapeHtml(thumbFallbackIcon)}" aria-hidden="true"></i><img ${deferThumb ? `data-aiw-deferred-src="${escapeHtml(thumbSrc)}" data-aiw-deferred-kind="history-thumb" aria-hidden="true"` : `src="${escapeHtml(thumbSrc)}"`} alt="" loading="${escapeHtml(thumbLoading)}" fetchpriority="${escapeHtml(thumbPriority)}" decoding="async">`
            : '';
        return `
            <div class="${rowClasses}" role="button" tabindex="0" data-aiw-task-id="${escapeHtml(rootId)}" data-status="${escapeHtml(task.status)}">
                <span class="ai-image-task-thumb ${thumbStateClass}" ${thumbIdentityKey ? `data-aiw-image-key="${escapeHtml(thumbIdentityKey)}"` : ''}>
                    ${hasFailedTask ? '<i class="fas fa-triangle-exclamation"></i>' : (isVideoThumb ? '<i class="fas fa-film"></i><em>视频</em>' : (thumbImageMarkup || `<i class="fas ${escapeHtml(MODE_META[task.mode]?.icon || 'fa-image')}"></i>`))}
                </span>
                <span class="ai-image-task-copy">
                    <strong>${row?.isPinned ? '<i class="fas fa-thumbtack"></i>' : ''}${escapeHtml(getTaskTitle(task || rootTask))}</strong>
                    <span>${escapeHtml(subtitle)}</span>
                </span>
                <span class="ai-image-task-meta">
                    ${threadCount > 1 ? `<span class="ai-image-task-thread-count">${escapeHtml(threadCount)}</span>` : ''}
                    ${hasUnreadSuccess ? '<span class="ai-image-task-unread-dot" aria-label="新生成未读"></span>' : ''}
                    ${historySelectionMode ? `
                        <button class="ai-image-task-select" type="button" data-aiw-history-select aria-label="${selected ? '取消选择' : '选择'} ${escapeHtml(getTaskTitle(task || rootTask))}">
                            <i class="fas fa-check"></i>
                        </button>
                    ` : ''}
                </span>
            </div>
        `;
    }

    function renderCreatorActions() {
        const actionLabel = state.mode === 'reverse' ? '反推提示词' : '开始生成';
        return `
            <div class="ai-image-creator-actions">
                <div class="ai-image-cost">
                    <span>预计消耗 <strong>${escapeHtml(formatPoints(getCostEstimate()))}</strong> 积分</span>
                </div>
                <button class="ai-image-generate-btn" type="button" data-aiw-action="generate">
                    <i class="fas fa-wand-magic-sparkles"></i>
                    ${escapeHtml(actionLabel)}
                </button>
            </div>
        `;
    }

    function init() {
        if (root || !document.body) return;
        restoreState();
        exposeWorkbenchOpenHandlers();
        createRoot();
        bindGlobalEvents();
        render();
        loadRemoteConfig();
        loadRemoteHistoryPrefs();
        loadRemoteRecords();
        resumeBusyTasks();
    }

    global.AIImageWorkbench = Object.freeze({
        init,
        open: openWorkbench,
        close: closeWorkbench,
        minimize: closeWorkbench,
        applyPrompt: (payload) => openPromptForImageGeneration(payload),
        getState: () => ({ ...state, tasks: state.tasks.slice() })
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}(window));
