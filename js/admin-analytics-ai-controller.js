// Shared analytics AI controller helpers.

function renderAnalyticsInsightDebounceMessage(content) {
    if (!content) return;
    content.innerHTML = '<p class="ai-error">请稍候再试（5秒内只能请求一次）</p>';
}

function getAnalyticsInsightCacheTtlRemaining(now = Date.now()) {
    const insightCache = getAnalyticsInsightCacheValue();
    const cacheTime = getAnalyticsInsightCacheTimeValue();

    if (!insightCache || !cacheTime) {
        return 0;
    }

    return Math.max(0, getAnalyticsInsightCacheDuration() - (Number(now) - cacheTime));
}

function buildAnalyticsInsightCacheHintHtml(now = Date.now()) {
    const minutesRemaining = Math.round(getAnalyticsInsightCacheTtlRemaining(now) / 60000);
    return `<p class="ai-cache-hint">📋 缓存结果 (${minutesRemaining} 分钟后刷新)</p>`;
}

function syncAnalyticsInsightCacheContext(contextKey = getAnalyticsAIContextKey()) {
    if (contextKey !== getAnalyticsInsightCacheKeyValue()) {
        resetAnalyticsAICache();
    }
}

function renderAnalyticsCachedInsight(content, contextKey = getAnalyticsAIContextKey(), now = Date.now()) {
    const insightCache = getAnalyticsInsightCacheValue();

    if (!content || !insightCache || contextKey !== getAnalyticsInsightCacheKeyValue()) {
        return false;
    }

    if (getAnalyticsInsightCacheTtlRemaining(now) <= 0) {
        return false;
    }

    const cachedReport = getAnalyticsInsightCacheReport(insightCache);
    const cachedSummary = getAnalyticsInsightCacheSummary(insightCache);
    content.innerHTML = renderAIInsightMarkup(cachedReport, {
        summaryData: cachedSummary,
        hintHtml: buildAnalyticsInsightCacheHintHtml(now)
    });
    return true;
}

async function ensureAnalyticsAIReady(options = {}) {
    const content = options.content || null;
    const missingMessage = String(options.missingMessage || '请先在后台 API 配置或 Vercel 环境变量中配置 Gemini Key');

    if (!hasAdminAI()) {
        try {
            await window.AdminAI?.checkHealth?.();
        } catch (err) {
            console.warn('[Analytics] AI proxy health check failed:', err);
        }
    }

    if (hasAdminAI()) {
        return true;
    }

    if (content) {
        content.innerHTML = `<p class="ai-error">${missingMessage}</p>`;
    }

    return false;
}

function beginAnalyticsInsightDebounce(durationMs = 5000) {
    if (isAnalyticsInsightDebouncing()) {
        return false;
    }

    setAnalyticsInsightDebouncing(true);
    setTimeout(() => {
        setAnalyticsInsightDebouncing(false);
    }, Math.max(0, Number(durationMs) || 0));
    return true;
}

function setAnalyticsInsightLoadingState(button, content, isLoading) {
    if (button) {
        button.disabled = isLoading === true;
        button.innerHTML = isLoading === true
            ? '<i class="fas fa-spinner fa-spin"></i> 分析中...'
            : '<i class="fas fa-magic"></i> 生成分析';
    }

    if (content && isLoading === true) {
        content.innerHTML = '<p class="ai-loading">AI 正在分析数据...</p>';
    }
}

function writeAnalyticsInsightCache(report, summaryData = null, contextKey = getAnalyticsAIContextKey()) {
    const cacheEntry = {
        report: report || '分析失败，请重试',
        summaryData: summaryData || null
    };
    return setAnalyticsInsightCacheValue(cacheEntry, contextKey, Date.now());
}

function renderAnalyticsInsightResult(content, reportText, options = {}) {
    if (!content) return;

    content.innerHTML = renderAIInsightMarkup(reportText, {
        summaryData: options.summaryData || null,
        hintHtml: options.hintHtml || ''
    });
}

function renderAnalyticsInsightError(content, error) {
    if (!content) return;
    const errMsg = error?.message || (error?.details ? error.details : '未知错误');
    content.innerHTML = `<p class="ai-error">分析失败：${errMsg}</p>`;
}

function setAnalyticsPredictionLoadingState(container, isLoading = true) {
    if (!container || isLoading !== true) return;
    container.innerHTML = '<p class="ai-loading">AI 正在生成预测...</p>';
}

function renderAnalyticsPredictionError(container, error) {
    if (!container) return;
    container.innerHTML = `<p class="ai-error">预测失败: ${error?.message || '未知错误'}</p>`;
}

window.AdminAnalyticsAIController = Object.assign({}, window.AdminAnalyticsAIController || {}, {
    renderAnalyticsInsightDebounceMessage,
    getAnalyticsInsightCacheTtlRemaining,
    buildAnalyticsInsightCacheHintHtml,
    syncAnalyticsInsightCacheContext,
    renderAnalyticsCachedInsight,
    ensureAnalyticsAIReady,
    beginAnalyticsInsightDebounce,
    setAnalyticsInsightLoadingState,
    writeAnalyticsInsightCache,
    renderAnalyticsInsightResult,
    renderAnalyticsInsightError,
    setAnalyticsPredictionLoadingState,
    renderAnalyticsPredictionError
});
