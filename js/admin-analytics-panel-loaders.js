/**
 * Admin Analytics panel loaders and panel-facing data fetchers.
 * Keeps admin-analytics.js focused on state, context, and lifecycle orchestration.
 */

async function resolveAnalyticsBundleFirstData(options = {}) {
    const {
        loadBundle,
        readSegment,
        segmentKey = '',
        unavailableMessage = 'Analytics bundle segment unavailable',
        warningMessage = '[Analytics] Analytics bundle segment unavailable, falling back to direct loader:',
        createSegmentError = null,
        isPayloadValid = (payload) => Array.isArray(payload),
        isPayloadEmpty = null,
        allowDirectRetryOnEmpty = false,
        mapPayload = (payload) => payload,
        directLoader
    } = options || {};

    try {
        const bundle = await loadBundle();
        const bundleSegment = readSegment(bundle, segmentKey);
        if (bundleSegment?.ok && isPayloadValid(bundleSegment.payload, bundleSegment)) {
            const mappedPayload = mapPayload(bundleSegment.payload, bundleSegment);
            if (
                allowDirectRetryOnEmpty
                && typeof directLoader === 'function'
                && typeof isPayloadEmpty === 'function'
                && isPayloadEmpty(mappedPayload, bundleSegment)
            ) {
                console.warn(`${warningMessage} bundle payload was empty, retrying direct loader.`);
                return directLoader();
            }
            return mappedPayload;
        }
        if (bundleSegment && bundleSegment.ok === false && typeof createSegmentError === 'function') {
            throw createSegmentError(bundleSegment, unavailableMessage);
        }
        throw new Error(unavailableMessage);
    } catch (error) {
        console.warn(warningMessage, error);
        if (typeof directLoader === 'function') {
            return directLoader();
        }
        throw error;
    }
}

function getAnalyticsResolutionFeedbackEntriesForProduct(options = {}) {
    if (typeof window.getAnalyticsResolutionFeedbackEntries !== 'function') {
        return [];
    }
    const entries = window.getAnalyticsResolutionFeedbackEntries({
        productId: options?.productId || '',
        productName: options?.productName || ''
    });
    return Array.isArray(entries) ? entries.slice(0, Math.max(1, Number(options?.limit) || 3)) : [];
}

function getAnalyticsResolutionFeedbackEntriesForContent(options = {}) {
    if (typeof window.getAnalyticsResolutionFeedbackEntries !== 'function') {
        return [];
    }

    const promptId = String(options?.promptId || '').trim();
    const promptTitle = String(options?.promptTitle || '').trim();
    if (!promptId && !promptTitle) {
        return [];
    }

    const entries = window.getAnalyticsResolutionFeedbackEntries({
        feedbackScope: 'content',
        entityType: 'prompt',
        entityId: promptId,
        entityName: promptTitle
    });
    return Array.isArray(entries) ? entries.slice(0, Math.max(1, Number(options?.limit) || 4)) : [];
}

function getAnalyticsResolutionFeedbackEntriesForUser(options = {}) {
    if (typeof window.getAnalyticsResolutionFeedbackEntries !== 'function') {
        return [];
    }

    const userId = String(options?.userId || '').trim();
    const userLabel = String(options?.userLabel || '').trim();
    const entries = window.getAnalyticsResolutionFeedbackEntries({
        feedbackScope: 'user',
        entityType: 'user',
        entityId: userId,
        entityName: userLabel
    });
    return Array.isArray(entries) ? entries.slice(0, Math.max(1, Number(options?.limit) || 6)) : [];
}

function formatAnalyticsResolutionFeedbackRelativeTime(value) {
    const time = Number(value || 0);
    if (!Number.isFinite(time) || time <= 0) {
        return '刚刚';
    }

    const diffMs = Math.max(0, Date.now() - time);
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;

    if (diffMs < minuteMs) return '刚刚';
    if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)} 分钟前`;
    if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)} 小时前`;
    return `${Math.floor(diffMs / dayMs)} 天前`;
}

function buildAnalyticsResolutionFeedbackStatusSummary(entries = []) {
    const summary = {
        resolved: 0,
        review: 0,
        abnormal: 0
    };
    for (const entry of Array.isArray(entries) ? entries : []) {
        const key = String(entry?.statusKey || '').trim().toLowerCase();
        if (key === 'review') {
            summary.review += 1;
        } else if (key === 'abnormal') {
            summary.abnormal += 1;
        } else {
            summary.resolved += 1;
        }
    }
    return summary;
}

function normalizeAnalyticsProductIndicatorKey(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');
}

function getAnalyticsProductIndicatorPalette() {
    return [
        chartColors.primary,
        chartColors.secondary,
        chartColors.success,
        chartColors.warning,
        chartColors.danger,
        '#14b8a6',
        '#f97316',
        '#ec4899'
    ];
}

function getAnalyticsProductSemanticIndicatorColor(value = '', index = 0) {
    const key = normalizeAnalyticsProductIndicatorKey(value);
    if (key.includes('虚拟卡') || key.includes('virtualcard') || key.includes('vcard')) {
        return chartColors.danger;
    }
    if (key.includes('facebook') || key.includes('meta')) {
        return chartColors.warning;
    }
    if (key.includes('公益') || key.includes('charity') || key.includes('public')) {
        return chartColors.secondary;
    }
    if (key.includes('other') || key.includes('others') || key.includes('其他') || key.includes('未分类') || key.includes('misc')) {
        return chartColors.success;
    }
    if (key.includes('gemini') || key.includes('google') || key.includes('gmail')) {
        return chartColors.primary;
    }
    if (key.includes('chatgpt') || key.includes('openai')) {
        return '#10b981';
    }
    if (key.includes('兑换') || key.includes('redeem') || key.includes('coupon') || key.includes('discount')) {
        return '#ec4899';
    }

    const palette = getAnalyticsProductIndicatorPalette();
    const safeIndex = Number.isFinite(Number(index)) ? Math.max(0, Number(index)) : 0;
    return palette[safeIndex % palette.length];
}

function getAnalyticsProductCategoryIndicatorColor(rowOrLabel = {}, index = 0) {
    if (rowOrLabel && typeof rowOrLabel === 'object') {
        return getAnalyticsProductSemanticIndicatorColor(
            rowOrLabel.category
                || rowOrLabel.category_label
                || rowOrLabel.product_name
                || rowOrLabel.name
                || rowOrLabel.key
                || '',
            index
        );
    }
    return getAnalyticsProductSemanticIndicatorColor(rowOrLabel, index);
}

function getAnalyticsProductToneIndicatorColor(tone = '', index = 0) {
    const normalized = normalizeAnalyticsProductIndicatorKey(tone);
    if (normalized === 'success') return chartColors.success;
    if (normalized === 'warning') return chartColors.warning;
    if (normalized === 'danger' || normalized === 'error') return chartColors.danger;
    if (normalized === 'accent' || normalized === 'info') return chartColors.primary;
    if (normalized === 'neutral' || normalized === 'muted') return '#64748b';
    return getAnalyticsProductIndicatorPalette()[Math.max(0, Number(index) || 0) % getAnalyticsProductIndicatorPalette().length];
}

function getAnalyticsProductSiteIndicatorColor(snapshot = {}, index = 0) {
    const key = normalizeAnalyticsProductIndicatorKey(snapshot?.site || snapshot?.site_key || snapshot?.label || '');
    if (key.includes('cn') || key.includes('中国') || key.includes('国内')) return chartColors.primary;
    if (key.includes('intl') || key.includes('global') || key.includes('国际')) return chartColors.secondary;
    if (key.includes('all') || key.includes('全站')) return '#14b8a6';
    return getAnalyticsProductCategoryIndicatorColor(snapshot?.label || snapshot?.site || '', index);
}

function withAnalyticsProductIndicatorAlpha(color = '', alpha = 1) {
    const safeColor = String(color || '').trim();
    const safeAlpha = Math.max(0, Math.min(1, Number(alpha)));
    const hexMatch = safeColor.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hexMatch) {
        return safeColor;
    }
    const hex = hexMatch[1].length === 3
        ? hexMatch[1].split('').map((char) => char + char).join('')
        : hexMatch[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function buildAnalyticsProductIndicatorStyle(color = '') {
    const safeColor = String(color || '').trim();
    return safeColor
        ? ` style="--analytics-distribution-indicator:${escapeHtml(safeColor)};"`
        : '';
}

function buildAnalyticsResolutionPriorityProducts(entries = [], alertItems = []) {
    const grouped = new Map();
    const alertMap = new Map();

    (Array.isArray(alertItems) ? alertItems : []).forEach((item) => {
        const productId = String(item?.productId || '').trim();
        const productName = String(item?.productName || '').trim();
        if (productId) {
            alertMap.set(`id:${productId}`, item);
        }
        if (productName) {
            alertMap.set(`name:${productName}`, item);
        }
    });

    (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const statusKey = String(entry?.statusKey || '').trim().toLowerCase();
        if (!statusKey || statusKey === 'resolved') {
            return;
        }

        const productId = String(entry?.productId || '').trim();
        const productName = String(entry?.productName || '').trim();
        const key = productId || productName;
        if (!key) {
            return;
        }

        const match = (productId && alertMap.get(`id:${productId}`))
            || (productName && alertMap.get(`name:${productName}`))
            || null;
        const current = grouped.get(key) || {
            key,
            productId,
            productName,
            score: 0,
            abnormalCount: 0,
            reviewCount: 0,
            latestCreatedAt: 0,
            latestEntry: null,
            alertItem: match
        };

        current.score += statusKey === 'abnormal' ? 2 : 1;
        current.latestCreatedAt = Math.max(current.latestCreatedAt, Number(entry?.createdAt || 0));
        current.latestEntry = !current.latestEntry || Number(entry?.createdAt || 0) >= Number(current.latestEntry?.createdAt || 0)
            ? entry
            : current.latestEntry;
        if (statusKey === 'abnormal') {
            current.abnormalCount += 1;
        } else if (statusKey === 'review') {
            current.reviewCount += 1;
        }
        if (!current.alertItem && match) {
            current.alertItem = match;
        }

        grouped.set(key, current);
    });

    return Array.from(grouped.values())
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            return Number(right.latestCreatedAt || 0) - Number(left.latestCreatedAt || 0);
        })
        .slice(0, 3);
}

function buildAnalyticsResolutionPriorityReason(row = {}, alertItem = {}, latestEntry = {}) {
    const reasons = [];
    if (Number(row?.abnormalCount || 0) > 0) {
        reasons.push(`最近仍有 ${formatNumber(row.abnormalCount)} 条回写保持异常`);
    }
    if (Number(row?.reviewCount || 0) > 0) {
        reasons.push(`还有 ${formatNumber(row.reviewCount)} 条回写停留在待复查`);
    }
    if (alertItem?.rankReason) {
        reasons.push(String(alertItem.rankReason).trim());
    } else if (latestEntry?.summary) {
        reasons.push(String(latestEntry.summary).trim());
    }
    return reasons.filter(Boolean).join('；') || '最近处理后仍有信号没有完全收口，所以优先排在前面。';
}

function buildAnalyticsResolutionPriorityRecommendation(row = {}, alertItem = {}, latestEntry = {}) {
    if (alertItem?.recommendedAction) {
        return String(alertItem.recommendedAction).trim();
    }
    if (latestEntry?.actionLabel) {
        return `先回到对应处理页继续执行“${String(latestEntry.actionLabel).trim()}”，再确认问题是否真正收口。`;
    }
    return '先回到对应处理页复查最近异常，再结合单品详情确认是支付、售后还是履约没有收口。';
}

function buildAnalyticsResolutionPriorityVerification(row = {}, alertItem = {}, latestEntry = {}) {
    if (alertItem?.verificationMethod) {
        return String(alertItem.verificationMethod).trim();
    }
    const productName = String(row?.productName || latestEntry?.productName || '').trim();
    if (productName) {
        return `处理后回到商品分析，确认“${productName}”是否从仍异常降到待复查或已处理，并观察相关预警是否消失。`;
    }
    return '处理后回到商品分析，确认对应商品是否从仍异常降到待复查或已处理，并观察预警是否消失。';
}

function buildAnalyticsResolutionPriorityVerificationStatus(row = {}, alertItem = {}, latestEntry = {}) {
    const hasActiveAlert = Boolean(
        alertItem
        && typeof alertItem === 'object'
        && !Array.isArray(alertItem)
        && (
            alertItem.title
            || alertItem.summary
            || alertItem.metric
            || alertItem.productId
            || alertItem.productName
        )
    );
    const abnormalCount = Number(row?.abnormalCount || 0);
    const reviewCount = Number(row?.reviewCount || 0);
    const latestStatusKey = String(latestEntry?.statusKey || '').trim().toLowerCase();
    const productName = String(row?.productName || latestEntry?.productName || alertItem?.productName || '').trim() || '该商品';

    if (!hasActiveAlert && abnormalCount <= 0 && reviewCount <= 0 && latestStatusKey !== 'abnormal' && latestStatusKey !== 'review') {
        return {
            key: 'passed',
            label: '验证已通过',
            tone: 'success',
            summary: `${productName} 当前已经不在商品预警主列表里，可做一次回看确认后结束本轮跟进。`
        };
    }

    if (!hasActiveAlert && abnormalCount <= 0 && (reviewCount > 0 || latestStatusKey === 'review')) {
        return {
            key: 'pending',
            label: '仍待验证',
            tone: 'warning',
            summary: `${productName} 最近处理结果已回落到待复查，但还需要再做一次回看，确认问题没有再次反弹。`
        };
    }

    return {
        key: 'pending',
        label: '仍待验证',
        tone: abnormalCount > 0 || latestStatusKey === 'abnormal' ? 'danger' : 'warning',
        summary: hasActiveAlert
            ? `${productName} 当前仍命中商品预警，说明这轮问题还没有真正收口。`
            : `${productName} 最近处理结果还没有稳定回落，建议继续回看近期信号。`
    };
}

function buildAnalyticsResolutionPriorityEvidence(row = {}, alertItem = {}, latestEntry = {}, verificationState = {}) {
    const metric = String(alertItem?.metric || '').trim();
    const alertSummary = String(alertItem?.summary || '').trim();
    const actionLabel = String(latestEntry?.actionLabel || '').trim();
    const referenceLabel = String(latestEntry?.referenceLabel || '').trim();
    const referenceValue = String(latestEntry?.referenceValue || '').trim();
    const statusLabel = String(latestEntry?.statusLabel || verificationState?.label || '').trim();

    if (verificationState?.key === 'passed') {
        const handledSummary = [statusLabel || '已处理', actionLabel, [referenceLabel, referenceValue].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
        return handledSummary
            ? `最近一次处理结果已回写为 ${handledSummary}，且当前商品已经不在预警主列表中。`
            : '最近一次处理结果已回写为已处理，且当前商品已经不在预警主列表中。';
    }

    if (metric || alertSummary) {
        return [metric, alertSummary].filter(Boolean).join(' · ');
    }

    const latestSummary = [actionLabel || statusLabel, [referenceLabel, referenceValue].filter(Boolean).join(' · '), String(latestEntry?.summary || '').trim()].filter(Boolean).join(' · ');
    if (latestSummary) {
        return latestSummary;
    }

    const productName = String(row?.productName || alertItem?.productName || latestEntry?.productName || '').trim() || '该商品';
    return `${productName} 最近仍有需要继续确认的处理回写，建议回看最新经营信号。`;
}

function buildAnalyticsResolutionPriorityTimeline(row = {}, alertItem = {}, latestEntry = {}, verificationState = {}) {
    const items = [];
    const latestActionLabel = String(latestEntry?.actionLabel || latestEntry?.title || latestEntry?.statusLabel || '').trim() || '最近处理';
    const latestReference = [String(latestEntry?.referenceLabel || '').trim(), String(latestEntry?.referenceValue || '').trim()].filter(Boolean).join(' · ');
    const latestCreatedAt = Number(row?.latestCreatedAt || latestEntry?.createdAt || 0);
    if (latestCreatedAt > 0) {
        items.push({
            label: '最近处理',
            summary: `${formatAnalyticsResolutionFeedbackRelativeTime(latestCreatedAt)}执行“${latestActionLabel}”${latestReference ? `，参考 ${latestReference}` : ''}。`
        });
    }

    items.push({
        label: '当前验证',
        summary: verificationState?.key === 'passed'
            ? '当前已从商品预警主列表退出，说明这一轮问题已基本收口。'
            : (verificationState?.summary || '当前仍需要继续验证这轮处理是否真正生效。')
    });

    const verificationMethod = buildAnalyticsResolutionPriorityVerification(row, alertItem, latestEntry);
    items.push({
        label: '下一步复查',
        summary: verificationMethod
    });

    return items;
}

function buildAnalyticsResolutionConclusionRecords(entries = [], alertItems = [], options = {}) {
    const rows = buildAnalyticsResolutionPriorityProducts(entries, alertItems);
    const limit = Math.max(1, Number(options?.limit || 4) || 4);
    if (!rows.length) {
        return [];
    }

    return rows
        .map((row) => {
            const alertItem = row.alertItem || {};
            const latestEntry = row.latestEntry || {};
            const verificationState = buildAnalyticsResolutionPriorityVerificationStatus(row, alertItem, latestEntry);
            const verificationEvidence = buildAnalyticsResolutionPriorityEvidence(row, alertItem, latestEntry, verificationState);
            const verificationMethod = buildAnalyticsResolutionPriorityVerification(row, alertItem, latestEntry);
            const productId = String(row.productId || alertItem.productId || '').trim();
            const productName = String(row.productName || alertItem.productName || latestEntry.productName || '').trim() || '未命名商品';
            const latestStatusLabel = String(latestEntry?.statusLabel || '').trim();

            return {
                productId,
                productName,
                latestCreatedAt: Number(row.latestCreatedAt || latestEntry.createdAt || 0),
                statusKey: verificationState.key,
                statusLabel: verificationState.label,
                tone: verificationState.tone,
                title: verificationState.key === 'passed' ? '本轮复查已通过' : '本轮仍待复查',
                summary: verificationState.key === 'passed'
                    ? `${productName} 最近一轮处理已基本收口${latestStatusLabel ? `，最新回写为${latestStatusLabel}` : ''}。`
                    : `${productName} 当前仍需要继续复查${latestStatusLabel ? `，最新回写为${latestStatusLabel}` : ''}。`,
                evidence: verificationEvidence,
                verificationMethod,
                latestEntry,
                alertItem
            };
        })
        .sort((left, right) => Number(right.latestCreatedAt || 0) - Number(left.latestCreatedAt || 0))
        .slice(0, limit);
}

function renderAnalyticsResolutionConclusionRecords(entries = [], alertItems = [], options = {}) {
    const records = buildAnalyticsResolutionConclusionRecords(entries, alertItems, options);
    if (!records.length) {
        return '';
    }

    return `
        <div class="analytics-writeback-conclusions">
            <div class="analytics-writeback-conclusions__head">
                <strong>复查结论记录</strong>
                <span>沉淀最近一轮商品复查结论，方便回看是否真正收口</span>
            </div>
            <div class="analytics-writeback-conclusions__list">
                ${records.map((record) => {
                    const detailContext = {
                        productId: record.productId,
                        productName: record.productName,
                        detailFocus: String(record?.alertItem?.detailFocus || '').trim(),
                        focusTargetId: String(record?.alertItem?.focusTargetId || '').trim() || 'productDetailPanelSection'
                    };
                    return `
                        <div class="analytics-writeback-conclusion-card analytics-writeback-conclusion-card--${escapeHtml(record.tone || 'warning')}">
                            <div class="analytics-writeback-conclusion-card__top">
                                <div>
                                    <div class="analytics-writeback-conclusion-card__title">${escapeHtml(record.title || '复查结论')}</div>
                                    <div class="analytics-writeback-conclusion-card__product">${escapeHtml(record.productName || '未命名商品')}</div>
                                </div>
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(record.tone || 'warning')}">${escapeHtml(record.statusLabel || '仍待复查')}</span>
                            </div>
                            <div class="analytics-writeback-conclusion-card__summary">${escapeHtml(record.summary || '')}</div>
                            <div class="analytics-writeback-conclusion-card__meta">
                                <span>最近回写 ${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(record.latestCreatedAt))}</span>
                            </div>
                            <div class="analytics-writeback-conclusion-card__evidence">
                                <span>结论依据</span>
                                <p>${escapeHtml(record.evidence || '请结合当前预警和最近处理回写继续复查。')}</p>
                            </div>
                            <div class="analytics-writeback-conclusion-card__next-step">
                                <span>下次复查建议</span>
                                <p>${escapeHtml(record.verificationMethod || '继续回到商品分析确认相关预警是否消失。')}</p>
                            </div>
                            <div class="analytics-writeback-conclusion-card__actions">
                                ${record.productId
                                    ? `<button
                                            type="button"
                                            class="btn-sm btn-secondary"
                                            ${buildAnalyticsProductDestinationAttrs('analytics-product-detail', detailContext)}
                                        ><i class="fas fa-cube"></i> 看单品详情</button>`
                                    : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderAnalyticsResolutionPriorityProducts(entries = [], alertItems = []) {
    const rows = buildAnalyticsResolutionPriorityProducts(entries, alertItems);
    if (!rows.length) {
        return '';
    }

    const verificationSummary = rows.reduce((summary, row) => {
        const verificationState = buildAnalyticsResolutionPriorityVerificationStatus(row, row.alertItem || {}, row.latestEntry || {});
        if (verificationState.key === 'passed') {
            summary.passed += 1;
        } else {
            summary.pending += 1;
        }
        return summary;
    }, { passed: 0, pending: 0 });

    return `
        <div class="analytics-writeback-priority">
            <div class="analytics-writeback-priority__head">
                <strong>最该复查的商品</strong>
                <span>仍异常优先，其次是待复查；验证已通过 ${escapeHtml(formatNumber(verificationSummary.passed))}，仍待验证 ${escapeHtml(formatNumber(verificationSummary.pending))}</span>
            </div>
            <div class="analytics-writeback-priority__list">
                ${rows.map((row, index) => {
                    const alertItem = row.alertItem || {};
                    const productId = String(row.productId || alertItem.productId || '').trim();
                    const productName = String(row.productName || alertItem.productName || '').trim() || '未命名商品';
                    const latestEntry = row.latestEntry || {};
                    const primaryAction = Array.isArray(alertItem.actions) && alertItem.actions.length > 0
                        ? alertItem.actions[0]
                        : null;
                    const detailContext = {
                        productId,
                        productName,
                        detailFocus: String(alertItem?.detailFocus || '').trim(),
                        focusTargetId: String(alertItem?.focusTargetId || '').trim() || 'productDetailPanelSection'
                    };
                    const rankReason = buildAnalyticsResolutionPriorityReason(row, alertItem, latestEntry);
                    const recommendedAction = buildAnalyticsResolutionPriorityRecommendation(row, alertItem, latestEntry);
                    const verificationMethod = buildAnalyticsResolutionPriorityVerification(row, alertItem, latestEntry);
                    const verificationState = buildAnalyticsResolutionPriorityVerificationStatus(row, alertItem, latestEntry);
                    const verificationEvidence = buildAnalyticsResolutionPriorityEvidence(row, alertItem, latestEntry, verificationState);
                    const verificationTimeline = buildAnalyticsResolutionPriorityTimeline(row, alertItem, latestEntry, verificationState);

                    return `
                        <div class="analytics-writeback-priority__item">
                            <div class="analytics-writeback-priority__top">
                                <div class="analytics-writeback-priority__rank">TOP ${index + 1}</div>
                                <div class="analytics-writeback-priority__status">
                                    ${row.abnormalCount > 0 ? `<span class="analytics-status-chip analytics-status-chip--danger">仍异常 ${escapeHtml(formatNumber(row.abnormalCount))}</span>` : ''}
                                    ${row.reviewCount > 0 ? `<span class="analytics-status-chip analytics-status-chip--warning">待复查 ${escapeHtml(formatNumber(row.reviewCount))}</span>` : ''}
                                </div>
                            </div>
                            <div class="analytics-writeback-priority__title">${escapeHtml(productName)}</div>
                            <div class="analytics-writeback-priority__summary">${escapeHtml(
                                alertItem.summary
                                || latestEntry.summary
                                || '最近处理后仍存在需要继续复查的信号。'
                            )}</div>
                            <div class="analytics-writeback-priority__meta">
                                ${alertItem.metric ? `<span>${escapeHtml(alertItem.metric)}</span>` : ''}
                                <span>最近回写 ${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(row.latestCreatedAt))}</span>
                            </div>
                            <div class="analytics-writeback-priority__verification analytics-writeback-priority__verification--${escapeHtml(verificationState.tone || 'warning')}">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(verificationState.tone || 'warning')}">${escapeHtml(verificationState.label || '仍待验证')}</span>
                                <p>${escapeHtml(verificationState.summary || '请继续回看当前信号。')}</p>
                            </div>
                            <div class="analytics-writeback-priority__evidence">
                                <span>最近一次验证依据</span>
                                <p>${escapeHtml(verificationEvidence)}</p>
                            </div>
                            <div class="analytics-writeback-priority__timeline">
                                <span class="analytics-writeback-priority__timeline-title">处理时间线</span>
                                ${verificationTimeline.map((item) => `
                                    <div class="analytics-writeback-priority__timeline-item">
                                        <strong>${escapeHtml(item?.label || '复查')}</strong>
                                        <p>${escapeHtml(item?.summary || '')}</p>
                                    </div>
                                `).join('')}
                            </div>
                            <div class="analytics-writeback-priority__actions">
                                ${primaryAction
                                    ? `<button
                                            type="button"
                                            class="btn-sm btn-secondary"
                                            ${buildAnalyticsProductDestinationAttrs(primaryAction.destination, primaryAction.context)}
                                        ><i class="fas ${escapeHtml(primaryAction.icon || 'fa-arrow-right')}"></i> ${escapeHtml(primaryAction.label || '继续处理')}</button>`
                                    : ''}
                                ${productId
                                    ? `<button
                                            type="button"
                                            class="btn-sm btn-secondary"
                                            ${buildAnalyticsProductDestinationAttrs('analytics-product-detail', detailContext)}
                                        ><i class="fas fa-cube"></i> 看单品详情</button>`
                                    : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderAnalyticsResolutionFeedbackNote(options = {}) {
    const entries = getAnalyticsResolutionFeedbackEntriesForProduct(options);
    if (!entries.length) {
        return '';
    }
    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(entries);
    const priorityProductsMarkup = options?.showPriorityProducts
        ? renderAnalyticsResolutionPriorityProducts(entries, options?.alertItems || [])
        : '';
    const conclusionRecordsMarkup = renderAnalyticsResolutionConclusionRecords(entries, options?.alertItems || [], {
        limit: options?.showPriorityProducts ? 4 : 1
    });

    return `
        <div class="analytics-writeback-note">
            <div class="analytics-writeback-note__head">
                <strong>最近处理回写</strong>
                <span>支付 / 售后处理结果已回传到分析页</span>
            </div>
            <div class="analytics-writeback-summary">
                <span class="analytics-status-chip analytics-status-chip--success">已处理 ${escapeHtml(formatNumber(statusSummary.resolved || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--warning">待复查 ${escapeHtml(formatNumber(statusSummary.review || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--danger">仍异常 ${escapeHtml(formatNumber(statusSummary.abnormal || 0))}</span>
            </div>
            ${priorityProductsMarkup}
            ${conclusionRecordsMarkup}
            <div class="analytics-writeback-list">
                ${entries.map((entry) => `
                    <div class="analytics-writeback-item">
                        <div class="analytics-writeback-item__top">
                            <div class="analytics-writeback-item__chips">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.module === 'tickets' ? 'warning' : 'accent')}">${escapeHtml(entry?.module === 'tickets' ? '售后处理' : '支付处理')}</span>
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.tone || 'accent')}">${escapeHtml(entry?.statusLabel || '已处理')}</span>
                            </div>
                            <span class="analytics-writeback-item__time">${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(entry?.createdAt))}</span>
                        </div>
                        <div class="analytics-writeback-item__title">${escapeHtml(entry?.title || '处理已回写')}</div>
                        <div class="analytics-writeback-item__summary">${escapeHtml(entry?.summary || '')}</div>
                        <div class="analytics-writeback-item__meta">
                            ${entry?.actionLabel ? `<span>${escapeHtml(entry.actionLabel)}</span>` : ''}
                            ${entry?.referenceLabel || entry?.referenceValue ? `<span>${escapeHtml([entry.referenceLabel, entry.referenceValue].filter(Boolean).join(' · '))}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function buildAnalyticsProductAlertDigest(item = {}, summary = {}) {
    const productId = String(item?.productId || '').trim();
    const productName = String(item?.productName || '').trim();
    if (!productId && !productName) {
        return null;
    }

    const entries = getAnalyticsResolutionFeedbackEntriesForProduct({
        productId,
        productName,
        limit: 4
    });
    if (!entries.length) {
        return null;
    }

    const latestEntry = entries[0] || {};
    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(entries);
    const latestStatusKey = String(latestEntry?.statusKey || '').trim().toLowerCase();
    const hasAbnormal = Number(statusSummary.abnormal || 0) > 0 || latestStatusKey === 'abnormal';
    const hasReview = Number(statusSummary.review || 0) > 0 || latestStatusKey === 'review';

    let tone = 'success';
    let label = '已基本收口';
    let summaryText = `${productName || '该商品'} 最近一轮处理已经基本收口，当前更适合继续观察是否稳定。`;

    if (hasAbnormal || String(item?.tone || '').trim().toLowerCase() === 'danger') {
        tone = 'danger';
        label = '仍未收口';
        summaryText = `${productName || '该商品'} 最近仍有异常回写，而且当前预警还在，说明问题还没有真正消化。`;
    } else if (hasReview || String(item?.tone || '').trim().toLowerCase() === 'warning') {
        tone = 'warning';
        label = '待复查';
        summaryText = `${productName || '该商品'} 最近问题已经回落，但还需要继续复查是否会反弹。`;
    }

    const evidenceItems = [
        item?.metric ? String(item.metric).trim() : '',
        latestEntry?.statusLabel ? `最新回写 ${String(latestEntry.statusLabel).trim()}` : '',
        latestEntry?.actionLabel ? `最近动作 ${String(latestEntry.actionLabel).trim()}` : '',
        latestEntry?.createdAt ? `最近回写 ${formatAnalyticsResolutionFeedbackRelativeTime(latestEntry.createdAt)}` : ''
    ].filter(Boolean).slice(0, 3);

    return {
        tone,
        label,
        summary: summaryText,
        evidenceItems
    };
}

function buildAnalyticsProductAlertGuidance(item = {}, summary = {}) {
    const productId = String(item?.productId || '').trim();
    const productName = String(item?.productName || '').trim();
    if (!productId && !productName) {
        return null;
    }

    const entries = getAnalyticsResolutionFeedbackEntriesForProduct({
        productId,
        productName,
        limit: 4
    });
    if (!entries.length) {
        return null;
    }

    const latestEntry = entries[0] || {};
    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(entries);
    const row = {
        productId,
        productName,
        abnormalCount: Number(statusSummary.abnormal || 0),
        reviewCount: Number(statusSummary.review || 0),
        latestCreatedAt: Number(latestEntry?.createdAt || 0),
        latestEntry
    };
    const verificationState = buildAnalyticsResolutionPriorityVerificationStatus(row, item, latestEntry);

    return {
        statusLabel: verificationState?.label || '仍待验证',
        statusTone: verificationState?.tone || 'warning',
        reason: buildAnalyticsResolutionPriorityReason(row, item, latestEntry),
        recommendation: buildAnalyticsResolutionPriorityRecommendation(row, item, latestEntry),
        verification: buildAnalyticsResolutionPriorityVerification(row, item, latestEntry)
    };
}

function buildAnalyticsProductListGuidance(item = {}, options = {}) {
    const productId = String(item?.product_id || item?.productId || '').trim();
    const productName = String(item?.product_name || item?.productName || '').trim();
    if (!productId && !productName) {
        return null;
    }

    const tone = String(options?.tone || item?.tone || 'neutral').trim().toLowerCase();
    const synthesizedAlertItem = {
        productId,
        productName,
        tone,
        rankReason: typeof options?.reason === 'function' ? options.reason(item) : '',
        recommendedAction: typeof options?.recommendation === 'function' ? options.recommendation(item) : '',
        verificationMethod: typeof options?.verification === 'function' ? options.verification(item) : ''
    };
    const entries = getAnalyticsResolutionFeedbackEntriesForProduct({
        productId,
        productName,
        limit: 4
    });

    if (entries.length > 0) {
        const latestEntry = entries[0] || {};
        const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(entries);
        const row = {
            productId,
            productName,
            abnormalCount: Number(statusSummary.abnormal || 0),
            reviewCount: Number(statusSummary.review || 0),
            latestCreatedAt: Number(latestEntry?.createdAt || 0),
            latestEntry
        };
        const verificationState = buildAnalyticsResolutionPriorityVerificationStatus(row, synthesizedAlertItem, latestEntry);
        return {
            statusLabel: verificationState?.label || '仍待验证',
            statusTone: verificationState?.tone || 'warning',
            reason: buildAnalyticsResolutionPriorityReason(row, synthesizedAlertItem, latestEntry),
            recommendation: buildAnalyticsResolutionPriorityRecommendation(row, synthesizedAlertItem, latestEntry),
            verification: buildAnalyticsResolutionPriorityVerification(row, synthesizedAlertItem, latestEntry)
        };
    }

    const fallbackLabel = tone === 'danger'
        ? '优先复查'
        : (tone === 'warning' ? '建议跟进' : '经营观察');

    return {
        statusLabel: fallbackLabel,
        statusTone: tone === 'danger' ? 'danger' : (tone === 'warning' ? 'warning' : 'accent'),
        reason: synthesizedAlertItem.rankReason || '当前商品在这组经营排行里排得比较靠前，值得优先确认问题或机会是否仍在持续。',
        recommendation: synthesizedAlertItem.recommendedAction || '先点进单品详情，结合来源、漏斗和售后履约拆解确认主要矛盾，再决定处理动作。',
        verification: synthesizedAlertItem.verificationMethod || '处理后回到商品分析，确认这件商品在当前榜单或经营矩阵中的位置是否回落。'
    };
}

function renderAnalyticsProductInlineGuidance(guidance = {}) {
    return '';
}

function renderAnalyticsProductConclusionHistory(options = {}) {
    const entries = getAnalyticsResolutionFeedbackEntriesForProduct(options);
    if (!entries.length) {
        return '';
    }

    const limit = Math.max(1, Number(options?.limit || 6) || 6);
    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(entries);
    const rows = entries.slice(0, limit);
    const layoutClass = [
        'analytics-product-detail-card',
        options.layout === 'wide' ? 'analytics-product-detail-card--wide' : 'analytics-product-detail-card--feature'
    ].filter(Boolean).join(' ');

    return `
        <section class="${layoutClass}" id="productConclusionHistorySection">
            <div class="analytics-product-detail-card__head">
                <strong>历史复查结论</strong>
                <span>最近 ${escapeHtml(formatNumber(rows.length))} 条回写</span>
            </div>
            <div class="analytics-product-history-summary">
                <span class="analytics-status-chip analytics-status-chip--success">已处理 ${escapeHtml(formatNumber(statusSummary.resolved || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--warning">待复查 ${escapeHtml(formatNumber(statusSummary.review || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--danger">仍异常 ${escapeHtml(formatNumber(statusSummary.abnormal || 0))}</span>
            </div>
            <div class="analytics-product-history-note">按时间倒序保留该商品最近一轮处理与复查结论，方便回看问题是否真正收口。</div>
            <div class="analytics-writeback-list">
                ${rows.map((entry) => `
                    <div class="analytics-writeback-item">
                        <div class="analytics-writeback-item__top">
                            <div class="analytics-writeback-item__chips">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.module === 'tickets' ? 'warning' : 'accent')}">${escapeHtml(entry?.module === 'tickets' ? '售后处理' : '支付处理')}</span>
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.tone || 'accent')}">${escapeHtml(entry?.statusLabel || '已处理')}</span>
                            </div>
                            <span class="analytics-writeback-item__time">${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(entry?.createdAt))}</span>
                        </div>
                        <div class="analytics-writeback-item__title">${escapeHtml(entry?.title || '复查结论')}</div>
                        <div class="analytics-writeback-item__summary">${escapeHtml(entry?.summary || '')}</div>
                        <div class="analytics-writeback-item__meta">
                            ${entry?.actionLabel ? `<span>${escapeHtml(entry.actionLabel)}</span>` : ''}
                            ${entry?.referenceLabel || entry?.referenceValue ? `<span>${escapeHtml([entry.referenceLabel, entry.referenceValue].filter(Boolean).join(' · '))}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function renderAnalyticsProductDetailSection(options = {}) {
    const content = String(options.content || '').trim();
    if (!content) {
        return '';
    }

    const sectionId = String(options.id || '').trim();
    const eyebrow = String(options.eyebrow || '').trim();
    const title = String(options.title || '').trim() || '详情分区';
    const summary = String(options.summary || '').trim();
    const meta = String(options.meta || '').trim();
    const sectionClasses = ['analytics-product-detail-section', String(options.sectionClass || '').trim()].filter(Boolean).join(' ');
    const gridClasses = ['analytics-product-detail-grid', String(options.gridClass || '').trim()].filter(Boolean).join(' ');

    return `
        <section class="${sectionClasses}"${sectionId ? ` id="${escapeHtml(sectionId)}"` : ''}>
            <div class="analytics-product-detail-section__head">
                <div class="analytics-product-detail-section__copy">
                    ${eyebrow ? `<div class="analytics-product-detail-section__eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
                    <strong>${escapeHtml(title)}</strong>
                    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
                </div>
                ${meta ? `<span class="analytics-product-detail-section__meta">${escapeHtml(meta)}</span>` : ''}
            </div>
            <div class="${gridClasses}">
                ${content}
            </div>
        </section>
    `;
}

function renderAnalyticsProductDetailNavigator(items = [], options = {}) {
    const safeItems = Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
    if (!safeItems.length) {
        return '';
    }

    const activeTargetId = String(options.activeTargetId || '').trim();
    const productId = String(options.productId || '').trim();
    const productName = String(options.productName || '').trim();

    return `
        <div class="analytics-product-detail-nav" aria-label="单品详情分区导航">
            ${safeItems.map((item) => {
                const targetId = String(item.targetId || '').trim();
                const hasDetailFocus = Object.prototype.hasOwnProperty.call(item, 'detailFocus');
                const detailFocus = hasDetailFocus ? String(item.detailFocus || '').trim() : '';
                const isActive = Boolean(activeTargetId) && activeTargetId === targetId;
                return `
                    <button
                        type="button"
                        class="analytics-product-detail-nav__button${isActive ? ' is-active' : ''}"
                        data-admin-action="analytics-product-detail-focus-section"
                        data-analytics-target-id="${escapeHtml(targetId)}"
                        ${hasDetailFocus ? `data-analytics-detail-focus="${escapeHtml(detailFocus)}"` : ''}
                        data-analytics-product-id="${escapeHtml(productId)}"
                        data-analytics-product-name="${escapeHtml(productName)}"
                        data-analytics-product-detail-nav-target="${escapeHtml(targetId)}"
                        aria-pressed="${isActive ? 'true' : 'false'}"
                    >
                        <span class="analytics-product-detail-nav__icon">
                            <i class="${escapeHtml(item.icon || 'fas fa-compass-drafting')}"></i>
                        </span>
                        <span class="analytics-product-detail-nav__copy">
                            <span class="analytics-product-detail-nav__label">${escapeHtml(item.label || '详情分区')}</span>
                            <span class="analytics-product-detail-nav__summary">${escapeHtml(item.summary || '')}</span>
                        </span>
                        ${item.metric ? `<span class="analytics-product-detail-nav__metric">${escapeHtml(item.metric)}</span>` : ''}
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

function buildAnalyticsProductConclusionDigest(entries = [], summary = {}) {
    const rows = Array.isArray(entries) ? entries : [];
    if (!rows.length) {
        return null;
    }

    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(rows);
    const paymentsCount = rows.filter((entry) => String(entry?.module || '').trim() === 'payments').length;
    const ticketsCount = rows.filter((entry) => String(entry?.module || '').trim() === 'tickets').length;
    const purchaseIntentUsers = Number(summary?.purchase_click_user_count || 0);
    const orderCount = Number(summary?.order_count || 0);
    const refundRate = Number(summary?.refund_rate || 0);
    const deliveryRiskCount = Number(summary?.delivery_risk_count || 0);

    if (Number(statusSummary.abnormal || 0) > 0) {
        return {
            tone: 'danger',
            label: '仍未收口',
            title: '本轮经营结论',
            summary: orderCount > 0
                ? `最近仍有 ${formatNumber(statusSummary.abnormal || 0)} 条异常回写，说明这件商品的支付、退款或履约问题还没有真正收口。`
                : (purchaseIntentUsers > 0
                    ? `最近仍有 ${formatNumber(statusSummary.abnormal || 0)} 条异常回写，而且当前只有购买意图没有成交，问题大概率仍卡在支付或履约前后。`
                    : `最近仍有 ${formatNumber(statusSummary.abnormal || 0)} 条异常回写，这件商品还需要继续复查最近一轮处理是否真的生效。`),
            evidenceItems: [
                paymentsCount > 0 ? `支付处理 ${formatNumber(paymentsCount)} 条` : '',
                ticketsCount > 0 ? `售后处理 ${formatNumber(ticketsCount)} 条` : '',
                purchaseIntentUsers > 0 ? `购买意图 ${formatNumber(purchaseIntentUsers)} 用户` : '',
                orderCount > 0 ? `订单 ${formatNumber(orderCount)} 单` : '当前成交 0 单',
                deliveryRiskCount > 0 ? `履约风险 ${formatNumber(deliveryRiskCount)} 单` : '',
                refundRate > 0 ? `退款率 ${formatPercent(refundRate)}` : ''
            ].filter(Boolean)
        };
    }

    if (Number(statusSummary.review || 0) > 0) {
        return {
            tone: 'warning',
            label: '待复查',
            title: '本轮经营结论',
            summary: `最近问题已经从异常回落到待复查，当前重点不是继续扩散处理，而是验证这轮处理是否真的让商品恢复稳定。`,
            evidenceItems: [
                paymentsCount > 0 ? `支付处理 ${formatNumber(paymentsCount)} 条` : '',
                ticketsCount > 0 ? `售后处理 ${formatNumber(ticketsCount)} 条` : '',
                purchaseIntentUsers > 0 ? `购买意图 ${formatNumber(purchaseIntentUsers)} 用户` : '',
                orderCount > 0 ? `订单 ${formatNumber(orderCount)} 单` : '仍需观察成交恢复',
                deliveryRiskCount > 0 ? `履约风险 ${formatNumber(deliveryRiskCount)} 单` : '',
                refundRate > 0 ? `退款率 ${formatPercent(refundRate)}` : ''
            ].filter(Boolean)
        };
    }

    return {
        tone: 'success',
        label: '已基本收口',
        title: '本轮经营结论',
        summary: `最近一轮处理已经基本收口，当前更适合继续观察成交、退款和履约是否维持稳定，而不是再扩大处理范围。`,
        evidenceItems: [
            paymentsCount > 0 ? `支付处理 ${formatNumber(paymentsCount)} 条` : '',
            ticketsCount > 0 ? `售后处理 ${formatNumber(ticketsCount)} 条` : '',
            orderCount > 0 ? `订单 ${formatNumber(orderCount)} 单` : '当前窗口订单较少',
            purchaseIntentUsers > 0 ? `购买意图 ${formatNumber(purchaseIntentUsers)} 用户` : '',
            deliveryRiskCount > 0 ? `履约风险 ${formatNumber(deliveryRiskCount)} 单` : '履约风险已降到低位',
            refundRate > 0 ? `退款率 ${formatPercent(refundRate)}` : ''
        ].filter(Boolean)
    };
}

function renderAnalyticsProductConclusionDigest(entries = [], summary = {}) {
    const digest = buildAnalyticsProductConclusionDigest(entries, summary);
    if (!digest) {
        return '';
    }

    return `
        <section class="analytics-product-conclusion-digest analytics-product-conclusion-digest--${escapeHtml(digest.tone || 'warning')}">
            <div class="analytics-product-conclusion-digest__top">
                <div>
                    <div class="analytics-product-conclusion-digest__eyebrow">${escapeHtml(digest.title || '本轮经营结论')}</div>
                    <strong>${escapeHtml(digest.label || '待复查')}</strong>
                </div>
                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(digest.tone || 'warning')}">${escapeHtml(digest.label || '待复查')}</span>
            </div>
            <p class="analytics-product-conclusion-digest__summary">${escapeHtml(digest.summary || '')}</p>
            <div class="analytics-product-conclusion-digest__chips">
                ${Array.isArray(digest.evidenceItems) ? digest.evidenceItems.map((item) => `<span class="analytics-product-matrix-chip analytics-product-matrix-chip--${escapeHtml(digest.tone || 'warning')}">${escapeHtml(item)}</span>`).join('') : ''}
            </div>
        </section>
    `;
}

async function loadAnalyticsTrendSeriesDirect(rpcName = '', days = getAnalyticsRangeDays(30)) {
    const rangeParams = buildAnalyticsRangeRpcParams({}, { days });
    return callAnalyticsRpcWithFallback(rpcName, [
        rangeParams,
        buildAnalyticsLegacyRpcParams(rangeParams),
        buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
        {}
    ]);
}

function hasChannelBreakdownV2Signal(rows = []) {
    return Array.isArray(rows) && rows.some((row) => (
        Number(row?.event_count || 0)
        + Number(row?.user_count || 0)
        + Number(row?.unlock_success_count || 0)
        + Number(row?.verify_submit_count || 0)
        + Number(row?.recharge_success_count || 0)
        + Number(row?.shop_purchase_count || 0)
    ) > 0);
}

function hasTopContentV2Signal(rows = []) {
    return Array.isArray(rows) && rows.some((row) => (
        Number(row?.view_count || 0)
        + Number(row?.unlock_count || 0)
        + Number(row?.comment_count || 0)
    ) > 0);
}

async function loadChannelBreakdownDirect(days = getAnalyticsRangeDays()) {
    const rangeParams = buildAnalyticsRangeRpcParams({}, { days });
    const legacyRangeParams = buildAnalyticsLegacyRpcParams(rangeParams);

    try {
        const v2Data = await callAnalyticsRpcWithFallback('get_channel_breakdown_v2', [
            rangeParams,
            legacyRangeParams,
            buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
            {}
        ]);
        if (hasChannelBreakdownV2Signal(v2Data)) {
            return v2Data;
        }
    } catch (error) {
        console.warn('[Analytics] Direct fallback get_channel_breakdown_v2 failed:', error);
    }

    return callAnalyticsRpcWithFallback('get_channel_breakdown', [
        rangeParams,
        legacyRangeParams,
        buildAnalyticsLegacyRpcParams(rangeParams, { excludeDays: true }),
        {}
    ]);
}

async function loadTopContentDirect(limit = 10, days = getAnalyticsRangeDays()) {
    const safeLimit = Math.max(1, Number(limit) || 10);
    const rangeParams = buildAnalyticsRangeRpcParams({ p_limit: safeLimit }, { days });
    const legacyRangeParams = buildAnalyticsLegacyRpcParams(rangeParams);

    try {
        const v2Data = await callAnalyticsRpcWithFallback('get_content_top_v2', [
            rangeParams,
            legacyRangeParams,
            buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
            { p_limit: safeLimit }
        ]);
        if (hasTopContentV2Signal(v2Data)) {
            return Array.isArray(v2Data) ? v2Data.slice(0, safeLimit) : [];
        }
    } catch (error) {
        console.warn('[Analytics] Direct fallback get_content_top_v2 failed:', error);
    }

    const legacyData = await callAnalyticsRpcWithFallback('get_content_top', [
        rangeParams,
        legacyRangeParams,
        buildAnalyticsLegacyRpcParams(rangeParams, { excludeDays: true }),
        { p_limit: safeLimit }
    ]);
    return Array.isArray(legacyData) ? legacyData.slice(0, safeLimit) : [];
}

async function loadAnalyticsRangeRpcRowsDirect(rpcName = '', days = getAnalyticsRangeDays(), baseParams = {}) {
    const rangeParams = buildAnalyticsRangeRpcParams(baseParams, { days });
    const finalAttempt = baseParams && typeof baseParams === 'object' && !Array.isArray(baseParams)
        ? baseParams
        : {};

    return callAnalyticsRpcWithFallback(rpcName, [
        rangeParams,
        buildAnalyticsLegacyRpcParams(rangeParams),
        buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
        finalAttempt
    ]);
}

async function loadAnalyticsStaticRpcRowsDirect(rpcName = '', baseParams = {}) {
    const rangeParams = buildAnalyticsRangeRpcParams(baseParams, { includeDays: false });
    const finalAttempt = baseParams && typeof baseParams === 'object' && !Array.isArray(baseParams)
        ? baseParams
        : {};

    return callAnalyticsRpcWithFallback(rpcName, [
        rangeParams,
        buildAnalyticsLegacyRpcParams(rangeParams),
        buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
        finalAttempt
    ]);
}

async function loadAnalyticsSummaryWindowFallbackData(options = {}) {
    try {
        return await getAnalyticsSummaryWindowData(options);
    } catch (error) {
        console.warn('[Analytics] Summary window accessor unavailable, retrying direct summary RPC:', error);
        return loadAnalyticsSummaryWindowSiteDirect(getAnalyticsSiteParam() || 'all', {
            topContentLimit: 5
        });
    }
}

async function fetchUserTrendData(days = getAnalyticsRangeDays(30)) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsTrendSeriesBundle({ days }),
        readSegment: getAnalyticsTrendSeriesBundleSegment,
        segmentKey: 'userTrend',
        unavailableMessage: 'User trend bundle unavailable',
        warningMessage: '[Analytics] Trend series bundle user trend unavailable:',
        createSegmentError: createAnalyticsTrendSeriesBundleSegmentError,
        directLoader: () => loadAnalyticsTrendSeriesDirect('get_user_trend', days)
    });
}

async function fetchContentTrendData(days = getAnalyticsRangeDays(30)) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsTrendSeriesBundle({ days }),
        readSegment: getAnalyticsTrendSeriesBundleSegment,
        segmentKey: 'contentTrend',
        unavailableMessage: 'Content trend bundle unavailable',
        warningMessage: '[Analytics] Trend series bundle content trend unavailable:',
        createSegmentError: createAnalyticsTrendSeriesBundleSegmentError,
        directLoader: () => loadAnalyticsTrendSeriesDirect('get_content_trend', days)
    });
}

async function fetchRevenueTrendData(days = getAnalyticsRangeDays(30)) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsTrendSeriesBundle({ days }),
        readSegment: getAnalyticsTrendSeriesBundleSegment,
        segmentKey: 'revenueTrend',
        unavailableMessage: 'Revenue trend bundle unavailable',
        warningMessage: '[Analytics] Trend series bundle revenue trend unavailable:',
        createSegmentError: createAnalyticsTrendSeriesBundleSegmentError,
        directLoader: () => loadAnalyticsTrendSeriesDirect('get_revenue_trend', days)
    });
}

function createAnalyticsProductBundleSegmentError(segment = null, fallbackMessage = 'Product analytics bundle segment unavailable') {
    const error = new Error(
        String(segment?.message || fallbackMessage || 'Product analytics bundle segment unavailable')
    );
    error.statusCode = Number(segment?.statusCode || 500);
    error.payload = segment?.payload;
    error.bundleSegment = segment || null;
    return error;
}

function getAnalyticsProductBundlePayloadOrThrow(bundle = null, segmentKey = '', fallbackMessage = 'Product analytics bundle segment unavailable') {
    const segment = getAnalyticsProductBundleSegment(bundle, segmentKey);
    if (segment?.ok) {
        return segment.payload;
    }
    throw createAnalyticsProductBundleSegmentError(segment, fallbackMessage);
}

function getAnalyticsProductLoadFailureMessage(error, fallbackMessage = '商品分析加载失败') {
    const baseMessage = String(fallbackMessage || '商品分析加载失败').trim() || '商品分析加载失败';
    const rawMessage = String(error?.message || '').trim();
    const normalizedMessage = rawMessage.toLowerCase();

    if (normalizedMessage.includes('admin route not found')) {
        return `${baseMessage}：当前后台实例未部署商品分析路由，请重新部署或重启 API 实例`;
    }

    if (normalizedMessage.includes('admin access required')) {
        return `${baseMessage}：当前后台会话没有商品分析访问权限，请重新登录管理员账号`;
    }

    if (normalizedMessage.includes('token is expired') || normalizedMessage.includes('invalid jwt')) {
        return `${baseMessage}：当前后台登录态已失效，请重新登录后再试`;
    }

    if (rawMessage && rawMessage !== baseMessage) {
        return `${baseMessage}：${rawMessage}`;
    }

    return baseMessage;
}

function renderAnalyticsProductWindowStatusNotice(message = '', tone = 'warning') {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        return '';
    }

    return `
        <div class="analytics-product-window-notice analytics-product-window-notice--${escapeHtml(tone)}">
            <i class="fas ${tone === 'warning' ? 'fa-circle-info' : 'fa-chart-line'}"></i>
            <span>${escapeHtml(normalizedMessage)}</span>
        </div>
    `;
}

function buildAnalyticsProductOrderlessMessage(summary = {}) {
    const viewUsers = Number(summary?.view_user_count || 0);
    const detailViewUsers = Number(summary?.detail_view_user_count || 0);
    const purchaseIntentUsers = Number(summary?.purchase_click_user_count || 0);
    const activeProducts = Number(summary?.active_product_count || 0);
    const sellingProducts = Number(summary?.selling_product_count || 0);

    if (viewUsers > 0 || detailViewUsers > 0) {
        return `当前窗口已采到 浏览用户 ${formatNumber(viewUsers)}、详情用户 ${formatNumber(detailViewUsers)}、购买意图用户 ${formatNumber(purchaseIntentUsers)}，但暂无成交订单，因此成交用户、销量、GMV 和收入类榜单会显示为 0。可延长时间范围，或优先查看商品漏斗与经营矩阵。`;
    }

    if (activeProducts > 0 || sellingProducts > 0) {
        return `当前窗口内商品池已加载，但暂无成交订单样本，因此总盘交易指标和订单型榜单暂时为空。`;
    }

    return '';
}

function renderAnalyticsProductLoadingState(message = '加载中...') {
    if (typeof window.AdminShell?.buildLoadingDotsMarkup === 'function') {
        return window.AdminShell.buildLoadingDotsMarkup(message, { variant: 'block', tagName: 'div' });
    }
    return `<div class="loading-text">${escapeHtml(message)}</div>`;
}

function renderAnalyticsProductDetailSkeletonBlock(classNames = '') {
    const normalizedClassNames = String(classNames || '').trim();
    return `<span class="admin-skeleton-block${normalizedClassNames ? ` ${normalizedClassNames}` : ''}"></span>`;
}

function renderAnalyticsProductSkeletonPill(width = 'admin-skeleton-w-chip-sm', className = '') {
    const classes = ['analytics-product-skeleton__pill', String(className || '').trim()].filter(Boolean).join(' ');
    return `
        <span class="${classes}">
            ${renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${String(width || 'admin-skeleton-w-chip-sm').trim()}`)}
        </span>
    `;
}

function renderAnalyticsProductSkeletonAction(width = 'admin-skeleton-w-chip-md') {
    return `
        <div class="analytics-product-skeleton__action">
            ${renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${String(width || 'admin-skeleton-w-chip-md').trim()}`)}
        </div>
    `;
}

function renderAnalyticsProductSkeletonNotice() {
    return `
        <div class="analytics-product-window-notice analytics-product-window-notice--warning analytics-product-skeleton__notice">
            <span class="analytics-product-skeleton__notice-icon">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--tiny admin-skeleton-w-20')}
            </span>
            <div class="analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
            </div>
        </div>
    `;
}

function renderAnalyticsProductSkeletonMetricCard(tone = 'default') {
    return `
        <article class="analytics-product-metric-card analytics-product-metric-card--${escapeHtml(tone)} analytics-product-skeleton__metric-card">
            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-50')}
        </article>
    `;
}

function renderAnalyticsProductSkeletonSurface(options = {}) {
    const classes = ['analytics-product-panel', 'analytics-product-skeleton__surface', String(options.className || '').trim()].filter(Boolean).join(' ');
    const eyebrowWidth = String(options.eyebrowWidth || 'admin-skeleton-w-chip-xs').trim() || 'admin-skeleton-w-chip-xs';
    const titleWidth = String(options.titleWidth || 'admin-skeleton-w-30').trim() || 'admin-skeleton-w-30';
    const summaryWidth = String(options.summaryWidth || 'admin-skeleton-w-60').trim() || 'admin-skeleton-w-60';
    const secondarySummaryWidth = String(options.secondarySummaryWidth || '').trim();
    const metaWidth = String(options.metaWidth || 'admin-skeleton-w-chip-sm').trim() || 'admin-skeleton-w-chip-sm';
    const body = String(options.body || '').trim();

    return `
        <section class="${classes}">
            <div class="analytics-product-panel__head analytics-product-skeleton__surface-head">
                <div class="analytics-product-skeleton__stack">
                    ${renderAnalyticsProductSkeletonPill(eyebrowWidth, 'analytics-product-skeleton__eyebrow')}
                    ${renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--title ${titleWidth}`)}
                    ${renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${summaryWidth}`)}
                    ${secondarySummaryWidth ? renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${secondarySummaryWidth}`) : ''}
                </div>
                ${renderAnalyticsProductSkeletonPill(metaWidth, 'analytics-product-skeleton__meta-pill')}
            </div>
            ${body}
        </section>
    `;
}

function renderAnalyticsProductSkeletonTrendChart(options = {}) {
    const columnSizes = ['sm', 'md', 'lg', 'xl', 'md', 'lg', 'sm'];
    const paneClasses = [
        'analytics-product-chart-pane',
        options.compact === true ? 'analytics-product-chart-pane--compact' : '',
        'analytics-product-skeleton__chart-pane'
    ].filter(Boolean).join(' ');
    return `
        <div class="${paneClasses}">
            <div class="analytics-product-skeleton__chart">
                <div class="analytics-product-skeleton__chart-bars">
                    ${columnSizes.map((size) => `<span class="analytics-product-skeleton__chart-column analytics-product-skeleton__chart-column--${size}"></span>`).join('')}
                </div>
                <div class="analytics-product-skeleton__chip-row">
                    ${['admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-xs'].map((width) => renderAnalyticsProductSkeletonPill(width)).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderAnalyticsProductSkeletonBubbleChart() {
    return `
        <div class="analytics-product-chart-pane analytics-product-chart-pane--compact analytics-product-skeleton__chart-pane">
            <div class="analytics-product-skeleton__chart analytics-product-skeleton__chart--matrix">
                <span class="analytics-product-skeleton__bubble analytics-product-skeleton__bubble--one"></span>
                <span class="analytics-product-skeleton__bubble analytics-product-skeleton__bubble--two"></span>
                <span class="analytics-product-skeleton__bubble analytics-product-skeleton__bubble--three"></span>
                <span class="analytics-product-skeleton__bubble analytics-product-skeleton__bubble--four"></span>
                <span class="analytics-product-skeleton__axis analytics-product-skeleton__axis--x"></span>
                <span class="analytics-product-skeleton__axis analytics-product-skeleton__axis--y"></span>
            </div>
        </div>
    `;
}

function renderAnalyticsProductSkeletonSiteCard() {
    return `
        <article class="analytics-product-site-card analytics-product-skeleton__site-card">
            <div class="analytics-product-site-card__top">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-20')}
                ${renderAnalyticsProductSkeletonPill('admin-skeleton-w-chip-xs')}
            </div>
            <div class="analytics-product-site-card__metrics analytics-product-skeleton__inline-meta">
                ${['admin-skeleton-w-20', 'admin-skeleton-w-20', 'admin-skeleton-w-20', 'admin-skeleton-w-20'].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${width}`)).join('')}
            </div>
        </article>
    `;
}

function renderAnalyticsProductSkeletonCategoryRow() {
    return `
        <article class="analytics-product-category-row analytics-product-skeleton__list-card">
            <div class="analytics-product-category-row__main analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                <div class="analytics-product-category-row__top">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                </div>
                <div class="analytics-product-category-row__meta analytics-product-skeleton__inline-meta">
                    ${['admin-skeleton-w-20', 'admin-skeleton-w-20', 'admin-skeleton-w-20', 'admin-skeleton-w-20'].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${width}`)).join('')}
                </div>
                <div class="analytics-product-inline-guidance analytics-product-skeleton__guidance">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
                </div>
            </div>
        </article>
    `;
}

function renderAnalyticsProductSkeletonMatrixRow() {
    return `
        <article class="analytics-product-matrix-row analytics-product-skeleton__list-card">
            <div class="analytics-product-matrix-row__main analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                <div class="analytics-product-matrix-row__top">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                    ${renderAnalyticsProductSkeletonPill('admin-skeleton-w-chip-xs')}
                </div>
                <div class="analytics-product-matrix-row__meta analytics-product-skeleton__inline-meta">
                    ${['admin-skeleton-w-20', 'admin-skeleton-w-20', 'admin-skeleton-w-20'].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${width}`)).join('')}
                </div>
                <div class="analytics-product-inline-guidance analytics-product-skeleton__guidance">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                </div>
            </div>
        </article>
    `;
}

function renderAnalyticsProductSkeletonRankRow() {
    return `
        <div class="analytics-product-rank-item analytics-product-skeleton__list-row">
            <span class="analytics-product-skeleton__rank-index">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--tiny admin-skeleton-w-20')}
            </span>
            <div class="analytics-product-rank-item__body analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                <div class="analytics-product-rank-item__top">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                </div>
                <div class="analytics-product-rank-item__meta analytics-product-skeleton__inline-meta">
                    ${['admin-skeleton-w-20', 'admin-skeleton-w-20', 'admin-skeleton-w-20'].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${width}`)).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderAnalyticsProductSkeletonHealthRow() {
    return `
        <div class="analytics-product-health-item analytics-product-skeleton__list-row">
            <div class="analytics-product-health-item__body analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                <div class="analytics-product-health-item__meta analytics-product-skeleton__inline-meta">
                    ${['admin-skeleton-w-20', 'admin-skeleton-w-30'].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${width}`)).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderAnalyticsProductSkeletonFunnelStage() {
    return `
        <div class="analytics-product-funnel-stage analytics-product-skeleton__funnel-stage">
            <div class="analytics-product-funnel-stage__head">
                <div class="analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-40')}
                </div>
                <div class="analytics-product-skeleton__row-side">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-20')}
                    ${renderAnalyticsProductSkeletonPill('admin-skeleton-w-chip-xs')}
                </div>
            </div>
            <div class="analytics-product-funnel-stage__bar analytics-product-skeleton__funnel-bar">
                <span style="width:72%;"></span>
            </div>
        </div>
    `;
}

function renderAnalyticsProductSkeletonCompareRow() {
    return `
        <div class="analytics-product-funnel-compare-row analytics-product-skeleton__list-row">
            <div class="analytics-product-funnel-compare-row__main analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                <div class="analytics-product-funnel-compare-row__meta analytics-product-skeleton__inline-meta">
                    ${['admin-skeleton-w-20', 'admin-skeleton-w-20', 'admin-skeleton-w-20', 'admin-skeleton-w-20'].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${width}`)).join('')}
                </div>
            </div>
            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-20')}
        </div>
    `;
}

function renderAnalyticsProductSkeletonAlertCard(tone = 'warning') {
    return `
        <article class="analytics-product-alert-card analytics-product-alert-card--${escapeHtml(tone)} analytics-product-skeleton__alert-card">
            <div class="analytics-product-alert-card__top">
                ${renderAnalyticsProductSkeletonPill('admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
            </div>
            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-50')}
            <div class="analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
            </div>
            <div class="analytics-product-inline-guidance analytics-product-skeleton__guidance">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-60')}
            </div>
            <div class="analytics-product-alert-card__actions analytics-product-skeleton__actions analytics-product-skeleton__actions--compact">
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
            </div>
        </article>
    `;
}

function renderAnalyticsProductSkeletonHintCard() {
    return `
        <article class="analytics-recommendation-item analytics-product-skeleton__hint-card">
            <div class="analytics-recommendation-item__top">
                ${renderAnalyticsProductSkeletonPill('admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
            </div>
            <div class="analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
            </div>
            <div class="analytics-recommendation-item__actions analytics-product-skeleton__actions analytics-product-skeleton__actions--compact">
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
            </div>
        </article>
    `;
}

function renderAnalyticsProductAlertsSkeleton() {
    return `
        <div class="analytics-product-alerts analytics-product-alerts--skeleton" aria-hidden="true">
            ${renderAnalyticsProductSkeletonNotice()}
            <section class="analytics-writeback-note analytics-product-skeleton__note-card">
                <div class="analytics-writeback-note__head">
                    <div class="analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-60')}
                    </div>
                    ${renderAnalyticsProductSkeletonPill('admin-skeleton-w-chip-xs')}
                </div>
                <div class="analytics-product-skeleton__stack">
                    ${Array.from({ length: 2 }, () => `
                        <div class="analytics-writeback-item analytics-product-skeleton__list-card">
                            <div class="analytics-writeback-item__top">
                                <div class="analytics-writeback-item__chips">
                                    ${renderAnalyticsProductSkeletonPill('admin-skeleton-w-chip-sm')}
                                    ${renderAnalyticsProductSkeletonPill('admin-skeleton-w-chip-xs')}
                                </div>
                                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                            </div>
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-50')}
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                        </div>
                    `).join('')}
                </div>
            </section>
            <div class="analytics-product-alert-grid">
                ${renderAnalyticsProductSkeletonAlertCard('warning')}
                ${renderAnalyticsProductSkeletonAlertCard('danger')}
            </div>
            <div class="analytics-product-actions analytics-product-skeleton__actions">
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
            </div>
        </div>
    `;
}

function renderAnalyticsProductOverviewSkeleton() {
    return `
        <div class="analytics-product-dashboard analytics-product-dashboard--skeleton" aria-hidden="true">
            ${renderAnalyticsProductSkeletonNotice()}
            <div class="analytics-product-metric-grid">
                ${['default', 'accent', 'success', 'default', 'warning', 'danger'].map((tone) => renderAnalyticsProductSkeletonMetricCard(tone)).join('')}
            </div>
            <div class="analytics-product-summary-layout">
                ${renderAnalyticsProductSkeletonSurface({
                    className: 'analytics-product-panel--trend',
                    titleWidth: 'admin-skeleton-w-30',
                    summaryWidth: 'admin-skeleton-w-50',
                    metaWidth: 'admin-skeleton-w-chip-sm',
                    body: renderAnalyticsProductSkeletonTrendChart()
                })}
                ${renderAnalyticsProductSkeletonSurface({
                    className: 'analytics-product-panel--comparison',
                    titleWidth: 'admin-skeleton-w-30',
                    summaryWidth: 'admin-skeleton-w-50',
                    metaWidth: 'admin-skeleton-w-chip-sm',
                    body: `<div class="analytics-product-site-grid">
                        ${Array.from({ length: 2 }, () => renderAnalyticsProductSkeletonSiteCard()).join('')}
                    </div>`
                })}
            </div>
            <div class="analytics-product-summary-layout analytics-product-summary-layout--secondary">
                ${renderAnalyticsProductSkeletonSurface({
                    className: 'analytics-product-panel--category',
                    titleWidth: 'admin-skeleton-w-30',
                    summaryWidth: 'admin-skeleton-w-60',
                    metaWidth: 'admin-skeleton-w-chip-sm',
                    body: `
                        <div class="analytics-product-structure-layout">
                            ${renderAnalyticsProductSkeletonTrendChart({ compact: true })}
                            <div class="analytics-product-category-list">
                                ${Array.from({ length: 4 }, () => renderAnalyticsProductSkeletonCategoryRow()).join('')}
                            </div>
                        </div>
                    `
                })}
                ${renderAnalyticsProductSkeletonSurface({
                    className: 'analytics-product-panel--matrix',
                    titleWidth: 'admin-skeleton-w-30',
                    summaryWidth: 'admin-skeleton-w-60',
                    metaWidth: 'admin-skeleton-w-chip-sm',
                    body: `
                        <div class="analytics-product-matrix-summary analytics-product-skeleton__chip-row">
                            ${['admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-xs'].map((width) => renderAnalyticsProductSkeletonPill(width)).join('')}
                        </div>
                        <div class="analytics-product-structure-layout">
                            ${renderAnalyticsProductSkeletonBubbleChart()}
                            <div class="analytics-product-matrix-list">
                                ${Array.from({ length: 4 }, () => renderAnalyticsProductSkeletonMatrixRow()).join('')}
                            </div>
                        </div>
                    `
                })}
            </div>
            <div class="analytics-product-actions analytics-product-skeleton__actions">
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
            </div>
        </div>
    `;
}

function renderAnalyticsProductRankingsSkeleton() {
    return `
        <div class="analytics-product-dashboard analytics-product-dashboard--skeleton" aria-hidden="true">
            ${renderAnalyticsProductSkeletonNotice()}
            <div class="analytics-product-rank-board analytics-product-rank-board--skeleton">
                <div class="analytics-product-rank-board__metric-tabs">
                    ${['admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-md', 'admin-skeleton-w-chip-sm'].map((width) => renderAnalyticsProductSkeletonPill(width)).join('')}
                </div>
                <div class="analytics-product-rank-board__body">
                    <section class="analytics-product-rank-board__chart">
                        <div class="analytics-product-rank-board__panel-head">
                            <div class="analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
                            </div>
                            ${renderAnalyticsProductSkeletonPill('admin-skeleton-w-chip-xs')}
                        </div>
                        <div class="analytics-product-rank-board__panel-note">
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                        </div>
                        <div class="analytics-product-rank-board__bars">
                            ${Array.from({ length: 6 }, () => `
                                <div class="analytics-product-rank-board__bar-row analytics-product-rank-board__bar-row--success analytics-product-rank-board__bar-row--skeleton">
                                    <span class="analytics-product-rank-board__bar-rank">
                                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--tiny admin-skeleton-w-20')}
                                    </span>
                                    <span class="analytics-product-rank-board__bar-main analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                                        <span class="analytics-product-rank-board__bar-top">
                                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                                        </span>
                                        <span class="analytics-product-rank-board__bar-track">
                                            <span class="analytics-product-rank-board__bar-fill analytics-product-rank-board__bar-fill--skeleton"></span>
                                        </span>
                                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-60')}
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    </section>
                    <aside class="analytics-product-rank-board__inspector">
                        <div class="analytics-product-rank-board__panel-head analytics-product-rank-board__panel-head--stack analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                        </div>
                        <div class="analytics-product-rank-board__hero">
                            <div class="analytics-product-rank-board__hero-top">
                                ${renderAnalyticsProductSkeletonPill('admin-skeleton-w-chip-xs')}
                                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                            </div>
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
                        </div>
                        <div class="analytics-product-rank-board__chip-list">
                            ${['admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-sm'].map((width) => renderAnalyticsProductSkeletonPill(width)).join('')}
                        </div>
                        <div class="analytics-product-rank-board__guidance analytics-product-skeleton__guidance">
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
                        </div>
                        <div class="analytics-product-rank-board__compare-list">
                            ${Array.from({ length: 5 }, () => `
                                <div class="analytics-product-rank-board__compare-row analytics-product-rank-board__compare-row--success">
                                    <span class="analytics-product-rank-board__compare-rank">
                                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--tiny admin-skeleton-w-20')}
                                    </span>
                                    <span class="analytics-product-rank-board__compare-main analytics-product-skeleton__stack analytics-product-skeleton__stack--tight">
                                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                                    </span>
                                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                                </div>
                            `).join('')}
                        </div>
                        <div class="analytics-product-actions analytics-product-skeleton__actions">
                            ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
                            ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    `;
}

function renderAnalyticsProductFunnelSkeleton() {
    return `
        <div class="analytics-product-dashboard analytics-product-dashboard--skeleton" aria-hidden="true">
            <div class="analytics-product-summary-layout">
                ${renderAnalyticsProductSkeletonSurface({
                    className: 'analytics-product-panel--funnel',
                    titleWidth: 'admin-skeleton-w-30',
                    summaryWidth: 'admin-skeleton-w-50',
                    metaWidth: 'admin-skeleton-w-chip-sm',
                    body: `
                        <div class="analytics-product-funnel-stage-list">
                            ${Array.from({ length: 4 }, () => renderAnalyticsProductSkeletonFunnelStage()).join('')}
                        </div>
                        <div class="analytics-product-funnel-risk-strip analytics-product-skeleton__chip-row">
                            ${['admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-xs'].map((width) => renderAnalyticsProductSkeletonPill(width)).join('')}
                        </div>
                    `
                })}
                ${renderAnalyticsProductSkeletonSurface({
                    className: 'analytics-product-panel--comparison',
                    titleWidth: 'admin-skeleton-w-30',
                    summaryWidth: 'admin-skeleton-w-50',
                    metaWidth: 'admin-skeleton-w-chip-sm',
                    body: `<div class="analytics-product-site-grid">
                        ${Array.from({ length: 2 }, () => renderAnalyticsProductSkeletonSiteCard()).join('')}
                    </div>`
                })}
            </div>
            ${renderAnalyticsProductSkeletonSurface({
                className: 'analytics-product-panel--compare-list',
                titleWidth: 'admin-skeleton-w-30',
                summaryWidth: 'admin-skeleton-w-50',
                metaWidth: 'admin-skeleton-w-chip-sm',
                body: `<div class="analytics-product-funnel-compare-list">
                    ${Array.from({ length: 4 }, () => renderAnalyticsProductSkeletonCompareRow()).join('')}
                </div>`
            })}
        </div>
    `;
}

function renderAnalyticsProductHealthSkeleton() {
    return `
        <div class="analytics-product-dashboard analytics-product-dashboard--skeleton" aria-hidden="true">
            <div class="analytics-product-health-grid">
                ${['warning', 'danger', 'warning', 'default'].map((tone) => `
                    <article class="analytics-product-health-card analytics-product-health-card--${escapeHtml(tone === 'default' ? 'neutral' : tone)} analytics-product-skeleton__list-card">
                        <div class="analytics-product-health-card__head">
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                        </div>
                        <div class="analytics-product-health-list">
                            ${Array.from({ length: 4 }, () => renderAnalyticsProductSkeletonHealthRow()).join('')}
                        </div>
                    </article>
                `).join('')}
            </div>
            <div class="analytics-recommendation-stack analytics-product-hint-stack">
                ${Array.from({ length: 2 }, () => renderAnalyticsProductSkeletonHintCard()).join('')}
            </div>
            <div class="analytics-product-actions analytics-product-skeleton__actions">
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductSkeletonAction('admin-skeleton-w-chip-sm')}
            </div>
        </div>
    `;
}

function renderAnalyticsProductCommerceSkeleton(kind = 'default') {
    switch (String(kind || '').trim().toLowerCase()) {
        case 'alerts':
            return renderAnalyticsProductAlertsSkeleton();
        case 'overview':
            return renderAnalyticsProductOverviewSkeleton();
        case 'rankings':
            return renderAnalyticsProductRankingsSkeleton();
        case 'funnel':
            return renderAnalyticsProductFunnelSkeleton();
        case 'health':
            return renderAnalyticsProductHealthSkeleton();
        default:
            return renderAnalyticsProductLoadingState('加载中...');
    }
}

function renderAnalyticsProductDetailSkeletonCard(options = {}) {
    const classes = ['analytics-product-detail-card', String(options.className || '').trim()].filter(Boolean).join(' ');
    const title = String(options.title || '内容加载中').trim() || '内容加载中';
    const metaMarkup = String(options.metaMarkup || '').trim()
        || renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-chip-sm');
    const content = String(options.content || '').trim();

    return `
        <section class="${classes}">
            <div class="analytics-product-detail-card__head">
                <strong>${escapeHtml(title)}</strong>
                ${metaMarkup}
            </div>
            ${content}
        </section>
    `;
}

function renderAnalyticsProductDetailSkeletonSection(options = {}) {
    const sectionId = String(options.id || '').trim();
    const eyebrow = String(options.eyebrow || '').trim();
    const title = String(options.title || '详情分区').trim() || '详情分区';
    const summary = String(options.summary || '').trim();
    const sectionClasses = [
        'analytics-product-detail-section',
        'analytics-product-detail-section--skeleton',
        String(options.sectionClass || '').trim()
    ].filter(Boolean).join(' ');
    const gridClasses = ['analytics-product-detail-grid', String(options.gridClass || '').trim()].filter(Boolean).join(' ');
    const content = String(options.content || '').trim();

    return `
        <section class="${sectionClasses}"${sectionId ? ` id="${escapeHtml(sectionId)}"` : ''}>
            <div class="analytics-product-detail-section__head">
                <div class="analytics-product-detail-section__copy">
                    ${eyebrow ? `<div class="analytics-product-detail-section__eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
                    <strong>${escapeHtml(title)}</strong>
                    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
                </div>
                <span class="analytics-product-detail-section__meta analytics-product-detail-skeleton__meta-pill">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-chip-md')}
                </span>
            </div>
            <div class="${gridClasses}">
                ${content}
            </div>
        </section>
    `;
}

function renderAnalyticsProductDetailSkeletonSurface(options = {}) {
    const classes = ['analytics-product-detail__surface', String(options.className || '').trim()].filter(Boolean).join(' ');
    const eyebrow = String(options.eyebrow || '').trim();
    const title = String(options.title || '加载中').trim() || '加载中';
    const summary = String(options.summary || '').trim();
    const headClasses = [
        'analytics-product-detail__surface-head',
        options.compact === true ? 'analytics-product-detail__surface-head--compact' : ''
    ].filter(Boolean).join(' ');
    const body = String(options.body || '').trim();

    return `
        <section class="${classes}">
            <div class="${headClasses}">
                <div class="analytics-product-detail__surface-copy">
                    ${eyebrow ? `<span class="analytics-product-detail__surface-eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
                    <strong class="analytics-product-detail__surface-title">${escapeHtml(title)}</strong>
                    ${summary ? `<p class="analytics-product-detail__surface-summary">${escapeHtml(summary)}</p>` : ''}
                </div>
            </div>
            ${body}
        </section>
    `;
}

function renderAnalyticsProductDetailSkeleton() {
    const renderTokenList = (widths = []) => `
        <div class="analytics-product-token-list">
            ${(Array.isArray(widths) ? widths : []).map((width) => (
                renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--pill ${String(width || 'admin-skeleton-w-chip-sm').trim()}`)
            )).join('')}
        </div>
    `;

    const renderMetricCardSkeleton = (tone = 'default') => `
        <article class="analytics-product-metric-card analytics-product-metric-card--${escapeHtml(tone)} analytics-product-detail-skeleton__metric-card">
            <div class="analytics-product-metric-card__label">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-40')}
            </div>
            <div class="analytics-product-metric-card__value">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
            </div>
            <div class="analytics-product-metric-card__note">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-60')}
            </div>
        </article>
    `;

    const renderEventRowSkeleton = () => `
        <div class="analytics-product-event-row">
            <div class="analytics-product-event-row__meta">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-50')}
            </div>
            <div class="analytics-product-detail-skeleton__row-side">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
            </div>
        </div>
    `;

    const renderWritebackItemSkeleton = () => `
        <div class="analytics-writeback-item">
            <div class="analytics-writeback-item__top">
                <div class="analytics-writeback-item__chips">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-xs')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-sm')}
                </div>
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
            </div>
            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
            <div class="analytics-product-detail-skeleton__stack analytics-product-detail-skeleton__stack--tight">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
            </div>
            <div class="analytics-writeback-item__meta">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
            </div>
        </div>
    `;

    const renderPromptRowSkeleton = () => `
        <div class="analytics-product-prompt-row">
            <div class="analytics-product-prompt-row__main">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                <div class="analytics-product-prompt-row__meta">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                </div>
            </div>
            <div class="analytics-product-prompt-row__metric">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-20')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
            </div>
        </div>
    `;

    const renderSourceRowSkeleton = (options = {}) => `
        <div class="analytics-product-source-row analytics-product-source-row--skeleton">
            <div class="analytics-product-source-row__main">
                ${options.withEyebrow ? renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20') : ''}
                ${renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--title ${options.titleWidth || 'admin-skeleton-w-30'}`)}
            </div>
            <div class="analytics-product-source-row__meta">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
            </div>
        </div>
    `;

    const renderFlowStepSkeleton = (options = {}) => `
        <article class="analytics-product-flow-step analytics-product-flow-step--${escapeHtml(options.tone || 'default')} analytics-product-flow-step--skeleton">
            ${options.index ? `<span class="analytics-product-flow-step__index">${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-xs')}</span>` : ''}
            <div class="analytics-product-flow-step__body">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                ${renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--title ${options.valueWidth || 'admin-skeleton-w-30'}`)}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-40')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-60')}
            </div>
        </article>
    `;

    const renderAttributionGroupSkeleton = (options = {}) => `
        <section class="analytics-product-attribution-group ${options.feature ? 'analytics-product-attribution-group--feature' : ''}">
            <div class="analytics-product-attribution-group__head">
                <span class="analytics-product-attribution-group__icon">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-xs')}
                </span>
                <div class="analytics-product-attribution-group__copy">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-60')}
                </div>
                ${renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--pill ${options.countWidth || 'admin-skeleton-w-chip-sm'}`)}
            </div>
            <div class="analytics-product-source-list">
                ${Array.from({ length: Number(options.rows || 2) }).map((_, index) => (
                    renderSourceRowSkeleton({
                        withEyebrow: options.withEyebrow === true,
                        titleWidth: index === 0 ? 'admin-skeleton-w-30' : 'admin-skeleton-w-20'
                    })
                )).join('')}
            </div>
        </section>
    `;

    const renderDeliveryCardSkeleton = (tone = 'neutral') => `
        <article class="analytics-product-delivery-card analytics-product-delivery-card--${escapeHtml(tone)} analytics-product-delivery-card--skeleton">
            <div class="analytics-product-delivery-card__top">
                <div class="analytics-product-delivery-card__copy">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                </div>
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-sm')}
            </div>
            <div class="analytics-product-delivery-card__stats">
                ${['订单', '用户'].map(() => `
                    <div class="analytics-product-delivery-card__stat">
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-20')}
                    </div>
                `).join('')}
            </div>
            <div class="analytics-product-delivery-card__actions">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-sm')}
            </div>
        </article>
    `;

    const renderDestinationRowSkeleton = () => `
        <div class="analytics-product-destination-row">
            <div class="analytics-product-destination-row__main">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                <div class="analytics-product-destination-row__meta">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                </div>
            </div>
            <div class="analytics-product-destination-row__side">
                <div class="analytics-product-destination-row__metric">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-20')}
                </div>
                <div class="analytics-product-destination-row__actions">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-sm')}
                </div>
            </div>
        </div>
    `;

    const renderOrderRowSkeleton = () => `
        <div class="analytics-product-order-row">
            <div class="analytics-product-order-row__main">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                <div class="analytics-product-order-row__meta">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-30')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-20')}
                </div>
            </div>
            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-sm')}
        </div>
    `;

    const renderFunnelStageSkeleton = (barWidth = '72%') => `
        <div class="analytics-product-funnel-stage">
            <div class="analytics-product-funnel-stage__head">
                <div class="analytics-product-detail-skeleton__stack analytics-product-detail-skeleton__stack--tight">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-50')}
                </div>
                <div class="analytics-product-detail-skeleton__row-side">
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-20')}
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-sm')}
                </div>
            </div>
            <div class="analytics-product-funnel-stage__bar">
                <span class="admin-skeleton-block analytics-product-detail-skeleton__progress" style="width:${escapeHtml(barWidth)};"></span>
            </div>
        </div>
    `;

    const identitySurface = renderAnalyticsProductDetailSkeletonSurface({
        className: 'analytics-product-detail__surface--identity',
        eyebrow: '商品概况',
        title: '当前单品的基础信息与经营定位',
        summary: '先看到当前商品身份、标题信息和基础标签，减少进入详情页后的空白等待感。',
        body: `
            <div class="analytics-product-detail__breadcrumbs analytics-product-detail-skeleton__breadcrumbs">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-chip-sm')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--tiny admin-skeleton-w-20')}
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-chip-sm')}
            </div>
            <div class="analytics-product-detail__headline-row analytics-product-detail-skeleton__headline-row">
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-sm')}
                <div class="analytics-product-detail__headline analytics-product-detail-skeleton__stack">
                    <div class="analytics-product-detail__title-line analytics-product-detail-skeleton__title-line">
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-xs')}
                    </div>
                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-60')}
                </div>
            </div>
            <div class="analytics-product-detail__identity">
                ${[
                    'admin-skeleton-w-chip-sm',
                    'admin-skeleton-w-chip-xs',
                    'admin-skeleton-w-chip-lg',
                    'admin-skeleton-w-chip-sm'
                ].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--pill ${width}`)).join('')}
            </div>
        `
    });

    const controlsSurface = renderAnalyticsProductDetailSkeletonSurface({
        className: 'analytics-product-detail__surface--controls',
        eyebrow: '控制中心',
        title: '当前单品与快捷操作',
        summary: '商品选择器和快捷入口先占住真实位置，避免后续按钮整体跳动。',
        compact: true,
        body: `
            <div class="analytics-product-detail__selector">
                <div class="analytics-product-detail__selector-label">当前单品</div>
                <div class="analytics-product-detail-skeleton__selector-box">
                    <div class="analytics-product-detail-skeleton__selector-main">
                        <span class="admin-skeleton-block analytics-product-detail-skeleton__selector-icon"></span>
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-20')}
                    </div>
                    <span class="admin-skeleton-block analytics-product-detail-skeleton__selector-chevron"></span>
                </div>
                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-50')}
            </div>
            <div class="analytics-product-actions analytics-product-detail__actions">
                ${[
                    'admin-skeleton-w-50',
                    'admin-skeleton-w-50',
                    'admin-skeleton-w-40',
                    'admin-skeleton-w-40',
                    'admin-skeleton-w-50'
                ].map((width) => `
                    <div class="analytics-product-detail-skeleton__action">
                        ${renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${width}`)}
                    </div>
                `).join('')}
            </div>
        `
    });

    const metricsSurface = renderAnalyticsProductDetailSkeletonSurface({
        className: 'analytics-product-detail__surface--metrics',
        eyebrow: '经营快照',
        title: '把浏览、成交、履约与库存收在一处',
        summary: '指标位提前占位，能让用户知道这页接下来会先给一屏快照。',
        compact: true,
        body: `
            <div class="analytics-product-detail__stats">
                ${['default', 'accent', 'success', 'warning', 'danger', 'default'].map((tone) => `
                    <article class="analytics-product-detail__stat analytics-product-detail__stat--${escapeHtml(tone)} analytics-product-detail__stat--skeleton">
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-40')}
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-50')}
                    </article>
                `).join('')}
            </div>
        `
    });

    const navigatorSurface = renderAnalyticsProductDetailSkeletonSurface({
        className: 'analytics-product-detail__surface--navigator',
        eyebrow: '分析目录',
        title: '按分类查看单品详情',
        summary: '四个主分区先显示出卡位和层级，加载完成后不会再突然出现新导航。',
        compact: true,
        body: `
            <div class="analytics-product-detail-nav" aria-hidden="true">
                ${Array.from({ length: 4 }, (_, index) => `
                    <div class="analytics-product-detail-nav__button analytics-product-detail-nav__button--skeleton">
                        <span class="analytics-product-detail-nav__icon">
                            <span class="admin-skeleton-block analytics-product-detail-skeleton__nav-icon"></span>
                        </span>
                        <span class="analytics-product-detail-nav__copy analytics-product-detail-skeleton__stack analytics-product-detail-skeleton__stack--tight">
                            ${renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${index % 2 === 0 ? 'admin-skeleton-w-40' : 'admin-skeleton-w-30'}`)}
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-60')}
                        </span>
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-xs')}
                    </div>
                `).join('')}
            </div>
        `
    });

    const insightsSurface = renderAnalyticsProductDetailSkeletonSurface({
        className: 'analytics-product-detail__surface--insights',
        eyebrow: '经营提示',
        title: '当前单品的复查结论与提醒',
        summary: '提示区也做成骨架，加载时能先告诉用户这里会出现复查摘要和回写记录。',
        compact: true,
        body: `
            <div class="analytics-product-detail__insights">
                <div class="analytics-product-detail__insight-item analytics-product-detail__insight-item--note">
                    <div class="analytics-product-window-notice">
                        <i class="fas fa-compass-drafting" aria-hidden="true"></i>
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
                    </div>
                </div>
                <div class="analytics-product-detail__insight-item analytics-product-detail__insight-item--digest">
                    <section class="analytics-product-conclusion-digest analytics-product-conclusion-digest--warning analytics-product-detail-skeleton__insight-card">
                        <div class="analytics-product-conclusion-digest__top">
                            <div>
                                <div class="analytics-product-conclusion-digest__eyebrow">本轮经营结论</div>
                                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-40')}
                            </div>
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-sm')}
                        </div>
                        <p class="analytics-product-conclusion-digest__summary">
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-full')}
                        </p>
                        <div class="analytics-product-conclusion-digest__chips">
                            ${[
                                'admin-skeleton-w-chip-sm',
                                'admin-skeleton-w-chip-sm',
                                'admin-skeleton-w-chip-xs'
                            ].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--pill ${width}`)).join('')}
                        </div>
                    </section>
                </div>
                <div class="analytics-product-detail__insight-item analytics-product-detail__insight-item--writeback">
                    <section class="analytics-writeback-note analytics-product-detail-skeleton__insight-card">
                        <div class="analytics-writeback-note__head">
                            <div class="analytics-product-detail-skeleton__stack analytics-product-detail-skeleton__stack--tight">
                                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-60')}
                            </div>
                            ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--pill admin-skeleton-w-chip-xs')}
                        </div>
                        <div class="analytics-writeback-list">
                            ${Array.from({ length: 2 }, () => renderWritebackItemSkeleton()).join('')}
                        </div>
                    </section>
                </div>
            </div>
        `
    });

    const operatingSection = renderAnalyticsProductDetailSkeletonSection({
        id: 'productDetailSectionOperating',
        sectionClass: 'analytics-nav-focus-target',
        gridClass: 'analytics-product-detail-grid--operating',
        eyebrow: '经营',
        title: '经营概览',
        summary: '先用漏斗、站点、来源和内容带货卡位，把当前商品的经营结构完整展示出来。',
        content: [
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--feature analytics-product-detail-card--operating-main',
                title: '单品漏斗',
                metaMarkup: '<span>真实口径</span>',
                content: `
                    <div class="analytics-product-funnel-stage-list analytics-product-funnel-stage-list--compact">
                        ${[
                            '88%',
                            '72%',
                            '54%',
                            '18%'
                        ].map((width) => renderFunnelStageSkeleton(width)).join('')}
                    </div>
                `
            }),
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--operating-side',
                title: '站点拆分',
                metaMarkup: '<span>CN / INTL</span>',
                content: `
                    <div class="analytics-product-site-grid analytics-product-site-grid--detail">
                        ${Array.from({ length: 2 }, () => `
                            <article class="analytics-product-site-card">
                                <div class="analytics-product-site-card__top">
                                    ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--title admin-skeleton-w-30')}
                                </div>
                                <div class="analytics-product-site-card__metrics">
                                    ${[
                                        'admin-skeleton-w-20',
                                        'admin-skeleton-w-20',
                                        'admin-skeleton-w-20',
                                        'admin-skeleton-w-20'
                                    ].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${width}`)).join('')}
                                </div>
                            </article>
                        `).join('')}
                    </div>
                `
            }),
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--feature analytics-product-detail-card--operating-secondary',
                title: '内容带货拆解',
                metaMarkup: '<span>来源 / Prompt / GMV</span>',
                content: `
                    <div class="analytics-product-window-notice analytics-product-window-notice--success">
                        <i class="fas fa-circle-nodes" aria-hidden="true"></i>
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
                    </div>
                    <div class="analytics-product-flow-board">
                        ${[
                            renderFlowStepSkeleton({ index: true, tone: 'default', valueWidth: 'admin-skeleton-w-20' }),
                            '<div class="analytics-product-flow-connector" aria-hidden="true"><span></span><i class="fas fa-arrow-right"></i></div>',
                            renderFlowStepSkeleton({ index: true, tone: 'accent', valueWidth: 'admin-skeleton-w-30' }),
                            '<div class="analytics-product-flow-connector" aria-hidden="true"><span></span><i class="fas fa-arrow-right"></i></div>',
                            renderFlowStepSkeleton({ index: true, tone: 'success', valueWidth: 'admin-skeleton-w-20' })
                        ].join('')}
                    </div>
                    ${renderAttributionGroupSkeleton({
                        feature: true,
                        rows: 3,
                        withEyebrow: true,
                        countWidth: 'admin-skeleton-w-chip-xs'
                    })}
                `
            }),
            `
                <div class="analytics-product-detail-stack analytics-product-detail-stack--operating-context">
                    ${renderAnalyticsProductDetailSkeletonCard({
                        className: 'analytics-product-detail-card--feature analytics-product-detail-card--operating-main',
                        title: '来源归因',
                        content: `
                            <div class="analytics-product-window-notice">
                                <i class="fas fa-sitemap" aria-hidden="true"></i>
                                ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-70')}
                            </div>
                            <div class="analytics-product-attribution-grid">
                                ${[
                                    renderAttributionGroupSkeleton({ rows: 2, countWidth: 'admin-skeleton-w-chip-sm' }),
                                    renderAttributionGroupSkeleton({ rows: 2, countWidth: 'admin-skeleton-w-chip-sm' }),
                                    renderAttributionGroupSkeleton({ rows: 2, countWidth: 'admin-skeleton-w-chip-sm' })
                                ].join('')}
                            </div>
                        `
                    })}
                    ${renderAnalyticsProductDetailSkeletonCard({
                        title: '相关 Prompt',
                        content: renderTokenList([
                            'admin-skeleton-w-chip-sm',
                            'admin-skeleton-w-chip-md',
                            'admin-skeleton-w-chip-sm',
                            'admin-skeleton-w-chip-xs'
                        ])
                    })}
                </div>
            `
        ].filter(Boolean).join('')
    });

    const riskSection = renderAnalyticsProductDetailSkeletonSection({
        id: 'productDetailSectionRisk',
        sectionClass: 'analytics-nav-focus-target',
        gridClass: 'analytics-product-detail-grid--risk',
        eyebrow: '风险',
        title: '风险与履约',
        summary: '风险区会先铺出退款、履约、回写和采集四条检查线，避免加载时下面整块发空。',
        content: [
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--risk-main',
                title: '售后与履约拆解',
                metaMarkup: '<span>退款 / 履约状态</span>',
                content: `
                    <div class="analytics-product-detail-subsection">
                        <div class="analytics-product-detail-subsection__label">退款状态</div>
                        <div class="analytics-product-event-list">
                            ${Array.from({ length: 2 }, () => renderEventRowSkeleton()).join('')}
                        </div>
                    </div>
                    <div class="analytics-product-detail-subsection">
                        <div class="analytics-product-detail-subsection__label">履约状态</div>
                        <div class="analytics-product-delivery-grid">
                            ${['success', 'warning'].map((tone) => renderDeliveryCardSkeleton(tone)).join('')}
                        </div>
                    </div>
                `
            }),
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--wide',
                title: '历史复查结论',
                metaMarkup: renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-chip-sm'),
                content: `
                    <div class="analytics-product-history-summary">
                        ${[
                            'admin-skeleton-w-chip-sm',
                            'admin-skeleton-w-chip-sm',
                            'admin-skeleton-w-chip-sm'
                        ].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--pill ${width}`)).join('')}
                    </div>
                    <div class="analytics-product-history-note">
                        ${renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-80')}
                    </div>
                    <div class="analytics-writeback-list">
                        ${Array.from({ length: 3 }, () => renderWritebackItemSkeleton()).join('')}
                    </div>
                `
            }),
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--risk-side',
                title: '事件采集状态',
                metaMarkup: renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-chip-xs'),
                content: `
                    <div class="analytics-product-event-list">
                        ${Array.from({ length: 4 }, () => renderEventRowSkeleton()).join('')}
                    </div>
                `
            })
        ].join('')
    });

    const usersSection = renderAnalyticsProductDetailSkeletonSection({
        id: 'productDetailSectionUsers',
        sectionClass: 'analytics-nav-focus-target',
        gridClass: 'analytics-product-detail-grid--users',
        eyebrow: '用户',
        title: '用户承接',
        summary: '用户区会先给出样本、分层和去向三块骨架，帮助用户预期这页后面会怎么展开。',
        content: [
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--feature analytics-product-detail-card--users-main',
                title: '购买用户',
                metaMarkup: renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-chip-sm'),
                content: renderTokenList([
                    'admin-skeleton-w-chip-sm',
                    'admin-skeleton-w-chip-md',
                    'admin-skeleton-w-chip-sm',
                    'admin-skeleton-w-chip-md'
                ])
            }),
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--users-segments',
                title: '购买用户分层',
                metaMarkup: '<span>当前窗口</span>',
                content: `
                    <div class="analytics-product-metric-grid analytics-product-metric-grid--detail">
                        ${[
                            renderMetricCardSkeleton('default'),
                            renderMetricCardSkeleton('accent'),
                            renderMetricCardSkeleton('success'),
                            renderMetricCardSkeleton('warning')
                        ].join('')}
                    </div>
                `
            }),
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--wide analytics-product-detail-card--users-destination',
                title: '用户去向',
                metaMarkup: '<span>首单入口 / 跨商品复购</span>',
                content: `
                    <div class="analytics-product-detail-subsection">
                        <div class="analytics-product-detail-subsection__label">首单入口分布</div>
                        <div class="analytics-product-destination-list">
                            ${Array.from({ length: 2 }, () => renderDestinationRowSkeleton()).join('')}
                        </div>
                    </div>
                    <div class="analytics-product-detail-subsection">
                        <div class="analytics-product-detail-subsection__label">跨商品复购去向</div>
                        <div class="analytics-product-destination-list">
                            ${Array.from({ length: 2 }, () => renderDestinationRowSkeleton()).join('')}
                        </div>
                    </div>
                    <div class="analytics-product-detail-subsection">
                        <div class="analytics-product-detail-subsection__label">后续复购商品</div>
                        <div class="analytics-product-destination-list">
                            ${Array.from({ length: 2 }, () => renderDestinationRowSkeleton()).join('')}
                        </div>
                    </div>
                `
            })
        ].join('')
    });

    const trendSection = renderAnalyticsProductDetailSkeletonSection({
        id: 'productDetailSectionTrend',
        sectionClass: 'analytics-nav-focus-target',
        gridClass: 'analytics-product-detail-grid--trend',
        eyebrow: '趋势',
        title: '趋势与订单',
        summary: '趋势区会先把趋势、Prompt 明细和订单三张卡占位住，减少加载完成时的版面回流。',
        content: [
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--feature analytics-product-detail-card--trend-main',
                title: '近窗趋势',
                metaMarkup: renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-chip-sm'),
                content: `
                    <div class="analytics-product-trend-list">
                        ${Array.from({ length: 5 }, () => `
                            <div class="analytics-product-trend-row">
                                ${[
                                    'admin-skeleton-w-20',
                                    'admin-skeleton-w-20',
                                    'admin-skeleton-w-20',
                                    'admin-skeleton-w-20',
                                    'admin-skeleton-w-20'
                                ].map((width) => renderAnalyticsProductDetailSkeletonBlock(`admin-skeleton-block--line ${width}`)).join('')}
                            </div>
                        `).join('')}
                    </div>
                `
            }),
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--trend-side',
                title: '来源 Prompt 归因明细',
                metaMarkup: renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-chip-xs'),
                content: `
                    <div class="analytics-product-prompt-list">
                        ${Array.from({ length: 4 }, () => renderPromptRowSkeleton()).join('')}
                    </div>
                `
            }),
            renderAnalyticsProductDetailSkeletonCard({
                className: 'analytics-product-detail-card--wide analytics-product-detail-card--trend-orders',
                title: '近期订单',
                metaMarkup: renderAnalyticsProductDetailSkeletonBlock('admin-skeleton-block--line admin-skeleton-w-chip-xs'),
                content: `
                    <div class="analytics-product-order-list">
                        ${Array.from({ length: 3 }, () => renderOrderRowSkeleton()).join('')}
                    </div>
                `
            })
        ].join('')
    });

    return `
        <div class="analytics-product-detail analytics-product-detail--skeleton" aria-hidden="true">
            <div class="analytics-product-detail__top-grid">
                ${identitySurface}
                ${controlsSurface}
                ${metricsSurface}
                ${navigatorSurface}
            </div>

            ${insightsSurface}

            <div class="analytics-product-detail-sections">
                ${operatingSection}
                ${riskSection}
                ${usersSection}
                ${trendSection}
            </div>
        </div>
    `;
}

function showAnalyticsProductDetailSkeletonState(options = {}) {
    const container = document.getElementById('productDetailPanel');
    const meta = document.getElementById('productDetailMeta');
    if (!container) {
        return false;
    }

    container.innerHTML = renderAnalyticsProductDetailSkeleton();
    if (meta) {
        const productId = String(options.productId || activeAnalyticsProductId || '').trim();
        const productName = String(options.productName || activeAnalyticsProductName || productId).trim();
        const detailFocus = String(options.detailFocus || getActiveAnalyticsProductDetailFocus() || '').trim();
        const focusConfig = getAnalyticsProductDetailFocusConfig(detailFocus);
        meta.textContent = `${productName || productId || '单品详情'} · 单品详情加载中${focusConfig ? ` · ${focusConfig.title}` : ''}`;
    }
    return true;
}

window.showAnalyticsProductDetailSkeletonState = showAnalyticsProductDetailSkeletonState;

function renderAnalyticsProductDetailEntryEmptyState() {
    return `
        <div class="empty-state-hint">
            <i class="fas fa-cubes"></i>
            <span>点击任一商品名后，会在这里展开单品详情，统一承接经营、库存、履约和订单下钻。</span>
        </div>
    `;
}

function showAnalyticsProductDetailEmptyState(options = {}) {
    const container = document.getElementById('productDetailPanel');
    const meta = document.getElementById('productDetailMeta');
    if (!container) {
        return false;
    }

    container.innerHTML = renderAnalyticsProductDetailEntryEmptyState();
    if (meta) {
        meta.textContent = String(options.metaText || '点击商品后展开单品详情').trim() || '点击商品后展开单品详情';
    }
    return true;
}

window.showAnalyticsProductDetailEmptyState = showAnalyticsProductDetailEmptyState;

function primeAnalyticsProductDetailSkeletonOnEntry(options = {}) {
    const container = document.getElementById('productDetailPanel');
    if (!(container instanceof HTMLElement)) {
        return false;
    }

    if (options.force !== true && container.querySelector('.analytics-product-detail:not(.analytics-product-detail--skeleton)')) {
        return 'resolved';
    }

    if (container.querySelector('.analytics-product-detail--skeleton')) {
        return 'skeleton';
    }

    const routeState = typeof getAnalyticsRouteState === 'function' ? getAnalyticsRouteState() : {};
    const productId = String(options.productId || activeAnalyticsProductId || routeState?.productId || '').trim();
    const productName = String(options.productName || activeAnalyticsProductName || routeState?.productName || productId).trim();
    const detailFocus = String(options.detailFocus || routeState?.detailFocus || getActiveAnalyticsProductDetailFocus() || '').trim();
    showAnalyticsProductDetailSkeletonState({
        productId,
        productName,
        detailFocus
    });
    return 'primed';
}

window.primeAnalyticsProductDetailSkeletonOnEntry = primeAnalyticsProductDetailSkeletonOnEntry;

function buildAnalyticsProductDestinationAttrs(destination = '', context = null) {
    const destinationAttr = escapeHtml(String(destination || '').trim());
    if (!destinationAttr) {
        return '';
    }
    const serializedContext = typeof serializeAnalyticsActionContext === 'function'
        ? serializeAnalyticsActionContext(context)
        : '';
    return `data-admin-action="analytics-open-destination" data-analytics-destination="${destinationAttr}"${serializedContext ? ` data-analytics-context="${escapeHtml(serializedContext)}"` : ''}`;
}

function buildAnalyticsUserDetailContext(context = {}) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return null;
    }

    const sourceLabel = String(context.sourceLabel || '').trim();
    const summary = String(context.summary || '').trim();
    const signalLabel = String(context.signalLabel || '').trim();
    const signalValue = String(context.signalValue || '').trim();
    const productId = String(context.productId || '').trim();
    const productName = String(context.productName || '').trim();
    const site = String(context.site || getAnalyticsSiteParam() || 'all').trim().toLowerCase();
    const siteLabel = String(context.siteLabel || (site === 'all' ? '全站' : site.toUpperCase())).trim();
    const rangeLabel = String(context.rangeLabel || buildAnalyticsRangeLabel()).trim();
    const referenceLabel = String(context.referenceLabel || '').trim();
    const referenceValue = String(context.referenceValue || '').trim();
    const actionLabel = String(context.actionLabel || '').trim();
    const verificationMethod = String(context.verificationMethod || '').trim();
    const feedbackScope = String(context.feedbackScope || '').trim().toLowerCase();
    const feedbackEntityType = String(context.feedbackEntityType || '').trim().toLowerCase();
    const feedbackEntityId = String(context.feedbackEntityId || '').trim();
    const feedbackEntityName = String(context.feedbackEntityName || '').trim();
    const destination = String(context.destination || '').trim().toLowerCase() || (productId || productName ? 'analytics-product-detail' : 'analytics-product');
    const destinationContext = context.destinationContext && typeof context.destinationContext === 'object' && !Array.isArray(context.destinationContext)
        ? { ...context.destinationContext }
        : {};

    if (!destinationContext.productId && productId && destination === 'analytics-product-detail') {
        destinationContext.productId = productId;
    }
    if (!destinationContext.productName && productName && destination === 'analytics-product-detail') {
        destinationContext.productName = productName;
    }
    if (!destinationContext.sectionId && destination === 'analytics-product') {
        destinationContext.sectionId = 'productOverviewSection';
    }

    return {
        sourceLabel: sourceLabel || '商品经营上下文',
        summary,
        signalLabel,
        signalValue,
        productId,
        productName,
        site,
        siteLabel,
        rangeLabel,
        referenceLabel,
        referenceValue,
        actionLabel: actionLabel || (destination === 'analytics-product-detail' ? '回到单品详情' : '回到商品经营'),
        verificationMethod,
        feedbackScope,
        feedbackEntityType,
        feedbackEntityId,
        feedbackEntityName,
        destination,
        destinationContext
    };
}

function buildAnalyticsOpenUserDetailAttrs(userId = '', context = null) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) {
        return '';
    }

    const normalizedContext = buildAnalyticsUserDetailContext(context);
    const serializedContext = typeof serializeAnalyticsActionContext === 'function'
        ? serializeAnalyticsActionContext(normalizedContext)
        : '';

    return `data-admin-action="analytics-open-user-detail" data-user-id="${escapeHtml(encodeURIComponent(safeUserId))}"${serializedContext ? ` data-analytics-context="${escapeHtml(serializedContext)}"` : ''}`;
}

function getAnalyticsUserProfileStore() {
    if (!globalThis.__analyticsUserProfileStore || typeof globalThis.__analyticsUserProfileStore !== 'object') {
        globalThis.__analyticsUserProfileStore = {
            cache: new Map()
        };
    }

    return globalThis.__analyticsUserProfileStore;
}

function normalizeAnalyticsUserProfileRecord(profile = {}) {
    return {
        id: String(profile?.id || '').trim(),
        display_name: String(profile?.display_name || '').trim(),
        username: String(profile?.username || '').trim(),
        email: String(profile?.email || '').trim(),
        avatar_url: String(profile?.avatar_url || '').trim()
    };
}

function buildAnalyticsUserFallbackLabel(userId = '') {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) {
        return '匿名用户';
    }
    if (safeUserId.length <= 12) {
        return safeUserId;
    }
    return `${safeUserId.slice(0, 8)}...${safeUserId.slice(-4)}`;
}

function resolveAnalyticsUserDisplayLabel(profile = {}, userId = '') {
    const safeProfile = profile && typeof profile === 'object' ? profile : {};
    const candidates = [
        safeProfile.display_name,
        safeProfile.username
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);

    if (candidates.length > 0) {
        return candidates[0];
    }

    const email = String(safeProfile.email || '').trim();
    if (email) {
        return email.split('@')[0] || email;
    }

    return buildAnalyticsUserFallbackLabel(userId);
}

function resolveAnalyticsUserSecondaryLabel(profile = {}, userId = '') {
    const safeProfile = profile && typeof profile === 'object' ? profile : {};
    const email = String(safeProfile.email || '').trim();
    if (email) {
        return email;
    }
    return buildAnalyticsUserFallbackLabel(userId);
}

async function fetchAnalyticsUserProfilesByIds(userIds = []) {
    const uniqueIds = Array.from(new Set(
        (Array.isArray(userIds) ? userIds : [])
            .map((userId) => String(userId || '').trim())
            .filter(Boolean)
    ));
    if (!uniqueIds.length || !window.supabaseClient?.from) {
        return {};
    }

    const store = getAnalyticsUserProfileStore();
    const cache = store.cache instanceof Map ? store.cache : new Map();
    store.cache = cache;

    const profilesById = {};
    const pendingIds = [];

    uniqueIds.forEach((userId) => {
        if (cache.has(userId)) {
            profilesById[userId] = cache.get(userId);
            return;
        }
        pendingIds.push(userId);
    });

    if (!pendingIds.length) {
        return profilesById;
    }

    const selectVariants = [
        'id, display_name, username, avatar_url, email',
        'id, display_name, username, email',
        'id, display_name, username',
        'id, username, email',
        'id, username'
    ];
    const chunkSize = 100;

    for (let index = 0; index < pendingIds.length; index += chunkSize) {
        const batch = pendingIds.slice(index, index + chunkSize);
        let rows = null;

        for (const selectClause of selectVariants) {
            try {
                const { data, error } = await window.supabaseClient
                    .from('profiles')
                    .select(selectClause)
                    .in('id', batch);

                if (error) {
                    continue;
                }

                rows = Array.isArray(data) ? data : [];
                break;
            } catch (_error) {
                rows = null;
            }
        }

        (Array.isArray(rows) ? rows : []).forEach((profile) => {
            const normalized = normalizeAnalyticsUserProfileRecord(profile);
            if (!normalized.id) {
                return;
            }
            cache.set(normalized.id, normalized);
            profilesById[normalized.id] = normalized;
        });
    }

    return profilesById;
}

function getAnalyticsProductDetailFocusState() {
    if (!globalThis.__analyticsProductDetailFocusState || typeof globalThis.__analyticsProductDetailFocusState !== 'object') {
        globalThis.__analyticsProductDetailFocusState = {
            detailFocus: '',
            focusTargetId: ''
        };
    }

    return globalThis.__analyticsProductDetailFocusState;
}

function setActiveAnalyticsProductDetailFocus(detailFocus = '', focusTargetId = '') {
    const state = getAnalyticsProductDetailFocusState();
    state.detailFocus = String(detailFocus || '').trim();
    state.focusTargetId = String(focusTargetId || '').trim();
    return state;
}

function getActiveAnalyticsProductDetailFocus() {
    return String(getAnalyticsProductDetailFocusState().detailFocus || '').trim();
}

function getActiveAnalyticsProductDetailFocusTargetId() {
    return String(getAnalyticsProductDetailFocusState().focusTargetId || '').trim();
}

function getAnalyticsProductDetailSelectorState() {
    if (!globalThis.__analyticsProductDetailSelectorState || typeof globalThis.__analyticsProductDetailSelectorState !== 'object') {
        globalThis.__analyticsProductDetailSelectorState = {
            products: new Map()
        };
    }

    const state = globalThis.__analyticsProductDetailSelectorState;
    if (!(state.products instanceof Map)) {
        state.products = new Map();
    }
    return state;
}

function normalizeAnalyticsProductDetailCandidate(candidate = {}) {
    const productId = String(candidate?.product_id || candidate?.productId || '').trim();
    const productName = String(candidate?.product_name || candidate?.productName || '').trim();
    if (!productId) {
        return null;
    }

    return {
        productId,
        productName: productName || productId
    };
}

function getAnalyticsProductDetailCandidates(options = {}) {
    const activeProductId = String(options.activeProductId || activeAnalyticsProductId || '').trim();
    const activeProductName = String(options.activeProductName || activeAnalyticsProductName || activeProductId).trim();
    const limit = Math.max(1, Number(options.limit) || 40);
    const rows = Array.from(getAnalyticsProductDetailSelectorState().products.values()).reverse();

    if (activeProductId && !rows.some((item) => item.productId === activeProductId)) {
        rows.unshift({
            productId: activeProductId,
            productName: activeProductName || activeProductId
        });
    }

    return rows.slice(0, limit);
}

function getAnalyticsProductDetailCandidateById(productId = '') {
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId) {
        return null;
    }

    const candidate = getAnalyticsProductDetailSelectorState().products.get(normalizedProductId);
    if (candidate) {
        return candidate;
    }

    if (normalizedProductId === String(activeAnalyticsProductId || '').trim()) {
        return {
            productId: normalizedProductId,
            productName: String(activeAnalyticsProductName || normalizedProductId).trim() || normalizedProductId
        };
    }

    return null;
}

function resolveAnalyticsProductDetailSelectorLabel(candidates = [], activeProductId = '', activeProductName = '') {
    const normalizedActiveProductId = String(activeProductId || activeAnalyticsProductId || '').trim();
    const normalizedActiveProductName = String(activeProductName || activeAnalyticsProductName || normalizedActiveProductId).trim();
    const matchedCandidate = (Array.isArray(candidates) ? candidates : []).find((candidate) => candidate.productId === normalizedActiveProductId);
    return matchedCandidate?.productName || normalizedActiveProductName || normalizedActiveProductId || '选择商品';
}

function shouldDisableAnalyticsProductDetailSelector(candidates = [], activeProductId = '') {
    const count = Array.isArray(candidates) ? candidates.length : 0;
    const normalizedActiveProductId = String(activeProductId || activeAnalyticsProductId || '').trim();

    if (count <= 0) {
        return true;
    }

    return count === 1 && Boolean(normalizedActiveProductId);
}

function buildAnalyticsProductDetailSelectorOptionsMarkup(candidates = [], options = {}) {
    const normalizedActiveProductId = String(options.activeProductId || activeAnalyticsProductId || '').trim();
    const detailFocus = String(options.detailFocus || getActiveAnalyticsProductDetailFocus() || '').trim();
    const focusTargetId = String(options.focusTargetId || getActiveAnalyticsProductDetailFocusTargetId() || '').trim() || 'productDetailSectionOperating';
    return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
        const isSelected = candidate.productId === normalizedActiveProductId;
        return `
            <button
                type="button"
                class="analytics-product-detail__selector-option${isSelected ? ' is-selected' : ''}"
                data-admin-action="analytics-select-product-detail-option"
                data-analytics-product-id="${escapeHtml(candidate.productId || '')}"
                data-analytics-product-name="${escapeHtml(candidate.productName || candidate.productId || '未命名商品')}"
                data-analytics-detail-focus="${escapeHtml(detailFocus)}"
                data-analytics-target-id="${escapeHtml(focusTargetId)}"
                role="option"
                aria-selected="${isSelected ? 'true' : 'false'}"
            >
                <span class="analytics-product-detail__selector-option-name">${escapeHtml(candidate.productName || candidate.productId || '未命名商品')}</span>
                <span class="analytics-product-detail__selector-option-id">${escapeHtml(candidate.productId || '')}</span>
            </button>
        `;
    }).join('');
}

function buildAnalyticsProductDetailSelectorMetaText(candidates = [], options = {}) {
    const count = Array.isArray(candidates) ? candidates.length : 0;
    const hasActiveProduct = Boolean(String(options.activeProductId || activeAnalyticsProductId || '').trim());
    if (count <= 0) {
        return '当前还没有可切换的商品';
    }
    if (count === 1) {
        return hasActiveProduct
            ? '当前仅收录 1 个已加载商品'
            : '当前已收录 1 个商品，点击即可进入单品详情';
    }
    return `已收录 ${formatNumber(count)} 个已加载商品，可直接切换`;
}

function refreshAnalyticsProductDetailSelectorState(options = {}) {
    const dropdown = document.querySelector('[data-analytics-product-detail-dropdown]');
    if (!(dropdown instanceof HTMLElement)) {
        return false;
    }

    const activeProductId = String(options.activeProductId || activeAnalyticsProductId || dropdown.dataset.activeProductId || '').trim();
    const activeProductName = String(options.activeProductName || activeAnalyticsProductName || activeProductId).trim();
    const detailFocus = Object.prototype.hasOwnProperty.call(options || {}, 'detailFocus')
        ? String(options.detailFocus || '').trim()
        : String(dropdown.dataset.analyticsDetailFocus || getActiveAnalyticsProductDetailFocus() || '').trim();
    const focusTargetId = String(
        Object.prototype.hasOwnProperty.call(options || {}, 'focusTargetId')
            ? options.focusTargetId
            : (dropdown.dataset.analyticsTargetId || getActiveAnalyticsProductDetailFocusTargetId() || '')
    ).trim() || 'productDetailSectionOperating';
    const candidates = getAnalyticsProductDetailCandidates({
        activeProductId,
        activeProductName
    });
    const trigger = dropdown.querySelector('[data-admin-action="analytics-toggle-product-detail-dropdown"]');
    const valueNode = dropdown.querySelector('[data-analytics-product-detail-selector-value]');
    const menu = dropdown.querySelector('[data-analytics-product-detail-selector-menu]');
    const isDisabled = shouldDisableAnalyticsProductDetailSelector(candidates, activeProductId);

    dropdown.dataset.analyticsDetailFocus = detailFocus;
    dropdown.dataset.analyticsTargetId = focusTargetId;
    dropdown.dataset.activeProductId = activeProductId;
    dropdown.classList.toggle('is-disabled', isDisabled);
    dropdown.classList.remove('is-open');

    if (trigger instanceof HTMLElement) {
        trigger.setAttribute('aria-expanded', 'false');
        if ('disabled' in trigger) {
            trigger.disabled = isDisabled;
        }
    }

    if (valueNode) {
        valueNode.textContent = resolveAnalyticsProductDetailSelectorLabel(candidates, activeProductId, activeProductName);
    }

    if (menu) {
        menu.innerHTML = buildAnalyticsProductDetailSelectorOptionsMarkup(candidates, {
            activeProductId,
            detailFocus,
            focusTargetId
        });
    }

    const metaNode = document.querySelector('[data-analytics-product-detail-selector-meta]');
    if (metaNode) {
        metaNode.textContent = buildAnalyticsProductDetailSelectorMetaText(candidates, {
            activeProductId
        });
    }

    return true;
}

window.refreshAnalyticsProductDetailSelectorState = refreshAnalyticsProductDetailSelectorState;

function closeAnalyticsProductDetailSelector() {
    const dropdown = document.querySelector('[data-analytics-product-detail-dropdown]');
    if (!(dropdown instanceof HTMLElement)) {
        return false;
    }

    dropdown.classList.remove('is-open');
    const trigger = dropdown.querySelector('[data-admin-action="analytics-toggle-product-detail-dropdown"]');
    if (trigger instanceof HTMLElement) {
        trigger.setAttribute('aria-expanded', 'false');
    }
    return true;
}

window.closeAnalyticsProductDetailSelector = closeAnalyticsProductDetailSelector;

function toggleAnalyticsProductDetailSelector(forceOpen) {
    const dropdown = document.querySelector('[data-analytics-product-detail-dropdown]');
    if (!(dropdown instanceof HTMLElement) || dropdown.classList.contains('is-disabled')) {
        return false;
    }

    const nextOpen = typeof forceOpen === 'boolean'
        ? forceOpen
        : !dropdown.classList.contains('is-open');
    dropdown.classList.toggle('is-open', nextOpen);
    const trigger = dropdown.querySelector('[data-admin-action="analytics-toggle-product-detail-dropdown"]');
    if (trigger instanceof HTMLElement) {
        trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    }
    return nextOpen;
}

window.toggleAnalyticsProductDetailSelector = toggleAnalyticsProductDetailSelector;

function registerAnalyticsProductDetailCandidates(candidates = [], options = {}) {
    const rows = Array.isArray(candidates) ? candidates : [];
    if (rows.length === 0) {
        return getAnalyticsProductDetailCandidates(options);
    }

    const state = getAnalyticsProductDetailSelectorState();
    let didChange = false;
    for (const row of rows) {
        const normalizedCandidate = normalizeAnalyticsProductDetailCandidate(row);
        if (!normalizedCandidate) {
            continue;
        }

        const previous = state.products.get(normalizedCandidate.productId) || null;
        state.products.delete(normalizedCandidate.productId);
        state.products.set(normalizedCandidate.productId, {
            productId: normalizedCandidate.productId,
            productName: normalizedCandidate.productName || previous?.productName || normalizedCandidate.productId
        });
        didChange = true;
    }

    while (state.products.size > 40) {
        const oldestKey = state.products.keys().next().value;
        if (!oldestKey) {
            break;
        }
        state.products.delete(oldestKey);
    }

    if (didChange) {
        refreshAnalyticsProductDetailSelectorState({
            activeProductId: options.activeProductId,
            activeProductName: options.activeProductName,
            detailFocus: options.detailFocus,
            focusTargetId: options.focusTargetId
        });
    }

    return getAnalyticsProductDetailCandidates(options);
}

function renderAnalyticsProductDetailSelector(options = {}) {
    const activeProductId = String(options.productId || activeAnalyticsProductId || '').trim();
    const activeProductName = String(options.productName || activeAnalyticsProductName || activeProductId).trim();
    const detailFocus = String(options.detailFocus || getActiveAnalyticsProductDetailFocus() || '').trim();
    const focusTargetId = String(options.focusTargetId || getActiveAnalyticsProductDetailFocusTargetId() || '').trim() || 'productDetailSectionOperating';
    const candidates = getAnalyticsProductDetailCandidates({
        activeProductId,
        activeProductName
    });
    const selectedLabel = resolveAnalyticsProductDetailSelectorLabel(candidates, activeProductId, activeProductName);
    const isDisabled = shouldDisableAnalyticsProductDetailSelector(candidates, activeProductId);

    return `
        <div class="analytics-product-detail__selector">
            <div class="analytics-product-detail__selector-label">当前单品</div>
            <div
                class="analytics-product-detail__dropdown${isDisabled ? ' is-disabled' : ''}"
                data-analytics-product-detail-dropdown
                data-analytics-detail-focus="${escapeHtml(detailFocus)}"
                data-analytics-target-id="${escapeHtml(focusTargetId)}"
                data-active-product-id="${escapeHtml(activeProductId)}"
            >
                <button
                    type="button"
                    class="analytics-product-detail__selector-trigger"
                    data-admin-action="analytics-toggle-product-detail-dropdown"
                    aria-haspopup="listbox"
                    aria-expanded="false"
                    ${isDisabled ? 'disabled' : ''}
                >
                    <span class="analytics-product-detail__selector-trigger-main">
                        <span class="analytics-product-detail__selector-icon"><i class="fas fa-cubes" aria-hidden="true"></i></span>
                        <span class="analytics-product-detail__selector-value" data-analytics-product-detail-selector-value>${escapeHtml(selectedLabel)}</span>
                    </span>
                    <i class="fas fa-chevron-down analytics-product-detail__selector-arrow" aria-hidden="true"></i>
                </button>
                <div class="analytics-product-detail__selector-menu" data-analytics-product-detail-selector-menu role="listbox" aria-label="切换单品">
                    ${buildAnalyticsProductDetailSelectorOptionsMarkup(candidates, {
                        activeProductId,
                        detailFocus,
                        focusTargetId
                    })}
                </div>
            </div>
            <div class="analytics-product-detail__selector-meta" data-analytics-product-detail-selector-meta>
                ${escapeHtml(buildAnalyticsProductDetailSelectorMetaText(candidates, {
                    activeProductId
                }))}
            </div>
        </div>
    `;
}

function refreshAnalyticsProductDetailNavigatorState(activeTargetId = '') {
    const normalizedTargetId = String(activeTargetId || getActiveAnalyticsProductDetailFocusTargetId() || '').trim();
    document.querySelectorAll('[data-analytics-product-detail-nav-target]').forEach((node) => {
        const isActive = Boolean(normalizedTargetId) && node.dataset.analyticsProductDetailNavTarget === normalizedTargetId;
        node.classList.toggle('is-active', isActive);
        node.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

window.refreshAnalyticsProductDetailNavigatorState = refreshAnalyticsProductDetailNavigatorState;

function focusAnalyticsProductDetailSection(sectionId = '', options = {}) {
    const normalizedSectionId = String(sectionId || '').trim();
    if (!normalizedSectionId) {
        return false;
    }

    const hasDetailFocus = Object.prototype.hasOwnProperty.call(options || {}, 'detailFocus');
    const nextDetailFocus = hasDetailFocus
        ? String(options.detailFocus || '').trim()
        : getActiveAnalyticsProductDetailFocus();
    const nextProductId = String(options.productId || activeAnalyticsProductId || '').trim();
    const nextProductName = String(options.productName || activeAnalyticsProductName || nextProductId).trim();

    activeAnalyticsProductId = nextProductId || activeAnalyticsProductId;
    activeAnalyticsProductName = nextProductName || activeAnalyticsProductName;
    setActiveAnalyticsProductDetailFocus(nextDetailFocus, normalizedSectionId);
    refreshAnalyticsProductDetailNavigatorState(normalizedSectionId);

    if (typeof syncAnalyticsRouteState === 'function' && nextProductId) {
        const nextRouteState = {
            view: 'product-detail',
            sectionId: normalizedSectionId,
            productId: nextProductId
        };
        if (hasDetailFocus) {
            nextRouteState.detailFocus = nextDetailFocus;
        }
        syncAnalyticsRouteState(nextRouteState);
    }

    const meta = document.getElementById('productDetailMeta');
    if (meta) {
        const focusConfig = getAnalyticsProductDetailFocusConfig(nextDetailFocus);
        meta.textContent = `${activeAnalyticsProductName || nextProductId || '当前商品'} · 经营与运维双视角${focusConfig ? ` · ${focusConfig.title}` : ''}`;
    }

    refreshAnalyticsProductDetailSelectorState({
        activeProductId: nextProductId,
        activeProductName: nextProductName,
        detailFocus: nextDetailFocus,
        focusTargetId: normalizedSectionId
    });

    if (typeof focusAnalyticsDestinationTarget === 'function') {
        return focusAnalyticsDestinationTarget(normalizedSectionId, {
            block: options.block || 'start'
        });
    }

    return false;
}

window.focusAnalyticsProductDetailSection = focusAnalyticsProductDetailSection;

function changeAnalyticsProductDetailSelection(productId = '', options = {}) {
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId) {
        return false;
    }

    closeAnalyticsProductDetailSelector();

    const candidate = getAnalyticsProductDetailCandidateById(normalizedProductId);
    const productName = String(options.productName || candidate?.productName || activeAnalyticsProductName || normalizedProductId).trim();
    const detailFocus = Object.prototype.hasOwnProperty.call(options || {}, 'detailFocus')
        ? String(options.detailFocus || '').trim()
        : getActiveAnalyticsProductDetailFocus();
    const focusTargetId = String(options.focusTargetId || getActiveAnalyticsProductDetailFocusTargetId() || '').trim() || 'productDetailSectionOperating';

    if (normalizedProductId === String(activeAnalyticsProductId || '').trim()) {
        refreshAnalyticsProductDetailSelectorState({
            activeProductId: normalizedProductId,
            activeProductName: productName,
            detailFocus,
            focusTargetId
        });
        return true;
    }

    return openAnalyticsProductDetail(normalizedProductId, {
        productName,
        detailFocus,
        focusTargetId,
        focus: false
    });
}

window.changeAnalyticsProductDetailSelection = changeAnalyticsProductDetailSelection;

function ensureAnalyticsProductDetailTabReady(options = {}) {
    const detailFocus = Object.prototype.hasOwnProperty.call(options || {}, 'detailFocus')
        ? String(options.detailFocus || '').trim()
        : getActiveAnalyticsProductDetailFocus();
    const focusTargetId = String(
        options.focusTargetId
        || options.sectionId
        || getActiveAnalyticsProductDetailFocusTargetId()
        || 'productDetailSectionOperating'
    ).trim() || 'productDetailSectionOperating';
    const activeProductId = String(options.productId || activeAnalyticsProductId || '').trim();
    const activeProductName = String(options.productName || activeAnalyticsProductName || activeProductId).trim();

    if (activeProductId) {
        void loadProductDetailPanel({
            productId: activeProductId,
            productName: activeProductName,
            detailFocus,
            focusTargetId,
            focus: options.focus === true
        });
        return 'active';
    }

    const candidates = getAnalyticsProductDetailCandidates({
        activeProductId,
        activeProductName
    });
    const candidate = candidates.find((item) => String(item?.productId || '').trim());
    if (candidate) {
        openAnalyticsProductDetail(candidate.productId, {
            productName: candidate.productName || candidate.productId,
            detailFocus,
            focusTargetId,
            focus: options.focus === true,
            syncRoute: options.syncRoute
        });
        return 'candidate';
    }

    const routeState = typeof getAnalyticsRouteState === 'function' ? getAnalyticsRouteState() : {};
    const routeProductId = String(options.routeProductId || routeState?.productId || '').trim();
    if (routeProductId) {
        openAnalyticsProductDetail(routeProductId, {
            productName: String(options.routeProductName || routeState?.productName || '').trim(),
            detailFocus: String(routeState?.detailFocus || detailFocus || '').trim(),
            focusTargetId: String(routeState?.sectionId || focusTargetId || 'productDetailPanelSection').trim() || 'productDetailPanelSection',
            focus: options.focus === true,
            syncRoute: false
        });
        return 'route';
    }

    primeAnalyticsProductDetailSkeletonOnEntry({
        detailFocus,
        productId: activeProductId,
        productName: activeProductName
    });
    return false;
}

window.ensureAnalyticsProductDetailTabReady = ensureAnalyticsProductDetailTabReady;

document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (target?.closest?.('[data-analytics-product-detail-dropdown]')) {
        return;
    }
    closeAnalyticsProductDetailSelector();
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeAnalyticsProductDetailSelector();
    }
});

function resetAnalyticsProductDetailRuntime(options = {}) {
    activeAnalyticsProductId = '';
    activeAnalyticsProductName = '';
    analyticsProductDetailRequestId += 1;
    setActiveAnalyticsProductDetailFocus('', '');
    getAnalyticsProductDetailSelectorState().products.clear();
    closeAnalyticsProductDetailSelector();
    refreshAnalyticsProductDetailNavigatorState('');
    refreshAnalyticsProductDetailSelectorState({
        activeProductId: '',
        activeProductName: '',
        detailFocus: '',
        focusTargetId: ''
    });

    if (options.resetPanel === false) {
        return;
    }

    const container = document.getElementById('productDetailPanel');
    const meta = document.getElementById('productDetailMeta');
    if (container) {
        container.innerHTML = `
            <div class="empty-state-hint">
                <i class="fas fa-cubes"></i>
                <span>点击任一商品名后，会在这里展开单品详情，统一承接经营、库存、履约和订单下钻。</span>
            </div>
        `;
    }
    if (meta) {
        meta.textContent = '点击商品后展开单品详情';
    }
}

window.resetAnalyticsProductDetailRuntime = resetAnalyticsProductDetailRuntime;

function renderAnalyticsProductNameButton(name = '', productId = '', options = {}) {
    const safeName = escapeHtml(String(name || '未命名商品'));
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId) {
        return `<span class="analytics-product-link-label">${safeName}</span>`;
    }

    const context = Object.assign({
        productId: normalizedProductId,
        productName: String(name || '').trim(),
        sectionId: 'productDetailPanelSection',
        focusTargetId: 'productDetailPanelSection'
    }, options.detailContext && typeof options.detailContext === 'object' ? options.detailContext : {});
    const attrs = buildAnalyticsProductDestinationAttrs('analytics-product-detail', context);
    const title = escapeHtml(options.title || `查看 ${safeName} 的单品详情`);
    const className = [
        'analytics-product-link',
        options.compact ? 'analytics-product-link--compact' : '',
        String(options.className || '').trim()
    ].filter(Boolean).join(' ');
    return `<button type="button" class="${escapeHtml(className)}" ${attrs} title="${title}" aria-label="${title}">${safeName}</button>`;
}

function renderAnalyticsProductMetricCard(label = '', value = '--', note = '', tone = 'default') {
    return `
        <article class="analytics-product-metric-card analytics-product-metric-card--${escapeHtml(tone)}">
            <div class="analytics-product-metric-card__label">${escapeHtml(label)}</div>
            <div class="analytics-product-metric-card__value">${escapeHtml(String(value))}</div>
            <div class="analytics-product-metric-card__note">${escapeHtml(note)}</div>
        </article>
    `;
}

function renderAnalyticsProductOverviewMetricCards(summary = {}) {
    const isOrderlessWindow = Number(summary?.order_count || 0) <= 0;
    if (!isOrderlessWindow) {
        const topProductNote = String(summary?.top_product_name || '').trim()
            ? `Top 商品 ${summary.top_product_name}`
            : '当前窗口暂无成交商品';

        return [
            renderAnalyticsProductMetricCard('成交用户', formatNumber(summary.unique_buyer_count || 0), `浏览用户 ${formatNumber(summary.view_user_count || 0)}`, 'default'),
            renderAnalyticsProductMetricCard('商品销量', formatNumber(summary.units_sold || 0), `订单 ${formatNumber(summary.order_count || 0)}`, 'accent'),
            renderAnalyticsProductMetricCard('积分 GMV', formatNumber(summary.gmv_points || 0), topProductNote, 'success'),
            renderAnalyticsProductMetricCard('客单价', formatNumber(summary.avg_order_value || 0), `在售商品 ${formatNumber(summary.selling_product_count || 0)}`, 'default'),
            renderAnalyticsProductMetricCard('成交转化', formatPercent(summary.purchase_conversion_rate || 0), `退款率 ${formatPercent(summary.refund_rate || 0)}`, 'warning'),
            renderAnalyticsProductMetricCard('交付成功率', formatPercent(summary.delivery_success_rate || 0), `履约风险商品 ${formatNumber(summary.delivery_risk_product_count || 0)}`, 'danger')
        ].join('');
    }

    return [
        renderAnalyticsProductMetricCard('浏览用户', formatNumber(summary.view_user_count || 0), `浏览 ${formatNumber(summary.view_count || 0)} 次`, 'default'),
        renderAnalyticsProductMetricCard('详情触达', formatNumber(summary.detail_view_user_count || 0), `详情 ${formatNumber(summary.detail_view_count || 0)} 次`, 'accent'),
        renderAnalyticsProductMetricCard('购买意图', formatNumber(summary.purchase_click_user_count || 0), `意图 ${formatNumber(summary.purchase_click_count || 0)} 次`, 'success'),
        renderAnalyticsProductMetricCard('商品卡点击', formatNumber(summary.card_click_user_count || 0), `点击 ${formatNumber(summary.card_click_count || 0)} 次`, 'default'),
        renderAnalyticsProductMetricCard('活跃商品', formatNumber(summary.active_product_count || 0), `在售商品 ${formatNumber(summary.selling_product_count || 0)}`, 'warning'),
        renderAnalyticsProductMetricCard('成交订单', formatNumber(summary.order_count || 0), '当前窗口尚未形成支付', 'danger')
    ].join('');
}

function renderAnalyticsProductAlertActions(actions = []) {
    const safeActions = (Array.isArray(actions) ? actions : []).filter((item) => item && item.destination && item.label);
    if (safeActions.length <= 0) {
        return '';
    }

    return `
        <div class="analytics-product-alert-card__actions">
            ${safeActions.map((action) => `
                <button
                    type="button"
                    class="btn-sm btn-secondary"
                    ${buildAnalyticsProductDestinationAttrs(action.destination, action.context)}
                >
                    <i class="fas ${escapeHtml(action.icon || 'fa-arrow-up-right-from-square')}"></i> ${escapeHtml(action.label)}
                </button>
            `).join('')}
        </div>
    `;
}

function buildAnalyticsProductAlertItems({ summary = {}, productMatrix = {}, healthPayloads = {}, rankPayloads = {} } = {}) {
    const items = [];
    const seenKeys = new Set();
    const productMatrixItems = Array.isArray(productMatrix?.items) ? productMatrix.items : [];
    const highExposureRows = Array.isArray(rankPayloads?.highExposureLowConversion) ? rankPayloads.highExposureLowConversion : [];
    const lowStockProducts = Array.isArray(healthPayloads?.lowStockProducts) ? healthPayloads.lowStockProducts : [];
    const soldOutProducts = Array.isArray(healthPayloads?.soldOutProducts) ? healthPayloads.soldOutProducts : [];
    const deliveryRiskProducts = Array.isArray(healthPayloads?.deliveryRiskProducts) ? healthPayloads.deliveryRiskProducts : [];
    const refundRiskProducts = Array.isArray(healthPayloads?.refundRiskProducts) ? healthPayloads.refundRiskProducts : [];
    const turnoverHints = Array.isArray(healthPayloads?.inventoryTurnoverHints) ? healthPayloads.inventoryTurnoverHints : [];

    const pushAlert = (key, payload = {}) => {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey || seenKeys.has(normalizedKey)) {
            return;
        }
        seenKeys.add(normalizedKey);
        items.push(Object.assign({
            key: normalizedKey,
            tone: 'warning',
            badge: '建议跟进',
            metric: '',
            actions: []
        }, payload));
    };

    const viewUsers = Number(summary?.view_user_count || 0);
    const detailUsers = Number(summary?.detail_view_user_count || 0);
    const purchaseIntentUsers = Number(summary?.purchase_click_user_count || 0);
    const orderCount = Number(summary?.order_count || 0);
    const soldOutProduct = soldOutProducts[0] || null;
    const lowStockProduct = soldOutProduct ? null : (lowStockProducts[0] || null);
    const deliveryRiskProduct = deliveryRiskProducts[0] || null;
    const refundRiskProduct = refundRiskProducts[0] || null;
    const conversionGapProduct = highExposureRows[0]
        || productMatrixItems.find((item) => String(item?.quadrant_key || '').trim() === 'conversion_gap')
        || null;
    const turnoverHint = turnoverHints[0] || null;

    if (soldOutProduct) {
        pushAlert(`sold-out:${soldOutProduct.product_id || soldOutProduct.product_name || 'product'}`, {
            productId: soldOutProduct.product_id,
            productName: soldOutProduct.product_name || '',
            tone: 'danger',
            badge: '优先处理',
            metric: `库存 ${formatNumber(soldOutProduct.stock_count || 0)}`,
            title: `${soldOutProduct.product_name || '商品'} 已售罄`,
            summary: `当前窗口已售 ${formatNumber(soldOutProduct.units_sold || 0)} 件，成交 ${formatNumber(soldOutProduct.order_count || 0)} 单，建议先看库存与补货节奏。`,
            rankReason: '售罄后如果仍有处理回写，说明补货或下线动作还没有真正消化掉库存风险。',
            recommendedAction: '先看库存明细和商品在售状态，确认是立即补货、限售，还是临时下线止损。',
            verificationMethod: '回到商品分析确认可用库存恢复、售罄预警消失，并观察后续订单是否继续承接。',
            actions: [
                {
                    label: '看库存',
                    icon: 'fa-warehouse',
                    destination: 'shop-inventory',
                    context: {
                        tab: 'inventory',
                        productId: soldOutProduct.product_id,
                        productName: soldOutProduct.product_name || ''
                    }
                },
                {
                    label: '看单品详情',
                    icon: 'fa-cube',
                    destination: 'analytics-product-detail',
                    context: {
                        productId: soldOutProduct.product_id,
                        productName: soldOutProduct.product_name || '',
                        focusTargetId: 'productDetailPanelSection'
                    }
                }
            ]
        });
    }

    if (lowStockProduct) {
        pushAlert(`low-stock:${lowStockProduct.product_id || lowStockProduct.product_name || 'product'}`, {
            productId: lowStockProduct.product_id,
            productName: lowStockProduct.product_name || '',
            tone: 'warning',
            badge: '建议补货',
            metric: `库存 ${formatNumber(lowStockProduct.stock_count || 0)}`,
            title: `${lowStockProduct.product_name || '商品'} 库存偏低`,
            summary: `当前库存 ${formatNumber(lowStockProduct.stock_count || 0)}，已售 ${formatNumber(lowStockProduct.units_sold || 0)} 件，可提前联动库存和商品页查看是否需要补货或下线。`,
            rankReason: '低库存商品在处理后仍被回写关注，说明后续成交可能继续受限。',
            recommendedAction: '先核对库存批次和最近销量，再决定补货、降流量还是限制继续售卖。',
            verificationMethod: '确认低库存预警回落，并观察销量没有因为缺货继续中断。',
            actions: [
                {
                    label: '看库存',
                    icon: 'fa-layer-group',
                    destination: 'shop-inventory',
                    context: {
                        tab: 'inventory',
                        productId: lowStockProduct.product_id,
                        productName: lowStockProduct.product_name || ''
                    }
                },
                {
                    label: '看商品池',
                    icon: 'fa-boxes-stacked',
                    destination: 'shop-products',
                    context: {
                        tab: 'products',
                        productId: lowStockProduct.product_id,
                        productName: lowStockProduct.product_name || ''
                    }
                }
            ]
        });
    }

    if (deliveryRiskProduct) {
        pushAlert(`delivery-risk:${deliveryRiskProduct.product_id || deliveryRiskProduct.product_name || 'product'}`, {
            productId: deliveryRiskProduct.product_id,
            productName: deliveryRiskProduct.product_name || '',
            tone: 'danger',
            badge: '优先处理',
            metric: `风险 ${formatNumber(deliveryRiskProduct.delivery_risk_count || 0)} 单`,
            title: `${deliveryRiskProduct.product_name || '商品'} 履约异常偏高`,
            summary: `当前窗口已有 ${formatNumber(deliveryRiskProduct.delivery_risk_count || 0)} 单履约风险，建议优先联动履约和订单处理查看具体问题列表。`,
            rankReason: '履约风险单仍在冒出，说明死信、待重试或发货阻塞还没完全收口。',
            recommendedAction: '先去履约任务和问题订单列表，优先清掉死信、待重试和待解锁任务。',
            verificationMethod: '确认履约风险单下降、发货成功率回升，且死信/待重试任务明显减少。',
            actions: [
                {
                    label: '去履约',
                    icon: 'fa-truck-fast',
                    destination: 'shop-fulfillment',
                    context: {
                        tab: 'fulfillment',
                        productId: deliveryRiskProduct.product_id,
                        productName: deliveryRiskProduct.product_name || '',
                        query: deliveryRiskProduct.product_name || deliveryRiskProduct.product_id || '',
                        deliveryQueryType: 'manual',
                        queryLabel: deliveryRiskProduct.product_name || deliveryRiskProduct.product_id || '商品',
                        referenceLabel: '商品',
                        referenceValue: deliveryRiskProduct.product_name || deliveryRiskProduct.product_id || '商品'
                    }
                },
                {
                    label: '看风险拆解',
                    icon: 'fa-triangle-exclamation',
                    destination: 'analytics-product-detail',
                    context: {
                        productId: deliveryRiskProduct.product_id,
                        productName: deliveryRiskProduct.product_name || '',
                        detailFocus: 'delivery-risk',
                        focusTargetId: 'productRiskBreakdownSection'
                    }
                }
            ]
        });
    }

    if (refundRiskProduct) {
        pushAlert(`refund-risk:${refundRiskProduct.product_id || refundRiskProduct.product_name || 'product'}`, {
            productId: refundRiskProduct.product_id,
            productName: refundRiskProduct.product_name || '',
            tone: 'warning',
            badge: '建议复核',
            metric: `退款 ${formatNumber(refundRiskProduct.refunded_order_count || 0)} 单`,
            title: `${refundRiskProduct.product_name || '商品'} 退款风险偏高`,
            summary: `当前退款率 ${formatPercent(refundRiskProduct.refund_rate || 0)}，建议联动订单与售后，确认是否是商品内容、库存或履约导致。`,
            rankReason: '退款风险在处理后仍被回写，说明问题可能不只是单笔售后，而是商品本身仍在持续制造退款。',
            recommendedAction: '先看售后队列和订单问题，确认是商品描述、库存交付还是支付体验导致退款上升。',
            verificationMethod: '确认退款率回落、退款工单减少，并观察后续支付转化没有继续恶化。',
            actions: [
                {
                    label: '去售后',
                    icon: 'fa-headset',
                    destination: 'tickets',
                    context: {
                        mode: 'pending',
                        workspace: 'queue',
                        status: 'pending',
                        search: refundRiskProduct.product_name || refundRiskProduct.product_id || '',
                        productId: refundRiskProduct.product_id,
                        productName: refundRiskProduct.product_name || '',
                        referenceLabel: '商品预警',
                        referenceValue: `${refundRiskProduct.product_name || refundRiskProduct.product_id || '商品'} · 退款风险`,
                        focusTargetId: 'ticketsQueueControls'
                    }
                },
                {
                    label: '看订单',
                    icon: 'fa-receipt',
                    destination: 'shop-orders',
                    context: {
                        tab: 'orders',
                        productId: refundRiskProduct.product_id,
                        productName: refundRiskProduct.product_name || '',
                        query: refundRiskProduct.product_name || refundRiskProduct.product_id || '',
                        referenceLabel: '商品',
                        referenceValue: refundRiskProduct.product_name || refundRiskProduct.product_id || '商品'
                    }
                },
                {
                    label: '看风险拆解',
                    icon: 'fa-rotate-left',
                    destination: 'analytics-product-detail',
                    context: {
                        productId: refundRiskProduct.product_id,
                        productName: refundRiskProduct.product_name || '',
                        detailFocus: 'refund-risk',
                        focusTargetId: 'productRiskBreakdownSection'
                    }
                }
            ]
        });
    }

    if (orderCount <= 0 && (purchaseIntentUsers > 0 || detailUsers > 0 || viewUsers > 0)) {
        pushAlert('orderless-window', {
            tone: purchaseIntentUsers > 0 ? 'warning' : 'accent',
            badge: purchaseIntentUsers > 0 ? '建议转化' : '持续观察',
            metric: `意图 ${formatNumber(purchaseIntentUsers || 0)} 用户`,
            title: '当前窗口有前置信号，但尚未形成支付',
            summary: `已采到浏览用户 ${formatNumber(viewUsers)}、详情用户 ${formatNumber(detailUsers)}、购买意图用户 ${formatNumber(purchaseIntentUsers)}，建议优先看商品漏斗和高曝光待转化商品。`,
            rankReason: '浏览、详情和购买意图都在，但成交仍是 0，说明问题卡在支付前后的关键断点。',
            recommendedAction: '先看商品漏斗和支付异常，确认是详情到意图、意图到支付，还是支付到履约这段出了问题。',
            verificationMethod: '确认购买意图继续增长的同时，订单和支付成功开始恢复，不再只停留在前置信号。',
            actions: [
                {
                    label: '看支付异常',
                    icon: 'fa-credit-card',
                    destination: 'payments-ops',
                    context: {
                        mode: 'ops',
                        referenceLabel: '商品预警',
                        referenceValue: '有意图未成交',
                        productId: '',
                        productName: '',
                        focusTargetId: 'paymentsExceptionTopics'
                    }
                },
                {
                    label: '看商品漏斗',
                    icon: 'fa-filter-circle-dollar',
                    destination: 'analytics-product',
                    context: {
                        focusTargetId: 'productFunnelSection'
                    }
                },
                {
                    label: '看总盘',
                    icon: 'fa-chart-line',
                    destination: 'analytics-product',
                    context: {
                        focusTargetId: 'productOverviewSection'
                    }
                }
            ]
        });
    }

    if (conversionGapProduct) {
        pushAlert(`conversion-gap:${conversionGapProduct.product_id || conversionGapProduct.product_name || 'product'}`, {
            productId: conversionGapProduct.product_id,
            productName: conversionGapProduct.product_name || '',
            tone: 'warning',
            badge: '建议优化',
            metric: `转化 ${formatPercent(conversionGapProduct.conversion_rate || 0)}`,
            title: `${conversionGapProduct.product_name || '商品'} 曝光高但转化偏低`,
            summary: `当前浏览用户 ${formatNumber(conversionGapProduct.view_user_count || 0)}，GMV ${formatNumber(conversionGapProduct.gmv_points || 0)}，建议结合单品详情和漏斗定位断点。`,
            rankReason: '高曝光低转化说明流量已经到位，但承接链路没有把流量变成支付。',
            recommendedAction: '先看单品详情和支付对账，判断是商品信息、价格、支付异常还是履约预期影响转化。',
            verificationMethod: '确认详情到支付转化回升，同时高曝光低转化榜上的排名下降。',
            actions: [
                {
                    label: '看支付对账',
                    icon: 'fa-sack-dollar',
                    destination: 'payments-overview',
                    context: {
                        mode: 'overview',
                        referenceLabel: '商品预警',
                        referenceValue: `${conversionGapProduct.product_name || '商品'} · 高曝光待转化`,
                        productId: conversionGapProduct.product_id,
                        productName: conversionGapProduct.product_name || '',
                        focusTargetId: 'paymentsOverviewGrid'
                    }
                },
                {
                    label: '看单品详情',
                    icon: 'fa-cube',
                    destination: 'analytics-product-detail',
                    context: {
                        productId: conversionGapProduct.product_id,
                        productName: conversionGapProduct.product_name || '',
                        focusTargetId: 'productDetailPanelSection'
                    }
                },
                {
                    label: '看漏斗',
                    icon: 'fa-diagram-project',
                    destination: 'analytics-product',
                    context: {
                        focusTargetId: 'productFunnelSection'
                    }
                }
            ]
        });
    }

    if (items.length <= 0 && turnoverHint) {
        pushAlert(`turnover-hint:${turnoverHint.product_id || turnoverHint.title || 'hint'}`, {
            productId: turnoverHint.product_id || '',
            productName: turnoverHint.product_name || '',
            tone: String(turnoverHint.tone || '').trim().toLowerCase() === 'danger' ? 'danger' : 'warning',
            badge: String(turnoverHint.tone || '').trim().toLowerCase() === 'danger' ? '优先处理' : '建议跟进',
            metric: turnoverHint.product_id ? `商品 ${turnoverHint.product_id}` : '库存 / 履约',
            title: turnoverHint.title || '商品经营提示',
            summary: turnoverHint.summary || '当前窗口存在需要继续跟进的库存或履约信号。',
            rankReason: '库存与履约提示在处理后仍然保留，说明这件商品还有潜在运维压力。',
            recommendedAction: '先回到库存或履约页复核最近处理结果，确认没有新的待办被遗漏。',
            verificationMethod: '确认提示消失或至少降级，同时库存和履约相关指标不再继续恶化。',
            actions: [
                {
                    label: String(turnoverHint.tone || '').trim().toLowerCase() === 'danger' ? '去履约' : '看库存',
                    icon: String(turnoverHint.tone || '').trim().toLowerCase() === 'danger' ? 'fa-truck-fast' : 'fa-warehouse',
                    destination: String(turnoverHint.tone || '').trim().toLowerCase() === 'danger' ? 'shop-fulfillment' : 'shop-inventory',
                    context: turnoverHint.product_id
                        ? {
                            tab: String(turnoverHint.tone || '').trim().toLowerCase() === 'danger' ? 'fulfillment' : 'inventory',
                            productId: turnoverHint.product_id
                        }
                        : {
                            tab: String(turnoverHint.tone || '').trim().toLowerCase() === 'danger' ? 'fulfillment' : 'inventory'
                        }
                }
            ]
        });
    }

    return items.slice(0, 4);
}

function renderAnalyticsProductAlerts(alertItems = [], summary = {}) {
    const items = Array.isArray(alertItems) ? alertItems : [];
    const leadMessage = items.length > 0
        ? `当前窗口识别到 ${formatNumber(items.length)} 条需优先跟进的商品信号，可直接联动库存、履约、订单和单品详情处理。`
        : (buildAnalyticsProductOrderlessMessage(summary) || '当前窗口暂无高优先级商品预警，可继续结合榜单、漏斗与经营矩阵观察。');
    const noticeTone = items.length > 0 ? 'warning' : 'success';
    const writebackMarkup = renderAnalyticsResolutionFeedbackNote({
        limit: 3,
        showPriorityProducts: true,
        alertItems: items
    });

    return `
        <div class="analytics-product-alerts">
            ${renderAnalyticsProductWindowStatusNotice(leadMessage, noticeTone)}
            ${writebackMarkup}
            ${items.length > 0
                ? `<div class="analytics-product-alert-grid">
                    ${items.map((item) => `
                        ${(() => {
                            const digest = buildAnalyticsProductAlertDigest(item, summary);
                            const guidance = buildAnalyticsProductAlertGuidance(item, summary);
                            return `
                        <article class="analytics-product-alert-card analytics-product-alert-card--${escapeHtml(item.tone || 'warning')}">
                            <div class="analytics-product-alert-card__top">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item.tone === 'danger' ? 'danger' : (item.tone || 'warning'))}">
                                    ${escapeHtml(item.badge || '建议跟进')}
                                </span>
                                <span class="analytics-product-alert-card__metric">${escapeHtml(item.metric || '')}</span>
                            </div>
                            <strong class="analytics-product-alert-card__title">${escapeHtml(item.title || '商品预警')}</strong>
                            <div class="analytics-product-alert-card__summary">${escapeHtml(item.summary || '')}</div>
                            ${digest
                                ? `<div class="analytics-product-alert-card__digest analytics-product-alert-card__digest--${escapeHtml(digest.tone || 'warning')}">
                                    <div class="analytics-product-alert-card__digest-head">
                                        <span>本轮经营判断</span>
                                        <span class="analytics-status-chip analytics-status-chip--${escapeHtml(digest.tone || 'warning')}">${escapeHtml(digest.label || '待复查')}</span>
                                    </div>
                                    <p>${escapeHtml(digest.summary || '')}</p>
                                    ${Array.isArray(digest.evidenceItems) && digest.evidenceItems.length > 0
                                        ? `<div class="analytics-product-alert-card__digest-chips">
                                            ${digest.evidenceItems.map((evidence) => `<span class="analytics-product-matrix-chip analytics-product-matrix-chip--${escapeHtml(digest.tone || 'warning')}">${escapeHtml(evidence)}</span>`).join('')}
                                        </div>`
                                        : ''}
                                </div>`
                                : ''}
                            ${renderAnalyticsProductAlertActions(item.actions)}
                        </article>
                    `;
                        })()}
                    `).join('')}
                </div>`
                : renderHintState('fas fa-shield-heart', '当前窗口暂无高优先级商品预警')}
            <div class="analytics-product-actions">
                <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('analytics-product', { focusTargetId: 'productFunnelSection' })}>
                    <i class="fas fa-filter-circle-dollar"></i> 看商品漏斗
                </button>
                <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('analytics-product', { focusTargetId: 'productHealthSection' })}>
                    <i class="fas fa-heart-circle-check"></i> 看健康面板
                </button>
                <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-products', { tab: 'products' })}>
                    <i class="fas fa-boxes-stacked"></i> 去商品池
                </button>
            </div>
        </div>
    `;
}

function getAnalyticsProductOverviewChartState() {
    if (!globalThis.__analyticsProductOverviewChartState || typeof globalThis.__analyticsProductOverviewChartState !== 'object') {
        globalThis.__analyticsProductOverviewChartState = {
            categoryChart: null,
            matrixChart: null
        };
    }

    return globalThis.__analyticsProductOverviewChartState;
}

function destroyAnalyticsProductOverviewChart(key = '') {
    const state = getAnalyticsProductOverviewChartState();
    const chart = state[key];
    if (chart && typeof chart.destroy === 'function') {
        chart.destroy();
    }
    state[key] = null;
}

function getAnalyticsProductRankingBoardState() {
    if (!globalThis.__analyticsProductRankingBoardState || typeof globalThis.__analyticsProductRankingBoardState !== 'object') {
        globalThis.__analyticsProductRankingBoardState = {
            metricKey: '',
            focusedRowKeysByMetric: {}
        };
    }

    const state = globalThis.__analyticsProductRankingBoardState;
    if (!state.focusedRowKeysByMetric || typeof state.focusedRowKeysByMetric !== 'object' || Array.isArray(state.focusedRowKeysByMetric)) {
        state.focusedRowKeysByMetric = {};
    }
    return state;
}

function setActiveAnalyticsProductRankingMetric(metricKey = '') {
    const state = getAnalyticsProductRankingBoardState();
    state.metricKey = String(metricKey || '').trim();
    return state;
}

function toggleActiveAnalyticsProductRankingFocus(metricKey = '', focusKey = '') {
    const state = getAnalyticsProductRankingBoardState();
    const normalizedMetricKey = String(metricKey || '').trim();
    const normalizedFocusKey = String(focusKey || '').trim();
    if (!normalizedMetricKey) {
        return state;
    }

    if (!normalizedFocusKey) {
        delete state.focusedRowKeysByMetric[normalizedMetricKey];
        return state;
    }

    state.focusedRowKeysByMetric[normalizedMetricKey] = state.focusedRowKeysByMetric[normalizedMetricKey] === normalizedFocusKey
        ? ''
        : normalizedFocusKey;
    return state;
}

function renderAnalyticsProductCategoryBreakdown(payload = {}) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const visibleRows = rows.slice(0, 6);

    return `
        <section class="analytics-product-panel analytics-product-panel--category">
            <div class="analytics-product-panel__head">
                <div>
                    <strong>类目贡献</strong>
                    <p>按积分 GMV 观察当前窗口的商品结构和类目转化表现</p>
                </div>
                <span class="analytics-product-panel__meta">${formatNumber(payload?.total_category_count || visibleRows.length || 0)} 个类目</span>
            </div>
            <div class="analytics-product-structure-layout">
                <div class="analytics-product-chart-pane analytics-product-chart-pane--compact">
                    ${visibleRows.length > 0
                        ? '<canvas id="productCategoryBreakdownChartCanvas"></canvas>'
                        : renderHintState('fas fa-chart-pie', '当前窗口暂无类目贡献数据')}
                </div>
                <div class="analytics-product-category-list">
                    ${visibleRows.length > 0
                        ? visibleRows.map((row, index) => {
                            const guidance = buildAnalyticsProductCategoryGuidance(row, index, payload);
                            const indicatorColor = getAnalyticsProductCategoryIndicatorColor(row, index);
                            return `
                                <article class="analytics-product-category-row"${buildAnalyticsProductIndicatorStyle(indicatorColor)}>
                                    <div class="analytics-product-category-row__main">
                                        <div class="analytics-product-category-row__top">
                                            <strong>${escapeHtml(row.category || '未分类')}</strong>
                                            <span>#${index + 1}</span>
                                        </div>
                                        <div class="analytics-product-category-row__meta">
                                            <span>GMV ${formatNumber(row.gmv_points || 0)}</span>
                                            <span>占比 ${formatPercent(row.gmv_share_rate || 0)}</span>
                                            <span>商品 ${formatNumber(row.product_count || 0)}</span>
                                            <span>转化 ${formatPercent(row.conversion_rate || 0)}</span>
                                        </div>
                                        ${renderAnalyticsProductInlineGuidance(guidance)}
                                    </div>
                                </article>
                            `;
                        }).join('')
                        : ''}
                </div>
            </div>
        </section>
    `;
}

function buildAnalyticsProductCategoryGuidance(row = {}, index = 0, payload = {}) {
    const gmvShareRate = Number(row?.gmv_share_rate || 0);
    const conversionRate = Number(row?.conversion_rate || 0);
    const productCount = Number(row?.product_count || 0);
    const activeProductCount = Number(row?.active_product_count || 0);
    const viewUserCount = Number(row?.view_user_count || 0);
    const buyerCount = Number(row?.buyer_count || 0);
    const activeRate = productCount > 0 ? (activeProductCount / productCount) * 100 : 0;
    const topShareRate = Number(payload?.rows?.[0]?.gmv_share_rate || 0);

    if ((index === 0 && gmvShareRate >= 30) || (gmvShareRate >= 35 && conversionRate >= 20)) {
        return {
            statusLabel: '核心类目',
            statusTone: 'success',
            reason: `当前类目贡献 ${formatPercent(gmvShareRate)} GMV，占比靠前且转化 ${formatPercent(conversionRate)}，已经是本窗口的核心成交来源。`,
            recommendation: '优先保障这个类目的库存、履约和支付链路稳定，再考虑继续放量相关商品与内容入口。',
            verification: '继续观察类目 GMV 占比、成交买家和转化率是否保持稳定，不要在放量后快速回落。'
        };
    }

    if (viewUserCount >= 8 && conversionRate > 0 && conversionRate < 12) {
        return {
            statusLabel: '低转化类目',
            statusTone: 'danger',
            reason: `当前类目已有 ${formatNumber(viewUserCount)} 个浏览用户，但转化仅 ${formatPercent(conversionRate)}，说明流量正在进入但成交承接不足。`,
            recommendation: '先看这个类目下的高曝光低转化商品，确认问题主要卡在详情触达、购买意图还是支付成功。',
            verification: '处理后确认类目转化率回升，且相关商品不再持续出现在高曝光低转化榜。'
        };
    }

    if (productCount >= 4 && activeRate < 60) {
        return {
            statusLabel: '结构偏散',
            statusTone: 'warning',
            reason: `当前类目有 ${formatNumber(productCount)} 个商品，但活跃商品只有 ${formatNumber(activeProductCount)} 个，结构偏散且动销集中度不高。`,
            recommendation: '先清点这个类目里的低动销商品，再决定是补强头部商品，还是收缩无效 SKU。',
            verification: '后续确认活跃商品占比提升，且类目浏览和成交不再继续分散。'
        };
    }

    return {
        statusLabel: topShareRate > 0 && gmvShareRate >= topShareRate * 0.6 ? '继续放量' : '继续观察',
        statusTone: topShareRate > 0 && gmvShareRate >= topShareRate * 0.6 ? 'accent' : 'neutral',
        reason: `当前类目贡献 ${formatPercent(gmvShareRate)} GMV，浏览 ${formatNumber(viewUserCount)}、成交买家 ${formatNumber(buyerCount)}，属于值得持续观察的经营分组。`,
        recommendation: topShareRate > 0 && gmvShareRate >= topShareRate * 0.6
            ? '保持内容与商品入口稳定，优先观察头部商品是否还能继续拉升成交。'
            : '先结合类目下商品榜单和经营矩阵，确认是继续扩量还是维持观察更合适。',
        verification: '后续回看这个类目的 GMV 占比、转化率和活跃商品数，确认趋势是在改善还是继续走弱。'
    };
}

function renderAnalyticsProductMatrix(payload = {}) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const quadrantSummary = Array.isArray(payload?.quadrant_summary) ? payload.quadrant_summary : [];
    const benchmarks = payload?.benchmark && typeof payload.benchmark === 'object'
        ? payload.benchmark
        : {};

    return `
        <section class="analytics-product-panel analytics-product-panel--matrix">
            <div class="analytics-product-panel__head">
                <div>
                    <strong>商品经营矩阵</strong>
                    <p>用浏览用户和支付转化率定位明星商品、待优化商品和潜力商品</p>
                </div>
                <span class="analytics-product-panel__meta">
                    基准：浏览 ${formatNumber(benchmarks.exposure_midpoint || 0)} / 转化 ${formatPercent(benchmarks.conversion_midpoint || 0)}
                </span>
            </div>
            <div class="analytics-product-matrix-summary">
                ${quadrantSummary.length > 0
                    ? quadrantSummary.map((item) => `
                        <span class="analytics-product-matrix-chip analytics-product-matrix-chip--${escapeHtml(item.tone || 'neutral')}">
                            ${escapeHtml(item.label || '经营分组')} · ${formatNumber(item.count || 0)}
                        </span>
                    `).join('')
                    : '<span class="analytics-product-matrix-chip analytics-product-matrix-chip--neutral">当前窗口暂无经营分组</span>'}
            </div>
            <div class="analytics-product-chart-pane analytics-product-chart-pane--compact">
                ${items.length > 0
                    ? '<canvas id="productOperatingMatrixChartCanvas"></canvas>'
                    : renderHintState('fas fa-braille', '当前窗口暂无商品经营矩阵样本')}
            </div>
            <div class="analytics-product-matrix-list">
                ${items.length > 0
                    ? items.slice(0, 5).map((item, index) => {
                        const guidance = buildAnalyticsProductListGuidance(item, {
                            tone: item?.tone,
                            reason(row) {
                                const quadrantKey = String(row?.quadrant_key || '').trim().toLowerCase();
                                if (quadrantKey === 'conversion_gap') {
                                    return `浏览 ${formatNumber(row.view_user_count || 0)}、转化 ${formatPercent(row.conversion_rate || 0)}，当前仍处在高曝光低转化象限。`;
                                }
                                if (quadrantKey === 'star') {
                                    return `浏览 ${formatNumber(row.view_user_count || 0)}、GMV ${formatNumber(row.gmv_points || 0)}，当前已经跑出稳定成交。`;
                                }
                                if (quadrantKey === 'potential') {
                                    return `已经有 ${formatNumber(row.view_user_count || 0)} 个浏览用户，但支付转化还没起量，属于潜力商品。`;
                                }
                                return `当前商品浏览 ${formatNumber(row.view_user_count || 0)}、转化 ${formatPercent(row.conversion_rate || 0)}，值得继续观察经营走势。`;
                            },
                            recommendation(row) {
                                const quadrantKey = String(row?.quadrant_key || '').trim().toLowerCase();
                                if (quadrantKey === 'conversion_gap') {
                                    return '先看单品详情里的商品漏斗和支付链路，确认是详情到意图还是意图到支付掉得更明显。';
                                }
                                if (quadrantKey === 'star') {
                                    return '优先确保库存、履约和支付链路稳定，再考虑继续放量。';
                                }
                                if (quadrantKey === 'potential') {
                                    return '先补详情转化和购买意图引导，再看内容和商品入口是否需要同步优化。';
                                }
                                return '先点进单品详情，结合来源、漏斗和回写结论判断这件商品更适合放量还是继续观察。';
                            },
                            verification(row) {
                                const quadrantKey = String(row?.quadrant_key || '').trim().toLowerCase();
                                if (quadrantKey === 'conversion_gap') {
                                    return '处理后确认这件商品是否脱离高曝光低转化象限，且转化率有回升。';
                                }
                                if (quadrantKey === 'star') {
                                    return '继续观察浏览、GMV 和履约风险是否保持稳定，不要在放量后反弹出新异常。';
                                }
                                return '回到商品经营矩阵，确认这件商品的位置和转化信号是否比当前更健康。';
                            }
                        });
                        const indicatorColor = getAnalyticsProductToneIndicatorColor(item?.tone || item?.quadrant_key || 'neutral', index);
                        return `
                            <article class="analytics-product-matrix-row analytics-product-matrix-row--${escapeHtml(item.tone || 'neutral')}"${buildAnalyticsProductIndicatorStyle(indicatorColor)}>
                                <div class="analytics-product-matrix-row__main">
                                    <div class="analytics-product-matrix-row__top">
                                        ${renderAnalyticsProductNameButton(item.product_name, item.product_id, {
                                            detailContext: {
                                                detailFocus: 'content-breakdown',
                                                focusTargetId: 'productContentBreakdownSection'
                                            }
                                        })}
                                        <span class="analytics-product-matrix-chip analytics-product-matrix-chip--${escapeHtml(item.tone || 'neutral')}">${escapeHtml(item.quadrant_label || '经营观察')}</span>
                                    </div>
                                    <div class="analytics-product-matrix-row__meta">
                                        <span>${escapeHtml(item.category || '未分类')}</span>
                                        <span>浏览 ${formatNumber(item.view_user_count || 0)}</span>
                                        <span>转化 ${formatPercent(item.conversion_rate || 0)}</span>
                                        <span>GMV ${formatNumber(item.gmv_points || 0)}</span>
                                    </div>
                                    ${renderAnalyticsProductInlineGuidance(guidance)}
                                </div>
                            </article>
                        `;
                    }).join('')
                    : ''}
            </div>
        </section>
    `;
}

function renderAnalyticsProductOverview(summary = {}, trendRows = [], comparison = {}, categoryBreakdown = {}, productMatrix = {}) {
    const recentTrend = Array.isArray(trendRows) ? trendRows.slice(-7) : [];
    const snapshots = Array.isArray(comparison?.snapshots) ? comparison.snapshots : [];
    const orderlessMessage = Number(summary?.order_count || 0) <= 0
        ? buildAnalyticsProductOrderlessMessage(summary)
        : '';
    const metricCards = renderAnalyticsProductOverviewMetricCards(summary);

    const comparisonMarkup = snapshots.length > 0
        ? snapshots.map((snapshot, index) => {
            const siteSummary = snapshot?.summary && typeof snapshot.summary === 'object'
                ? snapshot.summary
                : {};
            const indicatorColor = getAnalyticsProductSiteIndicatorColor(snapshot, index);
            return `
                <article class="analytics-product-site-card"${buildAnalyticsProductIndicatorStyle(indicatorColor)}>
                    <div class="analytics-product-site-card__top">
                        <strong>${escapeHtml(snapshot.label || snapshot.site || '站点')}</strong>
                        <span class="analytics-status-chip analytics-status-chip--${snapshot.site === comparison?.active_site ? 'warning' : 'neutral'}">${snapshot.site === comparison?.active_site ? '当前视角' : '对照'}</span>
                    </div>
                    <div class="analytics-product-site-card__metrics">
                        <span>GMV ${formatNumber(siteSummary.gmv_points || 0)}</span>
                        <span>订单 ${formatNumber(siteSummary.order_count || 0)}</span>
                        <span>买家 ${formatNumber(siteSummary.unique_buyer_count || 0)}</span>
                        <span>转化 ${formatPercent(siteSummary.purchase_conversion_rate || 0)}</span>
                    </div>
                </article>
            `;
        }).join('')
        : renderHintState('fas fa-diagram-project', '暂无站点对比数据');

    const actionsMarkup = `
        <div class="analytics-product-actions">
            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-products', { tab: 'products' })}>
                <i class="fas fa-box"></i> 商品管理
            </button>
            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-orders', { tab: 'orders' })}>
                <i class="fas fa-receipt"></i> 订单处理
            </button>
            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-inventory', { tab: 'inventory' })}>
                <i class="fas fa-layer-group"></i> 库存健康
            </button>
        </div>
    `;

    return `
        <div class="analytics-product-dashboard">
            ${renderAnalyticsProductWindowStatusNotice(orderlessMessage, 'warning')}
            <div class="analytics-product-metric-grid">
                ${metricCards}
            </div>
            <div class="analytics-product-summary-layout">
                <section class="analytics-product-panel analytics-product-panel--trend">
                    <div class="analytics-product-panel__head">
                        <div>
                            <strong>近窗趋势</strong>
                            <p>按日观察商品成交与商城访问变化</p>
                        </div>
                        <span class="analytics-product-panel__meta">${recentTrend.length > 0 ? `最近 ${recentTrend.length} 个观测日` : '暂无趋势数据'}</span>
                    </div>
                    <div class="analytics-product-chart-pane">
                        ${recentTrend.length > 0
                            ? '<canvas id="productTrendChartCanvas"></canvas>'
                            : renderHintState('fas fa-chart-line', '当前窗口暂无商品趋势数据')}
                    </div>
                </section>
                <section class="analytics-product-panel analytics-product-panel--comparison">
                    <div class="analytics-product-panel__head">
                        <div>
                            <strong>站点对比</strong>
                            <p>快速比较 CN / INTL 的商品经营差异</p>
                        </div>
                        <span class="analytics-product-panel__meta">${escapeHtml(summary.metric_basis || '商品经营口径')}</span>
                    </div>
                    <div class="analytics-product-site-grid">
                        ${comparisonMarkup}
                    </div>
                </section>
            </div>
            <div class="analytics-product-summary-layout analytics-product-summary-layout--secondary">
                ${renderAnalyticsProductCategoryBreakdown(categoryBreakdown)}
                ${renderAnalyticsProductMatrix(productMatrix)}
            </div>
            ${actionsMarkup}
        </div>
    `;
}

async function loadProductAlerts() {
    const container = document.getElementById('productAlerts');
    const meta = document.getElementById('productAlertsMeta');
    if (!container) return;

    container.innerHTML = renderAnalyticsProductCommerceSkeleton('alerts');

    try {
        const bundle = await getAnalyticsProductDashboardBundle({ limit: 10 });
        const summary = getAnalyticsProductBundlePayloadOrThrow(bundle, 'summary', 'Product summary unavailable') || {};
        const productMatrix = getAnalyticsProductBundlePayloadOrThrow(bundle, 'productMatrix', 'Product operating matrix unavailable') || {};
        const healthPayloads = {
            lowStockProducts: (getAnalyticsProductBundlePayloadOrThrow(bundle, 'lowStockProducts', 'Low-stock product health unavailable') || []).slice(0, 8),
            soldOutProducts: (getAnalyticsProductBundlePayloadOrThrow(bundle, 'soldOutProducts', 'Sold-out product health unavailable') || []).slice(0, 8),
            deliveryRiskProducts: (getAnalyticsProductBundlePayloadOrThrow(bundle, 'deliveryRiskProducts', 'Delivery risk product health unavailable') || []).slice(0, 8),
            refundRiskProducts: (getAnalyticsProductBundlePayloadOrThrow(bundle, 'refundRiskProducts', 'Refund risk product health unavailable') || []).slice(0, 8),
            inventoryTurnoverHints: (getAnalyticsProductBundlePayloadOrThrow(bundle, 'inventoryTurnoverHints', 'Inventory turnover hints unavailable') || []).slice(0, 8)
        };
        const rankPayloads = {
            highExposureLowConversion: (getAnalyticsProductBundlePayloadOrThrow(bundle, 'highExposureLowConversion', 'Product exposure-conversion rank unavailable') || []).slice(0, 6)
        };

        const hasSignal = Number(summary.active_product_count || 0) > 0
            || Number(summary.view_user_count || 0) > 0
            || Number(summary.order_count || 0) > 0
            || Object.values(healthPayloads).some((rows) => Array.isArray(rows) && rows.length > 0)
            || (Array.isArray(rankPayloads.highExposureLowConversion) && rankPayloads.highExposureLowConversion.length > 0)
            || (Array.isArray(productMatrix?.items) && productMatrix.items.length > 0);

        if (!hasSignal) {
            container.innerHTML = renderHintState('fas fa-siren-on', '当前窗口暂无商品预警信号');
            if (meta) meta.textContent = '当前窗口暂无预警';
            return;
        }

        const alertItems = buildAnalyticsProductAlertItems({ summary, productMatrix, healthPayloads, rankPayloads });
        registerAnalyticsProductDetailCandidates(alertItems);
        container.innerHTML = renderAnalyticsProductAlerts(alertItems, summary);
        if (meta) {
            meta.textContent = alertItems.length > 0
                ? `当前窗口 ${formatNumber(alertItems.length)} 条需关注`
                : '当前窗口暂无高优先级预警';
        }
    } catch (err) {
        console.error('[Analytics] Failed to load product alerts:', err);
        const failureMessage = getAnalyticsProductLoadFailureMessage(err, '商品预警中心加载失败');
        container.innerHTML = renderHintState('fas fa-siren-on', failureMessage, 'error');
        if (meta) meta.textContent = failureMessage;
    }
}

function renderAnalyticsProductTrendChart(rows = []) {
    const chartRows = Array.isArray(rows) ? rows.slice(-7) : [];
    const canvas = document.getElementById('productTrendChartCanvas');
    if (!canvas) {
        return;
    }

    if (productTrendChart) {
        productTrendChart.destroy();
    }

    const theme = getChartTheme();

    productTrendChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: chartRows.map((row) => formatDate(row.day)),
            datasets: [
                {
                    label: '积分 GMV',
                    data: chartRows.map((row) => roundTo(row.gmv_points, 1) || 0),
                    borderColor: chartColors.primary,
                    backgroundColor: 'rgba(107, 158, 206, 0.14)',
                    fill: true,
                    tension: 0.35,
                    yAxisID: 'y'
                },
                {
                    label: '订单数',
                    data: chartRows.map((row) => row.order_count || 0),
                    borderColor: chartColors.success,
                    backgroundColor: 'rgba(34, 197, 94, 0.12)',
                    tension: 0.35,
                    fill: false,
                    yAxisID: 'y1'
                },
                {
                    label: '商城浏览',
                    data: chartRows.map((row) => row.view_count || 0),
                    borderColor: chartColors.secondary,
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    tension: 0.35,
                    fill: false,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: theme.text }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: theme.text }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: theme.grid },
                    ticks: { color: theme.text }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: theme.text }
                }
            }
        }
    });
}

function renderAnalyticsProductCategoryBreakdownChart(payload = {}) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const canvas = document.getElementById('productCategoryBreakdownChartCanvas');
    destroyAnalyticsProductOverviewChart('categoryChart');
    if (!canvas || rows.length === 0) {
        return;
    }

    const theme = getChartTheme();
    const state = getAnalyticsProductOverviewChartState();
    const colors = rows.map((row, index) => getAnalyticsProductCategoryIndicatorColor(row, index));

    state.categoryChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: rows.map((row) => row.category || '未分类'),
            datasets: [{
                data: rows.map((row) => toNumericValue(row?.gmv_points) || 0),
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: theme.background
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: theme.text,
                        boxWidth: 10,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const row = rows[context.dataIndex] || {};
                            return `${context.label || '未分类'}: GMV ${formatNumber(row.gmv_points || 0)} / 占比 ${formatPercent(row.gmv_share_rate || 0)} / 转化 ${formatPercent(row.conversion_rate || 0)}`;
                        }
                    }
                }
            }
        }
    });
}

function renderAnalyticsProductOperatingMatrixChart(payload = {}) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const canvas = document.getElementById('productOperatingMatrixChartCanvas');
    destroyAnalyticsProductOverviewChart('matrixChart');
    if (!canvas || items.length === 0) {
        return;
    }

    const theme = getChartTheme();
    const state = getAnalyticsProductOverviewChartState();
    const itemColors = items.map((item, index) => getAnalyticsProductToneIndicatorColor(
        item?.tone || item?.quadrant_key || 'neutral',
        index
    ));

    state.matrixChart = new Chart(canvas, {
        type: 'bubble',
        data: {
            datasets: [{
                label: '商品经营矩阵',
                data: items.map((item) => ({
                    x: toNumericValue(item?.view_user_count) || 0,
                    y: toNumericValue(item?.conversion_rate) || 0,
                    r: Math.max(7, Math.min(22, toNumericValue(item?.bubble_size) || 10))
                })),
                backgroundColor: itemColors.map((color) => withAnalyticsProductIndicatorAlpha(color, 0.72)),
                borderColor: itemColors,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '浏览用户',
                        color: theme.text
                    },
                    ticks: {
                        color: theme.text,
                        callback(value) {
                            return formatNumber(value);
                        }
                    },
                    grid: { color: theme.grid }
                },
                y: {
                    title: {
                        display: true,
                        text: '支付转化率',
                        color: theme.text
                    },
                    ticks: {
                        color: theme.text,
                        callback(value) {
                            return `${value}%`;
                        }
                    },
                    grid: { color: theme.grid }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const item = items[context.dataIndex] || {};
                            return `${item.product_name || '未命名商品'} · ${item.quadrant_label || '经营观察'} · 浏览 ${formatNumber(item.view_user_count || 0)} · 转化 ${formatPercent(item.conversion_rate || 0)} · GMV ${formatNumber(item.gmv_points || 0)}`;
                        }
                    }
                }
            }
        }
    });
}

function buildAnalyticsProductRankMetaItems(row = {}, metaFormatter = null) {
    const defaultMetaItems = [
        row.category || '未分类',
        `浏览用户 ${formatNumber(row.view_user_count || 0)}`,
        `买家 ${formatNumber(row.buyer_count || 0)}`
    ];
    const metaItems = typeof metaFormatter === 'function'
        ? metaFormatter(row, defaultMetaItems)
        : defaultMetaItems;

    return (Array.isArray(metaItems) ? metaItems : [metaItems])
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

const ANALYTICS_PRODUCT_RANK_METRIC_ORDER = [
    'gmvTop',
    'salesTop',
    'conversionTop',
    'contentDrivenTop',
    'refundRateTop',
    'deliveryRiskRateTop',
    'highExposureLowConversion'
];

function getAnalyticsProductRankMetricCatalog() {
    return {
        gmvTop: {
            key: 'gmvTop',
            shortLabel: '收入',
            title: '收入 Top',
            tone: 'success',
            emptyMessage: '当前窗口暂无收入榜',
            description: '按商品贡献 GMV 排序，先看当前窗口真正的营收主力。',
            ctaLabel: '查看单品详情',
            metricValue: (row) => Number(row?.gmv_points || 0),
            metricText: (row) => `${formatNumber(row?.gmv_points || 0)} 积分`,
            summaryText: (row) => `销量 ${formatNumber(row?.units_sold || 0)} 件 · 买家 ${formatNumber(row?.buyer_count || 0)}`,
            metaFormatter: (row) => [
                row.category || '未分类',
                `订单 ${formatNumber(row?.order_count || 0)} 单`,
                `买家 ${formatNumber(row?.buyer_count || 0)}`,
                `转化 ${formatPercent(row?.conversion_rate || 0)}`
            ],
            guidanceBuilder: (row) => buildAnalyticsProductListGuidance(row, {
                tone: 'success',
                reason: () => `当前贡献 GMV ${formatNumber(row?.gmv_points || 0)}，同时成交 ${formatNumber(row?.order_count || 0)} 单，是当前窗口的主力收入商品。`,
                recommendation: () => '先看单品详情里的来源、漏斗和订单承接，确认这波放量是稳定成交，还是依赖某个临时入口。',
                verification: () => '继续回看收入榜和单品趋势，确认 GMV 与订单是否还保持在高位。'
            }),
            detailContext: () => ({})
        },
        salesTop: {
            key: 'salesTop',
            shortLabel: '销量',
            title: '销量 Top',
            tone: 'accent',
            emptyMessage: '当前窗口暂无销量榜',
            description: '按成交件数排序，适合看最近放量最快的商品。',
            ctaLabel: '查看单品详情',
            metricValue: (row) => Number(row?.units_sold || 0),
            metricText: (row) => `${formatNumber(row?.units_sold || 0)} 件`,
            summaryText: (row) => `支付 ${formatNumber(row?.order_count || 0)} 单 · GMV ${formatNumber(row?.gmv_points || 0)} 积分`,
            metaFormatter: (row) => [
                row.category || '未分类',
                `订单 ${formatNumber(row?.order_count || 0)} 单`,
                `GMV ${formatNumber(row?.gmv_points || 0)} 积分`,
                `买家 ${formatNumber(row?.buyer_count || 0)}`
            ],
            guidanceBuilder: (row) => buildAnalyticsProductListGuidance(row, {
                tone: 'accent',
                reason: () => `当前销量 ${formatNumber(row?.units_sold || 0)} 件，支付 ${formatNumber(row?.order_count || 0)} 单，是当前窗口最明显的放量商品之一。`,
                recommendation: () => '先确认是曝光扩量带来的自然增长，还是短时活动推高了成交，再决定要不要继续放量。',
                verification: () => '继续回看销量榜、订单量和单品趋势，确认放量是否能持续而不是瞬时冲高。'
            }),
            detailContext: () => ({})
        },
        conversionTop: {
            key: 'conversionTop',
            shortLabel: '转化',
            title: '转化 Top',
            tone: 'warning',
            emptyMessage: '当前窗口暂无转化榜',
            description: '按浏览到购买转化率排序，适合看成交效率最强的商品。',
            ctaLabel: '查看转化详情',
            metricValue: (row) => Number(row?.conversion_rate || 0),
            metricText: (row) => `${formatPercent(row?.conversion_rate || 0)}`,
            summaryText: (row) => `浏览用户 ${formatNumber(row?.view_user_count || 0)} · 买家 ${formatNumber(row?.buyer_count || 0)}`,
            metaFormatter: (row) => [
                row.category || '未分类',
                `浏览用户 ${formatNumber(row?.view_user_count || 0)}`,
                `买家 ${formatNumber(row?.buyer_count || 0)}`,
                `GMV ${formatNumber(row?.gmv_points || 0)} 积分`
            ],
            guidanceBuilder: (row) => buildAnalyticsProductListGuidance(row, {
                tone: 'warning',
                reason: () => `当前转化 ${formatPercent(row?.conversion_rate || 0)}，浏览用户 ${formatNumber(row?.view_user_count || 0)}，这件商品的成交效率明显更高。`,
                recommendation: () => '适合继续看流量来源和商品页承接，确认高转化是否来自稳定人群，便于复制到同类商品。',
                verification: () => '后续回看转化榜和浏览到支付漏斗，确认转化率能否继续稳定。'
            }),
            detailContext: () => ({})
        },
        contentDrivenTop: {
            key: 'contentDrivenTop',
            shortLabel: '带货',
            title: '内容带货 Top',
            tone: 'success',
            emptyMessage: '当前窗口暂无内容带货商品',
            description: '按内容归因 GMV 排序，适合看当前最会带货的商品。',
            ctaLabel: '查看带货拆解',
            metricValue: (row) => Number(row?.content_assisted_gmv_points || 0),
            metricText: (row) => `${formatNumber(row?.content_assisted_gmv_points || 0)} 积分`,
            summaryText: (row) => `归因支付 ${formatNumber(row?.content_assisted_purchase_success_count || 0)} 单 · Prompt ${String(row?.top_prompt_id || '暂无归因').trim() || '暂无归因'}`,
            metaFormatter: (row) => [
                row.category || '未分类',
                row.top_prompt_id ? `主 Prompt ${row.top_prompt_id}` : '暂无 Prompt 归因',
                `归因支付 ${formatNumber(row?.content_assisted_purchase_success_count || 0)} 单`,
                `详情触达 ${formatNumber(row?.content_assisted_detail_view_count || 0)} 次`
            ],
            guidanceBuilder: (row) => buildAnalyticsProductListGuidance(row, {
                tone: 'success',
                reason: () => `当前内容带货 GMV ${formatNumber(row?.content_assisted_gmv_points || 0)}，归因支付 ${formatNumber(row?.content_assisted_purchase_success_count || 0)} 单。`,
                recommendation: () => '先看来源 Prompt 与带货链路，确认是单一爆款内容带动，还是多个内容入口都在稳定承接。',
                verification: () => '继续回看内容带货榜与单品详情，确认归因 GMV 和归因支付是否还在持续。'
            }),
            detailContext: () => ({
                detailFocus: 'content-attribution',
                focusTargetId: 'productContentBreakdownSection'
            })
        },
        refundRateTop: {
            key: 'refundRateTop',
            shortLabel: '退款',
            title: '退款率 Top',
            tone: 'danger',
            emptyMessage: '当前窗口暂无退款风险商品',
            description: '按退款率排序，适合优先复查售后风险最高的商品。',
            ctaLabel: '查看退款拆解',
            metricValue: (row) => Number(row?.refund_rate || 0),
            metricText: (row) => `${formatPercent(row?.refund_rate || 0)}`,
            summaryText: (row) => `退款 ${formatNumber(row?.refunded_order_count || 0)} 单 · 总单 ${formatNumber((row?.order_count || 0) + (row?.refunded_order_count || 0))} 单`,
            metaFormatter: (row) => [
                row.category || '未分类',
                `退款 ${formatNumber(row?.refunded_order_count || 0)} 单`,
                `总单 ${formatNumber((row?.order_count || 0) + (row?.refunded_order_count || 0))} 单`,
                `转化 ${formatPercent(row?.conversion_rate || 0)}`
            ],
            guidanceBuilder: (row) => buildAnalyticsProductListGuidance(row, {
                tone: 'danger',
                reason: () => `退款率 ${formatPercent(row?.refund_rate || 0)}，退款 ${formatNumber(row?.refunded_order_count || 0)} 单，当前属于售后风险最高的一批商品。`,
                recommendation: () => '先看退款状态拆解和近期订单，确认问题是商品本身、支付链路还是履约体验引起的。',
                verification: () => '处理后回到榜单与单品详情，确认退款率、退款单量是否同步回落。'
            }),
            detailContext: () => ({
                detailFocus: 'refund-risk',
                focusTargetId: 'productRiskBreakdownSection'
            })
        },
        deliveryRiskRateTop: {
            key: 'deliveryRiskRateTop',
            shortLabel: '履约',
            title: '履约异常率 Top',
            tone: 'warning',
            emptyMessage: '当前窗口暂无履约异常商品',
            description: '按履约异常率排序，适合优先看交付压力最大的商品。',
            ctaLabel: '查看履约拆解',
            metricValue: (row) => Number(row?.delivery_risk_rate || 0),
            metricText: (row) => `${formatPercent(row?.delivery_risk_rate || 0)}`,
            summaryText: (row) => `风险 ${formatNumber(row?.delivery_risk_count || 0)} 单 · 支付 ${formatNumber(row?.order_count || 0)} 单`,
            metaFormatter: (row) => [
                row.category || '未分类',
                `风险 ${formatNumber(row?.delivery_risk_count || 0)} 单`,
                `支付 ${formatNumber(row?.order_count || 0)} 单`,
                `发货成功 ${formatPercent(row?.delivery_success_rate || 0)}`
            ],
            guidanceBuilder: (row) => buildAnalyticsProductListGuidance(row, {
                tone: 'warning',
                reason: () => `履约风险率 ${formatPercent(row?.delivery_risk_rate || 0)}，风险 ${formatNumber(row?.delivery_risk_count || 0)} 单，当前交付压力最明显。`,
                recommendation: () => '先看履约状态拆解和订单链路，确认是待重试、死信还是待解锁拉高了风险。',
                verification: () => '处理后继续回看履约异常榜与单品详情，确认风险率和风险单量是否一起回落。'
            }),
            detailContext: () => ({
                detailFocus: 'delivery-risk',
                focusTargetId: 'productRiskBreakdownSection'
            })
        },
        highExposureLowConversion: {
            key: 'highExposureLowConversion',
            shortLabel: '低转化',
            title: '高曝光低转化',
            tone: 'danger',
            emptyMessage: '当前窗口暂无结构风险商品',
            description: '按低转化分排序，适合看曝光被浪费最明显的商品。',
            ctaLabel: '查看漏斗详情',
            metricValue: (row) => Number(row?.low_conversion_score || 0),
            metricText: (row) => `低转化分 ${formatNumber(row?.low_conversion_score || 0)}`,
            summaryText: (row) => `浏览用户 ${formatNumber(row?.view_user_count || 0)} · 转化 ${formatPercent(row?.conversion_rate || 0)}`,
            metaFormatter: (row) => [
                row.category || '未分类',
                `浏览用户 ${formatNumber(row?.view_user_count || 0)}`,
                `转化 ${formatPercent(row?.conversion_rate || 0)}`,
                `买家 ${formatNumber(row?.buyer_count || 0)}`
            ],
            guidanceBuilder: (row) => buildAnalyticsProductListGuidance(row, {
                tone: 'danger',
                reason: () => `浏览用户 ${formatNumber(row?.view_user_count || 0)}、转化 ${formatPercent(row?.conversion_rate || 0)}，这件商品当前是最典型的高曝光低转化样本。`,
                recommendation: () => '先看详情到意图、意图到支付哪一段掉得最明显，再决定是优化商品页、内容入口还是支付承接。',
                verification: () => '处理后确认它是否脱离高曝光低转化榜，同时转化率出现明确回升。'
            }),
            detailContext: () => ({})
        }
    };
}

function buildAnalyticsProductRankFocusKey(row = {}, index = 0) {
    return String(row?.product_id || row?.productId || row?.product_name || row?.productName || `row-${index + 1}`).trim();
}

function getResolvedAnalyticsProductRankMetricKey(payloads = {}, metricOptions = []) {
    const boardState = getAnalyticsProductRankingBoardState();
    const normalizedMetricKey = String(boardState.metricKey || '').trim();
    if (normalizedMetricKey && metricOptions.some((item) => item.key === normalizedMetricKey && item.hasData)) {
        return normalizedMetricKey;
    }

    const firstAvailable = metricOptions.find((item) => item.hasData);
    return firstAvailable?.key || metricOptions[0]?.key || 'gmvTop';
}

function getResolvedAnalyticsProductRankFocusKey(metricKey = '', rows = []) {
    const boardState = getAnalyticsProductRankingBoardState();
    const currentFocusKey = String(boardState.focusedRowKeysByMetric?.[metricKey] || '').trim();
    return currentFocusKey && rows.some((row) => row.focusKey === currentFocusKey)
        ? currentFocusKey
        : '';
}

function buildAnalyticsProductRankMetricOptions(payloads = {}) {
    const catalog = getAnalyticsProductRankMetricCatalog();
    return ANALYTICS_PRODUCT_RANK_METRIC_ORDER.map((key) => {
        const rows = Array.isArray(payloads?.[key]) ? payloads[key] : [];
        return {
            ...catalog[key],
            count: rows.length,
            hasData: rows.length > 0
        };
    });
}

function buildAnalyticsProductRankingsModel(payloads = {}) {
    const metricOptions = buildAnalyticsProductRankMetricOptions(payloads);
    const metricKey = getResolvedAnalyticsProductRankMetricKey(payloads, metricOptions);
    const activeMetric = metricOptions.find((item) => item.key === metricKey) || metricOptions[0] || null;
    const sourceRows = activeMetric && Array.isArray(payloads?.[activeMetric.key])
        ? payloads[activeMetric.key].slice(0, 8)
        : [];
    const resolvedFocusKey = getResolvedAnalyticsProductRankFocusKey(activeMetric?.key || '', sourceRows.map((row, index) => ({
        focusKey: buildAnalyticsProductRankFocusKey(row, index)
    })));
    const hasFocus = Boolean(resolvedFocusKey);
    const maxMetricValue = Math.max(
        1,
        ...sourceRows.map((row) => Math.max(0, Number(activeMetric?.metricValue?.(row) || 0)))
    );
    const rows = sourceRows.map((row, index) => {
        const focusKey = buildAnalyticsProductRankFocusKey(row, index);
        const metricValue = Math.max(0, Number(activeMetric?.metricValue?.(row) || 0));
        const barWidth = metricValue > 0
            ? Math.max((metricValue / maxMetricValue) * 100, 8)
            : 0;
        const metaItems = buildAnalyticsProductRankMetaItems(row, activeMetric?.metaFormatter).slice(0, 4);
        return {
            raw: row,
            focusKey,
            productId: String(row?.product_id || '').trim(),
            productName: String(row?.product_name || '未命名商品').trim() || '未命名商品',
            rank: index + 1,
            metricValue,
            metricText: activeMetric?.metricText?.(row) || '--',
            summaryText: activeMetric?.summaryText?.(row) || '',
            metaItems,
            barWidth,
            isActive: hasFocus && focusKey === resolvedFocusKey,
            isMuted: hasFocus && focusKey !== resolvedFocusKey
        };
    });
    const activeRow = rows.find((row) => row.focusKey === resolvedFocusKey) || rows[0] || null;
    const guidance = activeRow ? activeMetric?.guidanceBuilder?.(activeRow.raw) : null;
    const hasOrderBackedRows = [
        payloads?.salesTop,
        payloads?.gmvTop,
        payloads?.refundRateTop,
        payloads?.deliveryRiskRateTop,
        payloads?.contentDrivenTop
    ].some((segmentRows) => Array.isArray(segmentRows) && segmentRows.length > 0);

    return {
        metricOptions,
        activeMetric,
        rows,
        activeRow,
        guidance,
        hasFocus,
        note: activeRow
            ? (
                hasFocus
                    ? `已聚焦 ${activeRow.productName}，其它商品保留排序但会淡化，便于看清当前主角。`
                    : `当前按 ${activeMetric?.title || '商品榜单'} 排序，点击条形或右侧榜单即可聚焦单个商品。`
            )
            : '当前窗口暂无商品榜单数据。',
        notice: hasOrderBackedRows
            ? ''
            : '当前窗口暂无成交订单，因此销量、收入、退款率与履约异常榜为空；可优先查看商品漏斗和高曝光低转化商品。'
    };
}

function buildAnalyticsProductRankDetailContext(metricKey = '', row = {}) {
    const catalog = getAnalyticsProductRankMetricCatalog();
    const metricConfig = catalog[metricKey] || {};
    return Object.assign({
        productId: String(row?.product_id || '').trim(),
        productName: String(row?.product_name || '').trim(),
        sectionId: 'productDetailPanelSection',
        focusTargetId: 'productDetailPanelSection'
    }, typeof metricConfig.detailContext === 'function' ? metricConfig.detailContext(row) : {});
}

function renderAnalyticsProductRankingMetricTabs(model = {}) {
    return `
        <div class="analytics-product-rank-board__metric-tabs">
            ${(Array.isArray(model.metricOptions) ? model.metricOptions : []).map((metric) => `
                <button
                    type="button"
                    class="analytics-product-rank-board__metric-btn analytics-product-rank-board__metric-btn--${escapeHtml(metric.tone || 'neutral')}${model.activeMetric?.key === metric.key ? ' is-active' : ''}${metric.hasData ? '' : ' is-disabled'}"
                    data-analytics-product-rank-metric="${escapeHtml(metric.key)}"
                    ${metric.hasData ? '' : 'disabled'}
                >
                    <span>${escapeHtml(metric.shortLabel || metric.title || '榜单')}</span>
                    <span class="analytics-product-rank-board__metric-count">${escapeHtml(formatNumber(metric.count || 0))}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsProductRankingBars(model = {}) {
    const activeMetric = model.activeMetric || {};
    return `
        <div class="analytics-product-rank-board__bars">
            ${(Array.isArray(model.rows) ? model.rows : []).map((row) => `
                <button
                    type="button"
                    class="analytics-product-rank-board__bar-row analytics-product-rank-board__bar-row--${escapeHtml(activeMetric.tone || 'neutral')}${row.isActive ? ' is-active' : ''}${row.isMuted ? ' is-muted' : ''}"
                    data-analytics-product-rank-focus-key="${escapeHtml(row.focusKey)}"
                    data-analytics-product-rank-focus-metric="${escapeHtml(activeMetric.key || '')}"
                    style="--analytics-product-rank-bar-width:${Math.min(100, Math.max(0, row.barWidth || 0)).toFixed(2)}%;"
                    aria-pressed="${row.isActive ? 'true' : 'false'}"
                >
                    <span class="analytics-product-rank-board__bar-rank">#${escapeHtml(formatNumber(row.rank || 0))}</span>
                    <span class="analytics-product-rank-board__bar-main">
                        <span class="analytics-product-rank-board__bar-top">
                            <strong title="${escapeHtml(row.productName)}">${escapeHtml(row.productName)}</strong>
                            <span>${escapeHtml(row.metricText)}</span>
                        </span>
                        <span class="analytics-product-rank-board__bar-track">
                            <span class="analytics-product-rank-board__bar-fill"></span>
                        </span>
                        <span class="analytics-product-rank-board__bar-meta">${escapeHtml(row.summaryText)}</span>
                    </span>
                </button>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsProductRankingCompareList(model = {}) {
    const activeMetric = model.activeMetric || {};
    return `
        <div class="analytics-product-rank-board__compare-list">
            ${(Array.isArray(model.rows) ? model.rows : []).map((row) => `
                <button
                    type="button"
                    class="analytics-product-rank-board__compare-row analytics-product-rank-board__compare-row--${escapeHtml(activeMetric.tone || 'neutral')}${row.isActive ? ' is-active' : ''}${row.isMuted ? ' is-muted' : ''}"
                    data-analytics-product-rank-focus-key="${escapeHtml(row.focusKey)}"
                    data-analytics-product-rank-focus-metric="${escapeHtml(activeMetric.key || '')}"
                    aria-pressed="${row.isActive ? 'true' : 'false'}"
                >
                    <span class="analytics-product-rank-board__compare-rank">#${escapeHtml(formatNumber(row.rank || 0))}</span>
                    <span class="analytics-product-rank-board__compare-main">
                        <strong title="${escapeHtml(row.productName)}">${escapeHtml(row.productName)}</strong>
                        <span>${escapeHtml(row.metaItems[0] || row.summaryText || '当前榜单商品')}</span>
                    </span>
                    <span class="analytics-product-rank-board__compare-metric">${escapeHtml(row.metricText)}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsProductRankings(payloads = {}) {
    const model = buildAnalyticsProductRankingsModel(payloads);
    const activeMetric = model.activeMetric || {};
    const activeRow = model.activeRow || null;
    const detailContext = activeRow ? buildAnalyticsProductRankDetailContext(activeMetric.key, activeRow.raw) : null;
    const detailButtonAttrs = detailContext
        ? buildAnalyticsProductDestinationAttrs('analytics-product-detail', detailContext)
        : '';
    const activeGuidance = model.guidance || null;

    return `
        ${renderAnalyticsProductWindowStatusNotice(model.notice, 'warning')}
        <div class="analytics-product-rank-board">
            ${renderAnalyticsProductRankingMetricTabs(model)}
            <div class="analytics-product-rank-board__body">
                <section class="analytics-product-rank-board__chart analytics-product-rank-board__chart--${escapeHtml(activeMetric.tone || 'neutral')}">
                    <div class="analytics-product-rank-board__panel-head">
                        <div>
                            <strong>${escapeHtml(activeMetric.title || '商品榜单')}</strong>
                            <p>${escapeHtml(activeMetric.description || '按当前窗口排序展示商品表现。')}</p>
                        </div>
                        <span class="analytics-product-rank-board__meta">Top ${escapeHtml(formatNumber(model.rows.length || 0))}</span>
                    </div>
                    <div class="analytics-product-rank-board__panel-note">${escapeHtml(model.note || '')}</div>
                    ${renderAnalyticsProductRankingBars(model)}
                </section>
                <aside class="analytics-product-rank-board__inspector analytics-product-rank-board__inspector--${escapeHtml(activeMetric.tone || 'neutral')}">
                    <div class="analytics-product-rank-board__panel-head analytics-product-rank-board__panel-head--stack">
                        <div>
                            <span class="analytics-product-rank-board__eyebrow">${escapeHtml(model.hasFocus ? '聚焦商品' : '榜首商品')}</span>
                            <strong>${escapeHtml(activeRow?.productName || '当前商品')}</strong>
                            <p>${escapeHtml(activeMetric.title || '商品榜单')}</p>
                        </div>
                    </div>
                    ${activeRow ? `
                        <div class="analytics-product-rank-board__hero analytics-product-rank-board__hero--${escapeHtml(activeMetric.tone || 'neutral')}">
                            <div class="analytics-product-rank-board__hero-top">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(activeMetric.tone || 'neutral')}">#${escapeHtml(formatNumber(activeRow.rank || 0))}</span>
                                <span>${escapeHtml(activeMetric.shortLabel || activeMetric.title || '当前指标')}</span>
                            </div>
                            <strong>${escapeHtml(activeRow.metricText)}</strong>
                            <span>${escapeHtml(activeRow.summaryText || '当前榜单暂无补充说明')}</span>
                        </div>
                        <div class="analytics-product-rank-board__chip-list">
                            ${activeRow.metaItems.map((item) => `<span class="analytics-product-rank-board__chip">${escapeHtml(item)}</span>`).join('')}
                        </div>
                    ` : ''}
                    ${activeGuidance ? `
                        <div class="analytics-product-rank-board__guidance">
                            <div class="analytics-product-rank-board__guidance-item">
                                <span>经营判断</span>
                                <p>${escapeHtml(activeGuidance.reason || '当前商品在这组榜单里排位靠前，值得继续观察。')}</p>
                            </div>
                            <div class="analytics-product-rank-board__guidance-item">
                                <span>下一步建议</span>
                                <p>${escapeHtml(activeGuidance.recommendation || '建议进入单品详情继续拆解来源、漏斗和订单承接。')}</p>
                            </div>
                        </div>
                    ` : ''}
                    <div class="analytics-product-rank-board__compare">
                        <div class="analytics-product-rank-board__compare-head">
                            <strong>同榜对比</strong>
                            <span>点击任一商品切换聚焦</span>
                        </div>
                        ${renderAnalyticsProductRankingCompareList(model)}
                    </div>
                    <div class="analytics-product-rank-board__actions">
                        ${detailButtonAttrs ? `
                            <button type="button" class="btn-sm btn-secondary" ${detailButtonAttrs}>
                                <i class="fas fa-up-right-from-square"></i> ${escapeHtml(activeMetric.ctaLabel || '查看单品详情')}
                            </button>
                        ` : ''}
                        <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-products', { tab: 'products' })}>
                            <i class="fas fa-boxes-stacked"></i> 看商品池
                        </button>
                    </div>
                </aside>
            </div>
        </div>
    `;
}

function getAnalyticsProductDetailFocusConfig(detailFocus = '', summary = {}) {
    const normalizedFocus = String(detailFocus || '').trim().toLowerCase();
    if (!normalizedFocus) {
        return null;
    }

    if (normalizedFocus === 'refund-risk') {
        return {
            key: normalizedFocus,
            title: '退款风险聚焦',
            icon: 'fas fa-rotate-left',
            summary: `当前窗口退款 ${formatNumber(summary.refunded_order_count || 0)} 单，退款率 ${formatPercent(summary.refund_rate || 0)}，优先看退款状态拆解与近期订单。`
        };
    }

    if (normalizedFocus === 'delivery-risk') {
        return {
            key: normalizedFocus,
            title: '履约异常聚焦',
            icon: 'fas fa-truck-ramp-box',
            summary: `当前窗口履约风险 ${formatNumber(summary.delivery_risk_count || 0)} 单，发货成功率 ${formatPercent(summary.delivery_success_rate || 0)}，优先看履约状态拆解与订单链路。`
        };
    }

    if (normalizedFocus === 'content-attribution') {
        return {
            key: normalizedFocus,
            title: '内容带货聚焦',
            icon: 'fas fa-wand-magic-sparkles',
            summary: `当前窗口有 ${formatNumber(summary.content_assisted_prompt_count || 0)} 个 Prompt 带货样本，归因支付 ${formatNumber(summary.content_assisted_purchase_success_count || 0)} 单，归因 GMV ${formatNumber(summary.content_assisted_gmv_points || 0)}。`
        };
    }

    return null;
}

function renderAnalyticsProductDetailFocusBanner(detailFocus = '', summary = {}) {
    const config = getAnalyticsProductDetailFocusConfig(detailFocus, summary);
    if (!config) {
        return '';
    }

    return `
        <div class="analytics-secondary-note">
            <i class="${escapeHtml(config.icon || 'fas fa-bullseye')}"></i>
            <span><strong>${escapeHtml(config.title)}</strong> · ${escapeHtml(config.summary || '')}</span>
        </div>
    `;
}

function getAnalyticsProductStatusBreakdownActions(kind = 'refund', item = {}, summary = {}) {
    const normalizedKind = String(kind || 'refund').trim().toLowerCase();
    const productId = String(summary?.product_id || '').trim();
    const productName = String(summary?.product_name || '').trim();
    const query = String(productName || productId || '').trim();
    const status = String(item?.status || '').trim().toLowerCase();
    const statusLabel = String(item?.label || '').trim() || '状态';
    const actions = [];

    if (normalizedKind === 'refund') {
        actions.push(`
            <button
                type="button"
                class="btn-sm btn-secondary analytics-product-inline-action"
                ${buildAnalyticsProductDestinationAttrs('shop-orders', {
                    tab: 'orders',
                    productId,
                    productName,
                    query,
                    refundStatus: status,
                    referenceLabel: '退款状态',
                    referenceValue: statusLabel
                })}
            >
                <i class="fas fa-receipt"></i> 看订单
            </button>
        `);
        actions.push(`
            <button
                type="button"
                class="btn-sm btn-secondary analytics-product-inline-action"
                ${buildAnalyticsProductDestinationAttrs('tickets', {
                    mode: 'pending',
                    workspace: 'queue',
                    status: 'pending',
                    search: query,
                    productId,
                    productName,
                    refundStatus: status,
                    referenceLabel: '退款状态',
                    referenceValue: `${statusLabel}${productName ? ` · ${productName}` : ''}`,
                    focusTargetId: 'ticketsQueueControls'
                })}
            >
                <i class="fas fa-headset"></i> 去售后
            </button>
        `);
        return actions.join('');
    }

    actions.push(`
        <button
            type="button"
            class="btn-sm btn-secondary analytics-product-inline-action"
            ${buildAnalyticsProductDestinationAttrs('shop-fulfillment', {
                tab: 'fulfillment',
                productId,
                productName,
                query,
                deliveryTaskStatus: status,
                deliveryQueryType: 'manual',
                queryLabel: productName || productId || '商品',
                referenceLabel: '履约状态',
                referenceValue: statusLabel
            })}
        >
            <i class="fas fa-truck-fast"></i> 去履约
        </button>
    `);
    actions.push(`
        <button
            type="button"
            class="btn-sm btn-secondary analytics-product-inline-action"
            ${buildAnalyticsProductDestinationAttrs('shop-orders', {
                tab: 'orders',
                productId,
                productName,
                query,
                deliveryStatus: status,
                referenceLabel: '履约状态',
                referenceValue: statusLabel
            })}
        >
            <i class="fas fa-receipt"></i> 看订单
        </button>
    `);
    return actions.join('');
}

function renderAnalyticsProductStatusBreakdownRow(item = {}, options = {}) {
    const siteSummary = String(item?.site_summary || '').trim();
    const tone = String(item?.tone || 'neutral').trim().toLowerCase();
    const indicatorColor = getAnalyticsProductToneIndicatorColor(tone);
    const actionMarkup = getAnalyticsProductStatusBreakdownActions(options.kind, item, options.summary || {});
    return `
        <div class="analytics-product-event-row"${buildAnalyticsProductIndicatorStyle(indicatorColor)}>
            <div class="analytics-product-event-row__meta">
                <strong>${escapeHtml(item?.label || '状态')}</strong>
                <span>${escapeHtml(siteSummary || '当前窗口状态分布')}</span>
            </div>
            <div class="analytics-product-event-row__side">
                <div class="analytics-product-event-row__value">
                    <span class="analytics-status-chip analytics-status-chip--${escapeHtml(tone)}">
                        ${escapeHtml(formatNumber(item?.count || 0))} 单
                    </span>
                    <span>${formatNumber(item?.user_count || 0)} 用户</span>
                </div>
                ${actionMarkup
                    ? `<div class="analytics-product-event-row__actions">${actionMarkup}</div>`
                    : ''}
            </div>
        </div>
    `;
}

function renderAnalyticsProductDeliveryStatusCard(item = {}, options = {}) {
    const siteSummary = String(item?.site_summary || '').trim();
    const tone = String(item?.tone || 'neutral').trim().toLowerCase();
    const indicatorColor = getAnalyticsProductToneIndicatorColor(tone);
    const actionMarkup = getAnalyticsProductStatusBreakdownActions('delivery', item, options.summary || {});
    return `
        <article class="analytics-product-delivery-card analytics-product-delivery-card--${escapeHtml(tone)}"${buildAnalyticsProductIndicatorStyle(indicatorColor)}>
            <div class="analytics-product-delivery-card__top">
                <div class="analytics-product-delivery-card__copy">
                    <strong>${escapeHtml(item?.label || '履约状态')}</strong>
                    <span>${escapeHtml(siteSummary || '当前窗口状态分布')}</span>
                </div>
                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(tone)}">
                    ${escapeHtml(formatNumber(item?.count || 0))} 单
                </span>
            </div>
            <div class="analytics-product-delivery-card__stats">
                <div class="analytics-product-delivery-card__stat">
                    <span>订单</span>
                    <strong>${formatNumber(item?.count || 0)}</strong>
                </div>
                <div class="analytics-product-delivery-card__stat">
                    <span>用户</span>
                    <strong>${formatNumber(item?.user_count || 0)}</strong>
                </div>
            </div>
            ${actionMarkup
                ? `<div class="analytics-product-delivery-card__actions">${actionMarkup}</div>`
                : ''}
        </article>
    `;
}

function renderAnalyticsProductRankSection(title = '', rows = [], emptyMessage = '暂无榜单数据', metricFormatter = () => '', sectionTone = 'default', options = {}) {
    const safeRows = Array.isArray(rows) ? rows.slice(0, 5) : [];
    const indicatorColor = getAnalyticsProductToneIndicatorColor(sectionTone);
    if (safeRows.length === 0) {
        return `
            <article class="analytics-product-rank-card analytics-product-rank-card--${escapeHtml(sectionTone)}"${buildAnalyticsProductIndicatorStyle(indicatorColor)}>
                <div class="analytics-product-rank-card__head">
                    <strong>${escapeHtml(title)}</strong>
                </div>
                ${renderHintState('fas fa-list-ol', emptyMessage)}
            </article>
        `;
    }

    return `
        <article class="analytics-product-rank-card analytics-product-rank-card--${escapeHtml(sectionTone)}"${buildAnalyticsProductIndicatorStyle(indicatorColor)}>
            <div class="analytics-product-rank-card__head">
                <strong>${escapeHtml(title)}</strong>
            </div>
            <div class="analytics-product-rank-list">
                ${safeRows.map((row, index) => {
                    const metaItems = buildAnalyticsProductRankMetaItems(row, options.metaFormatter);
                    const nameButtonOptions = typeof options.nameButtonOptions === 'function'
                        ? options.nameButtonOptions(row, index)
                        : (options.nameButtonOptions && typeof options.nameButtonOptions === 'object' ? options.nameButtonOptions : {});
                    const guidance = typeof options.guidanceBuilder === 'function'
                        ? options.guidanceBuilder(row, index)
                        : null;
                    return `
                        <div class="analytics-product-rank-item">
                            <span class="rank rank-${index + 1}">${index + 1}</span>
                            <div class="analytics-product-rank-item__body">
                                <div class="analytics-product-rank-item__top">
                                    ${renderAnalyticsProductNameButton(row.product_name, row.product_id, nameButtonOptions)}
                                    <span class="analytics-product-rank-item__metric">${metricFormatter(row)}</span>
                                </div>
                                <div class="analytics-product-rank-item__meta">
                                    ${metaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
                                </div>
                                ${renderAnalyticsProductInlineGuidance(guidance)}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </article>
    `;
}

function renderAnalyticsProductHealthList(title = '', rows = [], emptyMessage = '暂无风险商品', metricFormatter = () => '', tone = 'neutral') {
    const safeRows = Array.isArray(rows) ? rows.slice(0, 4) : [];
    return `
        <article class="analytics-product-health-card analytics-product-health-card--${escapeHtml(tone)}">
            <div class="analytics-product-health-card__head">
                <strong>${escapeHtml(title)}</strong>
            </div>
            ${safeRows.length > 0
                ? `<div class="analytics-product-health-list">
                    ${safeRows.map((row) => `
                        <div class="analytics-product-health-item">
                            <div class="analytics-product-health-item__body">
                                ${renderAnalyticsProductNameButton(row.product_name, row.product_id)}
                                <div class="analytics-product-health-item__meta">
                                    <span>${escapeHtml(row.category || '未分类')}</span>
                                    <span>${metricFormatter(row)}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>`
                : renderHintState('fas fa-shield-heart', emptyMessage)}
        </article>
    `;
}

function renderAnalyticsProductHealth(payloads = {}) {
    const hints = Array.isArray(payloads.inventoryTurnoverHints) ? payloads.inventoryTurnoverHints : [];
    return `
        <div class="analytics-product-health-grid">
            ${renderAnalyticsProductHealthList('低库存商品', payloads.lowStockProducts, '当前窗口暂无低库存商品', (row) => `库存 ${formatNumber(row.stock_count || 0)} · 已售 ${formatNumber(row.units_sold || 0)}`, 'warning')}
            ${renderAnalyticsProductHealthList('售罄商品', payloads.soldOutProducts, '当前窗口暂无售罄商品', (row) => `已售 ${formatNumber(row.units_sold || 0)} · 订单 ${formatNumber(row.order_count || 0)}`, 'danger')}
            ${renderAnalyticsProductHealthList('履约风险商品', payloads.deliveryRiskProducts, '当前窗口暂无履约风险商品', (row) => `风险订单 ${formatNumber(row.delivery_risk_count || 0)}`, 'warning')}
            ${renderAnalyticsProductHealthList('退款风险商品', payloads.refundRiskProducts, '当前窗口暂无退款风险商品', (row) => `退款订单 ${formatNumber(row.refunded_order_count || 0)} · 退款率 ${formatPercent(row.refund_rate || 0)}`, 'neutral')}
        </div>
        <div class="analytics-recommendation-stack analytics-product-hint-stack">
            ${hints.length > 0
                ? hints.map((hint) => `
                    <article class="analytics-recommendation-item">
                        <div class="analytics-recommendation-item__top">
                            <span class="analytics-status-chip analytics-status-chip--${hint.tone === 'danger' ? 'danger' : 'warning'}">${hint.tone === 'danger' ? '优先处理' : '建议跟进'}</span>
                            <strong class="analytics-recommendation-item__title">${escapeHtml(hint.title || '库存与履约提示')}</strong>
                        </div>
                        <div class="analytics-recommendation-item__summary">${escapeHtml(hint.summary || '')}</div>
                        <div class="analytics-recommendation-item__actions">
                            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs(
                                hint.tone === 'danger' ? 'shop-fulfillment' : 'shop-inventory',
                                hint.product_id ? { productId: hint.product_id } : null
                            )}>
                                <i class="fas ${hint.tone === 'danger' ? 'fa-truck-fast' : 'fa-warehouse'}"></i> ${hint.tone === 'danger' ? '看履约' : '看库存'}
                            </button>
                        </div>
                    </article>
                `).join('')
                : renderHintState('fas fa-heart-circle-check', '当前窗口暂无库存与履约预警')}
        </div>
        <div class="analytics-product-actions">
            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-inventory', { tab: 'inventory' })}>
                <i class="fas fa-layer-group"></i> 去库存管理
            </button>
            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-fulfillment', { tab: 'fulfillment' })}>
                <i class="fas fa-truck-fast"></i> 去履约处理
            </button>
        </div>
    `;
}

function maybePrimeAnalyticsProductDetail(rows = []) {
    registerAnalyticsProductDetailCandidates(rows);

    if (String(activeAnalyticsProductId || '').trim()) {
        return;
    }

    const candidate = (Array.isArray(rows) ? rows : []).find((row) => String(row?.product_id || '').trim());
    if (!candidate) {
        return;
    }

    if (typeof getAnalyticsActiveTabId === 'function' && getAnalyticsActiveTabId() !== 'product-detail') {
        return;
    }

    openAnalyticsProductDetail(candidate.product_id, {
        productName: candidate.product_name,
        focus: false,
        syncRoute: false
    });
}

function renderAnalyticsProductFunnelStage(stage = {}, baseline = 0) {
    const value = Math.max(0, Number(stage?.value || 0));
    const percentage = baseline > 0 ? Math.max(0, Math.min(100, Math.round((value / baseline) * 100))) : 0;
    const normalizedBasisType = String(stage?.basis_type || '').trim().toLowerCase();
    const basisTone = normalizedBasisType === 'real'
        ? 'success'
        : (normalizedBasisType === 'legacy' ? 'warning' : 'neutral');
    return `
        <div class="analytics-product-funnel-stage">
            <div class="analytics-product-funnel-stage__head">
                <div>
                    <strong>${escapeHtml(stage?.label || '阶段')}</strong>
                    <div class="analytics-product-funnel-stage__meta">${escapeHtml(stage?.note || '')}</div>
                </div>
                <div class="analytics-product-funnel-stage__value">
                    <span>${formatNumber(value)}</span>
                    <span class="analytics-status-chip analytics-status-chip--${basisTone}">${escapeHtml(stage?.basis_label || '口径')}</span>
                </div>
            </div>
            <div class="analytics-product-funnel-stage__bar">
                <span style="width:${percentage}%;"></span>
            </div>
        </div>
    `;
}

function renderAnalyticsProductFunnel(payload = {}) {
    const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : {};
    const stages = Array.isArray(summary.stages) ? summary.stages : [];
    const baseline = Math.max(0, Number(stages.find((stage) => Number(stage?.value || 0) > 0)?.value || stages[0]?.value || 0));
    const siteSnapshots = Array.isArray(payload?.siteComparison?.snapshots) ? payload.siteComparison.snapshots : [];
    const productRows = Array.isArray(payload?.productRows) ? payload.productRows.slice(0, 6) : [];

    const siteMarkup = siteSnapshots.length > 0
        ? siteSnapshots.map((snapshot, index) => {
            const stageSummary = snapshot?.summary && typeof snapshot.summary === 'object' ? snapshot.summary : {};
            const indicatorColor = getAnalyticsProductSiteIndicatorColor(snapshot, index);
            return `
                <article class="analytics-product-site-card analytics-product-site-card--funnel"${buildAnalyticsProductIndicatorStyle(indicatorColor)}>
                    <div class="analytics-product-site-card__top">
                        <strong>${escapeHtml(snapshot.label || snapshot.site || '站点')}</strong>
                        <span class="analytics-status-chip analytics-status-chip--${snapshot.site === payload?.siteComparison?.active_site ? 'warning' : 'neutral'}">${snapshot.site === payload?.siteComparison?.active_site ? '当前视角' : '对照'}</span>
                    </div>
                    <div class="analytics-product-site-card__metrics">
                        <span>详情 ${formatNumber(stageSummary.stages?.[0]?.value || 0)}</span>
                        <span>意图 ${formatNumber(stageSummary.stages?.[1]?.value || 0)}</span>
                        <span>支付 ${formatNumber(stageSummary.stages?.[2]?.value || 0)}</span>
                        <span>发货 ${formatNumber(stageSummary.stages?.[3]?.value || 0)}</span>
                    </div>
                </article>
            `;
        }).join('')
        : renderHintState('fas fa-diagram-project', '暂无站点漏斗对比');

    const productRowsMarkup = productRows.length > 0
        ? productRows.map((row) => `
            <div class="analytics-product-funnel-compare-row">
                <div class="analytics-product-funnel-compare-row__main">
                    ${renderAnalyticsProductNameButton(row.product_name, row.product_id)}
                    <div class="analytics-product-funnel-compare-row__meta">
                        <span>${escapeHtml(row.category || '未分类')}</span>
                        <span>详情 ${formatNumber(row.detail_view_user_count || 0)}</span>
                        <span>意图 ${formatNumber(row.purchase_click_user_count || 0)}</span>
                        <span>支付 ${formatNumber(row.buyer_count || 0)}</span>
                        <span>发货成功 ${formatPercent(row.delivery_success_rate || 0)}</span>
                    </div>
                </div>
                <div class="analytics-product-funnel-compare-row__metric">${formatPercent(row.intent_to_paid_rate || 0)}</div>
            </div>
        `).join('')
        : renderHintState('fas fa-list', '当前窗口暂无商品级漏斗对比');

    return `
        <div class="analytics-product-dashboard">
            <div class="analytics-product-summary-layout">
                <section class="analytics-product-panel analytics-product-panel--funnel">
                    <div class="analytics-product-panel__head">
                        <div>
                            <strong>${summary.product_name ? `${escapeHtml(summary.product_name)} 漏斗` : '全站商品漏斗'}</strong>
                            <p>${escapeHtml(summary.notice || '当前按可用真实事件版漏斗计算')}</p>
                        </div>
                        <span class="analytics-product-panel__meta">${escapeHtml(summary.metric_basis || '商品漏斗口径')}</span>
                    </div>
                    <div class="analytics-product-funnel-stage-list">
                        ${stages.length > 0
                            ? stages.map((stage) => renderAnalyticsProductFunnelStage(stage, baseline)).join('')
                            : renderHintState('fas fa-filter-circle-dollar', '当前窗口暂无商品漏斗数据')}
                    </div>
                    <div class="analytics-product-funnel-risk-strip">
                        <span>卡点击 ${formatNumber(summary.card_click_user_count || 0)}</span>
                        <span>详情到意图 ${formatPercent(summary.detail_to_intent_rate || 0)}</span>
                        <span>意图到支付 ${formatPercent(summary.intent_to_paid_rate || 0)}</span>
                        <span>发货成功 ${formatPercent(summary.delivery_success_rate || 0)}</span>
                        <span>退款率 ${formatPercent(summary.refund_rate || 0)}</span>
                    </div>
                </section>
                <section class="analytics-product-panel analytics-product-panel--comparison">
                    <div class="analytics-product-panel__head">
                        <div>
                            <strong>站点漏斗对比</strong>
                            <p>快速比较 CN / INTL 在详情、购买意图、支付和发货上的差异</p>
                        </div>
                        <span class="analytics-product-panel__meta">真实事件优先</span>
                    </div>
                    <div class="analytics-product-site-grid">
                        ${siteMarkup}
                    </div>
                </section>
            </div>
            <section class="analytics-product-panel analytics-product-panel--compare-list">
                <div class="analytics-product-panel__head">
                    <div>
                        <strong>商品级漏斗对比</strong>
                        <p>优先看详情有流量、但购买意图或支付承接偏弱的商品</p>
                    </div>
                    <span class="analytics-product-panel__meta">按详情用户排序</span>
                </div>
                <div class="analytics-product-funnel-compare-list">
                    ${productRowsMarkup}
                </div>
            </section>
        </div>
    `;
}

function renderAnalyticsProductPromptChip(promptId = '') {
    const safePromptId = String(promptId || '').trim();
    if (!safePromptId) {
        return '';
    }
    return `
        <button
            type="button"
            class="analytics-product-token"
            data-admin-action="analytics-view-context"
            data-prompt-id="${escapeHtml(safePromptId)}"
            title="查看 Prompt ${escapeHtml(safePromptId)} 的上下文"
        >
            Prompt ${escapeHtml(safePromptId)}
        </button>
    `;
}

function renderAnalyticsProductBuyerChip(buyer = {}, context = {}) {
    const userId = String(buyer?.user_id || '').trim();
    if (!userId) {
        return '';
    }

    const safeContext = context && typeof context === 'object' ? context : {};
    const {
        profilesById,
        ...userDetailContext
    } = safeContext;
    const profile = profilesById && typeof profilesById === 'object'
        ? profilesById[userId] || null
        : null;
    const displayLabel = resolveAnalyticsUserDisplayLabel(profile, userId);
    const secondaryLabel = resolveAnalyticsUserSecondaryLabel(profile, userId);
    const segmentLabels = Array.isArray(buyer?.segment_labels)
        ? buyer.segment_labels.filter((label) => String(label || '').trim())
        : [];
    const metaItems = [
        `${formatNumber(buyer.order_count || 0)} 单`,
        `${formatNumber(buyer.gmv_points || 0)} 积分`,
        ...segmentLabels
    ].filter(Boolean);

    return `
        <article class="analytics-product-buyer-row">
            <div class="analytics-product-buyer-row__top">
                <button
                    type="button"
                    class="analytics-product-buyer-row__link"
                    ${buildAnalyticsOpenUserDetailAttrs(userId, {
                        ...userDetailContext,
                        signalLabel: safeContext?.signalLabel || '成交用户',
                        signalValue: `${formatNumber(buyer.order_count || 0)} 单 / ${formatNumber(buyer.gmv_points || 0)} 积分`,
                        feedbackEntityName: displayLabel
                    })}
                    title="查看 ${escapeHtml(displayLabel)} 的用户详情"
                    aria-label="查看 ${escapeHtml(displayLabel)} 的用户详情"
                >
                    <span class="analytics-product-buyer-row__name">${escapeHtml(displayLabel)}</span>
                    <span class="analytics-product-buyer-row__jump">查看详情</span>
                </button>
            </div>
            <div class="analytics-product-buyer-row__meta">
                ${secondaryLabel && secondaryLabel !== displayLabel ? `<span>${escapeHtml(secondaryLabel)}</span>` : ''}
                ${metaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
            </div>
        </article>
    `;
}

function renderAnalyticsProductDestinationActions(row = {}, options = {}) {
    const mode = String(options.mode || 'cross-sell');
    if (mode === 'first-purchase') {
        return '';
    }

    const productId = String(row?.product_id || '').trim();
    const productName = String(row?.product_name || '').trim();
    const query = String(productName || productId || '').trim();
    if (!query) {
        return '';
    }

    const referenceLabel = mode === 'post-purchase' ? '后续复购商品' : '跨商品复购';
    const referenceValue = productName || productId || '商品';

    return `
        <div class="analytics-product-destination-row__actions">
            <button
                type="button"
                class="btn-sm btn-secondary analytics-product-inline-action"
                ${buildAnalyticsProductDestinationAttrs('shop-orders', {
                    tab: 'orders',
                    productId,
                    productName,
                    query,
                    referenceLabel,
                    referenceValue
                })}
            >
                <i class="fas fa-receipt"></i> 看订单
            </button>
            <button
                type="button"
                class="btn-sm btn-secondary analytics-product-inline-action"
                ${buildAnalyticsProductDestinationAttrs('shop-fulfillment', {
                    tab: 'fulfillment',
                    productId,
                    productName,
                    query,
                    deliveryQueryType: 'manual',
                    queryLabel: productName || productId || '商品',
                    referenceLabel,
                    referenceValue
                })}
            >
                <i class="fas fa-truck-fast"></i> 去履约
            </button>
        </div>
    `;
}

function renderAnalyticsProductDestinationRow(row = {}, options = {}) {
    const mode = String(options.mode || 'cross-sell');
    const nameMarkup = (mode === 'first-purchase' || mode === 'post-purchase') && row?.is_current_product
        ? `<span class="analytics-product-link-label">${escapeHtml(row?.product_name || '本商品')}</span>`
        : renderAnalyticsProductNameButton(row?.product_name, row?.product_id, {
            detailContext: {
                detailFocus: 'content-breakdown',
                focusTargetId: 'productDetailPanelSection'
            },
            title: `查看 ${row?.product_name || '商品'} 的单品详情`
        });

    const metaItems = mode === 'first-purchase'
        ? [
            row?.is_current_product ? '首单入口' : '首单落在其他商品',
            `${formatNumber(row?.user_count || 0)} 用户`
        ]
        : mode === 'post-purchase'
            ? [
                row?.is_current_product ? '本商品复购' : '后续购买',
                `${formatNumber(row?.user_count || 0)} 用户`,
                `${formatNumber(row?.order_count || 0)} 单`,
                row?.first_followup_at ? `最早 ${formatDate(row.first_followup_at)}` : ''
            ].filter(Boolean)
            : [
            `${formatNumber(row?.user_count || 0)} 用户`,
            `${formatNumber(row?.order_count || 0)} 单`,
            `GMV ${formatNumber(row?.gmv_points || 0)}`
        ];

    const metricText = mode === 'first-purchase'
        ? `${formatNumber(row?.user_count || 0)} 用户`
        : mode === 'post-purchase'
            ? `GMV ${formatNumber(row?.gmv_points || 0)}`
            : `${formatNumber(row?.order_count || 0)} 单`;
    const actionMarkup = renderAnalyticsProductDestinationActions(row, { mode });

    return `
        <div class="analytics-product-destination-row">
            <div class="analytics-product-destination-row__main">
                ${nameMarkup}
                <div class="analytics-product-destination-row__meta">
                    ${metaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
                </div>
            </div>
            <div class="analytics-product-destination-row__side">
                <div class="analytics-product-destination-row__metric">${escapeHtml(metricText)}</div>
                ${actionMarkup}
            </div>
        </div>
    `;
}

function renderAnalyticsProductStaticSourceRow(item = {}, options = {}) {
    const label = String(item?.label || item?.title || '').trim();
    if (!label) {
        return '';
    }

    const typeLabel = String(options?.typeLabel || '').trim();
    const metaParts = [];
    if (Number(item?.count || 0) > 0) {
        metaParts.push(`${formatNumber(item.count || 0)} 次`);
    }
    if (Number(item?.user_count || 0) > 0) {
        metaParts.push(`${formatNumber(item.user_count || 0)} 用户`);
    }

    return `
        <div class="analytics-product-source-row">
            <div class="analytics-product-source-row__main">
                ${typeLabel ? `<span class="analytics-product-source-row__eyebrow">${escapeHtml(typeLabel)}</span>` : ''}
                <span class="analytics-product-source-row__label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            </div>
            ${metaParts.length > 0
                ? `<div class="analytics-product-source-row__meta">${metaParts.map((itemText) => `<span>${escapeHtml(itemText)}</span>`).join('')}</div>`
                : ''}
        </div>
    `;
}

function renderAnalyticsProductPromptSourceRow(source = {}, options = {}) {
    const promptId = String(source?.prompt_id || '').trim();
    if (!promptId) {
        return '';
    }

    const typeLabel = String(options?.typeLabel || '').trim();
    const metaParts = [];
    if (Number(source?.count || 0) > 0) {
        metaParts.push(`${formatNumber(source.count || 0)} 次来源`);
    }
    if (Number(source?.user_count || 0) > 0) {
        metaParts.push(`${formatNumber(source.user_count || 0)} 用户`);
    }

    return `
        <div class="analytics-product-source-row">
            <div class="analytics-product-source-row__main">
                ${typeLabel ? `<span class="analytics-product-source-row__eyebrow">${escapeHtml(typeLabel)}</span>` : ''}
                <button
                    type="button"
                    class="analytics-product-link analytics-product-link--compact analytics-product-source-row__link"
                    data-admin-action="analytics-view-context"
                    data-prompt-id="${escapeHtml(promptId)}"
                    title="查看 Prompt ${escapeHtml(promptId)} 的上下文"
                >
                    Prompt ${escapeHtml(promptId)}
                </button>
            </div>
            ${metaParts.length > 0
                ? `<div class="analytics-product-source-row__meta">${metaParts.map((itemText) => `<span>${escapeHtml(itemText)}</span>`).join('')}</div>`
                : ''}
        </div>
    `;
}

function renderAnalyticsProductCommerceFlowStep(options = {}) {
    const label = String(options?.label || '').trim() || '带货链路';
    const value = String(options?.value ?? '--').trim() || '--';
    const note = String(options?.note || '').trim();
    const caption = String(options?.caption || '').trim();
    const tone = String(options?.tone || 'default').trim() || 'default';
    const indexLabel = String(options?.index || '').trim();

    return `
        <article class="analytics-product-flow-step analytics-product-flow-step--${escapeHtml(tone)}">
            ${indexLabel ? `<span class="analytics-product-flow-step__index">${escapeHtml(indexLabel)}</span>` : ''}
            <div class="analytics-product-flow-step__body">
                <span class="analytics-product-flow-step__label">${escapeHtml(label)}</span>
                <strong class="analytics-product-flow-step__value">${escapeHtml(value)}</strong>
                ${note ? `<span class="analytics-product-flow-step__note">${escapeHtml(note)}</span>` : ''}
                ${caption ? `<p class="analytics-product-flow-step__caption">${escapeHtml(caption)}</p>` : ''}
            </div>
        </article>
    `;
}

function renderAnalyticsProductAttributionGroup(options = {}) {
    const items = Array.isArray(options?.items) ? options.items.filter(Boolean) : [];
    const title = String(options?.title || '').trim() || '来源分组';
    const summary = String(options?.summary || '').trim();
    const countLabel = String(options?.countLabel || '').trim();
    const icon = String(options?.icon || 'fas fa-compass-drafting').trim();
    const emptyIcon = String(options?.emptyIcon || 'fas fa-circle-question').trim();
    const emptyText = String(options?.emptyText || '当前窗口暂无样本').trim();
    const className = [
        'analytics-product-attribution-group',
        options?.feature ? 'analytics-product-attribution-group--feature' : '',
        String(options?.className || '').trim()
    ].filter(Boolean).join(' ');

    return `
        <section class="${escapeHtml(className)}">
            <div class="analytics-product-attribution-group__head">
                <span class="analytics-product-attribution-group__icon" aria-hidden="true">
                    <i class="${escapeHtml(icon)}"></i>
                </span>
                <div class="analytics-product-attribution-group__copy">
                    <strong>${escapeHtml(title)}</strong>
                    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
                </div>
                ${countLabel ? `<span class="analytics-product-attribution-group__count">${escapeHtml(countLabel)}</span>` : ''}
            </div>
            <div class="analytics-product-source-list analytics-product-source-list--empty-centered">
                ${items.length > 0 ? items.join('') : renderHintState(emptyIcon, emptyText)}
            </div>
        </section>
    `;
}

function renderAnalyticsProductPromptAttributionRow(source = {}) {
    const promptId = String(source?.prompt_id || '').trim();
    if (!promptId) {
        return '';
    }

    return `
        <div class="analytics-product-prompt-row">
            <div class="analytics-product-prompt-row__main">
                <button
                    type="button"
                    class="analytics-product-link analytics-product-link--compact"
                    data-admin-action="analytics-view-context"
                    data-prompt-id="${escapeHtml(promptId)}"
                    title="查看 Prompt ${escapeHtml(promptId)} 的上下文"
                >
                    Prompt ${escapeHtml(promptId)}
                </button>
                <div class="analytics-product-prompt-row__meta">
                    <span>来源触达 ${formatNumber(source?.count || 0)}</span>
                    <span>详情 ${formatNumber(source?.detail_view_count || 0)}</span>
                    <span>意图 ${formatNumber(source?.purchase_click_count || 0)}</span>
                    <span>支付 ${formatNumber(source?.purchase_success_count || 0)}</span>
                </div>
            </div>
            <div class="analytics-product-prompt-row__metric">
                <span>归因 GMV</span>
                <strong>${formatNumber(source?.gmv_points || 0)}</strong>
            </div>
        </div>
    `;
}

function renderAnalyticsProductEventStageRow(stage = {}) {
    const label = String(stage?.label || '').trim() || '事件阶段';
    const basis = String(stage?.basis || '').trim();
    const basisLabel = String(stage?.basis_label || '').trim();
    const normalizedStatus = String(stage?.status || 'collecting').trim().toLowerCase();
    const statusLabel = normalizedStatus === 'ready'
        ? '已采集'
        : (normalizedStatus === 'legacy' ? '兼容' : '开始采集中');

    return `
        <div class="analytics-product-event-row">
            <div class="analytics-product-event-row__meta">
                <strong>${escapeHtml(label)}</strong>
                <span>${escapeHtml([basisLabel, basis].filter(Boolean).join(' · ') || '商品事件采集状态')}</span>
            </div>
            <div class="analytics-product-event-row__value">
                <span class="analytics-product-stage-badge analytics-product-stage-badge--${escapeHtml(normalizedStatus)}">${escapeHtml(statusLabel)}</span>
                <span>${formatNumber(stage?.count || 0)} 次 / ${formatNumber(stage?.user_count || 0)} 用户</span>
            </div>
        </div>
    `;
}

function renderAnalyticsProductOrderRow(order = {}, context = {}) {
    const orderId = String(order?.order_id || '').trim();
    const userId = String(order?.user_id || '').trim();
    return `
        <div class="analytics-product-order-row">
            <div class="analytics-product-order-row__main">
                <button type="button" class="analytics-product-link analytics-product-link--compact" ${buildAnalyticsProductDestinationAttrs('shop-orders', { tab: 'orders', orderId })} title="打开订单 ${escapeHtml(orderId)}">
                    订单 ${escapeHtml(orderId || '—')}
                </button>
                <div class="analytics-product-order-row__meta">
                    <span>${escapeHtml((order.site || 'all').toUpperCase())}</span>
                    <span>${formatNumber(order.quantity || 0)} 件</span>
                    <span>${formatNumber(order.total_points || 0)} 积分</span>
                    <span>${escapeHtml(order.delivery_status || 'unknown')}</span>
                    <span>${escapeHtml(order.refund_status || 'none')}</span>
                </div>
            </div>
            ${userId
                ? `<button
                        type="button"
                        class="analytics-product-token analytics-product-token--user analytics-product-token--inline"
                        ${buildAnalyticsOpenUserDetailAttrs(userId, {
                            ...context,
                            signalLabel: context?.signalLabel || '订单用户',
                            signalValue: `${formatNumber(order.quantity || 0)} 件 / ${formatNumber(order.total_points || 0)} 积分`,
                            referenceLabel: context?.referenceLabel || '订单',
                            referenceValue: orderId || '近期订单'
                        })}
                        title="查看 ${escapeHtml(userId)} 的用户详情"
                    >${escapeHtml(userId)}</button>`
                : ''}
        </div>
    `;
}

function renderAnalyticsProductDetailPanel(payload = {}, options = {}) {
    const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : {};
    const trendRows = Array.isArray(payload?.trend) ? payload.trend.slice(-7).reverse() : [];
    const funnelSummary = payload?.funnel?.summary && typeof payload.funnel.summary === 'object'
        ? payload.funnel.summary
        : {};
    const recentOrders = Array.isArray(payload?.recentOrders) ? payload.recentOrders.slice(0, 6) : [];
    const buyerSnapshot = Array.isArray(summary.buyer_snapshot) ? summary.buyer_snapshot : [];
    const buyerProfilesById = options?.buyerProfilesById && typeof options.buyerProfilesById === 'object'
        ? options.buyerProfilesById
        : {};
    const buyerSegmentSummary = Array.isArray(summary.buyer_segment_summary) ? summary.buyer_segment_summary : [];
    const firstPurchaseDestinations = Array.isArray(summary.first_purchase_destinations) ? summary.first_purchase_destinations.slice(0, 5) : [];
    const crossSellDestinations = Array.isArray(summary.cross_sell_destinations) ? summary.cross_sell_destinations.slice(0, 5) : [];
    const postPurchaseDestinations = Array.isArray(summary.post_purchase_destinations) ? summary.post_purchase_destinations.slice(0, 5) : [];
    const promptIds = Array.isArray(summary.related_prompt_ids) ? summary.related_prompt_ids : [];
    const sourcePages = Array.isArray(summary.source_pages) ? summary.source_pages.slice(0, 5) : [];
    const sourceChannels = Array.isArray(summary.source_channels) ? summary.source_channels.slice(0, 5) : [];
    const promptSources = Array.isArray(summary.prompt_sources) ? summary.prompt_sources.slice(0, 5) : [];
    const refundBreakdown = Array.isArray(summary.refund_breakdown) ? summary.refund_breakdown : [];
    const deliveryBreakdown = Array.isArray(summary.delivery_breakdown) ? summary.delivery_breakdown : [];
    const eventStageSummary = Array.isArray(summary.event_stage_summary) ? summary.event_stage_summary : [];
    const siteSnapshots = Array.isArray(summary.site_snapshots) ? summary.site_snapshots : [];
    const detailFocus = String(options.detailFocus || '').trim();
    const focusBanner = renderAnalyticsProductDetailFocusBanner(detailFocus, summary);
    const productFeedbackEntries = getAnalyticsResolutionFeedbackEntriesForProduct({
        productId: summary.product_id || options.productId || '',
        productName: summary.product_name || options.productName || ''
    });
    const conclusionDigestMarkup = renderAnalyticsProductConclusionDigest(productFeedbackEntries, summary);
    const writebackMarkup = renderAnalyticsResolutionFeedbackNote({
        productId: summary.product_id || options.productId || '',
        productName: summary.product_name || options.productName || '',
        limit: 3
    });
    const conclusionHistoryMarkup = renderAnalyticsProductConclusionHistory({
        productId: summary.product_id || options.productId || '',
        productName: summary.product_name || options.productName || '',
        limit: 6,
        layout: 'wide'
    });
    const productId = String(summary.product_id || options.productId || '').trim();
    const productName = String(summary.product_name || options.productName || '').trim();
    const contentFocusSources = [
        summary.top_source_page ? renderAnalyticsProductStaticSourceRow(summary.top_source_page, { typeLabel: '来源页面' }) : '',
        summary.top_source_channel ? renderAnalyticsProductStaticSourceRow(summary.top_source_channel, { typeLabel: '来源渠道' }) : '',
        summary.top_prompt_source ? renderAnalyticsProductPromptSourceRow(summary.top_prompt_source, { typeLabel: '来源 Prompt' }) : ''
    ].filter(Boolean);
    const sourceAttributionGroups = [
        renderAnalyticsProductAttributionGroup({
            icon: 'fas fa-map-signs',
            title: '来源页面',
            summary: '用户最先进入的页面位置',
            countLabel: `${formatNumber(sourcePages.length)} 个入口`,
            items: sourcePages.map((item) => renderAnalyticsProductStaticSourceRow(item)),
            emptyIcon: 'fas fa-map-signs',
            emptyText: '当前窗口暂无来源页面样本'
        }),
        renderAnalyticsProductAttributionGroup({
            icon: 'fas fa-route',
            title: '来源渠道',
            summary: '把页面流量带进来的渠道',
            countLabel: `${formatNumber(sourceChannels.length)} 条渠道`,
            items: sourceChannels.map((item) => renderAnalyticsProductStaticSourceRow(item)),
            emptyIcon: 'fas fa-route',
            emptyText: '当前窗口暂无来源渠道样本'
        }),
        renderAnalyticsProductAttributionGroup({
            icon: 'fas fa-wand-magic-sparkles',
            title: '来源 Prompt',
            summary: '真正带来归因的内容入口',
            countLabel: `${formatNumber(promptSources.length)} 个 Prompt`,
            items: promptSources.map((item) => renderAnalyticsProductPromptSourceRow(item)),
            emptyIcon: 'fas fa-wand-magic-sparkles',
            emptyText: '当前窗口暂无来源 Prompt'
        })
    ];
    const contentFlowSteps = [
        renderAnalyticsProductCommerceFlowStep({
            index: '01',
            label: '来源 Prompt',
            value: formatNumber(summary.content_assisted_prompt_count || 0),
            note: `主 Prompt ${summary.top_prompt_id || '—'}`,
            caption: '先看哪些内容入口真正带来成交归因',
            tone: 'default'
        }),
        renderAnalyticsProductCommerceFlowStep({
            index: '02',
            label: '详情触达',
            value: formatNumber(summary.content_assisted_detail_view_count || 0),
            note: `购买意图 ${formatNumber(summary.content_assisted_purchase_click_count || 0)}`,
            caption: '内容带来的详情访问是否继续走向意图',
            tone: 'accent'
        }),
        renderAnalyticsProductCommerceFlowStep({
            index: '03',
            label: '归因支付',
            value: formatNumber(summary.content_assisted_purchase_success_count || 0),
            note: `归因 GMV ${formatNumber(summary.content_assisted_gmv_points || 0)}`,
            caption: '最终是否沉淀成支付和 GMV',
            tone: 'success'
        })
    ];
    const detailSectionItems = [
        {
            key: 'operating',
            label: '经营概览',
            summary: '漏斗、站点、来源与带货拆解',
            metric: `Prompt ${formatNumber(promptIds.length)}`,
            icon: 'fas fa-chart-line',
            targetId: 'productDetailSectionOperating'
        },
        {
            key: 'risk',
            label: '风险与履约',
            summary: '退款、履约、复查与采集状态',
            metric: `风险 ${formatNumber(summary.delivery_risk_count || 0)}`,
            icon: 'fas fa-triangle-exclamation',
            targetId: 'productDetailSectionRisk'
        },
        {
            key: 'user',
            label: '用户承接',
            summary: '买家样本、分层与后续去向',
            metric: `买家 ${formatNumber(summary.buyer_count || buyerSnapshot.length || 0)}`,
            icon: 'fas fa-user-group',
            targetId: 'productDetailSectionUsers'
        },
        {
            key: 'trend',
            label: '趋势与订单',
            summary: '近窗波动、Prompt 明细与近期订单',
            metric: `订单 ${formatNumber(recentOrders.length)}`,
            icon: 'fas fa-wave-square',
            targetId: 'productDetailSectionTrend'
        }
    ];
    const activeDetailSectionId = detailSectionItems.some((item) => item.targetId === String(options.focusTargetId || '').trim())
        ? String(options.focusTargetId || '').trim()
        : detailSectionItems[0].targetId;
    const detailNavigatorMarkup = renderAnalyticsProductDetailNavigator(detailSectionItems, {
        activeTargetId: activeDetailSectionId,
        productId,
        productName
    });
    const detailSelectorMarkup = renderAnalyticsProductDetailSelector({
        productId,
        productName,
        detailFocus,
        focusTargetId: activeDetailSectionId
    });
    const detailActionsMarkup = `
        <div class="analytics-product-actions analytics-product-detail__actions">
            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('analytics-product', {
                sectionId: 'productOverviewSection',
                focusTargetId: 'productOverviewSection'
            })}>
                <i class="fas fa-arrow-left"></i> 商品经营
            </button>
            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-products', { tab: 'products', productId: summary.product_id })}>
                <i class="fas fa-pen-to-square"></i> 商品编辑
            </button>
            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-inventory', { tab: 'inventory', productId: summary.product_id })}>
                <i class="fas fa-layer-group"></i> 库存列表
            </button>
            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-orders', { tab: 'orders' })}>
                <i class="fas fa-receipt"></i> 订单列表
            </button>
            <button type="button" class="btn-sm btn-secondary" ${buildAnalyticsProductDestinationAttrs('shop-fulfillment', { tab: 'fulfillment' })}>
                <i class="fas fa-truck-fast"></i> 履约任务
            </button>
        </div>
    `;
    const detailInsightsMarkup = [focusBanner, conclusionDigestMarkup, writebackMarkup].filter(Boolean).length > 0
        ? `
            <div class="analytics-product-detail__insights">
                ${focusBanner ? `<div class="analytics-product-detail__insight-item analytics-product-detail__insight-item--note">${focusBanner}</div>` : ''}
                ${conclusionDigestMarkup ? `<div class="analytics-product-detail__insight-item analytics-product-detail__insight-item--digest">${conclusionDigestMarkup}</div>` : ''}
                ${writebackMarkup ? `<div class="analytics-product-detail__insight-item analytics-product-detail__insight-item--writeback">${writebackMarkup}</div>` : ''}
            </div>
        `
        : '';
    const detailFocusConfig = getAnalyticsProductDetailFocusConfig(detailFocus, summary);
    const sellingStatusLabel = summary.is_active === false ? '已停用' : '在售中';
    const sellingStatusTone = summary.is_active === false ? 'neutral' : 'success';
    const headerSummaryText = [
        detailFocusConfig ? `当前聚焦 ${detailFocusConfig.title}` : '',
        Number(summary.order_count || 0) > 0
            ? `订单 ${formatNumber(summary.order_count || 0)} 单`
            : (Number(summary.purchase_click_user_count || 0) > 0
                ? `购买意图 ${formatNumber(summary.purchase_click_user_count || 0)} 用户`
                : '当前窗口优先查看趋势、来源归因和库存履约承接'),
        Number(summary.gmv_points || 0) > 0 ? `GMV ${formatNumber(summary.gmv_points || 0)}` : '',
        Number(summary.delivery_risk_count || 0) > 0 ? `履约风险 ${formatNumber(summary.delivery_risk_count || 0)} 单` : ''
    ].filter(Boolean).join(' · ');
    const headerIdentityItems = [
        String(summary.category || '').trim() || '未分类',
        String(summary.delivery_type || '').trim() || 'KEY',
        productId ? `商品 ID ${productId}` : '',
        siteSnapshots.length > 0 ? `站点 ${formatNumber(siteSnapshots.length)}` : '',
        promptIds.length > 0 ? `Prompt ${formatNumber(promptIds.length)}` : ''
    ].filter(Boolean);
    const headerStats = [
        {
            label: '浏览用户',
            value: formatNumber(summary.view_user_count || 0),
            note: `浏览 ${formatNumber(summary.view_count || 0)} 次`,
            tone: 'default'
        },
        {
            label: '支付成功',
            value: formatNumber(summary.buyer_count || 0),
            note: `订单 ${formatNumber(summary.order_count || 0)}`,
            tone: 'accent'
        },
        {
            label: '积分 GMV',
            value: formatNumber(summary.gmv_points || 0),
            note: `客单价 ${formatNumber(summary.avg_order_value || 0)}`,
            tone: 'success'
        },
        {
            label: '支付转化',
            value: formatPercent(summary.conversion_rate || 0),
            note: `退款率 ${formatPercent(summary.refund_rate || 0)}`,
            tone: 'warning'
        },
        {
            label: '发货成功',
            value: formatPercent(summary.delivery_success_rate || 0),
            note: `履约风险 ${formatNumber(summary.delivery_risk_count || 0)}`,
            tone: 'danger'
        },
        {
            label: '库存可用',
            value: formatNumber(summary.available_inventory_count || 0),
            note: `故障库存 ${formatNumber(summary.fault_inventory_count || 0)}`,
            tone: 'default'
        }
    ];
    const funnelCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--feature analytics-product-detail-card--operating-main">
            <div class="analytics-product-detail-card__head">
                <strong>单品漏斗</strong>
                <span>真实口径</span>
            </div>
            <div class="analytics-product-funnel-stage-list analytics-product-funnel-stage-list--compact">
                ${(Array.isArray(funnelSummary.stages) ? funnelSummary.stages : []).map((stage, index, rows) => (
                    renderAnalyticsProductFunnelStage(stage, Math.max(0, Number(rows[0]?.value || 0)))
                )).join('') || renderHintState('fas fa-filter-circle-dollar', '当前窗口暂无单品漏斗数据')}
            </div>
        </section>
    `;
    const siteBreakdownCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--operating-side">
            <div class="analytics-product-detail-card__head">
                <strong>站点拆分</strong>
                <span>CN / INTL</span>
            </div>
            <div class="analytics-product-site-grid analytics-product-site-grid--detail">
                ${siteSnapshots.map((snapshot, index) => `
                    <article class="analytics-product-site-card"${buildAnalyticsProductIndicatorStyle(getAnalyticsProductSiteIndicatorColor(snapshot, index))}>
                        <div class="analytics-product-site-card__top">
                            <strong>${escapeHtml(snapshot.label || snapshot.site || '站点')}</strong>
                        </div>
                        <div class="analytics-product-site-card__metrics">
                            <span>GMV ${formatNumber(snapshot.summary?.gmv_points || 0)}</span>
                            <span>订单 ${formatNumber(snapshot.summary?.order_count || 0)}</span>
                            <span>买家 ${formatNumber(snapshot.summary?.buyer_count || 0)}</span>
                            <span>转化 ${formatPercent(snapshot.summary?.purchase_conversion_rate || 0)}</span>
                        </div>
                    </article>
                `).join('') || renderHintState('fas fa-diagram-project', '暂无站点拆分')}
            </div>
        </section>
    `;
    const relatedPromptCard = `
        <section class="analytics-product-detail-card">
            <div class="analytics-product-detail-card__head">
                <strong>相关 Prompt</strong>
                <span>${formatNumber(promptIds.length)} 个</span>
            </div>
            <div class="analytics-product-token-list analytics-product-token-list--empty-centered">
                ${promptIds.length > 0
                    ? promptIds.map((promptId) => renderAnalyticsProductPromptChip(promptId)).join('')
                    : renderHintState('fas fa-wand-magic-sparkles', '当前窗口暂无关联 Prompt')}
            </div>
        </section>
    `;
    const sourceAttributionCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--feature analytics-product-detail-card--operating-main">
            <div class="analytics-product-detail-card__head">
                <strong>来源归因</strong>
                <span>${formatNumber(sourcePages.length + sourceChannels.length + promptSources.length)} 组</span>
            </div>
            <div class="analytics-product-window-notice">
                <i class="fas fa-sitemap" aria-hidden="true"></i>
                <span>先看用户从哪个页面进来，再看通过哪条渠道和哪个 Prompt 形成支付归因。</span>
            </div>
            <div class="analytics-product-attribution-grid">
                ${sourceAttributionGroups.join('')}
            </div>
        </section>
    `;
    const contentBreakdownCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--feature analytics-product-detail-card--operating-secondary" id="productContentBreakdownSection">
            <div class="analytics-product-detail-card__head">
                <strong>内容带货拆解</strong>
                <span>来源 / Prompt / GMV</span>
            </div>
            <div class="analytics-product-window-notice analytics-product-window-notice--success">
                <i class="fas fa-circle-nodes" aria-hidden="true"></i>
                <span>先确认内容带货有没有从入口走到支付，再回头看是哪一类来源真正有效。</span>
            </div>
            <div class="analytics-product-flow-board">
                ${contentFlowSteps.map((stepMarkup, index, rows) => (
                    index < rows.length - 1
                        ? `${stepMarkup}<div class="analytics-product-flow-connector" aria-hidden="true"><span></span><i class="fas fa-arrow-right"></i></div>`
                        : stepMarkup
                )).join('')}
            </div>
            ${renderAnalyticsProductAttributionGroup({
                feature: true,
                icon: 'fas fa-bullseye',
                title: '关键来源',
                summary: '当前窗口里真正推动成交的页面、渠道和 Prompt',
                countLabel: `${formatNumber(contentFocusSources.length)} 类来源`,
                items: contentFocusSources,
                emptyIcon: 'fas fa-wand-magic-sparkles',
                emptyText: '当前窗口暂无内容带货来源样本'
            })}
        </section>
    `;
    const operatingAttributionStack = `
        <div class="analytics-product-detail-stack analytics-product-detail-stack--operating-context">
            ${sourceAttributionCard}
            ${relatedPromptCard}
        </div>
    `;
    const riskBreakdownCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--risk-main" id="productRiskBreakdownSection">
            <div class="analytics-product-detail-card__head">
                <strong>售后与履约拆解</strong>
                <span>退款 / 履约状态</span>
            </div>
            <div class="analytics-product-detail-subsection">
                <div class="analytics-product-detail-subsection__label">退款状态</div>
                <div class="analytics-product-event-list">
                    ${refundBreakdown.length > 0
                        ? refundBreakdown.map((item) => renderAnalyticsProductStatusBreakdownRow(item, {
                            kind: 'refund',
                            summary
                        })).join('')
                        : renderHintState('fas fa-rotate-left', '当前窗口暂无退款样本')}
                </div>
            </div>
            <div class="analytics-product-detail-subsection">
                <div class="analytics-product-detail-subsection__label">履约状态</div>
                <div class="analytics-product-delivery-grid analytics-product-delivery-grid--empty-centered">
                    ${deliveryBreakdown.length > 0
                        ? deliveryBreakdown.map((item) => renderAnalyticsProductDeliveryStatusCard(item, {
                            summary
                        })).join('')
                        : renderHintState('fas fa-truck-fast', '当前窗口暂无履约状态样本')}
                </div>
            </div>
        </section>
    `;
    const eventStageCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--risk-side">
            <div class="analytics-product-detail-card__head">
                <strong>事件采集状态</strong>
                <span>${formatNumber(eventStageSummary.length)} 段</span>
            </div>
            <div class="analytics-product-event-list">
                ${eventStageSummary.length > 0
                    ? eventStageSummary.map((stage) => renderAnalyticsProductEventStageRow(stage)).join('')
                    : renderHintState('fas fa-wave-square', '当前窗口暂无商品事件采集摘要')}
            </div>
        </section>
    `;
    const buyerCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--feature analytics-product-detail-card--users-main">
            <div class="analytics-product-detail-card__head">
                <strong>购买用户</strong>
                <span>${formatNumber(buyerSnapshot.length)} 个样本</span>
            </div>
            <div class="analytics-product-buyer-list">
                ${buyerSnapshot.length > 0
                    ? buyerSnapshot.map((buyer) => renderAnalyticsProductBuyerChip(buyer, {
                        profilesById: buyerProfilesById,
                        sourceLabel: '商品详情 / 购买用户',
                        summary: '该用户来自当前单品的成交样本，适合继续回看单品成交、退款和履约承接是否稳定。',
                        productId: String(summary.product_id || options.productId || '').trim(),
                        productName: String(summary.product_name || options.productName || '').trim(),
                        destination: 'analytics-product-detail',
                        destinationContext: {
                            productId: String(summary.product_id || options.productId || '').trim(),
                            productName: String(summary.product_name || options.productName || '').trim(),
                            focusTargetId: 'productDetailPanelSection'
                        },
                        actionLabel: '回到单品详情',
                        verificationMethod: '回到单品详情，继续查看成交、退款和履约拆解，确认这位用户对应的经营信号是否已经收口。'
                    })).join('')
                    : renderHintState('fas fa-user-group', '当前窗口暂无购买用户样本')}
            </div>
        </section>
    `;
    const buyerSegmentCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--users-segments">
            <div class="analytics-product-detail-card__head">
                <strong>购买用户分层</strong>
                <span>当前窗口</span>
            </div>
            <div class="analytics-product-metric-grid analytics-product-metric-grid--detail">
                ${buyerSegmentSummary.length > 0
                    ? buyerSegmentSummary.map((item) => (
                        renderAnalyticsProductMetricCard(item.label || '用户分层', formatNumber(item.count || 0), item.note || '', item.tone || 'default')
                    )).join('')
                    : renderHintState('fas fa-people-arrows', '当前窗口暂无购买用户分层样本')}
            </div>
        </section>
    `;
    const userDestinationCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--wide analytics-product-detail-card--users-destination">
            <div class="analytics-product-detail-card__head">
                <strong>用户去向</strong>
                <span>首单入口 / 跨商品复购</span>
            </div>
            <div class="analytics-product-detail-subsection">
                <div class="analytics-product-detail-subsection__label">首单入口分布</div>
                <div class="analytics-product-destination-list">
                    ${firstPurchaseDestinations.length > 0
                        ? firstPurchaseDestinations.map((row) => renderAnalyticsProductDestinationRow(row, { mode: 'first-purchase' })).join('')
                        : renderHintState('fas fa-compass', '当前窗口暂无首单入口样本')}
                </div>
            </div>
            <div class="analytics-product-detail-subsection">
                <div class="analytics-product-detail-subsection__label">跨商品复购去向</div>
                <div class="analytics-product-destination-list">
                    ${crossSellDestinations.length > 0
                        ? crossSellDestinations.map((row) => renderAnalyticsProductDestinationRow(row, { mode: 'cross-sell' })).join('')
                        : renderHintState('fas fa-arrows-left-right-to-line', '当前窗口暂无跨商品复购样本')}
                </div>
            </div>
            <div class="analytics-product-detail-subsection">
                <div class="analytics-product-detail-subsection__label">后续复购商品</div>
                <div class="analytics-product-destination-list">
                    ${postPurchaseDestinations.length > 0
                        ? postPurchaseDestinations.map((row) => renderAnalyticsProductDestinationRow(row, { mode: 'post-purchase' })).join('')
                        : renderHintState('fas fa-timeline', '当前窗口暂无后续复购样本')}
                </div>
            </div>
        </section>
    `;
    const promptAttributionCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--trend-side">
            <div class="analytics-product-detail-card__head">
                <strong>来源 Prompt 归因明细</strong>
                <span>${formatNumber(promptSources.length)} 条</span>
            </div>
            <div class="analytics-product-prompt-list">
                ${promptSources.length > 0
                    ? promptSources.map((item) => renderAnalyticsProductPromptAttributionRow(item)).join('')
                    : renderHintState('fas fa-wand-magic-sparkles', '当前窗口暂无来源 Prompt 归因明细')}
            </div>
        </section>
    `;
    const trendCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--feature analytics-product-detail-card--trend-main">
            <div class="analytics-product-detail-card__head">
                <strong>近窗趋势</strong>
                <span>最近 ${formatNumber(trendRows.length)} 天</span>
            </div>
            <div class="analytics-product-trend-list">
                ${trendRows.length > 0
                    ? trendRows.map((row) => `
                        <div class="analytics-product-trend-row">
                            <span>${escapeHtml(formatDate(row.day))}</span>
                            <span>浏览 ${formatNumber(row.view_count || 0)}</span>
                            <span>订单 ${formatNumber(row.order_count || 0)}</span>
                            <span>GMV ${formatNumber(row.gmv_points || 0)}</span>
                            <span>发货 ${formatNumber(row.delivery_success_count || 0)}</span>
                        </div>
                    `).join('')
                    : renderHintState('fas fa-chart-line', '当前窗口暂无单品趋势数据')}
            </div>
        </section>
    `;
    const recentOrdersCard = `
        <section class="analytics-product-detail-card analytics-product-detail-card--wide analytics-product-detail-card--trend-orders">
            <div class="analytics-product-detail-card__head">
                <strong>近期订单</strong>
                <span>${formatNumber(recentOrders.length)} 笔</span>
            </div>
            <div class="analytics-product-order-list">
                ${recentOrders.length > 0
                    ? recentOrders.map((order) => renderAnalyticsProductOrderRow(order, {
                        sourceLabel: '商品详情 / 最近订单',
                        summary: '该用户来自当前单品的最近订单样本，适合结合订单、履约和售后继续判断这次成交是否稳定。',
                        productId: String(summary.product_id || options.productId || '').trim(),
                        productName: String(summary.product_name || options.productName || '').trim(),
                        destination: 'analytics-product-detail',
                        destinationContext: {
                            productId: String(summary.product_id || options.productId || '').trim(),
                            productName: String(summary.product_name || options.productName || '').trim(),
                            focusTargetId: 'productDetailPanelSection'
                        },
                        actionLabel: '回到单品详情',
                        verificationMethod: '回到单品详情，对照最近订单、退款和履约状态，确认该用户对应的订单是否已经顺利承接。'
                    })).join('')
                    : renderHintState('fas fa-receipt', '当前窗口暂无近期订单')}
            </div>
        </section>
    `;
    const detailSectionsMarkup = [
        renderAnalyticsProductDetailSection({
            id: 'productDetailSectionOperating',
            sectionClass: 'analytics-nav-focus-target',
            gridClass: 'analytics-product-detail-grid--operating',
            eyebrow: '经营',
            title: '经营概览',
            summary: '先看单品漏斗、站点结构、来源归因和内容带货，快速判断这件商品当前处在哪一段经营承接里。',
            meta: `站点 ${formatNumber(siteSnapshots.length)} · Prompt ${formatNumber(promptIds.length)}`,
            content: [funnelCard, siteBreakdownCard, contentBreakdownCard, operatingAttributionStack].join('')
        }),
        renderAnalyticsProductDetailSection({
            id: 'productDetailSectionRisk',
            sectionClass: 'analytics-nav-focus-target',
            gridClass: 'analytics-product-detail-grid--risk',
            eyebrow: '风险',
            title: '风险与履约',
            summary: '把退款、履约、回写结论和事件采集放在同一段，方便确认问题究竟已经收口，还是仍停在处理中。',
            meta: `退款率 ${formatPercent(summary.refund_rate || 0)} · 履约风险 ${formatNumber(summary.delivery_risk_count || 0)}`,
            content: [riskBreakdownCard, conclusionHistoryMarkup, eventStageCard].join('')
        }),
        renderAnalyticsProductDetailSection({
            id: 'productDetailSectionUsers',
            sectionClass: 'analytics-nav-focus-target',
            gridClass: 'analytics-product-detail-grid--users',
            eyebrow: '用户',
            title: '用户承接',
            summary: '从成交样本、用户分层到后续去向，判断这件商品带来的到底是一次性成交，还是能继续沉淀用户价值。',
            meta: `买家 ${formatNumber(summary.buyer_count || buyerSnapshot.length || 0)} · 去向 ${formatNumber(firstPurchaseDestinations.length + crossSellDestinations.length + postPurchaseDestinations.length)}`,
            content: [buyerCard, buyerSegmentCard, userDestinationCard].join('')
        }),
        renderAnalyticsProductDetailSection({
            id: 'productDetailSectionTrend',
            sectionClass: 'analytics-nav-focus-target',
            gridClass: 'analytics-product-detail-grid--trend',
            eyebrow: '趋势',
            title: '趋势与订单',
            summary: '回看近窗波动、来源 Prompt 明细和最新订单承接，判断这件商品的成交节奏是否还在持续。',
            meta: `趋势 ${formatNumber(trendRows.length)} 天 · 订单 ${formatNumber(recentOrders.length)}`,
            content: [trendCard, promptAttributionCard, recentOrdersCard].join('')
        })
    ].join('');
    const detailInsightsGroupMarkup = detailInsightsMarkup
        ? `
            <section class="analytics-product-detail__surface analytics-product-detail__surface--insights">
                <div class="analytics-product-detail__surface-head analytics-product-detail__surface-head--compact">
                    <div class="analytics-product-detail__surface-copy">
                        <span class="analytics-product-detail__surface-eyebrow">经营提示</span>
                        <strong class="analytics-product-detail__surface-title">当前单品的复查结论与提醒</strong>
                        <p class="analytics-product-detail__surface-summary">把当前聚焦、复查结论和最近回写归到同一张卡里，避免信息漂在各个区块之间。</p>
                    </div>
                </div>
                ${detailInsightsMarkup}
            </section>
        `
        : '';

    return `
        <div class="analytics-product-detail">
            <div class="analytics-product-detail__top-grid">
                <section class="analytics-product-detail__surface analytics-product-detail__surface--identity">
                    <div class="analytics-product-detail__surface-head">
                        <div class="analytics-product-detail__surface-copy">
                            <span class="analytics-product-detail__surface-eyebrow">商品概况</span>
                            <div class="analytics-product-detail__breadcrumbs" aria-label="单品详情层级">
                                <button
                                    type="button"
                                    class="analytics-product-detail__crumb-link"
                                    ${buildAnalyticsProductDestinationAttrs('analytics-product', {
                                        sectionId: 'productOverviewSection',
                                        focusTargetId: 'productOverviewSection'
                                    })}
                                >
                                    商品经营
                                </button>
                                <i class="fas fa-angle-right" aria-hidden="true"></i>
                                <span class="analytics-product-detail__crumb-current">单品详情</span>
                            </div>
                            <div class="analytics-product-detail__headline-row">
                                <div class="analytics-product-shell__eyebrow">单品详情</div>
                                <div class="analytics-product-detail__headline">
                                    <div class="analytics-product-detail__title-line">
                                        <h4>${escapeHtml(summary.product_name || '未命名商品')}</h4>
                                        <span class="analytics-status-chip analytics-status-chip--${escapeHtml(sellingStatusTone)}">${escapeHtml(sellingStatusLabel)}</span>
                                    </div>
                                    <p>${escapeHtml(headerSummaryText || '当前窗口优先查看趋势、来源归因和库存履约承接。')}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="analytics-product-detail__identity">
                        ${headerIdentityItems.map((item) => `
                            <span class="analytics-product-detail__identity-item">${escapeHtml(item)}</span>
                        `).join('')}
                    </div>
                </section>

                <section class="analytics-product-detail__surface analytics-product-detail__surface--controls">
                    <div class="analytics-product-detail__surface-head analytics-product-detail__surface-head--compact">
                        <div class="analytics-product-detail__surface-copy">
                            <span class="analytics-product-detail__surface-eyebrow">控制中心</span>
                            <strong class="analytics-product-detail__surface-title">当前单品与快捷操作</strong>
                            <p class="analytics-product-detail__surface-summary">切换当前查看商品，并快速进入商品、库存、订单和履约处理页。</p>
                        </div>
                    </div>
                    ${detailSelectorMarkup}
                    ${detailActionsMarkup}
                </section>

                <section class="analytics-product-detail__surface analytics-product-detail__surface--metrics">
                    <div class="analytics-product-detail__surface-head analytics-product-detail__surface-head--compact">
                        <div class="analytics-product-detail__surface-copy">
                            <span class="analytics-product-detail__surface-eyebrow">经营快照</span>
                            <strong class="analytics-product-detail__surface-title">把浏览、成交、履约与库存收在一处</strong>
                            <p class="analytics-product-detail__surface-summary">先用一屏快照判断这件商品现在是放量、稳定，还是需要继续复查支付、退款和履约。</p>
                        </div>
                    </div>
                    <div class="analytics-product-detail__stats">
                        ${headerStats.map((item) => `
                            <article class="analytics-product-detail__stat analytics-product-detail__stat--${escapeHtml(item.tone || 'default')}">
                                <span class="analytics-product-detail__stat-label">${escapeHtml(item.label || '指标')}</span>
                                <strong class="analytics-product-detail__stat-value">${escapeHtml(item.value || '--')}</strong>
                                <span class="analytics-product-detail__stat-note">${escapeHtml(item.note || '')}</span>
                            </article>
                        `).join('')}
                    </div>
                </section>

                <section class="analytics-product-detail__surface analytics-product-detail__surface--navigator">
                    <div class="analytics-product-detail__surface-head analytics-product-detail__surface-head--compact">
                        <div class="analytics-product-detail__surface-copy">
                            <span class="analytics-product-detail__surface-eyebrow">分析目录</span>
                            <strong class="analytics-product-detail__surface-title">按分类查看单品详情</strong>
                            <p class="analytics-product-detail__surface-summary">把经营、风险、用户和趋势四类内容归到固定入口里，避免关键分析项散落在页面顶部。</p>
                        </div>
                    </div>
                    ${detailNavigatorMarkup}
                </section>
            </div>

            ${detailInsightsGroupMarkup}

            <div class="analytics-product-detail-sections">
                ${detailSectionsMarkup}
            </div>
        </div>
    `;
}

async function loadProductOverview() {
    const container = document.getElementById('productOverview');
    if (!container) return;

    container.innerHTML = renderAnalyticsProductCommerceSkeleton('overview');

    try {
        const bundle = await getAnalyticsProductDashboardBundle({ limit: 10 });
        const summary = getAnalyticsProductBundlePayloadOrThrow(bundle, 'summary', 'Product summary unavailable') || {};
        const trend = getAnalyticsProductBundlePayloadOrThrow(bundle, 'trend', 'Product trend unavailable') || [];
        const comparison = getAnalyticsProductBundlePayloadOrThrow(bundle, 'siteComparison', 'Product site comparison unavailable') || {};
        const categoryBreakdown = getAnalyticsProductBundlePayloadOrThrow(bundle, 'categoryBreakdown', 'Product category breakdown unavailable') || {};
        const productMatrix = getAnalyticsProductBundlePayloadOrThrow(bundle, 'productMatrix', 'Product operating matrix unavailable') || {};

        const hasSignal = Number(summary.active_product_count || 0) > 0
            || Number(summary.order_count || 0) > 0
            || Number(summary.view_user_count || 0) > 0
            || (Array.isArray(trend) && trend.length > 0)
            || (Array.isArray(categoryBreakdown?.rows) && categoryBreakdown.rows.length > 0)
            || (Array.isArray(productMatrix?.items) && productMatrix.items.length > 0);

        if (!hasSignal) {
            container.innerHTML = renderHintState('fas fa-box-open', '当前窗口暂无商品经营数据');
            destroyAnalyticsProductOverviewChart('categoryChart');
            destroyAnalyticsProductOverviewChart('matrixChart');
            return;
        }

        container.innerHTML = renderAnalyticsProductOverview(summary, trend, comparison, categoryBreakdown, productMatrix);
        if (Array.isArray(trend) && trend.length > 0) {
            renderAnalyticsProductTrendChart(trend);
        }
        renderAnalyticsProductCategoryBreakdownChart(categoryBreakdown);
        renderAnalyticsProductOperatingMatrixChart(productMatrix);
        maybePrimeAnalyticsProductDetail(Array.isArray(productMatrix?.items) ? productMatrix.items : []);
    } catch (err) {
        console.error('[Analytics] Failed to load product overview:', err);
        container.innerHTML = renderHintState(
            'fas fa-box-open',
            getAnalyticsProductLoadFailureMessage(err, '商品总盘加载失败'),
            'error'
        );
        destroyAnalyticsProductOverviewChart('categoryChart');
        destroyAnalyticsProductOverviewChart('matrixChart');
    }
}

function syncAnalyticsProductRankingsMeta(model = {}) {
    const meta = document.getElementById('productRankingsMeta');
    if (!meta) {
        return;
    }

    const activeMetric = model.activeMetric || null;
    const activeRow = model.activeRow || null;
    if (!activeMetric) {
        meta.textContent = '销量 / 收入 / 转化 / 风险榜';
        return;
    }

    meta.textContent = model.hasFocus && activeRow
        ? `${activeMetric.title || '商品榜单'} · 已聚焦 ${activeRow.productName || '当前商品'}`
        : `${activeMetric.title || '商品榜单'} · 点击商品聚焦`;
}

function renderAnalyticsProductRankingsInto(container, payloads = {}) {
    if (!container) {
        return;
    }

    container.__analyticsProductRankingsPayloads = payloads;
    const model = buildAnalyticsProductRankingsModel(payloads);
    container.innerHTML = renderAnalyticsProductRankings(payloads);
    syncAnalyticsProductRankingsMeta(model);
    bindAnalyticsProductRankingsInteractions(container);
}

function bindAnalyticsProductRankingsInteractions(container) {
    if (!container || container.dataset.analyticsProductRankingsBound === 'true') {
        return;
    }

    container.addEventListener('click', (event) => {
        const payloads = container.__analyticsProductRankingsPayloads || {};
        if (event.target.closest('[data-admin-action="analytics-open-destination"]')) {
            return;
        }

        const metricButton = event.target.closest('[data-analytics-product-rank-metric]');
        if (metricButton && container.contains(metricButton) && !metricButton.hasAttribute('disabled')) {
            setActiveAnalyticsProductRankingMetric(metricButton.dataset.analyticsProductRankMetric || '');
            renderAnalyticsProductRankingsInto(container, payloads);
            return;
        }

        const focusButton = event.target.closest('[data-analytics-product-rank-focus-key]');
        if (focusButton && container.contains(focusButton)) {
            toggleActiveAnalyticsProductRankingFocus(
                focusButton.dataset.analyticsProductRankFocusMetric || '',
                focusButton.dataset.analyticsProductRankFocusKey || ''
            );
            renderAnalyticsProductRankingsInto(container, payloads);
        }
    });

    container.dataset.analyticsProductRankingsBound = 'true';
}

async function loadProductRankings() {
    const container = document.getElementById('productRankings');
    const meta = document.getElementById('productRankingsMeta');
    if (!container) return;

    container.__analyticsProductRankingsPayloads = null;
    container.innerHTML = renderAnalyticsProductCommerceSkeleton('rankings');
    if (meta) {
        meta.textContent = '商品榜单加载中';
    }

    try {
        const bundle = await getAnalyticsProductDashboardBundle({ limit: 10 });
        const payloads = {
            salesTop: getAnalyticsProductBundlePayloadOrThrow(bundle, 'salesTop', 'Product sales rank unavailable') || [],
            gmvTop: getAnalyticsProductBundlePayloadOrThrow(bundle, 'gmvTop', 'Product revenue rank unavailable') || [],
            conversionTop: getAnalyticsProductBundlePayloadOrThrow(bundle, 'conversionTop', 'Product conversion rank unavailable') || [],
            refundRateTop: getAnalyticsProductBundlePayloadOrThrow(bundle, 'refundRateTop', 'Product refund-rate rank unavailable') || [],
            deliveryRiskRateTop: getAnalyticsProductBundlePayloadOrThrow(bundle, 'deliveryRiskRateTop', 'Product delivery-risk rank unavailable') || [],
            contentDrivenTop: getAnalyticsProductBundlePayloadOrThrow(bundle, 'contentDrivenTop', 'Product content-driven rank unavailable') || [],
            highExposureLowConversion: getAnalyticsProductBundlePayloadOrThrow(bundle, 'highExposureLowConversion', 'Product exposure-conversion rank unavailable') || []
        };

        const hasSignal = Object.values(payloads).some((rows) => Array.isArray(rows) && rows.length > 0);
        if (!hasSignal) {
            container.__analyticsProductRankingsPayloads = null;
            container.innerHTML = renderHintState('fas fa-ranking-star', '当前窗口暂无商品榜单数据');
            if (meta) {
                meta.textContent = '当前窗口暂无榜单数据';
            }
            return;
        }

        renderAnalyticsProductRankingsInto(container, payloads);
        maybePrimeAnalyticsProductDetail([
            ...(Array.isArray(payloads.gmvTop) ? payloads.gmvTop : []),
            ...(Array.isArray(payloads.salesTop) ? payloads.salesTop : []),
            ...(Array.isArray(payloads.conversionTop) ? payloads.conversionTop : []),
            ...(Array.isArray(payloads.refundRateTop) ? payloads.refundRateTop : []),
            ...(Array.isArray(payloads.deliveryRiskRateTop) ? payloads.deliveryRiskRateTop : []),
            ...(Array.isArray(payloads.contentDrivenTop) ? payloads.contentDrivenTop : []),
            ...(Array.isArray(payloads.highExposureLowConversion) ? payloads.highExposureLowConversion : [])
        ]);
    } catch (err) {
        console.error('[Analytics] Failed to load product rankings:', err);
        container.__analyticsProductRankingsPayloads = null;
        container.innerHTML = renderHintState(
            'fas fa-ranking-star',
            getAnalyticsProductLoadFailureMessage(err, '商品榜单加载失败'),
            'error'
        );
        if (meta) {
            meta.textContent = '商品榜单加载失败';
        }
    }
}

async function loadProductFunnel() {
    const container = document.getElementById('productFunnel');
    const meta = document.getElementById('productFunnelMeta');
    if (!container) return;

    container.innerHTML = renderAnalyticsProductCommerceSkeleton('funnel');

    try {
        const bundle = await getAnalyticsProductDashboardBundle({ limit: 10 });
        const payload = {
            summary: getAnalyticsProductBundlePayloadOrThrow(bundle, 'funnelSummary', 'Product funnel summary unavailable') || {},
            siteComparison: getAnalyticsProductBundlePayloadOrThrow(bundle, 'funnelSiteComparison', 'Product funnel site comparison unavailable') || {},
            productRows: getAnalyticsProductBundlePayloadOrThrow(bundle, 'funnelProductRows', 'Product funnel product comparison unavailable') || []
        };

        const hasSignal = Number(payload.summary?.stages?.[0]?.value || 0) > 0
            || Number(payload.summary?.stages?.[1]?.value || 0) > 0
            || Number(payload.summary?.stages?.[2]?.value || 0) > 0
            || (Array.isArray(payload.productRows) && payload.productRows.length > 0);
        if (!hasSignal) {
            container.innerHTML = renderHintState('fas fa-filter-circle-dollar', '当前窗口暂无商品漏斗数据');
            if (meta) meta.textContent = '可用真实事件版漏斗';
            return;
        }

        container.innerHTML = renderAnalyticsProductFunnel(payload);
        if (meta) {
            meta.textContent = '真实事件优先 · 详情 / 意图 / 支付 / 发货';
        }
        maybePrimeAnalyticsProductDetail(payload.productRows);
    } catch (err) {
        console.error('[Analytics] Failed to load product funnel:', err);
        const failureMessage = getAnalyticsProductLoadFailureMessage(err, '商品漏斗加载失败');
        container.innerHTML = renderHintState('fas fa-filter-circle-dollar', failureMessage, 'error');
        if (meta) meta.textContent = failureMessage;
    }
}

async function loadProductHealth() {
    const container = document.getElementById('productHealth');
    if (!container) return;

    container.innerHTML = renderAnalyticsProductCommerceSkeleton('health');

    try {
        const bundle = await getAnalyticsProductDashboardBundle({ limit: 10 });
        const payloads = {
            lowStockProducts: getAnalyticsProductBundlePayloadOrThrow(bundle, 'lowStockProducts', 'Low-stock product health unavailable') || [],
            soldOutProducts: getAnalyticsProductBundlePayloadOrThrow(bundle, 'soldOutProducts', 'Sold-out product health unavailable') || [],
            deliveryRiskProducts: getAnalyticsProductBundlePayloadOrThrow(bundle, 'deliveryRiskProducts', 'Delivery risk product health unavailable') || [],
            refundRiskProducts: getAnalyticsProductBundlePayloadOrThrow(bundle, 'refundRiskProducts', 'Refund risk product health unavailable') || [],
            inventoryTurnoverHints: getAnalyticsProductBundlePayloadOrThrow(bundle, 'inventoryTurnoverHints', 'Inventory turnover hints unavailable') || []
        };

        const hasSignal = Object.values(payloads).some((rows) => Array.isArray(rows) && rows.length > 0);
        if (!hasSignal) {
            container.innerHTML = renderHintState('fas fa-triangle-exclamation', '当前窗口暂无商品健康数据');
            return;
        }

        container.innerHTML = renderAnalyticsProductHealth(payloads);
        maybePrimeAnalyticsProductDetail([
            ...(Array.isArray(payloads.deliveryRiskProducts) ? payloads.deliveryRiskProducts : []),
            ...(Array.isArray(payloads.refundRiskProducts) ? payloads.refundRiskProducts : []),
            ...(Array.isArray(payloads.lowStockProducts) ? payloads.lowStockProducts : []),
            ...(Array.isArray(payloads.soldOutProducts) ? payloads.soldOutProducts : [])
        ]);
    } catch (err) {
        console.error('[Analytics] Failed to load product health:', err);
        container.innerHTML = renderHintState(
            'fas fa-triangle-exclamation',
            getAnalyticsProductLoadFailureMessage(err, '库存与履约健康加载失败'),
            'error'
        );
    }
}

function openAnalyticsProductDetail(productId = '', options = {}) {
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId) {
        return false;
    }
    const panelSectionId = String(options.focusTargetId || 'productDetailPanelSection').trim() || 'productDetailPanelSection';

    activeAnalyticsProductId = normalizedProductId;
    activeAnalyticsProductName = String(options.productName || activeAnalyticsProductName || '').trim();
    registerAnalyticsProductDetailCandidates([
        {
            productId: normalizedProductId,
            productName: activeAnalyticsProductName || normalizedProductId
        }
    ], {
        activeProductId: normalizedProductId,
        activeProductName: activeAnalyticsProductName || normalizedProductId,
        detailFocus: options.detailFocus,
        focusTargetId: options.focusTargetId
    });
    setActiveAnalyticsProductDetailFocus(options.detailFocus, options.focusTargetId);

    if (typeof switchAnalyticsTab === 'function') {
        switchAnalyticsTab('product-detail', {
            syncRoute: false,
            sectionId: panelSectionId,
            ensureProductDetailLoad: false
        });
    }

    if (options.syncRoute !== false && typeof syncAnalyticsRouteState === 'function') {
        syncAnalyticsRouteState({
            view: 'product-detail',
            sectionId: panelSectionId,
            productId: normalizedProductId,
            detailFocus: String(options.detailFocus || '').trim()
        });
    }

    if (options.focus !== false && typeof focusAnalyticsDestinationTarget === 'function') {
        focusAnalyticsDestinationTarget(panelSectionId, { block: 'start' });
    }

    void loadProductDetailPanel({
        productId: normalizedProductId,
        productName: options.productName || '',
        detailFocus: options.detailFocus || '',
        focusTargetId: options.focusTargetId || '',
        focus: options.focus !== false
    });
    return true;
}

async function loadProductDetailPanel(options = {}) {
    const container = document.getElementById('productDetailPanel');
    const meta = document.getElementById('productDetailMeta');
    if (!container) return;

    const productId = String(options.productId || activeAnalyticsProductId || '').trim();
    const detailFocus = String(options.detailFocus || getActiveAnalyticsProductDetailFocus() || '').trim();
    const focusTargetId = String(options.focusTargetId || getActiveAnalyticsProductDetailFocusTargetId() || '').trim();
    if (!productId) {
        const shouldHoldSkeleton = options.deferEmptyState === true || getAnalyticsActiveTabId() === 'product-detail';
        if (shouldHoldSkeleton) {
            primeAnalyticsProductDetailSkeletonOnEntry({
                detailFocus,
                force: true
            });
        } else {
            showAnalyticsProductDetailEmptyState();
        }
        return;
    }

    const requestId = ++analyticsProductDetailRequestId;
    container.innerHTML = renderAnalyticsProductDetailSkeleton();
    if (meta) {
        const focusConfig = getAnalyticsProductDetailFocusConfig(detailFocus);
        meta.textContent = `${activeAnalyticsProductName || productId} · 单品详情加载中${focusConfig ? ` · ${focusConfig.title}` : ''}`;
    }

    try {
        const bundle = await getAnalyticsProductDetailBundle({
            productId,
            recentOrderLimit: 6
        });
        if (requestId !== analyticsProductDetailRequestId) {
            return;
        }

        const payload = {
            summary: getAnalyticsProductBundlePayloadOrThrow(bundle, 'summary', 'Product detail summary unavailable') || {},
            trend: getAnalyticsProductBundlePayloadOrThrow(bundle, 'trend', 'Product detail trend unavailable') || [],
            funnel: getAnalyticsProductBundlePayloadOrThrow(bundle, 'funnel', 'Product detail funnel unavailable') || {},
            recentOrders: getAnalyticsProductBundlePayloadOrThrow(bundle, 'recentOrders', 'Product detail recent orders unavailable') || []
        };

        const summary = payload.summary || {};
        const buyerUserIds = Array.isArray(summary?.buyer_snapshot)
            ? summary.buyer_snapshot.map((buyer) => String(buyer?.user_id || '').trim()).filter(Boolean)
            : [];
        let buyerProfilesById = {};
        if (buyerUserIds.length > 0) {
            try {
                buyerProfilesById = await fetchAnalyticsUserProfilesByIds(buyerUserIds);
            } catch (profileError) {
                console.warn('[Analytics] Failed to hydrate product detail buyer profiles:', profileError);
            }
        }
        const hasSignal = Number(summary.order_count || 0) > 0
            || Number(summary.view_user_count || 0) > 0
            || Number(summary.stock_count || 0) > 0
            || Number(summary.refunded_order_count || 0) > 0;
        activeAnalyticsProductId = String(summary.product_id || productId).trim();
        activeAnalyticsProductName = String(summary.product_name || activeAnalyticsProductName || productId).trim();
        setActiveAnalyticsProductDetailFocus(detailFocus, focusTargetId);
        registerAnalyticsProductDetailCandidates([
            {
                productId: activeAnalyticsProductId,
                productName: activeAnalyticsProductName
            }
        ], {
            activeProductId: activeAnalyticsProductId,
            activeProductName: activeAnalyticsProductName,
            detailFocus,
            focusTargetId
        });

        if (!hasSignal) {
            container.innerHTML = renderHintState('fas fa-cube', '当前窗口暂无该商品详情数据');
            if (meta) meta.textContent = `${activeAnalyticsProductName || productId} · 当前窗口暂无详情`;
            return;
        }

        container.innerHTML = renderAnalyticsProductDetailPanel(payload, {
            detailFocus,
            focusTargetId,
            productId: activeAnalyticsProductId,
            productName: activeAnalyticsProductName,
            buyerProfilesById
        });
        refreshAnalyticsProductDetailNavigatorState(
            focusTargetId || 'productDetailSectionOperating'
        );
        refreshAnalyticsProductDetailSelectorState({
            activeProductId: activeAnalyticsProductId,
            activeProductName: activeAnalyticsProductName,
            detailFocus,
            focusTargetId: focusTargetId || 'productDetailSectionOperating'
        });
        if (meta) {
            const focusConfig = getAnalyticsProductDetailFocusConfig(detailFocus, summary);
            meta.textContent = `${activeAnalyticsProductName || productId} · 经营与运维双视角${focusConfig ? ` · ${focusConfig.title}` : ''}`;
        }
        if (options.focus !== false && focusTargetId && typeof focusAnalyticsDestinationTarget === 'function') {
            setTimeout(() => {
                focusAnalyticsDestinationTarget(focusTargetId, { block: 'start' });
            }, 40);
        }
    } catch (err) {
        if (requestId !== analyticsProductDetailRequestId) {
            return;
        }
        console.error('[Analytics] Failed to load product detail:', err);
        const failureMessage = getAnalyticsProductLoadFailureMessage(err, '单品详情加载失败');
        container.innerHTML = renderHintState('fas fa-cube', failureMessage, 'error');
        if (meta) meta.textContent = `${activeAnalyticsProductName || productId} · ${failureMessage}`;
    }
}

function settleAnalyticsProductDetailPendingState(options = {}) {
    const activeTabId = String(options.activeTabId || getAnalyticsActiveTabId() || '').trim().toLowerCase();
    if (activeTabId !== 'product-detail') {
        return false;
    }

    const activeProductId = String(options.productId || activeAnalyticsProductId || '').trim();
    if (activeProductId) {
        return 'active';
    }

    const candidates = getAnalyticsProductDetailCandidates({
        activeProductId
    });
    const candidate = candidates.find((item) => String(item?.productId || '').trim());
    if (candidate) {
        openAnalyticsProductDetail(candidate.productId, {
            productName: candidate.productName || candidate.productId,
            detailFocus: String(options.detailFocus || getActiveAnalyticsProductDetailFocus() || '').trim(),
            focusTargetId: String(options.focusTargetId || getActiveAnalyticsProductDetailFocusTargetId() || 'productDetailSectionOperating').trim(),
            focus: false
        });
        return 'candidate';
    }

    showAnalyticsProductDetailEmptyState();
    return 'empty';
}

window.settleAnalyticsProductDetailPendingState = settleAnalyticsProductDetailPendingState;

window.openAnalyticsProductDetail = openAnalyticsProductDetail;

function isAnalyticsProductTabActive() {
    return Boolean(
        ['product', 'product-detail'].includes(getAnalyticsActiveTabId())
        && (typeof isAnalyticsModuleVisible !== 'function' || isAnalyticsModuleVisible())
    );
}

function isAnalyticsOpsTabActive() {
    const tab = document.getElementById('analytics-tab-ops');
    return Boolean(
        tab
        && tab.classList.contains('active')
        && (typeof isAnalyticsModuleVisible !== 'function' || isAnalyticsModuleVisible())
    );
}

window.addEventListener('analytics-resolution-feedback-updated', () => {
    if (isAnalyticsProductTabActive()) {
        void loadProductAlerts();

        if (String(activeAnalyticsProductId || '').trim()) {
            void loadProductDetailPanel({
                productId: activeAnalyticsProductId,
                productName: activeAnalyticsProductName || '',
                detailFocus: typeof getActiveAnalyticsProductDetailFocus === 'function'
                    ? getActiveAnalyticsProductDetailFocus()
                    : '',
                focusTargetId: typeof getActiveAnalyticsProductDetailFocusTargetId === 'function'
                    ? getActiveAnalyticsProductDetailFocusTargetId()
                    : '',
                focus: false
            });
        }
    }

    if (isAnalyticsOpsTabActive()) {
        void loadOperationsCockpit();
    }

    if (typeof isAnalyticsModuleVisible === 'function' && isAnalyticsModuleVisible()) {
        updateAnalyticsContentOperatingCockpitPanel();
        updateAnalyticsContentCommerceDetailPanel();
        void loadUserTrendChart(getAnalyticsRangeDays());
    }
});

async function loadOverviewStats() {
    try {
        let data, error;
        const siteParam = getAnalyticsSiteParam();
        ({ data, error } = await getAnalyticsSupabaseClient().rpc('get_overview_stats_with_trend', { p_site: siteParam }));

        if (error) {
            ({ data, error } = await getAnalyticsSupabaseClient().rpc('get_overview_stats', { p_site: siteParam }));
            if (error) throw error;
        }

        if (!data || typeof data !== 'object') {
            const summaryWindow = await getAnalyticsSummaryWindowData({ forceRefresh: true }).catch(() => null);
            const fallbackOverview = summaryWindow?.overview && typeof summaryWindow.overview === 'object'
                ? summaryWindow.overview
                : null;
            if (fallbackOverview) {
                data = fallbackOverview;
            }
        }

        if (!data || typeof data !== 'object') {
            throw new Error('Analytics overview payload missing');
        }

        syncAnalyticsActiveUsersContext(data);
        syncAnalyticsNewUsersContext(data);
        syncAnalyticsGrowthNewUsersTodayFromSources({
            overview: data
        });

        const kpiBindings = [
            ['kpiDauValue', data.dau],
            ['kpiMauValue', data.mau],
            ['kpiNewUsersValue', data.new_users_week],
            ['kpiPointsValue', data.total_points],
            ['kpiCommentsValue', data.total_comments]
        ];
        kpiBindings.forEach(([elementId, value]) => {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = formatNumber(value);
            }
        });

        if (document.getElementById('kpiDauTrend') && data.dau_growth !== undefined) {
            updateTrendArrow('kpiDauTrend', data.dau_growth);
        }
        if (document.getElementById('kpiNewUsersTrend') && data.new_users_growth !== undefined) {
            updateTrendArrow('kpiNewUsersTrend', data.new_users_growth);
        }
        if (document.getElementById('kpiCommentsTrend') && data.comments_growth !== undefined) {
            updateTrendArrow('kpiCommentsTrend', data.comments_growth);
        }
    } catch (err) {
        console.error('[Analytics] Failed to load overview:', err);
    }
}

function updateTrendArrow(elementId, growthRate) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (growthRate === 0 || growthRate === null) {
        el.innerHTML = '<span class="trend-neutral">—</span>';
    } else if (growthRate > 0) {
        el.innerHTML = `<span class="trend-up">↑ ${Math.abs(growthRate)}%</span>`;
    } else {
        el.innerHTML = `<span class="trend-down">↓ ${Math.abs(growthRate)}%</span>`;
    }
}

function getAnalyticsOverviewNavigatorProductPayload(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    if (!bundle || typeof bundle !== 'object' || !normalizedKey) {
        return null;
    }

    const segments = bundle?.segments && typeof bundle.segments === 'object'
        ? bundle.segments
        : {};
    const segment = segments[normalizedKey];
    if (!segment || typeof segment !== 'object' || segment.ok !== true) {
        return null;
    }
    return Object.prototype.hasOwnProperty.call(segment, 'payload') ? segment.payload : null;
}

function getAnalyticsSectionNavigatorTonePriority(tone = '') {
    switch (String(tone || '').trim().toLowerCase()) {
        case 'danger':
            return 0;
        case 'warning':
            return 1;
        case 'accent':
            return 2;
        case 'success':
            return 3;
        case 'neutral':
            return 4;
        default:
            return 5;
    }
}

const ANALYTICS_CONTENT_OPERATING_SECTION_ID = 'contentOperatingCockpitSection';
const ANALYTICS_USER_VALUE_SECTION_ID = 'userValueCockpitSection';
const ANALYTICS_USER_VALUE_OVERVIEW_PANEL_ID = 'userValueCockpit';
const ANALYTICS_USER_VALUE_STANDALONE_PANEL_ID = 'userValueCockpitStandalone';

function getAnalyticsSectionNavigatorActiveKey() {
    const activeTab = document.querySelector('#analyticsTabsNav .admin-tab.active')?.dataset?.tab || '';
    switch (String(activeTab || '').trim().toLowerCase()) {
        case 'overview':
            return 'overview';
        case 'content':
            return 'content';
        case 'product':
        case 'product-detail':
            return 'product';
        case 'ops':
            return 'ops';
        case 'growth':
            return 'user';
        case 'monetization':
        case 'verify':
            return 'ops';
        default:
            return '';
    }
}

function getAnalyticsSectionNavigatorCardsState() {
    if (!Array.isArray(globalThis.__analyticsSectionNavigatorCardsState)) {
        globalThis.__analyticsSectionNavigatorCardsState = [];
    }
    return globalThis.__analyticsSectionNavigatorCardsState;
}

function setAnalyticsSectionNavigatorCardsState(cards = []) {
    globalThis.__analyticsSectionNavigatorCardsState = Array.isArray(cards) ? cards.filter(Boolean) : [];
    return globalThis.__analyticsSectionNavigatorCardsState;
}

function getAnalyticsActiveTabId() {
    return String(document.querySelector('#analyticsTabsNav .admin-tab.active')?.dataset?.tab || '')
        .trim()
        .toLowerCase();
}

function normalizeAnalyticsRouteTabId(tabId = '') {
    const normalizedTabId = String(tabId || '').trim().toLowerCase();
    if (!normalizedTabId) {
        return '';
    }

    return ['overview', 'content', 'product', 'product-detail', 'ops', 'monetization', 'verify', 'growth'].includes(normalizedTabId)
        ? normalizedTabId
        : '';
}

function getAnalyticsRouteUrlObject() {
    if (typeof window.getAdminStudioUrlObject === 'function') {
        return window.getAdminStudioUrlObject();
    }

    try {
        return new URL(window.location.href);
    } catch (error) {
        console.warn('[Analytics] Failed to parse route URL:', error);
        return null;
    }
}

function getAnalyticsSidebarModuleIdForView(view = '') {
    const normalizedView = normalizeAnalyticsRouteTabId(view || '') || 'overview';
    switch (normalizedView) {
        case 'growth':
        case 'content':
            return 'growth-center';
        case 'product':
        case 'product-detail':
        case 'ops':
        case 'monetization':
        case 'verify':
            return 'commerce-center';
        case 'overview':
        default:
            return 'business-overview';
    }
}

function getAnalyticsDefaultViewForModule(moduleId = '') {
    const normalizedModuleId = String(moduleId || '').trim().toLowerCase();
    switch (normalizedModuleId) {
        case 'growth-center':
            return 'growth';
        case 'commerce-center':
            return 'product';
        case 'business-overview':
        case 'business-center':
        case 'analytics-center':
        case 'analytics':
        default:
            return 'overview';
    }
}

function getAnalyticsRouteState() {
    const url = getAnalyticsRouteUrlObject();
    const searchParams = url?.searchParams;
    const moduleId = String(searchParams?.get('module') || '').trim().toLowerCase();
    return {
        module: moduleId,
        view: normalizeAnalyticsRouteTabId(searchParams?.get('analytics_view') || '') || getAnalyticsDefaultViewForModule(moduleId),
        sectionId: String(searchParams?.get('analytics_section') || '').trim(),
        promptId: String(searchParams?.get('analytics_prompt_id') || '').trim(),
        productId: String(searchParams?.get('analytics_product_id') || '').trim(),
        detailFocus: String(searchParams?.get('analytics_product_focus') || '').trim()
    };
}

function syncAnalyticsRouteState(nextState = {}, options = {}) {
    const url = getAnalyticsRouteUrlObject();
    if (!url || typeof window.history?.replaceState !== 'function') {
        return false;
    }

    const currentState = getAnalyticsRouteState();
    const resolvedView = Object.prototype.hasOwnProperty.call(nextState, 'view')
        ? normalizeAnalyticsRouteTabId(nextState.view) || currentState.view || getAnalyticsActiveTabId() || 'overview'
        : (currentState.view || getAnalyticsActiveTabId() || 'overview');
    const resolvedSectionId = Object.prototype.hasOwnProperty.call(nextState, 'sectionId')
        ? String(nextState.sectionId || '').trim()
        : currentState.sectionId;
    let resolvedPromptId = Object.prototype.hasOwnProperty.call(nextState, 'promptId')
        ? String(nextState.promptId || '').trim()
        : currentState.promptId;
    let resolvedProductId = Object.prototype.hasOwnProperty.call(nextState, 'productId')
        ? String(nextState.productId || '').trim()
        : currentState.productId;
    let resolvedDetailFocus = Object.prototype.hasOwnProperty.call(nextState, 'detailFocus')
        ? String(nextState.detailFocus || '').trim()
        : currentState.detailFocus;

    if (resolvedView !== 'content') {
        resolvedPromptId = '';
    }

    if (resolvedView !== 'product-detail') {
        resolvedProductId = '';
        resolvedDetailFocus = '';
    }

    if (options.ensureAnalyticsModule !== false) {
        url.searchParams.set(
            'module',
            typeof window.getAdminAnalyticsSidebarModuleIdForTab === 'function'
                ? window.getAdminAnalyticsSidebarModuleIdForTab(resolvedView)
                : getAnalyticsSidebarModuleIdForView(resolvedView)
        );
    }

    if (resolvedView) {
        url.searchParams.set('analytics_view', resolvedView);
    } else {
        url.searchParams.delete('analytics_view');
    }

    if (resolvedSectionId) {
        url.searchParams.set('analytics_section', resolvedSectionId);
    } else {
        url.searchParams.delete('analytics_section');
    }

    if (resolvedPromptId) {
        url.searchParams.set('analytics_prompt_id', resolvedPromptId);
    } else {
        url.searchParams.delete('analytics_prompt_id');
    }

    if (resolvedProductId) {
        url.searchParams.set('analytics_product_id', resolvedProductId);
    } else {
        url.searchParams.delete('analytics_product_id');
    }

    if (resolvedDetailFocus) {
        url.searchParams.set('analytics_product_focus', resolvedDetailFocus);
    } else {
        url.searchParams.delete('analytics_product_focus');
    }

    const nextRelativeUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextRelativeUrl === currentRelativeUrl) {
        return false;
    }

    window.history.replaceState(window.history.state, '', nextRelativeUrl);
    window.renderAnalyticsBusinessCenterShell?.();
    return true;
}

window.getAnalyticsRouteState = getAnalyticsRouteState;
window.syncAnalyticsRouteState = syncAnalyticsRouteState;

function refreshAnalyticsSectionNavigatorActiveState() {
    const activeKey = getAnalyticsSectionNavigatorActiveKey();
    document.querySelectorAll('#analyticsBusinessCenterShell [data-analytics-section-key]').forEach((node) => {
        const isActive = Boolean(activeKey) && node.dataset.analyticsSectionKey === activeKey;
        node.classList.toggle('analytics-business-center-shell__card--active', isActive);
        node.setAttribute('aria-current', isActive ? 'true' : 'false');
        const badge = node.querySelector('[data-analytics-center-badge]');
        if (badge) {
            badge.textContent = isActive ? '当前经营线' : '经营线';
        }
    });
    document.querySelectorAll('#analyticsOperatingHub [data-analytics-section-key]').forEach((node) => {
        const isActive = Boolean(activeKey) && node.dataset.analyticsSectionKey === activeKey;
        node.classList.toggle('analytics-operating-hub__item--active', isActive);
        node.setAttribute('aria-current', isActive ? 'true' : 'false');
        const badge = node.querySelector('[data-analytics-hub-badge]');
        if (badge) {
            badge.textContent = isActive ? '当前经营入口' : '经营入口';
        }
    });
    document.querySelectorAll('#analyticsSectionNavigator [data-analytics-section-key]').forEach((node) => {
        const isActive = Boolean(activeKey) && node.dataset.analyticsSectionKey === activeKey;
        node.classList.toggle('analytics-section-navigator-card--active', isActive);
        node.setAttribute('aria-current', isActive ? 'true' : 'false');
        const badge = node.querySelector('[data-analytics-section-entry-badge]');
        if (badge) {
            badge.textContent = isActive ? '当前经营入口' : '主入口';
        }
    });
}

window.refreshAnalyticsSectionNavigatorActiveState = refreshAnalyticsSectionNavigatorActiveState;

function buildAnalyticsSectionNavigatorEntryItems(card = null) {
    const key = String(card?.key || '').trim().toLowerCase();
    switch (key) {
        case 'user':
            return [
                {
                    label: '用户趋势',
                    destination: 'analytics-overview',
                    context: { sectionId: 'userTrendPanel', focusTargetId: 'userTrendPanel' }
                },
                {
                    label: '影响用户',
                    destination: 'analytics-overview',
                    context: { sectionId: 'userGrowthCommerceImpact', focusTargetId: 'userGrowthCommerceImpact' }
                },
                {
                    label: '商品承接',
                    destination: 'analytics-product',
                    context: { sectionId: 'productOverviewSection', focusTargetId: 'productOverviewSection' }
                }
            ];
        case 'content':
            return [
                {
                    label: '热门内容',
                    destination: 'analytics-content',
                    context: { sectionId: 'topContentList', focusTargetId: 'topContentList' }
                },
                {
                    label: '带货详情',
                    destination: 'analytics-content',
                    context: { sectionId: 'contentCommerceDetailSection', focusTargetId: 'contentCommerceDetailSection' }
                },
                {
                    label: '商品订单',
                    destination: 'analytics-product',
                    context: { sectionId: 'productContentBreakdownSection', focusTargetId: 'productContentBreakdownSection' }
                }
            ];
        case 'product':
            return [
                {
                    label: '预警中心',
                    destination: 'analytics-product',
                    context: { sectionId: 'productAlertsSection', focusTargetId: 'productAlertsSection' }
                },
                {
                    label: '商品总盘',
                    destination: 'analytics-product',
                    context: { sectionId: 'productOverviewSection', focusTargetId: 'productOverviewSection' }
                },
                {
                    label: '单品详情',
                    destination: 'analytics-product-detail',
                    context: { sectionId: 'productDetailPanelSection', focusTargetId: 'productDetailPanelSection' }
                }
            ];
        case 'ops':
            return [
                {
                    label: '运营总览',
                    destination: 'analytics-ops',
                    context: { sectionId: 'opsCockpitOverviewSection', focusTargetId: 'opsCockpitOverviewSection' }
                },
                {
                    label: '支付问题',
                    destination: 'analytics-ops',
                    context: { sectionId: 'opsPaymentsSection', focusTargetId: 'opsPaymentsSection' }
                },
                {
                    label: '售后工单',
                    destination: 'analytics-ops',
                    context: { sectionId: 'opsTicketsSection', focusTargetId: 'opsTicketsSection' }
                },
                {
                    label: '履约处理',
                    destination: 'analytics-ops',
                    context: { sectionId: 'opsFulfillmentSection', focusTargetId: 'opsFulfillmentSection' }
                }
            ];
        case 'overview':
        default:
            return [
                {
                    label: '今日待处理',
                    destination: 'analytics-overview',
                    context: { sectionId: 'overviewDutyBoard', focusTargetId: 'overviewDutyBoard' }
                },
                {
                    label: '经营主线',
                    destination: 'analytics-overview',
                    context: { sectionId: 'overviewBusinessMix', focusTargetId: 'overviewBusinessMix' }
                },
                {
                    label: '建议动作',
                    destination: 'analytics-overview',
                    context: { sectionId: 'overviewActionRecommendations', focusTargetId: 'overviewActionRecommendations' }
                }
            ];
    }
}

function getAnalyticsOperatingFocusSectionTargetId(item = null) {
    if (!item || typeof item !== 'object') {
        return '';
    }

    return String(item?.context?.focusTargetId || item?.context?.sectionId || '')
        .trim();
}

function getAnalyticsOperatingFocusSectionItems(activeTabId = 'overview') {
    switch (String(activeTabId || '').trim().toLowerCase()) {
        case 'content':
            return [
                {
                    label: '内容经营页',
                    summary: '先看内容级经营判断、复查结论和建议动作。',
                    icon: 'fas fa-compass-drafting',
                    destination: 'analytics-content',
                    context: { sectionId: ANALYTICS_CONTENT_OPERATING_SECTION_ID, focusTargetId: ANALYTICS_CONTENT_OPERATING_SECTION_ID }
                },
                {
                    label: '热门内容',
                    summary: '先看当前窗口最强的内容热点和带货内容。',
                    icon: 'fas fa-fire',
                    destination: 'analytics-content',
                    context: { sectionId: 'topContentList', focusTargetId: 'topContentList' }
                },
                {
                    label: '带货详情',
                    summary: '继续看商品、用户和订单样本。',
                    icon: 'fas fa-store',
                    destination: 'analytics-content',
                    context: { sectionId: 'contentCommerceDetailSection', focusTargetId: 'contentCommerceDetailSection' }
                },
                {
                    label: '活跃热力',
                    summary: '确认当前内容消费活跃落在哪些时段。',
                    icon: 'fas fa-th',
                    destination: 'analytics-content',
                    context: { sectionId: 'activityHeatmap', focusTargetId: 'activityHeatmap' }
                },
                {
                    label: '转化漏斗',
                    summary: '确认内容用户卡在浏览、点击还是支付前。',
                    icon: 'fas fa-filter',
                    destination: 'analytics-content',
                    context: { sectionId: 'conversionFunnel', focusTargetId: 'conversionFunnel' }
                }
            ];
        case 'product':
            return [
                {
                    label: '预警中心',
                    summary: '先看库存、履约、退款和转化异常。',
                    icon: 'fas fa-siren-on',
                    destination: 'analytics-product',
                    context: { sectionId: 'productAlertsSection', focusTargetId: 'productAlertsSection' }
                },
                {
                    label: '商品总盘',
                    summary: '看总盘、类目贡献和经营矩阵。',
                    icon: 'fas fa-chart-line',
                    destination: 'analytics-product',
                    context: { sectionId: 'productOverviewSection', focusTargetId: 'productOverviewSection' }
                },
                {
                    label: '商品榜单',
                    summary: '看销量、收入、退款率和履约异常榜。',
                    icon: 'fas fa-ranking-star',
                    destination: 'analytics-product',
                    context: { sectionId: 'productRankingsSection', focusTargetId: 'productRankingsSection' }
                },
                {
                    label: '商品漏斗',
                    summary: '确认曝光、详情、意图、支付和发货断点。',
                    icon: 'fas fa-filter-circle-dollar',
                    destination: 'analytics-product',
                    context: { sectionId: 'productFunnelSection', focusTargetId: 'productFunnelSection' }
                },
                {
                    label: '履约健康',
                    summary: '继续看库存、售后和履约风险。',
                    icon: 'fas fa-triangle-exclamation',
                    destination: 'analytics-product',
                    context: { sectionId: 'productHealthSection', focusTargetId: 'productHealthSection' }
                }
            ];
        case 'product-detail':
            return [
                {
                    label: '经营概览',
                    summary: '先看当前单品的经营漏斗、来源与带货承接。',
                    icon: 'fas fa-chart-line',
                    destination: 'analytics-product-detail',
                    context: { sectionId: 'productDetailSectionOperating', focusTargetId: 'productDetailSectionOperating' }
                },
                {
                    label: '风险履约',
                    summary: '确认退款、履约和回写是否已经真正收口。',
                    icon: 'fas fa-triangle-exclamation',
                    destination: 'analytics-product-detail',
                    context: { sectionId: 'productDetailSectionRisk', focusTargetId: 'productDetailSectionRisk' }
                },
                {
                    label: '用户承接',
                    summary: '继续看买家分层和后续去向。',
                    icon: 'fas fa-users',
                    destination: 'analytics-product-detail',
                    context: { sectionId: 'productDetailSectionUsers', focusTargetId: 'productDetailSectionUsers' }
                },
                {
                    label: '趋势订单',
                    summary: '回看趋势波动、来源 Prompt 和近期订单样本。',
                    icon: 'fas fa-chart-column',
                    destination: 'analytics-product-detail',
                    context: { sectionId: 'productDetailSectionTrend', focusTargetId: 'productDetailSectionTrend' }
                }
            ];
        case 'monetization':
            return [
                {
                    label: '积分流向',
                    summary: '先看收入来源和消费去向。',
                    icon: 'fas fa-exchange-alt',
                    destination: 'analytics-monetization',
                    context: { sectionId: 'pointsFlow', focusTargetId: 'pointsFlow' }
                },
                {
                    label: '富豪榜',
                    summary: '看当前积分持有分层和关键用户。',
                    icon: 'fas fa-trophy',
                    destination: 'analytics-monetization',
                    context: { sectionId: 'pointsLeaderboard', focusTargetId: 'pointsLeaderboard' }
                },
                {
                    label: '真实交易转化',
                    summary: '确认真实交易事件有没有形成承接。',
                    icon: 'fas fa-credit-card',
                    destination: 'analytics-monetization',
                    context: { sectionId: 'commerceEventFunnel', focusTargetId: 'commerceEventFunnel' }
                }
            ];
        case 'verify':
            return [
                {
                    label: '验证状态拆解',
                    summary: '先看验证状态和任务分布。',
                    icon: 'fas fa-signal',
                    destination: 'analytics-verify',
                    context: { sectionId: 'verifyStatusList', focusTargetId: 'verifyStatusList' }
                },
                {
                    label: '最近任务',
                    summary: '继续看最近验证任务和活跃任务。',
                    icon: 'fas fa-list-check',
                    destination: 'analytics-verify',
                    context: { sectionId: 'verifyRecentList', focusTargetId: 'verifyRecentList' }
                },
                {
                    label: '失败阻塞',
                    summary: '优先看失败样本和阻塞链路。',
                    icon: 'fas fa-triangle-exclamation',
                    destination: 'analytics-verify',
                    context: { sectionId: 'verifyFailureList', focusTargetId: 'verifyFailureList' }
                },
                {
                    label: '验证转化',
                    summary: '确认验证事件转化是否开始形成承接。',
                    icon: 'fas fa-shuffle',
                    destination: 'analytics-verify',
                    context: { sectionId: 'verifyEventFunnel', focusTargetId: 'verifyEventFunnel' }
                }
            ];
        case 'growth':
            return [
                {
                    label: '用户价值',
                    summary: '先看首单、复购、跨商品和风险复查是否形成独立价值层。',
                    icon: 'fas fa-user-group',
                    destination: 'analytics-growth',
                    context: { sectionId: ANALYTICS_USER_VALUE_SECTION_ID, focusTargetId: ANALYTICS_USER_VALUE_SECTION_ID }
                },
                {
                    label: '社区趋势',
                    summary: '先看社区活跃、互动和近期波动。',
                    icon: 'fas fa-heart',
                    destination: 'analytics-growth',
                    context: { sectionId: 'topContributorsList', focusTargetId: 'topContributorsList' }
                },
                {
                    label: '贡献者排行',
                    summary: '看高贡献用户和受商品影响样本。',
                    icon: 'fas fa-crown',
                    destination: 'analytics-growth',
                    context: { sectionId: 'topContributorsList', focusTargetId: 'topContributorsList' }
                },
                {
                    label: '留存复查',
                    summary: '确认真实业务回访留存的当前状态。',
                    icon: 'fas fa-th',
                    destination: 'analytics-growth',
                    context: { sectionId: 'retentionCohort', focusTargetId: 'retentionCohort' }
                },
                {
                    label: '裂变拆解',
                    summary: '看奖励、返佣和留言互动的当前表现。',
                    icon: 'fas fa-bullhorn',
                    destination: 'analytics-growth',
                    context: { sectionId: 'growthBreakdownList', focusTargetId: 'growthBreakdownList' }
                },
                {
                    label: '增长动作',
                    summary: '确认真实增长动作是否开始形成承接。',
                    icon: 'fas fa-seedling',
                    destination: 'analytics-growth',
                    context: { sectionId: 'growthEventFunnel', focusTargetId: 'growthEventFunnel' }
                }
            ];
        case 'ops':
            return [
                {
                    label: '运营总览',
                    summary: '先判断支付、工单、履约、验证和告警里哪条最值得先看。',
                    icon: 'fas fa-satellite-dish',
                    destination: 'analytics-ops',
                    context: { sectionId: 'opsCockpitOverviewSection', focusTargetId: 'opsCockpitOverviewSection' }
                },
                {
                    label: '支付问题',
                    summary: '看告警、死信、退款异常和待重试。',
                    icon: 'fas fa-credit-card',
                    destination: 'analytics-ops',
                    context: { sectionId: 'opsPaymentsSection', focusTargetId: 'opsPaymentsSection' }
                },
                {
                    label: '售后工单',
                    summary: '看待处理、超时、高优和队列堆积。',
                    icon: 'fas fa-headset',
                    destination: 'analytics-ops',
                    context: { sectionId: 'opsTicketsSection', focusTargetId: 'opsTicketsSection' }
                },
                {
                    label: '履约处理',
                    summary: '看库存、履约风险和退款风险样本。',
                    icon: 'fas fa-truck-fast',
                    destination: 'analytics-ops',
                    context: { sectionId: 'opsFulfillmentSection', focusTargetId: 'opsFulfillmentSection' }
                },
                {
                    label: '验证服务',
                    summary: '看失败样本、活跃任务和验证承接。',
                    icon: 'fas fa-shield-halved',
                    destination: 'analytics-ops',
                    context: { sectionId: 'opsVerifySection', focusTargetId: 'opsVerifySection' }
                },
                {
                    label: '站外告警',
                    summary: '看通道健康、死信和最近投递异常。',
                    icon: 'fas fa-tower-broadcast',
                    destination: 'analytics-ops',
                    context: { sectionId: 'opsAlertsSection', focusTargetId: 'opsAlertsSection' }
                }
            ];
        case 'overview':
        default:
            return [
                {
                    label: '今日待处理',
                    summary: '先看当前窗口最急的待处理事项。',
                    icon: 'fas fa-clipboard-list',
                    destination: 'analytics-overview',
                    context: { sectionId: 'overviewDutyBoard', focusTargetId: 'overviewDutyBoard' }
                },
                {
                    label: '经营导航',
                    summary: '快速判断四条经营线里谁最值得先看。',
                    icon: 'fas fa-compass-drafting',
                    destination: 'analytics-overview',
                    context: { sectionId: 'overviewOperatingNavigator', focusTargetId: 'overviewOperatingNavigator' }
                },
                {
                    label: '用户趋势',
                    summary: '确认当前窗口新增、活跃和商品影响用户层。',
                    icon: 'fas fa-chart-area',
                    destination: 'analytics-overview',
                    context: { sectionId: 'userTrendPanel', focusTargetId: 'userTrendPanel' }
                },
                {
                    label: '渠道分布',
                    summary: '继续看渠道、事件和内容承接。',
                    icon: 'fas fa-chart-pie',
                    destination: 'analytics-overview',
                    context: { sectionId: 'channelChartPanel', focusTargetId: 'channelChartPanel' }
                },
                {
                    label: '经营主线',
                    summary: '看当前窗口的一句话经营判断和建议动作。',
                    icon: 'fas fa-route',
                    destination: 'analytics-overview',
                    context: { sectionId: 'overviewBusinessMix', focusTargetId: 'overviewBusinessMix' }
                }
            ];
    }
}

function resolveAnalyticsOperatingFocusSectionSnapshot(activeTabId = getAnalyticsActiveTabId()) {
    const normalizedTabId = String(activeTabId || 'overview').trim().toLowerCase() || 'overview';
    const activeTab = document.getElementById(`analytics-tab-${normalizedTabId}`);
    const anchorLine = window.innerWidth <= 768 ? 132 : 176;
    const items = getAnalyticsOperatingFocusSectionItems(normalizedTabId)
        .map((item) => {
            const targetId = getAnalyticsOperatingFocusSectionTargetId(item);
            const target = targetId ? document.getElementById(targetId) : null;
            const targetTab = target?.closest?.('.analytics-tab-content') || null;
            if (!(target instanceof HTMLElement) || targetTab !== activeTab) {
                return null;
            }

            return {
                ...item,
                targetId,
                target,
                rect: target.getBoundingClientRect()
            };
        })
        .filter(Boolean);

    if (!items.length) {
        return {
            activeTabId: normalizedTabId,
            items: [],
            currentItem: null,
            nextItem: null
        };
    }

    const currentItem = items.reduce((best, item) => {
        if (!best) {
            return item;
        }

        const bestTop = Number(best?.rect?.top || 0);
        const itemTop = Number(item?.rect?.top || 0);
        const bestPassed = bestTop <= anchorLine;
        const itemPassed = itemTop <= anchorLine;

        if (bestPassed && itemPassed) {
            return itemTop > bestTop ? item : best;
        }

        if (itemPassed && !bestPassed) {
            return item;
        }

        if (bestPassed && !itemPassed) {
            return best;
        }

        return itemTop < bestTop ? item : best;
    }, null) || items[0];

    const currentIndex = items.findIndex((item) => item.targetId === currentItem?.targetId);
    const nextItem = currentIndex >= 0 && currentIndex < items.length - 1
        ? items[currentIndex + 1]
        : null;

    return {
        activeTabId: normalizedTabId,
        items,
        currentItem,
        nextItem
    };
}

function refreshAnalyticsOperatingFocusSectionActiveState() {
    const container = document.getElementById('analyticsOperatingFocusWorkspace');
    if (!container) {
        return;
    }

    const snapshot = resolveAnalyticsOperatingFocusSectionSnapshot();
    const currentTargetId = String(snapshot.currentItem?.targetId || '').trim();
    const nextTargetId = String(snapshot.nextItem?.targetId || '').trim();
    const currentLabel = snapshot.currentItem?.label || '当前分区待定位';
    const nextLabel = snapshot.nextItem?.label || '当前已在本视角最后一个分区';
    const countLabel = snapshot.items.length ? `共 ${snapshot.items.length} 个分区` : '当前视角暂无分区导航';

    container.querySelectorAll('[data-analytics-focus-section-target]').forEach((node) => {
        const isActive = Boolean(currentTargetId) && node.dataset.analyticsFocusSectionTarget === currentTargetId;
        const isNext = Boolean(nextTargetId) && node.dataset.analyticsFocusSectionTarget === nextTargetId;
        node.classList.toggle('analytics-operating-focus__action-card--active', isActive);
        node.classList.toggle('analytics-operating-focus__action-card--next', isNext && !isActive);
        node.setAttribute('aria-current', isActive ? 'true' : 'false');
    });

    const currentNode = container.querySelector('[data-analytics-focus-current]');
    if (currentNode) {
        currentNode.textContent = currentLabel;
    }

    const nextNode = container.querySelector('[data-analytics-focus-next]');
    if (nextNode) {
        nextNode.textContent = nextLabel;
    }

    const countNode = container.querySelector('[data-analytics-focus-count]');
    if (countNode) {
        countNode.textContent = countLabel;
    }

    const currentBadgeNode = container.querySelector('[data-analytics-focus-current-badge]');
    if (currentBadgeNode) {
        currentBadgeNode.hidden = !currentTargetId;
        currentBadgeNode.textContent = currentTargetId ? '当前分区' : '';
    }

    const nextBadgeNode = container.querySelector('[data-analytics-focus-next-badge]');
    if (nextBadgeNode) {
        nextBadgeNode.hidden = !nextTargetId;
        nextBadgeNode.textContent = nextTargetId ? '下一分区' : '';
    }
}

window.refreshAnalyticsOperatingFocusSectionActiveState = refreshAnalyticsOperatingFocusSectionActiveState;

function scheduleAnalyticsOperatingFocusSectionRefresh() {
    if (analyticsRuntime.focusScrollSyncQueued) {
        return;
    }

    analyticsRuntime.focusScrollSyncQueued = true;
    window.requestAnimationFrame(() => {
        analyticsRuntime.focusScrollSyncQueued = false;
        if (!analyticsRuntime.moduleActive) {
            return;
        }
        refreshAnalyticsOperatingFocusSectionActiveState();
    });
}

window.scheduleAnalyticsOperatingFocusSectionRefresh = scheduleAnalyticsOperatingFocusSectionRefresh;

function getAnalyticsOperatingFocusStaticConfig(activeKey = 'overview', activeTabId = 'overview') {
    switch (String(activeKey || '').trim().toLowerCase()) {
        case 'user':
            return {
                routeLabel: '用户影响',
                summary: '先判断商品经营当前影响到了浏览、详情、意图还是成交用户，再继续回看用户样本和承接链。',
                focusItems: [
                    {
                        label: '看用户增长趋势',
                        summary: '先确认业务活跃、新增和商品影响用户层的当前承接。',
                        icon: 'fas fa-chart-area',
                        destination: 'analytics-overview',
                        context: { sectionId: 'userTrendPanel', focusTargetId: 'userTrendPanel' }
                    },
                    {
                        label: '看商品影响用户层',
                        summary: '直接看浏览、详情、意图、成交用户样本。',
                        icon: 'fas fa-users-viewfinder',
                        destination: 'analytics-overview',
                        context: { sectionId: 'userGrowthCommerceImpact', focusTargetId: 'userGrowthCommerceImpact' }
                    }
                ],
                relatedItems: [
                    {
                        label: '回经营总览',
                        summary: '看当前窗口的经营主线和建议动作。',
                        icon: 'fas fa-compass-drafting',
                        destination: 'analytics-overview',
                        context: { sectionId: 'overviewOperatingNavigator', focusTargetId: 'overviewOperatingNavigator' }
                    },
                    {
                        label: '看商品经营',
                        summary: '继续确认用户影响最后承接到了哪些商品。',
                        icon: 'fas fa-box-open',
                        destination: 'analytics-product',
                        context: { sectionId: 'productOverviewSection', focusTargetId: 'productOverviewSection' }
                    },
                    {
                        label: '看运营保障',
                        summary: '确认支付、售后和验证是否影响用户转化。',
                        icon: 'fas fa-life-ring',
                        destination: 'analytics-ops',
                        context: { sectionId: 'opsCockpitOverviewSection', focusTargetId: 'opsCockpitOverviewSection' }
                    }
                ],
                sectionItems: getAnalyticsOperatingFocusSectionItems(activeTabId)
            };
        case 'content':
            return {
                routeLabel: '内容带货',
                summary: '先看带货内容有没有把流量推到详情、意图和支付，再继续下钻带货商品和订单链。',
                focusItems: [
                    {
                        label: '看热门内容',
                        summary: '快速确认当前带货 Prompt 和内容热点。',
                        icon: 'fas fa-fire',
                        destination: 'analytics-content',
                        context: { sectionId: 'topContentList', focusTargetId: 'topContentList' }
                    },
                    {
                        label: '看带货详情',
                        summary: '继续下钻带货商品、用户样本和订单样本。',
                        icon: 'fas fa-store',
                        destination: 'analytics-content',
                        context: { sectionId: 'contentCommerceDetailSection', focusTargetId: 'contentCommerceDetailSection' }
                    },
                    {
                        label: '看转化漏斗',
                        summary: '确认内容之后卡在浏览、点击还是支付前。',
                        icon: 'fas fa-filter',
                        destination: 'analytics-content',
                        context: { sectionId: 'conversionFunnel', focusTargetId: 'conversionFunnel' }
                    }
                ],
                relatedItems: [
                    {
                        label: '回经营总览',
                        summary: '看内容带货在当前窗口属于起量、待转化还是带货中。',
                        icon: 'fas fa-compass-drafting',
                        destination: 'analytics-overview',
                        context: { sectionId: 'overviewOperatingNavigator', focusTargetId: 'overviewOperatingNavigator' }
                    },
                    {
                        label: '看商品经营',
                        summary: '继续确认内容最终承接到了哪些商品和风险点。',
                        icon: 'fas fa-cubes',
                        destination: 'analytics-product',
                        context: { sectionId: 'productRankingsSection', focusTargetId: 'productRankingsSection' }
                    },
                    {
                        label: '看用户影响',
                        summary: '判断带货内容最终影响到了哪些用户样本。',
                        icon: 'fas fa-users',
                        destination: 'analytics-overview',
                        context: { sectionId: 'userGrowthCommerceImpact', focusTargetId: 'userGrowthCommerceImpact' }
                    }
                ],
                sectionItems: getAnalyticsOperatingFocusSectionItems(activeTabId)
            };
        case 'product':
            if (String(activeTabId || '').trim().toLowerCase() === 'product-detail') {
                return {
                    routeLabel: '单品详情',
                    summary: '先判断这件商品当前卡在经营、风险、用户还是订单承接，再决定回商品总盘、内容带货还是运营保障继续联动。',
                    focusItems: [
                        {
                            label: '看经营概览',
                            summary: '先看当前单品的漏斗、来源与内容带货承接。',
                            icon: 'fas fa-chart-line',
                            destination: 'analytics-product-detail',
                            context: { sectionId: 'productDetailSectionOperating', focusTargetId: 'productDetailSectionOperating' }
                        },
                        {
                            label: '看风险履约',
                            summary: '确认退款、履约与回写结论是否已经收口。',
                            icon: 'fas fa-triangle-exclamation',
                            destination: 'analytics-product-detail',
                            context: { sectionId: 'productDetailSectionRisk', focusTargetId: 'productDetailSectionRisk' }
                        },
                        {
                            label: '看用户承接',
                            summary: '继续看买家分层、复购去向和后续价值。',
                            icon: 'fas fa-users',
                            destination: 'analytics-product-detail',
                            context: { sectionId: 'productDetailSectionUsers', focusTargetId: 'productDetailSectionUsers' }
                        }
                    ],
                    relatedItems: [
                        {
                            label: '回商品经营',
                            summary: '回到总盘、榜单和漏斗判断这件商品在全站里的位置。',
                            icon: 'fas fa-box-open',
                            destination: 'analytics-product',
                            context: { sectionId: 'productOverviewSection', focusTargetId: 'productOverviewSection' }
                        },
                        {
                            label: '看内容带货',
                            summary: '回看哪些内容还在推动这件商品。',
                            icon: 'fas fa-store',
                            destination: 'analytics-content',
                            context: { sectionId: 'contentCommerceDetailSection', focusTargetId: 'contentCommerceDetailSection' }
                        },
                        {
                            label: '看运营保障',
                            summary: '确认支付、售后和履约有没有拖住承接。',
                            icon: 'fas fa-life-ring',
                            destination: 'analytics-ops',
                            context: { sectionId: 'opsCockpitOverviewSection', focusTargetId: 'opsCockpitOverviewSection' }
                        }
                    ],
                    sectionItems: getAnalyticsOperatingFocusSectionItems(activeTabId)
                };
            }

            return {
                routeLabel: '商品经营',
                summary: '先判断商品经营当前是放量、待复查还是仍异常，再继续排查预警、漏斗、榜单和单品详情。',
                focusItems: [
                    {
                        label: '看商品预警',
                        summary: '先处理库存、履约、退款、高曝光低转化等异常。',
                        icon: 'fas fa-siren-on',
                        destination: 'analytics-product',
                        context: { sectionId: 'productAlertsSection', focusTargetId: 'productAlertsSection' }
                    },
                    {
                        label: '看商品总盘',
                        summary: '确认成交、浏览、站点对比和类目结构。',
                        icon: 'fas fa-chart-line',
                        destination: 'analytics-product',
                        context: { sectionId: 'productOverviewSection', focusTargetId: 'productOverviewSection' }
                    },
                    {
                        label: '看单品详情',
                        summary: '下钻复查中的商品，直接看单品承接与回写结论。',
                        icon: 'fas fa-cube',
                        destination: 'analytics-product-detail',
                        context: { sectionId: 'productDetailPanelSection', focusTargetId: 'productDetailPanelSection' }
                    }
                ],
                relatedItems: [
                    {
                        label: '回经营总览',
                        summary: '看商品经营当前在全站里属于放量还是仍异常。',
                        icon: 'fas fa-compass-drafting',
                        destination: 'analytics-overview',
                        context: { sectionId: 'overviewOperatingNavigator', focusTargetId: 'overviewOperatingNavigator' }
                    },
                    {
                        label: '看内容带货',
                        summary: '回看哪些内容还在推动这批商品。',
                        icon: 'fas fa-store',
                        destination: 'analytics-content',
                        context: { sectionId: 'contentCommerceDetailSection', focusTargetId: 'contentCommerceDetailSection' }
                    },
                    {
                        label: '看运营保障',
                        summary: '确认支付、售后和履约有没有拖住承接。',
                        icon: 'fas fa-life-ring',
                        destination: 'analytics-ops',
                        context: { sectionId: 'opsCockpitOverviewSection', focusTargetId: 'opsCockpitOverviewSection' }
                    }
                ],
                sectionItems: getAnalyticsOperatingFocusSectionItems(activeTabId)
            };
        case 'ops':
            return {
                routeLabel: '运营保障',
                summary: '先看支付、售后、履约、验证和告警当前是否影响承接，再继续切到对应的问题列表和处理动作。',
                focusItems: [
                    {
                        label: '看运营总览',
                        summary: '先收口当前支付、工单、履约、验证和告警里最值得先看的问题。',
                        icon: 'fas fa-satellite-dish',
                        destination: 'analytics-ops',
                        context: { sectionId: 'opsCockpitOverviewSection', focusTargetId: 'opsCockpitOverviewSection' }
                    },
                    {
                        label: '看支付问题',
                        summary: '确认告警、死信、退款异常和待重试。',
                        icon: 'fas fa-credit-card',
                        destination: 'analytics-ops',
                        context: { sectionId: 'opsPaymentsSection', focusTargetId: 'opsPaymentsSection' }
                    },
                    {
                        label: '看售后工单',
                        summary: '确认当前积压、超时和高优工单。',
                        icon: 'fas fa-life-ring',
                        destination: 'analytics-ops',
                        context: { sectionId: 'opsTicketsSection', focusTargetId: 'opsTicketsSection' }
                    }
                ],
                relatedItems: [
                    {
                        label: '回经营总览',
                        summary: '看运营问题目前影响的是哪条经营线。',
                        icon: 'fas fa-compass-drafting',
                        destination: 'analytics-overview',
                        context: { sectionId: 'overviewOperatingNavigator', focusTargetId: 'overviewOperatingNavigator' }
                    },
                    {
                        label: '看商品经营',
                        summary: '回看运营异常正在影响哪些商品。',
                        icon: 'fas fa-box-open',
                        destination: 'analytics-product',
                        context: { sectionId: 'productAlertsSection', focusTargetId: 'productAlertsSection' }
                    },
                    {
                        label: '看用户影响',
                        summary: '确认这些运营问题有没有压住成交用户。',
                        icon: 'fas fa-users',
                        destination: 'analytics-overview',
                        context: { sectionId: 'userGrowthCommerceImpact', focusTargetId: 'userGrowthCommerceImpact' }
                    }
                ],
                sectionItems: getAnalyticsOperatingFocusSectionItems(activeTabId)
            };
        case 'overview':
        default:
            return {
                routeLabel: '总览',
                summary: '先看当前窗口最值得先看的经营线，再决定下钻到用户、内容、商品还是运营保障。',
                focusItems: [
                    {
                        label: '看今日待处理',
                        summary: '先确认当前窗口最急的待处理事项。',
                        icon: 'fas fa-clipboard-list',
                        destination: 'analytics-overview',
                        context: { sectionId: 'overviewDutyBoard', focusTargetId: 'overviewDutyBoard' }
                    },
                    {
                        label: '看经营导航',
                        summary: '快速判断四条经营线里谁最值得先看。',
                        icon: 'fas fa-compass-drafting',
                        destination: 'analytics-overview',
                        context: { sectionId: 'overviewOperatingNavigator', focusTargetId: 'overviewOperatingNavigator' }
                    },
                    {
                        label: '看经营主线',
                        summary: '继续看当前经营摘要和建议动作。',
                        icon: 'fas fa-route',
                        destination: 'analytics-overview',
                        context: { sectionId: 'overviewBusinessMix', focusTargetId: 'overviewBusinessMix' }
                    }
                ],
                relatedItems: [
                    {
                        label: '看用户影响',
                        summary: '确认商品经营现在主要影响到哪些用户。',
                        icon: 'fas fa-users',
                        destination: 'analytics-overview',
                        context: { sectionId: 'userGrowthCommerceImpact', focusTargetId: 'userGrowthCommerceImpact' }
                    },
                    {
                        label: '看内容带货',
                        summary: '确认带货内容当前处在起量、待转化还是带货中。',
                        icon: 'fas fa-fire',
                        destination: 'analytics-content',
                        context: { sectionId: 'topContentList', focusTargetId: 'topContentList' }
                    },
                    {
                        label: '看商品经营',
                        summary: '确认商品总盘、预警和单品详情的当前状态。',
                        icon: 'fas fa-box-open',
                        destination: 'analytics-product',
                        context: { sectionId: 'productOverviewSection', focusTargetId: 'productOverviewSection' }
                    },
                    {
                        label: '看运营保障',
                        summary: '确认支付、售后和验证有没有拖住承接。',
                        icon: 'fas fa-life-ring',
                        destination: 'analytics-ops',
                        context: { sectionId: 'opsCockpitOverviewSection', focusTargetId: 'opsCockpitOverviewSection' }
                    }
                ],
                sectionItems: getAnalyticsOperatingFocusSectionItems(activeTabId)
            };
    }
}

function renderAnalyticsOperatingFocusActions(items = [], variant = 'focus') {
    const safeItems = (Array.isArray(items) ? items : [])
        .filter((item) => item && String(item.destination || '').trim());
    if (!safeItems.length) {
        return '';
    }

    return `
        <div class="analytics-operating-focus__action-grid analytics-operating-focus__action-grid--${escapeHtml(variant)}">
            ${safeItems.map((item) => `
                <button
                    type="button"
                    class="analytics-operating-focus__action-card"
                    ${variant === 'sections' && getAnalyticsOperatingFocusSectionTargetId(item)
                        ? `data-analytics-focus-section-target="${escapeHtml(getAnalyticsOperatingFocusSectionTargetId(item))}"`
                        : ''}
                    ${buildAnalyticsProductDestinationAttrs(item.destination, item.context)}
                >
                    <span class="analytics-operating-focus__action-top">
                        <i class="${escapeHtml(item.icon || 'fas fa-arrow-right')}"></i>
                        <strong>${escapeHtml(item.label || '查看详情')}</strong>
                    </span>
                    ${item.summary ? `<span class="analytics-operating-focus__action-summary">${escapeHtml(item.summary)}</span>` : ''}
                </button>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsOperatingFocusWorkspace(cards = null) {
    const container = document.getElementById('analyticsOperatingFocusWorkspace');
    const meta = document.getElementById('analyticsOperatingFocusMeta');
    if (!container) {
        return;
    }

    const laneCards = Array.isArray(cards) ? cards.filter(Boolean) : getAnalyticsSectionNavigatorCardsState();
    const activeKey = getAnalyticsSectionNavigatorActiveKey() || 'overview';
    const activeTabId = getAnalyticsActiveTabId() || 'overview';
    const laneMap = new Map(laneCards.map((card) => [String(card?.key || '').trim(), card]));
    const activeCard = laneMap.get(activeKey) || laneMap.get('overview') || null;
    const staticConfig = getAnalyticsOperatingFocusStaticConfig(activeKey, activeTabId);

    if (!activeCard && !staticConfig) {
        container.innerHTML = renderHintState('fas fa-location-crosshairs', '当前经营视角暂无可用数据');
        if (meta) {
            meta.textContent = '当前经营视角暂无信号';
        }
        return;
    }

    const tone = activeCard?.tone || 'neutral';
    const statusLabel = activeCard?.statusLabel || '观察中';
    const routeLabel = staticConfig.routeLabel || activeCard?.navLabel || activeCard?.eyebrow || '当前视角';
    const title = activeCard?.title || routeLabel;
    const summary = activeCard?.summary || staticConfig.summary || '';
    const metrics = Array.isArray(activeCard?.metrics) ? activeCard.metrics.slice(0, 4) : [];
    const focusItems = staticConfig.focusItems || [];
    const relatedItems = staticConfig.relatedItems || [];
    const sectionItems = staticConfig.sectionItems || [];
    const sectionSnapshot = resolveAnalyticsOperatingFocusSectionSnapshot(activeTabId);
    const currentSectionLabel = sectionSnapshot.currentItem?.label || '当前分区待定位';
    const nextSectionLabel = sectionSnapshot.nextItem?.label || '当前已在本视角最后一个分区';

    container.innerHTML = `
        <div class="analytics-operating-focus__workspace analytics-operating-focus__workspace--${escapeHtml(tone)}">
            <div class="analytics-operating-focus__hero">
                <div class="analytics-operating-focus__hero-copy">
                    <div class="analytics-operating-focus__hero-top">
                        <span class="analytics-operating-focus__route">${escapeHtml(routeLabel)}</span>
                        ${renderAnalyticsNavigatorStatus(statusLabel, tone)}
                    </div>
                    <strong class="analytics-operating-focus__title">${escapeHtml(title)}</strong>
                    ${summary ? `<p class="analytics-operating-focus__summary">${escapeHtml(summary)}</p>` : ''}
                    <div class="analytics-operating-focus__section-summary">
                        <div class="analytics-operating-focus__section-summary-item">
                            <span class="analytics-operating-focus__section-badge analytics-operating-focus__section-badge--current" data-analytics-focus-current-badge ${sectionSnapshot.currentItem ? '' : 'hidden'}>当前分区</span>
                            <strong class="analytics-operating-focus__section-value" data-analytics-focus-current>${escapeHtml(currentSectionLabel)}</strong>
                        </div>
                        <div class="analytics-operating-focus__section-summary-item">
                            <span class="analytics-operating-focus__section-badge analytics-operating-focus__section-badge--next" data-analytics-focus-next-badge ${sectionSnapshot.nextItem ? '' : 'hidden'}>下一分区</span>
                            <span class="analytics-operating-focus__section-next" data-analytics-focus-next>${escapeHtml(nextSectionLabel)}</span>
                        </div>
                        <span class="analytics-operating-focus__section-count" data-analytics-focus-count>${escapeHtml(sectionItems.length ? `共 ${sectionItems.length} 个分区` : '当前视角暂无分区导航')}</span>
                    </div>
                </div>
                ${metrics.length
                    ? `<div class="analytics-operating-focus__metrics">
                        ${metrics.map((item) => `<span class="analytics-operating-focus__metric">${escapeHtml(item)}</span>`).join('')}
                    </div>`
                    : ''}
            </div>
            <div class="analytics-operating-focus__sections">
                <section class="analytics-operating-focus__section">
                    <div class="analytics-operating-focus__section-head">
                        <h4>这层先看</h4>
                        <span>先看本页最关键的分析区。</span>
                    </div>
                    ${renderAnalyticsOperatingFocusActions(focusItems, 'focus')}
                </section>
                <section class="analytics-operating-focus__section">
                    <div class="analytics-operating-focus__section-head">
                        <h4>相关经营线</h4>
                        <span>需要联动判断时，再看相邻经营线。</span>
                    </div>
                    ${renderAnalyticsOperatingFocusActions(relatedItems, 'related')}
                </section>
                <section class="analytics-operating-focus__section analytics-operating-focus__section--wide">
                    <div class="analytics-operating-focus__section-head">
                        <h4>视角内分区</h4>
                        <span>当前页常用入口。</span>
                    </div>
                    ${renderAnalyticsOperatingFocusActions(sectionItems, 'sections')}
                </section>
            </div>
        </div>
    `;

    if (meta) {
        meta.textContent = `${routeLabel} · ${statusLabel}`;
    }

    refreshAnalyticsOperatingFocusSectionActiveState();
}

window.renderAnalyticsOperatingFocusWorkspace = renderAnalyticsOperatingFocusWorkspace;

function renderAnalyticsOverviewNavigatorActions(actions = []) {
    const safeActions = (Array.isArray(actions) ? actions : [])
        .filter((action) => action && String(action.destination || '').trim())
        .slice(0, 2);

    if (!safeActions.length) {
        return '';
    }

    return `
        <div class="analytics-overview-navigator-card__actions">
            ${safeActions.map((action) => `
                <button
                    type="button"
                    class="btn-sm btn-secondary"
                    ${buildAnalyticsProductDestinationAttrs(action.destination, action.context)}
                >
                    <i class="${escapeHtml(action.icon || 'fas fa-arrow-right')}"></i> ${escapeHtml(action.label || '查看详情')}
                </button>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsSectionNavigatorActions(actions = []) {
    const safeActions = (Array.isArray(actions) ? actions : [])
        .filter((action) => action && String(action.destination || '').trim())
        .slice(0, 2);

    if (!safeActions.length) {
        return '';
    }

    return `
        <div class="analytics-section-navigator-card__actions">
            ${safeActions.map((action) => `
                <button
                    type="button"
                    class="btn-sm btn-secondary"
                    ${buildAnalyticsProductDestinationAttrs(action.destination, action.context)}
                >
                    <i class="${escapeHtml(action.icon || 'fas fa-arrow-right')}"></i> ${escapeHtml(action.label || '查看详情')}
                </button>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsSectionNavigatorEntryItems(entryItems = []) {
    const safeItems = (Array.isArray(entryItems) ? entryItems : [])
        .filter((item) => item && String(item.destination || '').trim())
        .slice(0, 3);

    if (!safeItems.length) {
        return '';
    }

    return `
        <div class="analytics-section-navigator-card__entry">
            <div class="analytics-section-navigator-card__entry-head">
                <span class="analytics-section-navigator-card__entry-badge" data-analytics-section-entry-badge>主入口</span>
                <span class="analytics-section-navigator-card__entry-count">${safeItems.length} 个入口</span>
            </div>
            <div class="analytics-section-navigator-card__entry-row">
                ${safeItems.map((item) => `
                    <button
                        type="button"
                        class="analytics-section-navigator-card__entry-chip"
                        ${buildAnalyticsProductDestinationAttrs(item.destination, item.context)}
                    >
                        ${escapeHtml(item.label || '进入')}
                    </button>
                `).join('')}
            </div>
        </div>
    `;
}

function renderAnalyticsNavigatorStatus(statusLabel = '观察中', tone = 'neutral') {
    const normalizedTone = String(tone || 'neutral').trim().toLowerCase() || 'neutral';
    return `<span class="analytics-nav-status-text analytics-nav-status-text--${escapeHtml(normalizedTone)}">${escapeHtml(statusLabel || '观察中')}</span>`;
}

function buildAnalyticsOperatingHubItems(cards = []) {
    return (Array.isArray(cards) ? cards : [])
        .filter(Boolean)
        .map((card) => {
            const entryItems = Array.isArray(card.entryItems) ? card.entryItems.slice(0, 3) : [];
            const primaryAction = entryItems[0] || (Array.isArray(card.actions) ? card.actions[0] : null) || null;
            return {
                key: String(card.key || '').trim(),
                navLabel: card.navLabel || card.eyebrow || '经营线',
                tone: card.tone || 'neutral',
                statusLabel: card.statusLabel || '观察中',
                title: card.title || card.navLabel || '经营入口',
                summary: card.summary || '',
                metrics: Array.isArray(card.metrics) ? card.metrics.slice(0, 2) : [],
                primaryAction,
                entryItems
            };
        })
        .filter((item) => item.key && item.primaryAction);
}

function buildAnalyticsBusinessCenterDeepLinkItem(activeCard = null, routeState = null) {
    const normalizedRouteState = routeState && typeof routeState === 'object' ? routeState : getAnalyticsRouteState();
    const currentView = normalizeAnalyticsRouteTabId(normalizedRouteState?.view || '') || getAnalyticsActiveTabId() || 'overview';
    const sectionId = String(normalizedRouteState?.sectionId || '').trim();
    const promptId = String(normalizedRouteState?.promptId || '').trim();
    const productId = String(normalizedRouteState?.productId || '').trim();
    const detailFocus = String(normalizedRouteState?.detailFocus || '').trim();
    const sectionItems = getAnalyticsOperatingFocusSectionItems(currentView);
    const matchedSection = sectionItems.find((item) => getAnalyticsOperatingFocusSectionTargetId(item) === sectionId) || null;

    if ((currentView === 'product' || currentView === 'product-detail') && productId) {
        return {
            badge: '单品详情',
            title: '回当前单品详情',
            summary: '继续查看当前单品的承接链、复查结论和经营动作。',
            action: {
                label: '回单品详情',
                destination: 'analytics-product-detail',
                context: {
                    productId,
                    detailFocus,
                    sectionId: sectionId || 'productDetailPanelSection',
                    focusTargetId: sectionId || 'productDetailPanelSection'
                }
            }
        };
    }

    if (currentView === 'content' && promptId) {
        return {
            badge: '带货详情',
            title: '回当前内容带货详情',
            summary: '继续查看这条内容的带货商品、用户样本和订单样本。',
            action: {
                label: '回带货详情',
                destination: 'analytics-content',
                context: {
                    promptId,
                    sectionId: sectionId || 'contentCommerceDetailSection',
                    focusTargetId: sectionId || 'contentCommerceDetailSection'
                }
            }
        };
    }

    if (sectionId && currentView) {
        const routeLabel = matchedSection?.label || '当前分区';
        return {
            badge: '页内分区',
            title: `回 ${routeLabel}`,
            summary: '继续回到当前经营线里的焦点分区，不用重新在页面里找。',
            action: {
                label: `回 ${routeLabel}`,
                destination: `analytics-${currentView}`,
                context: {
                    sectionId,
                    focusTargetId: sectionId
                }
            }
        };
    }

    const fallbackAction = (Array.isArray(activeCard?.entryItems) ? activeCard.entryItems[0] : null)
        || (Array.isArray(activeCard?.actions) ? activeCard.actions[0] : null)
        || null;
    if (!fallbackAction) {
        return {
            badge: '常用入口',
            title: '从经营中心入口开始',
            summary: '当前没有可恢复的深链焦点，可以直接从当前经营入口继续下钻。',
            action: null
        };
    }

    return {
        badge: '常用入口',
        title: '回当前经营入口',
        summary: '当前没有单独的详情深链，直接回到这条经营线的主入口继续判断。',
        action: fallbackAction
    };
}

function buildAnalyticsBusinessCenterShellState(cards = null) {
    const laneCards = Array.isArray(cards) ? cards.filter(Boolean) : getAnalyticsSectionNavigatorCardsState();
    if (!laneCards.length) {
        return null;
    }

    const sectionCards = buildAnalyticsSectionNavigatorCards({ laneCards });
    const activeKey = getAnalyticsSectionNavigatorActiveKey() || 'overview';
    const activeCard = sectionCards.find((card) => card?.key === activeKey)
        || sectionCards.find((card) => card?.key === 'overview')
        || sectionCards[0]
        || null;
    if (!activeCard) {
        return null;
    }

    const activeTabId = getAnalyticsActiveTabId() || activeKey || 'overview';
    const sectionSnapshot = resolveAnalyticsOperatingFocusSectionSnapshot(activeTabId);
    const currentSectionLabel = sectionSnapshot.currentItem?.label || '当前分区待定位';
    const deepLinkItem = buildAnalyticsBusinessCenterDeepLinkItem(activeCard, getAnalyticsRouteState());
    const watchCards = sectionCards
        .filter((card) => card?.key && card.key !== activeCard.key)
        .sort((left, right) => getAnalyticsSectionNavigatorTonePriority(left?.tone) - getAnalyticsSectionNavigatorTonePriority(right?.tone))
        .slice(0, 3);
    const highlightedCards = watchCards
        .filter((card) => ['danger', 'warning', 'accent'].includes(String(card?.tone || '').trim().toLowerCase()))
        .slice(0, 2);
    const highlightedLabels = highlightedCards
        .map((card) => String(card?.navLabel || card?.eyebrow || card?.title || '').trim())
        .filter(Boolean);
    const activeLabel = activeCard.navLabel || activeCard.eyebrow || activeCard.title || '当前经营线';
    const title = activeCard.key === 'overview'
        ? '先看经营总览'
        : `当前先看 ${activeLabel}`;
    const summary = activeCard.key === 'overview'
        ? (highlightedLabels.length
            ? `先从总览判断当前窗口的重点，再继续留意 ${highlightedLabels.join(' / ')}。`
            : '先从总览判断当前窗口的重点，再顺着用户、内容、商品和运营保障继续看。')
        : `${activeCard.summary || '当前经营线已切成主入口。'}${highlightedLabels.length ? ` 同时继续留意 ${highlightedLabels.join(' / ')}。` : ''}`;
    const metrics = [
        `${activeLabel} ${activeCard.statusLabel || '观察中'}`,
        sectionSnapshot.items.length ? `当前分区 ${currentSectionLabel}` : '当前分区待定位',
        `共 ${sectionCards.length} 条经营线`
    ];
    if (deepLinkItem?.badge) {
        metrics.push(`可恢复 ${deepLinkItem.badge}`);
    }

    return {
        tone: activeCard.tone || 'neutral',
        statusLabel: activeCard.statusLabel || '观察中',
        routeLabel: activeLabel,
        title,
        summary,
        metrics,
        currentSectionLabel,
        activeCard,
        sectionCards,
        watchCards,
        deepLinkItem,
        meta: `${activeLabel} · ${activeCard.statusLabel || '观察中'}`
    };
}

function buildAnalyticsBusinessCenterCloseoutState(cards = []) {
    const lineCards = (Array.isArray(cards) ? cards : [])
        .filter((card) => card && card.key && card.key !== 'overview');
    if (!lineCards.length) {
        return null;
    }

    const normalizeTone = (value) => String(value || 'neutral').trim().toLowerCase();
    const abnormalCards = lineCards.filter((card) => normalizeTone(card.tone) === 'danger');
    const reviewCards = lineCards.filter((card) => ['warning', 'accent'].includes(normalizeTone(card.tone)));
    const settledCards = lineCards.filter((card) => !abnormalCards.includes(card) && !reviewCards.includes(card));
    const topPendingCard = abnormalCards[0] || reviewCards[0] || null;
    const resolvedCount = settledCards.length;
    const totalCount = lineCards.length;
    const completionPercent = Math.max(0, Math.min(100, Math.round((resolvedCount / Math.max(1, totalCount)) * 100)));

    let tone = 'success';
    let statusLabel = '已收口';
    let title = '当前整体进入稳定观察';
    let summary = `当前 ${formatNumber(totalCount)} 条主线里，已有 ${formatNumber(resolvedCount)} 条进入稳定巡检或已收口状态。`;

    if (abnormalCards.length > 0) {
        tone = 'danger';
        statusLabel = '仍有异常';
        title = '当前仍有异常需要优先处理';
        summary = `${abnormalCards.map((card) => card.navLabel || card.eyebrow || card.title || '经营线').join(' / ')} 仍在异常态，建议先处理 ${topPendingCard?.navLabel || topPendingCard?.eyebrow || '对应经营线'}。`;
    } else if (reviewCards.length > 0) {
        tone = 'warning';
        statusLabel = '待复查';
        title = '当前重点在线索复查';
        summary = `${reviewCards.map((card) => card.navLabel || card.eyebrow || card.title || '经营线').join(' / ')} 还在复查或待转化阶段，建议继续跟进。`;
    }

    const lines = lineCards.map((card) => {
        const cardTone = normalizeTone(card.tone);
        const primaryAction = (Array.isArray(card.entryItems) ? card.entryItems[0] : null)
            || (Array.isArray(card.actions) ? card.actions[0] : null)
            || null;
        return {
            key: card.key,
            label: card.navLabel || card.eyebrow || card.title || '经营线',
            tone: cardTone,
            statusLabel: card.statusLabel || (cardTone === 'danger' ? '仍异常' : (cardTone === 'warning' ? '待复查' : '已收口')),
            summary: card.summary || '',
            primaryAction
        };
    });

    const metrics = [
        `主线 ${formatNumber(totalCount)} 条`,
        `已收口 ${formatNumber(resolvedCount)}`,
        reviewCards.length ? `待复查 ${formatNumber(reviewCards.length)}` : '',
        abnormalCards.length ? `仍异常 ${formatNumber(abnormalCards.length)}` : '',
        `完成度 ${formatNumber(completionPercent)}%`
    ].filter(Boolean);

    const nextAction = topPendingCard
        ? ((Array.isArray(topPendingCard.entryItems) ? topPendingCard.entryItems[0] : null)
            || (Array.isArray(topPendingCard.actions) ? topPendingCard.actions[0] : null)
            || null)
        : {
            label: '看经营总览',
            destination: 'analytics-overview',
            context: {
                sectionId: 'overviewOperatingNavigator',
                focusTargetId: 'overviewOperatingNavigator'
            }
        };

    return {
        tone,
        statusLabel,
        title,
        summary,
        metrics,
        lines,
        nextAction
    };
}

function renderAnalyticsBusinessCenterCloseoutCard(state = null) {
    if (!state) {
        return '';
    }

    return `
        <article class="analytics-business-center-shell__card analytics-business-center-shell__card--${escapeHtml(state.tone || 'neutral')} analytics-business-center-shell__card--closeout">
            <div class="analytics-business-center-shell__card-top">
                <span class="analytics-business-center-shell__card-label">当前状态</span>
                ${renderAnalyticsNavigatorStatus(state.statusLabel || '观察中', state.tone || 'neutral')}
            </div>
            <strong class="analytics-business-center-shell__card-title">${escapeHtml(state.title || '经营分析主线')}</strong>
            ${state.summary ? `<p class="analytics-business-center-shell__card-summary">${escapeHtml(state.summary)}</p>` : ''}
            <div class="analytics-business-center-shell__hero-metrics">
                ${(Array.isArray(state.metrics) ? state.metrics : []).map((metric) => `<span class="analytics-business-center-shell__metric">${escapeHtml(metric)}</span>`).join('')}
            </div>
            <div class="analytics-business-center-shell__closeout-list">
                ${(Array.isArray(state.lines) ? state.lines : []).map((item) => `
                    <div class="analytics-business-center-shell__closeout-item analytics-business-center-shell__closeout-item--${escapeHtml(item.tone || 'neutral')}">
                        <div class="analytics-business-center-shell__closeout-top">
                            <strong>${escapeHtml(item.label || '经营线')}</strong>
                            ${renderAnalyticsNavigatorStatus(item.statusLabel || '观察中', item.tone || 'neutral')}
                        </div>
                        ${item.summary ? `<p class="analytics-business-center-shell__closeout-summary">${escapeHtml(item.summary)}</p>` : ''}
                        ${item.primaryAction
                            ? `<button
                                type="button"
                                class="analytics-business-center-shell__entry-chip"
                                ${buildAnalyticsProductDestinationAttrs(item.primaryAction.destination, item.primaryAction.context)}
                            >
                                ${escapeHtml(item.primaryAction.label || '进入')}
                            </button>`
                            : ''}
                    </div>
                `).join('')}
            </div>
            ${state.nextAction
                ? `<button
                    type="button"
                    class="analytics-business-center-shell__primary"
                    ${buildAnalyticsProductDestinationAttrs(state.nextAction.destination, state.nextAction.context)}
                >
                    <i class="fas fa-arrow-right"></i>
                    <span>${escapeHtml(state.nextAction.label || '看下一条主线')}</span>
                </button>`
                : ''}
        </article>
    `;
}

function renderAnalyticsBusinessCenterWatchItems(items = []) {
    const safeItems = (Array.isArray(items) ? items : [])
        .filter((item) => item && item.key)
        .slice(0, 3);
    if (!safeItems.length) {
        return `
            <div class="analytics-business-center-shell__empty">
                当前没有额外需要优先看的经营线，可先顺着当前入口继续判断。
            </div>
        `;
    }

    return `
        <div class="analytics-business-center-shell__watch-list">
            ${safeItems.map((item) => {
                const primaryAction = (Array.isArray(item.entryItems) ? item.entryItems[0] : null)
                    || (Array.isArray(item.actions) ? item.actions[0] : null)
                    || null;
                return `
                    <article
                        class="analytics-business-center-shell__watch-item analytics-business-center-shell__watch-item--${escapeHtml(item.tone || 'neutral')}"
                        data-analytics-section-key="${escapeHtml(item.key || '')}"
                        aria-current="false"
                    >
                        <div class="analytics-business-center-shell__watch-top">
                            <span class="analytics-business-center-shell__watch-route">${escapeHtml(item.navLabel || item.eyebrow || '经营线')}</span>
                            ${renderAnalyticsNavigatorStatus(item.statusLabel || '观察中', item.tone || 'neutral')}
                        </div>
                        <strong class="analytics-business-center-shell__watch-title">${escapeHtml(item.title || item.navLabel || '经营线')}</strong>
                        ${item.summary ? `<p class="analytics-business-center-shell__watch-summary">${escapeHtml(item.summary)}</p>` : ''}
                        ${primaryAction
                            ? `<button
                                type="button"
                                class="analytics-business-center-shell__watch-action"
                                ${buildAnalyticsProductDestinationAttrs(primaryAction.destination, primaryAction.context)}
                            >
                                <i class="fas fa-arrow-right"></i>
                                <span>${escapeHtml(primaryAction.label || '进入')}</span>
                            </button>`
                            : ''}
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

function renderAnalyticsBusinessCenterShell(cards = null) {
    const container = document.getElementById('analyticsBusinessCenterShell');
    const meta = document.getElementById('analyticsBusinessCenterShellMeta');
    if (!container) {
        return;
    }

    const state = buildAnalyticsBusinessCenterShellState(cards);
    if (!state) {
        container.innerHTML = renderHintState('fas fa-layer-group', '当前窗口暂无经营分析中心数据');
        if (meta) {
            meta.textContent = '当前窗口暂无经营中心信号';
        }
        return;
    }

    const entryItems = Array.isArray(state.activeCard?.entryItems) ? state.activeCard.entryItems.slice(0, 3) : [];
    const primaryAction = entryItems[0]
        || (Array.isArray(state.activeCard?.actions) ? state.activeCard.actions[0] : null)
        || null;
    const closeoutState = buildAnalyticsBusinessCenterCloseoutState(state.sectionCards);

    container.innerHTML = `
        <div class="analytics-business-center-shell__workspace analytics-business-center-shell__workspace--${escapeHtml(state.tone || 'neutral')}">
            <div class="analytics-business-center-shell__hero">
                <div class="analytics-business-center-shell__hero-copy">
                    <div class="analytics-business-center-shell__hero-top">
                        <span class="analytics-business-center-shell__route">经营分析中心</span>
                        ${renderAnalyticsNavigatorStatus(state.statusLabel || '观察中', state.tone || 'neutral')}
                    </div>
                    <strong class="analytics-business-center-shell__title">${escapeHtml(state.title || '经营分析中心')}</strong>
                    ${state.summary ? `<p class="analytics-business-center-shell__summary">${escapeHtml(state.summary)}</p>` : ''}
                    <div class="analytics-business-center-shell__hero-metrics">
                        ${state.metrics.map((metric) => `<span class="analytics-business-center-shell__metric">${escapeHtml(metric)}</span>`).join('')}
                    </div>
                </div>
            </div>
            <div class="analytics-business-center-shell__grid">
                <div class="analytics-business-center-shell__lead-grid">
                    <article
                        class="analytics-business-center-shell__card analytics-business-center-shell__card--${escapeHtml(state.tone || 'neutral')}"
                        data-analytics-section-key="${escapeHtml(state.activeCard?.key || '')}"
                        aria-current="false"
                    >
                        <div class="analytics-business-center-shell__card-top">
                            <span class="analytics-business-center-shell__card-label" data-analytics-center-badge>当前经营线</span>
                            <div class="analytics-business-center-shell__card-meta">${escapeHtml(state.routeLabel || '当前经营线')}</div>
                        </div>
                        <strong class="analytics-business-center-shell__card-title">${escapeHtml(state.activeCard?.title || state.routeLabel || '当前经营入口')}</strong>
                        ${state.activeCard?.summary ? `<p class="analytics-business-center-shell__card-summary">${escapeHtml(state.activeCard.summary)}</p>` : ''}
                        ${primaryAction
                            ? `<button
                                type="button"
                                class="analytics-business-center-shell__primary"
                                ${buildAnalyticsProductDestinationAttrs(primaryAction.destination, primaryAction.context)}
                            >
                                <i class="fas fa-arrow-right"></i>
                                <span>${escapeHtml(primaryAction.label || '进入当前经营入口')}</span>
                            </button>`
                            : ''}
                        ${entryItems.length
                            ? `<div class="analytics-business-center-shell__entry-row">
                                ${entryItems.map((entry) => `
                                    <button
                                        type="button"
                                        class="analytics-business-center-shell__entry-chip"
                                        ${buildAnalyticsProductDestinationAttrs(entry.destination, entry.context)}
                                    >
                                        ${escapeHtml(entry.label || '进入')}
                                    </button>
                                `).join('')}
                            </div>`
                            : ''}
                    </article>
                    <article class="analytics-business-center-shell__card analytics-business-center-shell__card--route">
                        <div class="analytics-business-center-shell__card-top">
                            <span class="analytics-business-center-shell__card-label">最近查看</span>
                            <div class="analytics-business-center-shell__card-meta">${escapeHtml(state.deepLinkItem?.badge || '常用入口')}</div>
                        </div>
                        <strong class="analytics-business-center-shell__card-title">${escapeHtml(state.deepLinkItem?.title || '回当前经营入口')}</strong>
                        ${state.deepLinkItem?.summary ? `<p class="analytics-business-center-shell__card-summary">${escapeHtml(state.deepLinkItem.summary)}</p>` : ''}
                        ${state.deepLinkItem?.action
                            ? `<button
                                type="button"
                                class="analytics-business-center-shell__primary analytics-business-center-shell__primary--ghost"
                                ${buildAnalyticsProductDestinationAttrs(state.deepLinkItem.action.destination, state.deepLinkItem.action.context)}
                            >
                                <i class="fas fa-location-arrow"></i>
                                <span>${escapeHtml(state.deepLinkItem.action.label || '恢复当前深链')}</span>
                            </button>`
                            : ''}
                    </article>
                </div>
                <article class="analytics-business-center-shell__card analytics-business-center-shell__card--watch">
                    <div class="analytics-business-center-shell__card-top">
                        <span class="analytics-business-center-shell__card-label">继续关注</span>
                        <div class="analytics-business-center-shell__card-meta">${escapeHtml(`${state.watchCards.length} 条经营线`)}</div>
                    </div>
                    <strong class="analytics-business-center-shell__card-title">继续关注</strong>
                    ${renderAnalyticsBusinessCenterWatchItems(state.watchCards)}
                </article>
                ${renderAnalyticsBusinessCenterCloseoutCard(closeoutState)}
            </div>
        </div>
    `;

    if (meta) {
        meta.textContent = state.meta;
    }

    refreshAnalyticsSectionNavigatorActiveState();
}

window.renderAnalyticsBusinessCenterShell = renderAnalyticsBusinessCenterShell;

function renderAnalyticsOperatingHub(items = []) {
    const safeItems = (Array.isArray(items) ? items : []).filter(Boolean);
    if (!safeItems.length) {
        return renderHintState('fas fa-sitemap', '当前窗口暂无经营中心入口数据');
    }

    return `
        <div class="analytics-operating-hub__grid">
            ${safeItems.map((item) => `
                <article
                    class="analytics-operating-hub__item analytics-operating-hub__item--${escapeHtml(item.tone || 'neutral')}"
                    data-analytics-section-key="${escapeHtml(item.key || '')}"
                    aria-current="false"
                >
                    <div class="analytics-operating-hub__item-top">
                        <span class="analytics-operating-hub__route">${escapeHtml(item.navLabel || '经营线')}</span>
                        ${renderAnalyticsNavigatorStatus(item.statusLabel || '观察中', item.tone || 'neutral')}
                    </div>
                    <strong class="analytics-operating-hub__title">${escapeHtml(item.title || item.navLabel || '经营入口')}</strong>
                    <p class="analytics-operating-hub__summary">${escapeHtml(item.summary || '')}</p>
                    <div class="analytics-operating-hub__entry-head">
                        <span class="analytics-operating-hub__badge" data-analytics-hub-badge>经营入口</span>
                        <span class="analytics-operating-hub__entry-count">${escapeHtml(`${item.entryItems.length || 1} 个入口`)}</span>
                    </div>
                    <button
                        type="button"
                        class="analytics-operating-hub__primary"
                        ${buildAnalyticsProductDestinationAttrs(item.primaryAction.destination, item.primaryAction.context)}
                    >
                        <i class="fas fa-arrow-right"></i>
                        <span>${escapeHtml(item.primaryAction.label || '进入')}</span>
                    </button>
                    ${item.entryItems.length
                        ? `<div class="analytics-operating-hub__entry-row">
                            ${item.entryItems.map((entry) => `
                                <button
                                    type="button"
                                    class="analytics-operating-hub__entry-chip"
                                    ${buildAnalyticsProductDestinationAttrs(entry.destination, entry.context)}
                                >
                                    ${escapeHtml(entry.label || '进入')}
                                </button>
                            `).join('')}
                        </div>`
                        : ''}
                    ${item.metrics.length
                        ? `<div class="analytics-operating-hub__metrics">
                            ${item.metrics.map((metric) => `<span class="analytics-operating-hub__metric">${escapeHtml(metric)}</span>`).join('')}
                        </div>`
                        : ''}
                </article>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsOverviewNavigator(cards = []) {
    if (!Array.isArray(cards) || cards.length === 0) {
        return renderHintState('fas fa-compass-drafting', '当前窗口暂无经营导航数据');
    }

    return `
        <div class="analytics-overview-navigator">
            <div class="analytics-overview-navigator__summary">
                <strong>把当前窗口最值得先看的四条经营线放在一起</strong>
                <span>先判断状态，再直接下钻到用户、内容、商品或运营保障处理页。</span>
            </div>
            <div class="analytics-overview-navigator__grid">
                ${cards.map((card) => `
                    <article class="analytics-overview-navigator-card analytics-overview-navigator-card--${escapeHtml(card.tone || 'neutral')}">
                        <div class="analytics-overview-navigator-card__top">
                            <span class="analytics-overview-navigator-card__eyebrow">${escapeHtml(card.eyebrow || '经营导航')}</span>
                            ${renderAnalyticsNavigatorStatus(card.statusLabel || '观察中', card.tone || 'neutral')}
                        </div>
                        <strong class="analytics-overview-navigator-card__title">${escapeHtml(card.title || '经营导航')}</strong>
                        <p class="analytics-overview-navigator-card__summary">${escapeHtml(card.summary || '')}</p>
                        ${Array.isArray(card.metrics) && card.metrics.length > 0
                            ? `<div class="analytics-overview-navigator-card__metrics">
                                ${card.metrics.map((item) => `<span class="analytics-overview-navigator-card__metric">${escapeHtml(item)}</span>`).join('')}
                            </div>`
                            : ''}
                        ${renderAnalyticsOverviewNavigatorActions(card.actions)}
                    </article>
                `).join('')}
            </div>
        </div>
    `;
}

function buildAnalyticsSectionNavigatorOverviewCard(cards = []) {
    const safeCards = (Array.isArray(cards) ? cards : []).filter(Boolean);
    const prioritized = safeCards
        .slice()
        .sort((left, right) => getAnalyticsSectionNavigatorTonePriority(left?.tone) - getAnalyticsSectionNavigatorTonePriority(right?.tone));
    const focusCards = prioritized
        .filter((card) => ['danger', 'warning', 'accent'].includes(String(card?.tone || '').trim().toLowerCase()))
        .slice(0, 2);
    const focusLabels = focusCards.map((card) => String(card?.eyebrow || card?.title || '经营线').trim()).filter(Boolean);
    const hasDanger = focusCards.some((card) => String(card?.tone || '').trim().toLowerCase() === 'danger');
    const hasWarning = focusCards.some((card) => String(card?.tone || '').trim().toLowerCase() === 'warning');
    const tone = focusCards[0]?.tone || (safeCards.length ? 'success' : 'neutral');
    const statusLabel = focusLabels.length
        ? (hasDanger ? '待处理' : (hasWarning ? '待跟进' : '需放量'))
        : '平稳中';
    const title = focusLabels.length
        ? `当前更值得先看 ${focusLabels.join(' / ')}`
        : '当前窗口的经营主线暂时平稳';
    const summary = focusLabels.length
        ? `先从 ${focusLabels.join(' / ')} 判断当前窗口的经营状态，再继续下钻到对应处理页。`
        : '把用户、内容、商品和运营承接收在同一层，当前可以直接按经营层次巡检。';

    return {
        key: 'overview',
        navLabel: '总览',
        tone,
        statusLabel,
        title,
        summary,
        entryItems: buildAnalyticsSectionNavigatorEntryItems({ key: 'overview' }),
        metrics: safeCards
            .map((card) => `${card.eyebrow || '经营'} ${card.statusLabel || '观察中'}`)
            .slice(0, 4),
        actions: [
            {
                label: '回总览',
                destination: 'analytics-overview',
                icon: 'fas fa-compass-drafting',
                context: {
                    sectionId: 'overviewOperatingNavigator',
                    focusTargetId: 'overviewOperatingNavigator'
                }
            },
            {
                label: '看建议动作',
                destination: 'analytics-overview',
                icon: 'fas fa-list-check',
                context: {
                    sectionId: 'overviewActionRecommendations',
                    focusTargetId: 'overviewActionRecommendations'
                }
            }
        ]
    };
}

function buildAnalyticsSectionNavigatorCards(source = {}) {
    const laneCards = Array.isArray(source?.laneCards) && source.laneCards.length > 0
        ? source.laneCards.filter(Boolean)
        : buildAnalyticsOverviewNavigatorCards(source);
    const laneMap = new Map(laneCards.map((card) => [String(card?.key || '').trim(), card]));
    const userCard = laneMap.get('user') || null;
    const contentCard = laneMap.get('content') || null;
    const productCard = laneMap.get('product') || null;
    const opsCard = laneMap.get('ops') || null;

    return [
        buildAnalyticsSectionNavigatorOverviewCard(laneCards),
        userCard ? {
            key: 'user',
            navLabel: '用户影响',
            tone: userCard.tone || 'neutral',
            statusLabel: userCard.statusLabel || '观察中',
            title: userCard.title || '用户影响',
            summary: userCard.summary || '',
            metrics: Array.isArray(userCard.metrics) ? userCard.metrics.slice(0, 3) : [],
            entryItems: buildAnalyticsSectionNavigatorEntryItems({ key: 'user' }),
            actions: Array.isArray(userCard.actions) ? userCard.actions.slice(0, 2) : []
        } : null,
        contentCard ? {
            key: 'content',
            navLabel: '内容带货',
            tone: contentCard.tone || 'neutral',
            statusLabel: contentCard.statusLabel || '观察中',
            title: contentCard.title || '内容带货',
            summary: contentCard.summary || '',
            metrics: Array.isArray(contentCard.metrics) ? contentCard.metrics.slice(0, 3) : [],
            entryItems: buildAnalyticsSectionNavigatorEntryItems({ key: 'content' }),
            actions: Array.isArray(contentCard.actions) ? contentCard.actions.slice(0, 2) : []
        } : null,
        productCard ? {
            key: 'product',
            navLabel: '商品经营',
            tone: productCard.tone || 'neutral',
            statusLabel: productCard.statusLabel || '观察中',
            title: productCard.title || '商品经营',
            summary: productCard.summary || '',
            metrics: Array.isArray(productCard.metrics) ? productCard.metrics.slice(0, 3) : [],
            entryItems: buildAnalyticsSectionNavigatorEntryItems({ key: 'product' }),
            actions: Array.isArray(productCard.actions) ? productCard.actions.slice(0, 2) : []
        } : null,
        opsCard ? {
            key: 'ops',
            navLabel: '运营保障',
            tone: opsCard.tone || 'neutral',
            statusLabel: opsCard.statusLabel || '观察中',
            title: opsCard.title || '运营保障',
            summary: opsCard.summary || '',
            metrics: Array.isArray(opsCard.metrics) ? opsCard.metrics.slice(0, 3) : [],
            entryItems: buildAnalyticsSectionNavigatorEntryItems({ key: 'ops' }),
            actions: Array.isArray(opsCard.actions) ? opsCard.actions.slice(0, 2) : []
        } : null
    ].filter(Boolean);
}

function buildAnalyticsSectionNavigatorMeta(cards = []) {
    return (Array.isArray(cards) ? cards : [])
        .map((card) => `${card.navLabel || card.eyebrow || '经营'} ${card.statusLabel || '观察中'}`)
        .join(' · ') || '总览 / 用户影响 / 内容经营 / 商品经营 / 单品详情 / 运营保障';
}

function renderAnalyticsSectionNavigator(cards = []) {
    if (!Array.isArray(cards) || cards.length === 0) {
        return renderHintState('fas fa-diagram-project', '当前窗口暂无经营分层导航数据');
    }

    return `
        <div class="analytics-section-navigator__grid">
            ${cards.map((card) => `
                <article
                    class="analytics-section-navigator-card analytics-section-navigator-card--${escapeHtml(card.tone || 'neutral')}"
                    data-analytics-section-key="${escapeHtml(card.key || '')}"
                    aria-current="false"
                >
                    <div class="analytics-section-navigator-card__top">
                        <span class="analytics-section-navigator-card__route">${escapeHtml(card.navLabel || card.eyebrow || '经营')}</span>
                        ${renderAnalyticsNavigatorStatus(card.statusLabel || '观察中', card.tone || 'neutral')}
                    </div>
                    <strong class="analytics-section-navigator-card__title">${escapeHtml(card.title || card.navLabel || '经营分层')}</strong>
                    <p class="analytics-section-navigator-card__summary">${escapeHtml(card.summary || '')}</p>
                    ${renderAnalyticsSectionNavigatorEntryItems(card.entryItems)}
                    ${Array.isArray(card.metrics) && card.metrics.length > 0
                        ? `<div class="analytics-section-navigator-card__metrics">
                            ${card.metrics.map((item) => `<span class="analytics-section-navigator-card__metric">${escapeHtml(item)}</span>`).join('')}
                        </div>`
                        : ''}
                    ${renderAnalyticsSectionNavigatorActions(card.actions)}
                </article>
            `).join('')}
        </div>
    `;
}

function buildAnalyticsOverviewNavigatorUserCard({ summaryWindow = {}, productSummary = {} } = {}) {
    const userValueOverview = buildAnalyticsUserValueOverviewState({
        summaryWindow,
        productSummary
    });
    const userTrendRows = Array.isArray(userValueOverview?.userTrendRows) ? userValueOverview.userTrendRows : [];
    const commerceImpact = buildAnalyticsUserCommerceImpactSummary(productSummary, userTrendRows);
    const userValueSummary = userValueOverview?.summary || {};
    const feedbackEntries = Array.isArray(userValueOverview?.feedbackEntries) ? userValueOverview.feedbackEntries : [];
    const prioritySummary = userValueOverview?.prioritySummary || null;
    const verificationState = userValueOverview?.verificationState || null;
    const digest = userValueOverview?.digest || null;
    const statusSummary = userValueOverview?.statusSummary || {};
    const latestEntry = userValueOverview?.latestEntry || null;
    const newUsers = normalizeAnalyticsCountValue(userValueOverview?.newUsers);
    const activeUsers = normalizeAnalyticsCountValue(userValueOverview?.activeUsers);
    const viewUsers = normalizeAnalyticsCountValue(userValueOverview?.viewUsers);
    const detailUsers = normalizeAnalyticsCountValue(userValueOverview?.detailUsers);
    const intentUsers = normalizeAnalyticsCountValue(userValueOverview?.intentUsers);
    const buyerUsers = normalizeAnalyticsCountValue(userValueOverview?.buyerUsers);

    let tone = 'neutral';
    let statusLabel = '观察中';
    let title = '用户增长当前以自然活跃为主';
    let summary = `当前窗口新增 ${formatNumber(newUsers)}，业务活跃 ${formatNumber(activeUsers)}。`;
    let metrics = [
        `新增 ${formatNumber(newUsers)}`,
        `活跃 ${formatNumber(activeUsers)}`,
        `浏览 ${formatNumber(viewUsers)}`,
        `详情 ${formatNumber(detailUsers)}`,
        `意图 ${formatNumber(intentUsers)}`,
        `成交 ${formatNumber(buyerUsers)}`
    ].filter(Boolean);
    let leadingActions = [];

    if (prioritySummary?.topItem) {
        tone = verificationState?.tone || prioritySummary.tone || 'warning';
        statusLabel = digest?.label || verificationState?.label || prioritySummary.statusLabel || '建议复核';
        title = prioritySummary.title || '用户价值复查项';
        summary = [
            prioritySummary.summary || '',
            latestEntry?.createdAt ? `最近回写 ${formatAnalyticsResolutionFeedbackRelativeTime(latestEntry.createdAt)}` : ''
        ].filter(Boolean).join('，') || summary;
        metrics = [
            digest?.label || '',
            prioritySummary.topItem?.meta ? String(prioritySummary.topItem.meta).trim() : '',
            Number(statusSummary.review || 0) > 0 ? `待复查 ${formatNumber(statusSummary.review || 0)}` : '',
            Number(statusSummary.abnormal || 0) > 0 ? `仍异常 ${formatNumber(statusSummary.abnormal || 0)}` : '',
            Number(statusSummary.resolved || 0) > 0 ? `已处理 ${formatNumber(statusSummary.resolved || 0)}` : '',
            latestEntry?.createdAt ? `回写 ${formatAnalyticsResolutionFeedbackRelativeTime(latestEntry.createdAt)}` : ''
        ].filter(Boolean).slice(0, 4);
        leadingActions = Array.isArray(prioritySummary.actions) ? prioritySummary.actions.slice(0, 2) : [];
    } else if (feedbackEntries.length && digest) {
        tone = verificationState?.tone || digest.tone || 'warning';
        statusLabel = digest.label || verificationState?.label || '待复查';
        title = digest.title || '本轮用户价值结论';
        summary = [
            digest.summary || '',
            digest.guidance || ''
        ].filter(Boolean).join(' ') || summary;
        metrics = [
            digest.label || '',
            Number(statusSummary.review || 0) > 0 ? `待复查 ${formatNumber(statusSummary.review || 0)}` : '',
            Number(statusSummary.abnormal || 0) > 0 ? `仍异常 ${formatNumber(statusSummary.abnormal || 0)}` : '',
            Number(statusSummary.resolved || 0) > 0 ? `已处理 ${formatNumber(statusSummary.resolved || 0)}` : '',
            latestEntry?.createdAt ? `最近回写 ${formatAnalyticsResolutionFeedbackRelativeTime(latestEntry.createdAt)}` : ''
        ].filter(Boolean).slice(0, 4);
    } else if (commerceImpact?.hasSignal) {
        if (buyerUsers > 0) {
            tone = 'success';
            statusLabel = '承接中';
            title = '商品经营已经开始影响成交用户';
        } else if (intentUsers > 0) {
            tone = 'warning';
            statusLabel = '待转化';
            title = '用户已进入商品购买意图阶段';
        } else {
            tone = 'accent';
            statusLabel = '前链路';
            title = '商品经营已经开始影响用户浏览';
        }
        summary = commerceImpact.summary || summary;
    }

    return {
        key: 'user',
        eyebrow: '用户增长',
        tone,
        statusLabel,
        title,
        summary,
        metrics,
        actions: [
            {
                label: '看用户价值',
                destination: 'analytics-growth',
                icon: 'fas fa-user-group',
                context: {
                    sectionId: ANALYTICS_USER_VALUE_SECTION_ID,
                    focusTargetId: ANALYTICS_USER_VALUE_SECTION_ID
                }
            },
            ...leadingActions,
            commerceImpact?.hasSignal ? {
                label: buyerUsers > 0 ? '看成交用户' : '看商品承接',
                destination: buyerUsers > 0 ? 'analytics-product' : 'analytics-product',
                icon: buyerUsers > 0 ? 'fas fa-box-open' : 'fas fa-filter-circle-dollar',
                context: {
                    sectionId: buyerUsers > 0 ? 'productOverviewSection' : 'productFunnelSection',
                    focusTargetId: buyerUsers > 0 ? 'productOverviewSection' : 'productFunnelSection'
                }
            } : null
        ].filter(Boolean).slice(0, 3)
    };
}

function buildAnalyticsOverviewNavigatorContentCard({ topContentRows = [] } = {}) {
    const commerce = buildAnalyticsContentCommerceSummary(topContentRows);
    const summary = commerce?.summary && typeof commerce.summary === 'object' ? commerce.summary : {};
    const promptRows = Array.isArray(commerce?.promptRows) ? commerce.promptRows : [];
    const topPrompt = promptRows[0] || null;
    const topContent = Array.isArray(topContentRows) ? topContentRows[0] || null : null;
    const promptCount = normalizeAnalyticsCountValue(summary.prompt_count);
    const purchaseSuccessCount = normalizeAnalyticsCountValue(summary.purchase_success_count);
    const purchaseClickCount = normalizeAnalyticsCountValue(summary.purchase_click_count);
    const detailViewCount = normalizeAnalyticsCountValue(summary.detail_view_count);
    const gmvPoints = normalizeAnalyticsNumber(summary.gmv_points);

    let tone = 'neutral';
    let statusLabel = '观察中';
    let title = '内容带货当前还在观察窗口';
    let description = topContent
        ? `${buildAnalyticsTopContentCommerceLabel(topContent)} 正在承接当前内容消费。`
        : '当前窗口暂无明显内容带货样本。';

    if (promptCount > 0) {
        if (purchaseSuccessCount > 0 || gmvPoints > 0) {
            tone = 'success';
            statusLabel = '带货中';
            title = '内容已经开始影响商品成交';
        } else if (purchaseClickCount > 0 || detailViewCount > 0) {
            tone = 'warning';
            statusLabel = '待转化';
            title = '内容已经带来详情与购买意图';
        } else {
            tone = 'accent';
            statusLabel = '起量中';
            title = '内容正在把流量带入商品链路';
        }
        description = `当前窗口有 ${formatNumber(promptCount)} 个 Prompt 参与带货，归因支付 ${formatNumber(purchaseSuccessCount)}，归因 GMV ${formatNumber(gmvPoints)}。`;
    }

    const promptLabel = topPrompt ? buildAnalyticsTopContentCommerceLabel(topPrompt) : '';

    return {
        key: 'content',
        eyebrow: '提示词内容',
        tone,
        statusLabel,
        title,
        summary: description,
        metrics: [
            `带货 Prompt ${formatNumber(promptCount)}`,
            `带货商品 ${formatNumber(summary.product_count || 0)}`,
            `详情 ${formatNumber(detailViewCount)}`,
            `意图 ${formatNumber(purchaseClickCount)}`,
            `支付 ${formatNumber(purchaseSuccessCount)}`
        ].filter(Boolean),
        actions: [
            {
                label: '看内容经营页',
                destination: 'analytics-content',
                icon: 'fas fa-compass-drafting',
                context: {
                    promptId: topPrompt?.prompt_id || '',
                    promptTitle: promptLabel,
                    sectionId: ANALYTICS_CONTENT_OPERATING_SECTION_ID,
                    focusTargetId: ANALYTICS_CONTENT_OPERATING_SECTION_ID
                }
            },
            promptLabel ? {
                label: '看带货详情',
                destination: 'analytics-content',
                icon: 'fas fa-chart-column',
                context: {
                    promptId: topPrompt?.prompt_id || '',
                    promptTitle: promptLabel,
                    sectionId: 'contentCommerceDetailSection',
                    focusTargetId: 'contentCommerceDetailSection'
                }
            } : null,
            {
                label: '看带货商品',
                destination: 'analytics-product',
                icon: 'fas fa-cubes',
                context: {
                    sectionId: 'productRankingsSection',
                    focusTargetId: 'productRankingsSection'
                }
            }
        ]
    };
}

function buildAnalyticsOverviewNavigatorProductCard({
    productSummaryBundle = null,
    productRankBundle = null,
    productHealthBundle = null
} = {}) {
    const summary = getAnalyticsOverviewNavigatorProductPayload(productSummaryBundle, 'summary') || {};
    const insight = typeof buildAnalyticsProductOverviewInsight === 'function'
        ? buildAnalyticsProductOverviewInsight({
            productSummaryBundle,
            productRankBundle,
            productHealthBundle
        })
        : null;
    const pulseItem = insight?.pulseItem || {};
    const anomalyCard = insight?.anomalyCard || null;
    const viewUsers = normalizeAnalyticsCountValue(summary.view_user_count);
    const detailUsers = normalizeAnalyticsCountValue(summary.detail_view_user_count);
    const intentUsers = normalizeAnalyticsCountValue(summary.purchase_click_user_count);
    const orderCount = normalizeAnalyticsCountValue(summary.order_count);
    const gmvPoints = normalizeAnalyticsNumber(summary.gmv_points);

    return {
        key: 'product',
        eyebrow: '商品经营',
        tone: pulseItem.tone || (orderCount > 0 ? 'success' : (intentUsers > 0 ? 'warning' : 'neutral')),
        statusLabel: pulseItem.value || (orderCount > 0 ? '放量中' : '观察中'),
        title: anomalyCard?.title || (orderCount > 0 ? '商品经营已经形成成交承接' : '商品经营当前以浏览和意图信号为主'),
        summary: pulseItem.detail || `当前窗口浏览 ${formatNumber(viewUsers)}、详情 ${formatNumber(detailUsers)}、意图 ${formatNumber(intentUsers)}、成交 ${formatNumber(orderCount)}。`,
        metrics: [
            `浏览 ${formatNumber(viewUsers)}`,
            `详情 ${formatNumber(detailUsers)}`,
            `意图 ${formatNumber(intentUsers)}`,
            `成交 ${formatNumber(orderCount)}`,
            `GMV ${formatNumber(gmvPoints)}`
        ].filter(Boolean),
        actions: [
            anomalyCard?.actionLabel ? {
                label: anomalyCard.actionLabel,
                destination: anomalyCard.destination || 'analytics-product',
                icon: anomalyCard.icon || 'fas fa-box-open',
                context: anomalyCard.context || { sectionId: 'productOverviewSection', focusTargetId: 'productOverviewSection' }
            } : null,
            {
                label: '看商品预警',
                destination: 'analytics-product',
                icon: 'fas fa-siren-on',
                context: {
                    sectionId: 'productAlertsSection',
                    focusTargetId: 'productAlertsSection'
                }
            }
        ].filter(Boolean)
    };
}

function buildAnalyticsOverviewNavigatorOpsCard({
    operationsHealthSnapshot = null,
    verifySummary = null
} = {}) {
    const metrics = operationsHealthSnapshot?.metrics && typeof operationsHealthSnapshot.metrics === 'object'
        ? operationsHealthSnapshot.metrics
        : {};
    const verifyMetrics = verifySummary?.metrics && typeof verifySummary.metrics === 'object'
        ? verifySummary.metrics
        : {};
    const paymentAlerts = normalizeAnalyticsCountValue(metrics.paymentAlertTotal);
    const paymentDeadLetters = normalizeAnalyticsCountValue(metrics.paymentDeadLetterCount);
    const paymentRetries = normalizeAnalyticsCountValue(metrics.paymentRetryCount);
    const ticketPending = normalizeAnalyticsCountValue(metrics.ticketPendingCount);
    const ticketCritical = normalizeAnalyticsCountValue(metrics.ticketCriticalOverdueCount);
    const verifyFailed = normalizeAnalyticsCountValue(verifyMetrics.failedCount);
    const verifyActive = normalizeAnalyticsCountValue(verifyMetrics.activeCount);

    let tone = 'success';
    let statusLabel = '平稳中';
    let title = '运营保障当前没有明显堆积';
    let summary = '支付、售后工单和验证服务当前都没有看到明显需要优先处理的异常。';
    let primaryAction = {
        label: '看运营总览',
        destination: 'analytics-ops',
        icon: 'fas fa-satellite-dish',
        context: {
            sectionId: 'opsCockpitOverviewSection',
            focusTargetId: 'opsCockpitOverviewSection'
        }
    };
    let secondaryAction = {
        label: '看支付问题',
        destination: 'analytics-ops',
        icon: 'fas fa-credit-card',
        context: {
            sectionId: 'opsPaymentsSection',
            focusTargetId: 'opsPaymentsSection'
        }
    };

    if (paymentDeadLetters > 0 || paymentAlerts > 0) {
        tone = paymentDeadLetters > 0 ? 'danger' : 'warning';
        statusLabel = '待处理';
        title = paymentDeadLetters > 0 ? '支付死信与告警需要优先处理' : '支付告警仍在影响承接';
        summary = `当前支付告警 ${formatNumber(paymentAlerts)}，其中死信 ${formatNumber(paymentDeadLetters)}、待重试 ${formatNumber(paymentRetries)}。`;
        primaryAction = {
            label: '看支付问题',
            destination: 'analytics-ops',
            icon: 'fas fa-credit-card',
            context: {
                sectionId: 'opsPaymentsSection',
                focusTargetId: 'opsPaymentsSection'
            }
        };
        secondaryAction = {
            label: '看站外告警',
            destination: 'analytics-ops',
            icon: 'fas fa-tower-broadcast',
            context: {
                sectionId: 'opsAlertsSection',
                focusTargetId: 'opsAlertsSection'
            }
        };
    } else if (ticketCritical > 0 || ticketPending > 0) {
        tone = ticketCritical > 0 ? 'danger' : 'warning';
        statusLabel = '待处理';
        title = ticketCritical > 0 ? '售后高优和超时工单仍在堆积' : '售后工单仍需继续收口';
        summary = `当前待处理工单 ${formatNumber(ticketPending)}，其中 critical ${formatNumber(ticketCritical)}。`;
        primaryAction = {
            label: '看售后工单',
            destination: 'analytics-ops',
            icon: 'fas fa-life-ring',
            context: {
                sectionId: 'opsTicketsSection',
                focusTargetId: 'opsTicketsSection'
            }
        };
        secondaryAction = {
            label: '看履约处理',
            destination: 'analytics-ops',
            icon: 'fas fa-truck-fast',
            context: {
                sectionId: 'opsFulfillmentSection',
                focusTargetId: 'opsFulfillmentSection'
            }
        };
    } else if (verifyFailed > 0 || verifyActive > 0) {
        tone = verifyFailed > 0 ? 'warning' : 'accent';
        statusLabel = '待复核';
        title = verifyFailed > 0 ? '验证服务仍有失败样本' : '验证服务仍有活跃任务';
        summary = `当前验证失败 ${formatNumber(verifyFailed)}，活跃任务 ${formatNumber(verifyActive)}。`;
        primaryAction = {
            label: '看验证服务',
            destination: 'analytics-ops',
            icon: 'fas fa-shield-halved',
            context: {
                sectionId: 'opsVerifySection',
                focusTargetId: 'opsVerifySection'
            }
        };
        secondaryAction = {
            label: '看站外告警',
            destination: 'analytics-ops',
            icon: 'fas fa-tower-broadcast',
            context: {
                sectionId: 'opsAlertsSection',
                focusTargetId: 'opsAlertsSection'
            }
        };
    }

    return {
        key: 'ops',
        eyebrow: '运营保障',
        tone,
        statusLabel,
        title,
        summary,
        metrics: [
            `支付告警 ${formatNumber(paymentAlerts)}`,
            `死信 ${formatNumber(paymentDeadLetters)}`,
            `工单待处理 ${formatNumber(ticketPending)}`,
            `验证失败 ${formatNumber(verifyFailed)}`,
            `验证活跃 ${formatNumber(verifyActive)}`
        ],
        actions: [primaryAction, secondaryAction].filter(Boolean)
    };
}

function buildAnalyticsOverviewNavigatorCards(source = {}) {
    const summaryWindow = source.summaryWindowData || {};
    const productSummaryBundle = source.productSummaryBundle || null;
    const productRankBundle = source.productRankBundle || null;
    const productHealthBundle = source.productHealthBundle || null;
    const productSummary = getAnalyticsOverviewNavigatorProductPayload(productSummaryBundle, 'summary') || {};

    return [
        buildAnalyticsOverviewNavigatorUserCard({
            summaryWindow,
            productSummary
        }),
        buildAnalyticsOverviewNavigatorContentCard({
            topContentRows: Array.isArray(source.topContentRows) ? source.topContentRows : (Array.isArray(summaryWindow?.top_content) ? summaryWindow.top_content : [])
        }),
        buildAnalyticsOverviewNavigatorProductCard({
            productSummaryBundle,
            productRankBundle,
            productHealthBundle
        }),
        buildAnalyticsOverviewNavigatorOpsCard({
            operationsHealthSnapshot: source.operationsHealthSnapshot || {},
            verifySummary: source.verifyServiceSummary || {}
        })
    ].filter(Boolean);
}

function buildAnalyticsOverviewNavigatorMeta(cards = []) {
    return (Array.isArray(cards) ? cards : [])
        .map((card) => `${card.eyebrow || '经营'} ${card.statusLabel || '观察中'}`)
        .join(' · ') || '用户 / 内容 / 商品 / 运营保障';
}

async function loadOverviewOperatingNavigator() {
    const container = document.getElementById('overviewOperatingNavigator');
    const shellContainer = document.getElementById('analyticsBusinessCenterShell');
    const shellMeta = document.getElementById('analyticsBusinessCenterShellMeta');
    const meta = document.getElementById('overviewOperatingNavigatorMeta');
    const focusWorkspace = document.getElementById('analyticsOperatingFocusWorkspace');
    const focusMeta = document.getElementById('analyticsOperatingFocusMeta');
    if (!container && !shellContainer && !focusWorkspace) return;

    const shellHasRenderedWorkspace = Boolean(
        shellContainer?.querySelector?.('.analytics-business-center-shell__workspace')
    );
    const focusHasRenderedWorkspace = Boolean(
        focusWorkspace?.querySelector?.('.analytics-operating-focus__workspace')
    );

    if (container) {
        container.innerHTML = renderAnalyticsProductLoadingState('经营导航加载中...');
    }
    if (shellContainer && !shellHasRenderedWorkspace) {
        shellContainer.innerHTML = renderAnalyticsProductLoadingState('经营分析中心加载中...');
    }
    if (shellMeta) {
        shellMeta.textContent = '总览 / 用户影响 / 内容经营 / 商品经营 / 单品详情 / 运营保障';
    }
    if (meta) {
        meta.textContent = '用户 / 内容 / 商品 / 运营保障';
    }
    if (focusWorkspace && !focusHasRenderedWorkspace) {
        focusWorkspace.innerHTML = renderAnalyticsProductLoadingState('当前经营视角加载中...');
    }
    if (focusMeta) {
        focusMeta.textContent = '随当前分栏自动更新';
    }

    try {
        const requestState = {
            summaryWindowData: null,
            productDashboardBundle: null,
            operationsHealthSnapshot: null,
            verifyServiceSummary: null,
            topContentRows: null
        };
        const requestStatus = {
            summaryWindowData: 'pending',
            productDashboardBundle: 'idle',
            operationsHealthSnapshot: 'pending',
            verifyServiceSummary: 'pending',
            topContentRows: 'pending'
        };

        const renderCards = (forceFallback = false) => {
            const cards = buildAnalyticsOverviewNavigatorCards({
                summaryWindowData: requestState.summaryWindowData || {},
                productSummaryBundle: requestState.productDashboardBundle,
                productRankBundle: requestState.productDashboardBundle,
                productHealthBundle: requestState.productDashboardBundle,
                operationsHealthSnapshot: requestState.operationsHealthSnapshot,
                verifyServiceSummary: requestState.verifyServiceSummary,
                topContentRows: Array.isArray(requestState.topContentRows) ? requestState.topContentRows : null
            });

            if (!cards.length) {
                if (!forceFallback) {
                    return false;
                }

                const hasAnySuccess = Object.values(requestStatus).some((status) => status === 'fulfilled');
                if (container) {
                    container.innerHTML = renderHintState(
                        'fas fa-compass-drafting',
                        hasAnySuccess ? '当前窗口暂无经营导航数据' : '经营导航加载失败',
                        hasAnySuccess ? '' : 'error'
                    );
                }
                if (shellContainer) {
                    shellContainer.innerHTML = renderHintState(
                        'fas fa-layer-group',
                        hasAnySuccess ? '当前窗口暂无经营分析中心数据' : '经营分析中心加载失败',
                        hasAnySuccess ? '' : 'error'
                    );
                }
                if (shellMeta) {
                    shellMeta.textContent = hasAnySuccess ? '当前窗口暂无经营中心信号' : '经营分析中心加载失败';
                }
                if (meta) {
                    meta.textContent = hasAnySuccess ? '当前窗口暂无经营导航信号' : '经营导航加载失败';
                }
                if (focusWorkspace) {
                    if (hasAnySuccess) {
                        renderAnalyticsOperatingFocusWorkspace([]);
                    } else {
                        focusWorkspace.innerHTML = renderHintState('fas fa-location-crosshairs', '当前经营视角加载失败', 'error');
                    }
                }
                if (focusMeta) {
                    focusMeta.textContent = hasAnySuccess ? '当前窗口暂无经营视角信号' : '当前经营视角加载失败';
                }
                return false;
            }

            setAnalyticsSectionNavigatorCardsState(cards);
            if (shellContainer) {
                renderAnalyticsBusinessCenterShell(cards);
            }
            if (container) {
                container.innerHTML = renderAnalyticsOverviewNavigator(cards);
            }
            if (meta) {
                meta.textContent = buildAnalyticsOverviewNavigatorMeta(cards);
            }
            if (focusWorkspace) {
                renderAnalyticsOperatingFocusWorkspace(cards);
            }
            if (focusMeta) {
                focusMeta.textContent = '随当前分栏自动更新';
            }
            return true;
        };

        const scheduleProductDashboardWarm = () => {
            if (requestStatus.productDashboardBundle === 'pending' || requestStatus.productDashboardBundle === 'fulfilled') {
                return;
            }
            requestStatus.productDashboardBundle = 'pending';
            window.setTimeout(() => {
                void Promise.resolve(getAnalyticsProductDashboardBundle())
                    .then((value) => {
                        requestState.productDashboardBundle = value;
                        requestStatus.productDashboardBundle = 'fulfilled';
                        renderCards(false);
                        return value;
                    })
                    .catch((error) => {
                        requestStatus.productDashboardBundle = 'rejected';
                        console.warn('[Analytics] Overview product navigator warm failed:', error);
                    });
            }, 0);
        };

        const requests = [
            ['summaryWindowData', getAnalyticsSummaryWindowData()],
            ['operationsHealthSnapshot', getOperationsHealthSnapshotData()],
            ['verifyServiceSummary', getVerifyServiceSummaryData()],
            ['topContentRows', fetchTopContentData(10)]
        ];

        await Promise.allSettled(requests.map(([key, promise]) => Promise.resolve(promise)
            .then((value) => {
                requestState[key] = value;
                requestStatus[key] = 'fulfilled';
                renderCards(false);
                return value;
            })
            .catch((error) => {
                requestStatus[key] = 'rejected';
                return Promise.reject(error);
            })));

        renderCards(true);
        scheduleProductDashboardWarm();
    } catch (err) {
        console.error('[Analytics] Failed to load overview operating navigator:', err);
        if (container) {
            container.innerHTML = renderHintState('fas fa-compass-drafting', '经营导航加载失败', 'error');
        }
        if (shellContainer) {
            shellContainer.innerHTML = renderHintState('fas fa-layer-group', '经营分析中心加载失败', 'error');
        }
        if (shellMeta) {
            shellMeta.textContent = '经营分析中心加载失败';
        }
        if (meta) {
            meta.textContent = '经营导航加载失败';
        }
        if (focusWorkspace) {
            focusWorkspace.innerHTML = renderHintState('fas fa-location-crosshairs', '当前经营视角加载失败', 'error');
        }
        if (focusMeta) {
            focusMeta.textContent = '当前经营视角加载失败';
        }
    }
}

function buildAnalyticsUserCommerceImpactSummary(productSummary = {}, userTrendRows = []) {
    const latestRow = Array.isArray(userTrendRows) && userTrendRows.length > 0
        ? userTrendRows[userTrendRows.length - 1]
        : null;
    const businessActiveUsers = normalizeAnalyticsCountValue(latestRow?.active_users);
    const loginActiveUsers = normalizeAnalyticsCountValue(latestRow?.login_active_users);
    const viewUsers = normalizeAnalyticsCountValue(productSummary.view_user_count);
    const cardClickUsers = normalizeAnalyticsCountValue(productSummary.card_click_user_count);
    const detailViewUsers = normalizeAnalyticsCountValue(productSummary.detail_view_user_count);
    const purchaseIntentUsers = normalizeAnalyticsCountValue(productSummary.purchase_click_user_count);
    const buyerUsers = normalizeAnalyticsCountValue(productSummary.unique_buyer_count);
    const influencedUsers = Math.max(viewUsers, cardClickUsers, detailViewUsers, purchaseIntentUsers, buyerUsers, 0);
    const activeReference = businessActiveUsers > 0 ? businessActiveUsers : loginActiveUsers;
    const activeReferenceLabel = businessActiveUsers > 0
        ? `最新业务活跃参考 ${formatNumber(businessActiveUsers)}`
        : (loginActiveUsers > 0 ? `登录活跃参考 ${formatNumber(loginActiveUsers)}` : '');
    const signalItems = [
        {
            key: 'view',
            label: '商品浏览',
            count: viewUsers,
            note: '进入商城页',
            samples: Array.isArray(productSummary.user_signal_samples?.shop_view) ? productSummary.user_signal_samples.shop_view : []
        },
        {
            key: 'card',
            label: '卡片点击',
            count: cardClickUsers,
            note: '开始看具体商品',
            samples: Array.isArray(productSummary.user_signal_samples?.product_card_click) ? productSummary.user_signal_samples.product_card_click : []
        },
        {
            key: 'detail',
            label: '详情触达',
            count: detailViewUsers,
            note: '进入详情页',
            samples: Array.isArray(productSummary.user_signal_samples?.product_detail_view) ? productSummary.user_signal_samples.product_detail_view : []
        },
        {
            key: 'intent',
            label: '购买意图',
            count: purchaseIntentUsers,
            note: '点击购买/下单',
            samples: Array.isArray(productSummary.user_signal_samples?.product_purchase_click) ? productSummary.user_signal_samples.product_purchase_click : []
        },
        {
            key: 'buyer',
            label: '成交用户',
            count: buyerUsers,
            note: '形成有效订单',
            samples: Array.isArray(productSummary.user_signal_samples?.buyer) ? productSummary.user_signal_samples.buyer : []
        }
    ];
    const hasSignal = signalItems.some((item) => item.count > 0);
    const headline = hasSignal
        ? `当前窗口有 ${formatNumber(influencedUsers)} 位用户进入了商品经营路径`
        : '当前窗口暂无商品经营影响用户层信号';
    let summary = '可以用这块快速判断商品链路影响还停留在浏览层、意图层，还是已经进入成交层。';
    if (buyerUsers > 0) {
        summary = `其中 ${formatNumber(buyerUsers)} 位已经形成成交，适合继续回看带货内容、库存承接和复购去向。`;
    } else if (purchaseIntentUsers > 0) {
        summary = `目前已经有 ${formatNumber(purchaseIntentUsers)} 位用户出现购买意图，但还没有形成成交，建议优先排查支付、库存与履约承接。`;
    } else if (detailViewUsers > 0 || cardClickUsers > 0 || viewUsers > 0) {
        summary = '当前信号主要停留在浏览或详情层，适合优先排查商品结构、内容带货质量与转化承接。';
    }

    return {
        hasSignal,
        headline,
        summary,
        activeReference,
        activeReferenceLabel,
        influencedUsers,
        signalItems
    };
}

function renderAnalyticsUserCommerceImpactSample(sample = {}, item = {}, summary = {}) {
    const userId = String(sample?.user_id || '').trim();
    if (!userId) {
        return '';
    }
    const note = item?.key === 'buyer'
        ? `${formatNumber(sample.order_count || 0)} 单 / ${formatNumber(sample.gmv_points || 0)} 积分`
        : `${formatNumber(sample.event_count || 0)} 次`;
    const focusTargetId = item?.key === 'buyer'
        ? 'productOverviewSection'
        : 'productFunnelSection';
    return `
        <button
            type="button"
            class="analytics-user-commerce-impact__sample"
            ${buildAnalyticsOpenUserDetailAttrs(userId, {
                sourceLabel: '用户增长 / 商品影响用户层',
                summary: `该用户当前命中“${String(item?.label || '商品信号').trim()}”样本，适合回到商品经营继续确认信号停在浏览、意图还是成交层。`,
                signalLabel: String(item?.label || '商品信号').trim(),
                signalValue: note,
                referenceLabel: String(summary?.activeReferenceLabel || '').trim() ? '活跃参考' : '',
                referenceValue: String(summary?.activeReferenceLabel || '').trim(),
                feedbackScope: 'user',
                feedbackEntityType: 'user',
                feedbackEntityId: userId,
                feedbackEntityName: userId,
                destination: 'analytics-product',
                destinationContext: {
                    sectionId: focusTargetId
                },
                actionLabel: item?.key === 'buyer' ? '回到商品总盘' : '回到商品漏斗',
                verificationMethod: item?.key === 'buyer'
                    ? '回到商品总盘，确认成交用户、退款风险和履约承接是否继续改善。'
                    : '回到商品漏斗，确认该用户所在的浏览/意图环节是否继续向成交推进。'
            })}
            title="查看 ${escapeHtml(userId)} 的用户详情"
        >
            <strong>${escapeHtml(userId)}</strong>
            <span>${escapeHtml(note)}</span>
        </button>
    `;
}

function renderAnalyticsUserCommerceImpactSummary(summary = {}) {
    if (!summary || !summary.hasSignal) {
        return renderHintState('fas fa-users-viewfinder', '当前窗口暂无商品影响用户层信号');
    }

    const chips = Array.isArray(summary.signalItems) ? summary.signalItems : [];
    return `
        <div class="analytics-user-commerce-impact__head">
            <div>
                <div class="analytics-user-commerce-impact__eyebrow">商品影响用户层</div>
                <strong class="analytics-user-commerce-impact__title">${escapeHtml(summary.headline || '当前窗口暂无商品影响用户层信号')}</strong>
            </div>
            ${summary.activeReferenceLabel
                ? `<div class="analytics-user-commerce-impact__meta">${escapeHtml(summary.activeReferenceLabel)}</div>`
                : ''}
        </div>
        <p class="analytics-user-commerce-impact__summary">${escapeHtml(summary.summary || '')}</p>
        <div class="analytics-user-commerce-impact__chips">
            ${chips.map((item) => `
                <div class="analytics-user-commerce-impact__chip">
                    <div class="analytics-user-commerce-impact__chip-main">
                        <strong>${escapeHtml(item.label || '用户层')}</strong>
                        <span>${formatNumber(item.count || 0)}</span>
                        <em>${escapeHtml(item.note || '')}</em>
                    </div>
                    ${Array.isArray(item.samples) && item.samples.length > 0
                        ? `<div class="analytics-user-commerce-impact__samples">
                            ${item.samples.slice(0, 3).map((sample) => renderAnalyticsUserCommerceImpactSample(sample, item, summary)).join('')}
                        </div>`
                        : ''}
                </div>
            `).join('')}
        </div>
    `;
}

function buildAnalyticsUserValueCockpitSummary(productSummary = {}, userTrendRows = []) {
    const commerceImpact = buildAnalyticsUserCommerceImpactSummary(productSummary, userTrendRows);
    const buyerUsers = normalizeAnalyticsCountValue(productSummary.unique_buyer_count);
    const repeatBuyers = normalizeAnalyticsCountValue(
        Array.isArray(productSummary.buyer_segment_summary)
            ? (productSummary.buyer_segment_summary.find((item) => String(item?.key || '') === 'repeat_buyers')?.count || 0)
            : 0
    );
    const crossProductBuyers = normalizeAnalyticsCountValue(
        Array.isArray(productSummary.buyer_segment_summary)
            ? (productSummary.buyer_segment_summary.find((item) => String(item?.key || '') === 'cross_product_buyers')?.count || 0)
            : 0
    );
    const refundRiskBuyers = normalizeAnalyticsCountValue(
        Array.isArray(productSummary.buyer_segment_summary)
            ? (productSummary.buyer_segment_summary.find((item) => String(item?.key || '') === 'refund_risk_buyers')?.count || 0)
            : 0
    );
    const firstPurchaseDestinations = Array.isArray(productSummary.first_purchase_destinations)
        ? productSummary.first_purchase_destinations.slice(0, 4)
        : [];
    const postPurchaseDestinations = Array.isArray(productSummary.post_purchase_destinations)
        ? productSummary.post_purchase_destinations.slice(0, 4)
        : [];
    const buyerSnapshot = Array.isArray(productSummary.buyer_snapshot)
        ? productSummary.buyer_snapshot.slice(0, 5)
        : [];
    const segmentItems = Array.isArray(productSummary.buyer_segment_summary)
        ? productSummary.buyer_segment_summary
        : [];
    const hasSignal = commerceImpact.hasSignal
        || buyerUsers > 0
        || repeatBuyers > 0
        || crossProductBuyers > 0
        || refundRiskBuyers > 0;
    let stateTone = 'default';
    let stateLabel = '价值层尚未形成';
    let headline = '当前窗口仍停留在浏览或意图前段，尚未形成稳定的用户价值层';
    let summary = '适合先看商品漏斗、支付承接和库存履约，确认意图用户为什么还没有进入成交与复购。';

    if (repeatBuyers > 0 || crossProductBuyers > 0) {
        stateTone = 'success';
        stateLabel = '价值分层已出现';
        headline = `当前窗口已有 ${formatNumber(buyerUsers)} 位成交用户，其中 ${formatNumber(Math.max(repeatBuyers, crossProductBuyers))} 位已经开始进入复购或跨商品购买`;
        summary = '可以直接用这块确认用户价值是否已经从首单成交，推进到复购、跨商品购买和高价值样本沉淀。';
    } else if (buyerUsers > 0) {
        stateTone = 'warning';
        stateLabel = '已有首批成交';
        headline = `当前窗口已有 ${formatNumber(buyerUsers)} 位用户形成首单成交，但复购层仍然偏薄`;
        summary = '建议继续回看首购商品去向、后续复购去向和高价值买家样本，确认是不是只形成了首单，没有继续扩成复购。';
    } else if (commerceImpact.hasSignal) {
        headline = commerceImpact.headline || headline;
        summary = '当前商品信号已经影响到用户层，但价值层仍停留在浏览或购买意图前段，适合先排查内容带货质量和支付承接。';
    }

    return {
        hasSignal,
        stateTone,
        stateLabel,
        headline,
        summary,
        activeReferenceLabel: commerceImpact.activeReferenceLabel,
        viewUsers: normalizeAnalyticsCountValue(productSummary.view_user_count),
        detailViewUsers: normalizeAnalyticsCountValue(productSummary.detail_view_user_count),
        purchaseIntentUsers: normalizeAnalyticsCountValue(productSummary.purchase_click_user_count),
        buyerUsers,
        repeatBuyers,
        crossProductBuyers,
        refundRiskBuyers,
        segmentItems,
        buyerSnapshot,
        firstPurchaseDestinations,
        postPurchaseDestinations
    };
}

function renderAnalyticsUserValueCockpitBuyerSample(sample = {}, summary = {}, segment = {}) {
    const userId = String(sample?.user_id || '').trim();
    if (!userId) {
        return '';
    }

    const displayUserLabel = buildAnalyticsUserFallbackLabel(userId);
    const signalValue = `${formatNumber(sample.order_count || 0)} 单 / ${formatNumber(sample.gmv_points || 0)} 积分`;
    return `
        <button
            type="button"
            class="analytics-user-value-cockpit__sample"
            ${buildAnalyticsOpenUserDetailAttrs(userId, {
                sourceLabel: '用户增长 / 用户价值驾驶舱',
                summary: `该用户当前命中“${String(segment?.label || '价值层').trim()}”样本，适合回到用户价值驾驶舱继续确认首单、复购与跨商品承接。`,
                signalLabel: String(segment?.label || '价值层').trim(),
                signalValue,
                referenceLabel: String(summary?.activeReferenceLabel || '').trim() ? '活跃参考' : '',
                referenceValue: String(summary?.activeReferenceLabel || '').trim(),
                feedbackScope: 'user',
                feedbackEntityType: 'user',
                feedbackEntityId: userId,
                feedbackEntityName: userId,
                destination: 'analytics-product',
                destinationContext: {
                    sectionId: 'productOverviewSection',
                    focusTargetId: 'productOverviewSection'
                },
                actionLabel: '回到商品经营',
                verificationMethod: '回到用户价值驾驶舱，确认这类用户是否继续从首单推进到复购、跨商品购买或高价值层。'
            })}
            title="查看 ${escapeHtml(userId)} 的用户详情"
        >
            <strong>用户 ${escapeHtml(displayUserLabel)}</strong>
            <span>${escapeHtml(signalValue)}</span>
        </button>
    `;
}

function renderAnalyticsUserValueCockpitProductRow(row = {}, label = '') {
    const productId = String(row?.product_id || '').trim();
    const productName = String(row?.product_name || '').trim() || (productId ? `商品 ${productId}` : '未命名商品');
    if (!productId) {
        return `<div class="analytics-user-value-cockpit__product-row"><span class="analytics-user-value-cockpit__empty">当前暂无${escapeHtml(label || '商品')}样本</span></div>`;
    }

    const noteParts = [];
    if (normalizeAnalyticsCountValue(row?.user_count) > 0) {
        noteParts.push(`${formatNumber(row.user_count)} 位用户`);
    }
    if (normalizeAnalyticsCountValue(row?.order_count) > 0) {
        noteParts.push(`${formatNumber(row.order_count)} 单`);
    }
    if (normalizeAnalyticsCountValue(row?.gmv_points) > 0) {
        noteParts.push(`${formatNumber(row.gmv_points)} 积分`);
    }

    return `
        <div class="analytics-user-value-cockpit__product-row">
            ${renderAnalyticsProductNameButton(productName, productId, {
                compact: true,
                detailContext: {
                    sourceLabel: '用户增长 / 用户价值驾驶舱',
                    summary: `这件商品当前出现在“${label || '用户价值'}”分布里，适合继续确认成交后的复购与跨商品承接。`,
                    sectionId: 'productDetailPanelSection',
                    focusTargetId: 'productDetailPanelSection'
                }
            })}
            <div class="analytics-user-value-cockpit__product-note">${escapeHtml(noteParts.join(' / ') || '当前暂无补充样本')}</div>
        </div>
    `;
}

function buildAnalyticsUserValueFeedbackVerificationStatus(entries = [], summary = {}) {
    const rows = Array.isArray(entries) ? entries : [];
    const latestEntry = rows[0] || {};
    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(rows);
    const refundRiskBuyers = Number(summary?.refundRiskBuyers || 0);
    const repeatBuyers = Number(summary?.repeatBuyers || 0);
    const crossProductBuyers = Number(summary?.crossProductBuyers || 0);
    const latestStatusKey = String(latestEntry?.statusKey || '').trim().toLowerCase();

    if (rows.length > 0 && Number(statusSummary.abnormal || 0) <= 0 && Number(statusSummary.review || 0) <= 0 && latestStatusKey !== 'abnormal' && latestStatusKey !== 'review' && refundRiskBuyers <= 0) {
        return {
            key: 'passed',
            label: '验证已通过',
            tone: 'success',
            summary: repeatBuyers > 0 || crossProductBuyers > 0
                ? '当前用户价值层已经形成复购或跨商品购买，最近一轮处理也没有继续回写新的异常。'
                : '当前用户价值层没有继续冒出退款或承接异常，最近一轮处理已经基本收口。'
        };
    }

    if (Number(statusSummary.abnormal || 0) > 0 || latestStatusKey === 'abnormal' || refundRiskBuyers > 0) {
        return {
            key: 'pending',
            label: '仍待验证',
            tone: 'danger',
            summary: '当前用户价值层仍有退款风险或异常回写，说明用户承接链还没有真正收口。'
        };
    }

    return {
        key: 'pending',
        label: '仍待验证',
        tone: 'warning',
        summary: '当前用户价值层已经开始形成成交和复购，但仍需要继续复查承接链是否稳定，没有再次反弹。'
    };
}

function buildAnalyticsUserValueConclusionDigest(entries = [], summary = {}) {
    const rows = Array.isArray(entries) ? entries : [];
    const verificationState = buildAnalyticsUserValueFeedbackVerificationStatus(rows, summary);
    const latestEntry = rows[0] || {};
    const evidenceItems = [
        Number(summary?.buyerUsers || 0) > 0 ? `成交用户 ${formatNumber(summary.buyerUsers)}` : '',
        Number(summary?.repeatBuyers || 0) > 0 ? `窗口复购 ${formatNumber(summary.repeatBuyers)}` : '',
        Number(summary?.crossProductBuyers || 0) > 0 ? `跨商品购买 ${formatNumber(summary.crossProductBuyers)}` : '',
        Number(summary?.refundRiskBuyers || 0) > 0 ? `退款风险 ${formatNumber(summary.refundRiskBuyers)}` : '',
        latestEntry?.createdAt ? `最近回写 ${formatAnalyticsResolutionFeedbackRelativeTime(latestEntry.createdAt)}` : ''
    ].filter(Boolean);

    let guidance = '先看高价值用户样本，再顺着首购去向和后续复购去向确认用户价值有没有继续向上走。';
    if (Number(summary?.refundRiskBuyers || 0) > 0) {
        guidance = '优先去看商城订单、支付问题和售后工单，先把退款或履约风险处理掉，再回看复购是否恢复。';
    } else if (Number(summary?.buyerUsers || 0) <= 0 && Number(summary?.purchaseIntentUsers || 0) > 0) {
        guidance = '当前更像意图待成交，先看商品漏斗和支付承接，再继续观察用户价值层。';
    } else if (Number(summary?.repeatBuyers || 0) > 0 || Number(summary?.crossProductBuyers || 0) > 0) {
        guidance = '当前已经出现复购和跨商品购买，建议优先盯高价值样本和后续复购去向，确认放量没有带出新的风险。';
    }

    return {
        tone: verificationState.tone,
        label: verificationState.key === 'passed'
            ? '本轮价值层已收口'
            : (verificationState.tone === 'danger' ? '本轮价值层仍异常' : '本轮价值层待复查'),
        title: '本轮用户价值结论',
        summary: verificationState.summary,
        guidance,
        evidenceItems
    };
}

function buildAnalyticsUserValuePriorityDestinationContext(summary = {}, options = {}) {
    const referenceLabel = String(options?.referenceLabel || '用户价值').trim() || '用户价值';
    const referenceValue = String(options?.referenceValue || '').trim();
    const actionLabel = String(options?.actionLabel || '回到用户价值').trim() || '回到用户价值';
    const verificationMethod = String(options?.verificationMethod || '').trim();
    const destinationContext = options?.destinationContext && typeof options.destinationContext === 'object' && !Array.isArray(options.destinationContext)
        ? { ...options.destinationContext }
        : {};

    return {
        feedbackScope: 'user',
        feedbackEntityType: 'user-value',
        feedbackEntityId: 'user-value-cockpit',
        feedbackEntityName: '用户价值驾驶舱',
        referenceLabel,
        referenceValue,
        actionLabel,
        verificationMethod,
        destination: 'analytics-growth',
        destinationContext: {
            sectionId: ANALYTICS_USER_VALUE_SECTION_ID,
            focusTargetId: ANALYTICS_USER_VALUE_SECTION_ID,
            ...destinationContext
        },
        buyerUsers: Number(summary?.buyerUsers || 0),
        repeatBuyers: Number(summary?.repeatBuyers || 0),
        crossProductBuyers: Number(summary?.crossProductBuyers || 0),
        refundRiskBuyers: Number(summary?.refundRiskBuyers || 0)
    };
}

function buildAnalyticsUserValuePriorityReviewItems(summary = {}, entries = []) {
    const rows = Array.isArray(entries) ? entries : [];
    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(rows);
    const buyerUsers = normalizeAnalyticsCountValue(summary?.buyerUsers);
    const repeatBuyers = normalizeAnalyticsCountValue(summary?.repeatBuyers);
    const crossProductBuyers = normalizeAnalyticsCountValue(summary?.crossProductBuyers);
    const refundRiskBuyers = normalizeAnalyticsCountValue(summary?.refundRiskBuyers);
    const purchaseIntentUsers = normalizeAnalyticsCountValue(summary?.purchaseIntentUsers);
    const detailViewUsers = normalizeAnalyticsCountValue(summary?.detailViewUsers);
    const viewUsers = normalizeAnalyticsCountValue(summary?.viewUsers);
    const items = [];

    if (refundRiskBuyers > 0 || Number(statusSummary.abnormal || 0) > 0) {
        const verificationMethod = '处理后回到用户价值驾驶舱，确认退款风险用户减少，同时复购和跨商品购买没有继续回落。';
        items.push({
            key: 'refund-risk',
            score: 120 + (Number(statusSummary.abnormal || 0) * 10) + refundRiskBuyers,
            tone: 'danger',
            badge: '优先处理',
            title: '退款风险用户仍待收口',
            summary: `当前已成交 ${formatNumber(buyerUsers)} 位用户，但退款风险样本仍有 ${formatNumber(refundRiskBuyers)} 位，说明成交后的承接链还没有真正稳定。`,
            meta: `成交 ${formatNumber(buyerUsers)} / 退款风险 ${formatNumber(refundRiskBuyers)}`,
            rankReason: '用户价值层已经形成成交，但退款风险和异常回写仍在冒出，优先级高于单纯的转化偏薄。',
            recommendedAction: '先看支付问题和售后工单，确认退款是支付体验、商品承接还是履约解释导致，再回到用户价值层复查。',
            verificationMethod,
            actions: [
                {
                    label: '看支付问题',
                    destination: 'payments',
                    context: {
                        ...buildAnalyticsUserValuePriorityDestinationContext(summary, {
                            referenceValue: '退款风险用户',
                            actionLabel: '回到用户价值',
                            verificationMethod
                        }),
                        focusTargetId: 'paymentsIssueSummary'
                    }
                },
                {
                    label: '看售后工单',
                    destination: 'tickets',
                    context: {
                        ...buildAnalyticsUserValuePriorityDestinationContext(summary, {
                            referenceValue: '退款风险用户',
                            actionLabel: '回到用户价值',
                            verificationMethod
                        }),
                        mode: 'pending',
                        workspace: 'queue',
                        status: 'pending',
                        focusTargetId: 'ticketsQueueControls'
                    }
                },
                {
                    label: '看用户价值',
                    destination: 'analytics-growth',
                    context: {
                        sectionId: ANALYTICS_USER_VALUE_SECTION_ID,
                        focusTargetId: ANALYTICS_USER_VALUE_SECTION_ID
                    }
                }
            ]
        });
    }

    if (buyerUsers > 0 && repeatBuyers <= 0 && crossProductBuyers <= 0) {
        const verificationMethod = '回到用户价值驾驶舱，确认复购、跨商品购买和高价值用户样本是否开始出现，而不只是停在首单层。';
        items.push({
            key: 'repeat-thin',
            score: 90 + buyerUsers,
            tone: 'warning',
            badge: '建议复核',
            title: '首单已形成，复购层仍偏薄',
            summary: `当前已有 ${formatNumber(buyerUsers)} 位用户形成首单成交，但复购 ${formatNumber(repeatBuyers)}、跨商品购买 ${formatNumber(crossProductBuyers)}，价值层还没有继续向上走。`,
            meta: `首单 ${formatNumber(buyerUsers)} / 复购 ${formatNumber(repeatBuyers)} / 跨商品 ${formatNumber(crossProductBuyers)}`,
            rankReason: '已经形成成交，但复购和跨商品购买没有起量，说明用户价值层可能只完成了首单承接。',
            recommendedAction: '先看首购商品去向和后续复购去向，再结合内容带货质量判断，是商品单一还是内容承接过窄。',
            verificationMethod,
            actions: [
                {
                    label: '看商品经营',
                    destination: 'analytics-product',
                    context: {
                        sectionId: 'productOverviewSection',
                        focusTargetId: 'productOverviewSection'
                    }
                },
                {
                    label: '看内容带货',
                    destination: 'analytics-content',
                    context: {
                        sectionId: 'topContentList',
                        focusTargetId: 'topContentList'
                    }
                },
                {
                    label: '看用户价值',
                    destination: 'analytics-growth',
                    context: {
                        sectionId: ANALYTICS_USER_VALUE_SECTION_ID,
                        focusTargetId: ANALYTICS_USER_VALUE_SECTION_ID
                    }
                }
            ]
        });
    }

    if (purchaseIntentUsers > 0 && buyerUsers <= 0) {
        const verificationMethod = '回到用户价值驾驶舱，确认购买意图继续增长的同时，成交用户开始出现，而不是继续停在意图层。';
        items.push({
            key: 'intent-no-buyer',
            score: 70 + purchaseIntentUsers,
            tone: 'warning',
            badge: '建议跟进',
            title: '购买意图已出现，但还没转成成交用户',
            summary: `当前已有 ${formatNumber(purchaseIntentUsers)} 位用户进入购买意图，但成交用户仍为 ${formatNumber(buyerUsers)}，问题更可能卡在支付前后的承接。`,
            meta: `意图 ${formatNumber(purchaseIntentUsers)} / 成交 ${formatNumber(buyerUsers)}`,
            rankReason: '用户已经进入购买意图，但还没形成成交，是最接近支付转换的一层断点。',
            recommendedAction: '先看商品漏斗和支付问题，确认是详情到意图、意图到支付，还是支付到成功这段出了问题。',
            verificationMethod,
            actions: [
                {
                    label: '看商品漏斗',
                    destination: 'analytics-product',
                    context: {
                        sectionId: 'productFunnelSection',
                        focusTargetId: 'productFunnelSection'
                    }
                },
                {
                    label: '看支付问题',
                    destination: 'payments',
                    context: {
                        ...buildAnalyticsUserValuePriorityDestinationContext(summary, {
                            referenceValue: '购买意图未成交',
                            actionLabel: '回到用户价值',
                            verificationMethod
                        }),
                        focusTargetId: 'paymentsIssueSummary'
                    }
                },
                {
                    label: '看用户价值',
                    destination: 'analytics-growth',
                    context: {
                        sectionId: ANALYTICS_USER_VALUE_SECTION_ID,
                        focusTargetId: ANALYTICS_USER_VALUE_SECTION_ID
                    }
                }
            ]
        });
    }

    if (buyerUsers <= 0 && (detailViewUsers > 0 || viewUsers > 0)) {
        const verificationMethod = '回到用户价值驾驶舱，确认详情和意图用户是否继续上升，并最终带出首批成交用户。';
        items.push({
            key: 'front-chain',
            score: 50 + detailViewUsers + Math.floor(viewUsers / 2),
            tone: 'accent',
            badge: '持续观察',
            title: '用户价值还停在浏览或详情前段',
            summary: `当前浏览用户 ${formatNumber(viewUsers)}、详情用户 ${formatNumber(detailViewUsers)}，但还没有形成成交，说明内容和商品承接还停留在前链路。`,
            meta: `浏览 ${formatNumber(viewUsers)} / 详情 ${formatNumber(detailViewUsers)}`,
            rankReason: '这批用户已经被内容或商品触达，但还没进入购买意图和成交层，是最前面的承接断点。',
            recommendedAction: '先看内容带货和商品总盘，确认内容是否真的把用户带进详情，以及商品结构有没有承接住内容流量。',
            verificationMethod,
            actions: [
                {
                    label: '看内容带货',
                    destination: 'analytics-content',
                    context: {
                        sectionId: 'topContentList',
                        focusTargetId: 'topContentList'
                    }
                },
                {
                    label: '看商品总盘',
                    destination: 'analytics-product',
                    context: {
                        sectionId: 'productOverviewSection',
                        focusTargetId: 'productOverviewSection'
                    }
                },
                {
                    label: '看用户价值',
                    destination: 'analytics-growth',
                    context: {
                        sectionId: ANALYTICS_USER_VALUE_SECTION_ID,
                        focusTargetId: ANALYTICS_USER_VALUE_SECTION_ID
                    }
                }
            ]
        });
    }

    return items
        .sort((left, right) => Number(right?.score || 0) - Number(left?.score || 0))
        .slice(0, 3);
}

function buildAnalyticsUserValuePrioritySummary(summary = {}, entries = []) {
    const items = buildAnalyticsUserValuePriorityReviewItems(summary, entries);
    const topItem = items[0] || null;
    if (!topItem) {
        return null;
    }

    const buyerUsers = normalizeAnalyticsCountValue(summary?.buyerUsers);
    const repeatBuyers = normalizeAnalyticsCountValue(summary?.repeatBuyers);
    const crossProductBuyers = normalizeAnalyticsCountValue(summary?.crossProductBuyers);
    const refundRiskBuyers = normalizeAnalyticsCountValue(summary?.refundRiskBuyers);
    const purchaseIntentUsers = normalizeAnalyticsCountValue(summary?.purchaseIntentUsers);
    const detailViewUsers = normalizeAnalyticsCountValue(summary?.detailViewUsers);
    const viewUsers = normalizeAnalyticsCountValue(summary?.viewUsers);

    return {
        tone: String(topItem.tone || 'warning').trim().toLowerCase() || 'warning',
        statusLabel: String(topItem.badge || '建议复核').trim() || '建议复核',
        title: String(topItem.title || '用户价值复查项').trim() || '用户价值复查项',
        summary: String(topItem.summary || '').trim(),
        metrics: [
            String(topItem.meta || '').trim(),
            buyerUsers > 0 ? `成交 ${formatNumber(buyerUsers)}` : '',
            repeatBuyers > 0 ? `复购 ${formatNumber(repeatBuyers)}` : '',
            crossProductBuyers > 0 ? `跨商品 ${formatNumber(crossProductBuyers)}` : '',
            refundRiskBuyers > 0 ? `退款风险 ${formatNumber(refundRiskBuyers)}` : '',
            purchaseIntentUsers > 0 ? `意图 ${formatNumber(purchaseIntentUsers)}` : '',
            detailViewUsers > 0 ? `详情 ${formatNumber(detailViewUsers)}` : '',
            viewUsers > 0 ? `浏览 ${formatNumber(viewUsers)}` : ''
        ].filter(Boolean).slice(0, 4),
        actions: Array.isArray(topItem.actions) ? topItem.actions : [],
        topItem
    };
}

function buildAnalyticsUserValueOverviewState({ summaryWindow = {}, productSummary = {} } = {}) {
    const overview = summaryWindow?.overview && typeof summaryWindow.overview === 'object'
        ? summaryWindow.overview
        : {};
    const userTrendRows = Array.isArray(summaryWindow?.user_trend) ? summaryWindow.user_trend : [];
    const summary = buildAnalyticsUserValueCockpitSummary(productSummary, userTrendRows);
    const feedbackEntries = getAnalyticsResolutionFeedbackEntriesForUser({ limit: 8 });
    const prioritySummary = buildAnalyticsUserValuePrioritySummary(summary, feedbackEntries);
    const verificationState = buildAnalyticsUserValueFeedbackVerificationStatus(feedbackEntries, summary);
    const digest = buildAnalyticsUserValueConclusionDigest(feedbackEntries, summary);
    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(feedbackEntries);
    const latestEntry = feedbackEntries[0] || null;

    return {
        overview,
        userTrendRows,
        summary,
        feedbackEntries,
        prioritySummary,
        verificationState,
        digest,
        statusSummary,
        latestEntry,
        newUsers: normalizeAnalyticsCountValue(overview?.new_users_week),
        activeUsers: normalizeAnalyticsCountValue(overview?.business_dau ?? overview?.dau),
        viewUsers: normalizeAnalyticsCountValue(productSummary?.view_user_count),
        detailUsers: normalizeAnalyticsCountValue(productSummary?.detail_view_user_count),
        intentUsers: normalizeAnalyticsCountValue(productSummary?.purchase_click_user_count),
        buyerUsers: normalizeAnalyticsCountValue(productSummary?.unique_buyer_count)
    };
}

function renderAnalyticsUserValuePriorityReview(summary = {}, entries = []) {
    const items = buildAnalyticsUserValuePriorityReviewItems(summary, entries);
    if (!items.length) {
        return `
            <section class="analytics-product-detail-card analytics-product-detail-card--wide">
                <div class="analytics-product-detail-card__head">
                    <strong>最该复查的用户承接</strong>
                    <span>当前窗口暂无更高优先级的用户价值问题</span>
                </div>
                ${renderHintState('fas fa-user-check', '当前用户价值层没有更高优先级的复查项，继续观察复购、跨商品购买和高价值样本是否保持稳定。')}
            </section>
        `;
    }

    return `
        <section class="analytics-product-detail-card analytics-product-detail-card--wide">
            <div class="analytics-product-detail-card__head">
                <strong>最该复查的用户承接</strong>
                <span>按用户价值层的当前断点和最近回写自动排序</span>
            </div>
            <div class="analytics-writeback-priority">
                <div class="analytics-writeback-priority__list">
                    ${items.map((item, index) => `
                        <div class="analytics-writeback-priority__item">
                            <div class="analytics-writeback-priority__top">
                                <div class="analytics-writeback-priority__rank">TOP ${index + 1}</div>
                                <div class="analytics-writeback-priority__status">
                                    <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item.tone === 'danger' ? 'danger' : (item.tone || 'warning'))}">${escapeHtml(item.badge || '建议复核')}</span>
                                </div>
                            </div>
                            <div class="analytics-writeback-priority__title">${escapeHtml(item.title || '用户承接复查项')}</div>
                            <div class="analytics-writeback-priority__summary">${escapeHtml(item.summary || '')}</div>
                            <div class="analytics-writeback-priority__meta">
                                ${item.meta ? `<span>${escapeHtml(item.meta)}</span>` : ''}
                            </div>
                            ${renderAnalyticsProductInlineGuidance({
                                statusLabel: item.badge || '建议复核',
                                statusTone: item.tone === 'danger' ? 'danger' : (item.tone || 'warning'),
                                reason: item.rankReason || '',
                                recommendation: item.recommendedAction || '',
                                verification: item.verificationMethod || ''
                            })}
                            <div class="analytics-writeback-priority__actions">
                                ${(Array.isArray(item.actions) ? item.actions : []).map((action) => `
                                    <button
                                        type="button"
                                        class="btn-sm btn-secondary"
                                        ${buildAnalyticsProductDestinationAttrs(action.destination, action.context)}
                                    ><i class="fas ${escapeHtml(action.icon || 'fa-arrow-right')}"></i> ${escapeHtml(action.label || '继续处理')}</button>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </section>
    `;
}

function renderAnalyticsUserValueConclusionDigest(entries = [], summary = {}) {
    const digest = buildAnalyticsUserValueConclusionDigest(entries, summary);
    if (!digest) {
        return '';
    }

    return `
        <section class="analytics-product-conclusion-digest analytics-product-conclusion-digest--${escapeHtml(digest.tone || 'warning')}">
            <div class="analytics-product-conclusion-digest__top">
                <div>
                    <div class="analytics-product-conclusion-digest__eyebrow">${escapeHtml(digest.title || '本轮用户价值结论')}</div>
                    <strong>${escapeHtml(digest.label || '待复查')}</strong>
                </div>
                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(digest.tone || 'warning')}">${escapeHtml(digest.label || '待复查')}</span>
            </div>
            <p class="analytics-product-conclusion-digest__summary">${escapeHtml(digest.summary || '')}</p>
            <div class="analytics-product-conclusion-digest__chips">
                ${Array.isArray(digest.evidenceItems)
                    ? digest.evidenceItems.map((item) => `<span class="analytics-product-matrix-chip analytics-product-matrix-chip--${escapeHtml(digest.tone || 'warning')}">${escapeHtml(item)}</span>`).join('')
                    : ''}
            </div>
        </section>
    `;
}

function renderAnalyticsUserValueFeedbackNote(summary = {}) {
    const entries = getAnalyticsResolutionFeedbackEntriesForUser({ limit: 6 });
    if (!entries.length) {
        return `
            <section class="analytics-product-detail-card analytics-product-detail-card--wide">
                <div class="analytics-product-detail-card__head">
                    <strong>最近处理回写</strong>
                    <span>用户侧订单 / 支付 / 售后结果还未回写到这里</span>
                </div>
                ${renderHintState('fas fa-people-arrows', '当前还没有围绕用户价值层的处理回写，先从样本用户进入用户详情或订单承接链。')}
            </section>
        `;
    }

    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(entries);
    const verificationState = buildAnalyticsUserValueFeedbackVerificationStatus(entries, summary);
    const latestEntry = entries[0] || {};

    return `
            <section class="analytics-product-detail-card analytics-product-detail-card--wide">
                <div class="analytics-product-detail-card__head">
                    <strong>最近处理回写</strong>
                    <span>用户侧订单 / 支付 / 售后结果已回传到用户价值驾驶舱</span>
                </div>
            <div class="analytics-writeback-summary">
                <span class="analytics-status-chip analytics-status-chip--success">已处理 ${escapeHtml(formatNumber(statusSummary.resolved || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--warning">待复查 ${escapeHtml(formatNumber(statusSummary.review || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--danger">仍异常 ${escapeHtml(formatNumber(statusSummary.abnormal || 0))}</span>
            </div>
            <div class="analytics-writeback-conclusions">
                <div class="analytics-writeback-conclusions__head">
                    <strong>复查结论记录</strong>
                    <span>沉淀最近一轮用户承接复查结论，方便回看价值层是否真正收口</span>
                </div>
                <div class="analytics-writeback-conclusions__list">
                    <div class="analytics-writeback-conclusion-card analytics-writeback-conclusion-card--${escapeHtml(verificationState.tone || 'warning')}">
                        <div class="analytics-writeback-conclusion-card__top">
                            <div>
                                <div class="analytics-writeback-conclusion-card__title">${escapeHtml(verificationState.key === 'passed' ? '本轮复查已通过' : '本轮仍待复查')}</div>
                                <div class="analytics-writeback-conclusion-card__product">用户价值驾驶舱</div>
                            </div>
                            <span class="analytics-status-chip analytics-status-chip--${escapeHtml(verificationState.tone || 'warning')}">${escapeHtml(verificationState.label || '仍待验证')}</span>
                        </div>
                        <div class="analytics-writeback-conclusion-card__summary">${escapeHtml(verificationState.summary || '')}</div>
                        <div class="analytics-writeback-conclusion-card__meta">
                            <span>最近回写 ${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(latestEntry?.createdAt))}</span>
                        </div>
                        <div class="analytics-writeback-conclusion-card__evidence">
                            <span>最近一次验证依据</span>
                            <p>${escapeHtml(String(latestEntry?.summary || '').trim() || '请结合用户价值层信号和最近处理回写继续复查。')}</p>
                        </div>
                        <div class="analytics-writeback-conclusion-card__next-step">
                            <span>下次复查建议</span>
                            <p>${escapeHtml(Number(summary?.refundRiskBuyers || 0) > 0 ? '继续复查退款风险用户是否减少，再确认复购和跨商品购买是否恢复。' : '继续复查复购、跨商品购买和高价值用户样本是否保持稳定。')}</p>
                        </div>
                    </div>
                </div>
            </div>
            <div class="analytics-writeback-list">
                ${entries.map((entry) => `
                    <div class="analytics-writeback-item">
                        <div class="analytics-writeback-item__top">
                            <div class="analytics-writeback-item__chips">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.module === 'tickets' ? 'warning' : (entry?.module === 'payments' ? 'accent' : 'default'))}">${escapeHtml(entry?.module === 'tickets' ? '售后处理' : (entry?.module === 'payments' ? '支付处理' : '订单处理'))}</span>
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.tone || 'accent')}">${escapeHtml(entry?.statusLabel || '已处理')}</span>
                            </div>
                            <span class="analytics-writeback-item__time">${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(entry?.createdAt))}</span>
                        </div>
                        <div class="analytics-writeback-item__title">${escapeHtml(entry?.title || '处理已回写')}</div>
                        <div class="analytics-writeback-item__summary">${escapeHtml(entry?.summary || '')}</div>
                        <div class="analytics-writeback-item__meta">
                            ${entry?.actionLabel ? `<span>${escapeHtml(entry.actionLabel)}</span>` : ''}
                            ${entry?.entityName ? `<span>${escapeHtml(entry.entityName)}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function renderAnalyticsUserValueConclusionHistory(summary = {}) {
    const entries = getAnalyticsResolutionFeedbackEntriesForUser({ limit: 8 });
    if (!entries.length) {
        return '';
    }

    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(entries);
    return `
        <section class="analytics-product-detail-card analytics-product-detail-card--wide">
            <div class="analytics-product-detail-card__head">
                <strong>历史复查结论</strong>
                <span>最近 ${escapeHtml(formatNumber(entries.length))} 条回写</span>
            </div>
            <div class="analytics-product-history-summary">
                <span class="analytics-status-chip analytics-status-chip--success">已处理 ${escapeHtml(formatNumber(statusSummary.resolved || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--warning">待复查 ${escapeHtml(formatNumber(statusSummary.review || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--danger">仍异常 ${escapeHtml(formatNumber(statusSummary.abnormal || 0))}</span>
            </div>
            <div class="analytics-product-history-note">按时间倒序保留最近一轮用户承接处理与复查结论，方便回看价值层是否真正收口。</div>
            <div class="analytics-writeback-list">
                ${entries.map((entry) => `
                    <div class="analytics-writeback-item">
                        <div class="analytics-writeback-item__top">
                            <div class="analytics-writeback-item__chips">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.module === 'tickets' ? 'warning' : (entry?.module === 'payments' ? 'accent' : 'default'))}">${escapeHtml(entry?.module === 'tickets' ? '售后处理' : (entry?.module === 'payments' ? '支付处理' : '订单处理'))}</span>
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.tone || 'accent')}">${escapeHtml(entry?.statusLabel || '已处理')}</span>
                            </div>
                            <span class="analytics-writeback-item__time">${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(entry?.createdAt))}</span>
                        </div>
                        <div class="analytics-writeback-item__title">${escapeHtml(entry?.title || '复查结论')}</div>
                        <div class="analytics-writeback-item__summary">${escapeHtml(entry?.summary || '')}</div>
                        <div class="analytics-writeback-item__meta">
                            ${entry?.actionLabel ? `<span>${escapeHtml(entry.actionLabel)}</span>` : ''}
                            ${entry?.entityName ? `<span>${escapeHtml(entry.entityName)}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function renderAnalyticsUserValueCockpitSummary(summary = {}) {
    if (!summary || !summary.hasSignal) {
        return renderHintState('fas fa-user-group', '当前窗口暂无用户价值层信号');
    }

    const segmentItems = Array.isArray(summary.segmentItems) ? summary.segmentItems : [];
    const buyerSnapshot = Array.isArray(summary.buyerSnapshot) ? summary.buyerSnapshot : [];
    const firstPurchaseDestinations = Array.isArray(summary.firstPurchaseDestinations) ? summary.firstPurchaseDestinations : [];
    const postPurchaseDestinations = Array.isArray(summary.postPurchaseDestinations) ? summary.postPurchaseDestinations : [];
    const feedbackEntries = getAnalyticsResolutionFeedbackEntriesForUser({ limit: 8 });
    const conclusionDigestMarkup = renderAnalyticsUserValueConclusionDigest(feedbackEntries, summary);
    const priorityReviewMarkup = renderAnalyticsUserValuePriorityReview(summary, feedbackEntries);
    const writebackMarkup = renderAnalyticsUserValueFeedbackNote(summary);
    const historyMarkup = renderAnalyticsUserValueConclusionHistory(summary);

    return `
            <div class="analytics-user-value-cockpit__head">
                <div>
                    <div class="analytics-user-value-cockpit__eyebrow">用户价值驾驶舱</div>
                    <strong class="analytics-user-value-cockpit__title">${escapeHtml(summary.headline || '当前窗口暂无用户价值层信号')}</strong>
                </div>
                <div class="analytics-user-value-cockpit__state analytics-user-value-cockpit__state--${escapeHtml(summary.stateTone || 'default')}">
                    ${escapeHtml(summary.stateLabel || '价值层尚未形成')}
                </div>
            </div>
            <p class="analytics-user-value-cockpit__summary">${escapeHtml(summary.summary || '')}</p>
            ${conclusionDigestMarkup}
            <div class="analytics-user-value-cockpit__stats">
                ${segmentItems.map((segment) => `
                    <article class="analytics-user-value-cockpit__stat">
                        <strong>${escapeHtml(segment.label || '价值层')}</strong>
                        <div class="analytics-user-value-cockpit__stat-value">${formatNumber(segment.count || 0)}</div>
                        <div class="analytics-user-value-cockpit__stat-note">${escapeHtml(segment.note || '')}</div>
                        ${Array.isArray(segment.sample_users) && segment.sample_users.length > 0
                            ? `<div class="analytics-user-value-cockpit__samples">
                                ${segment.sample_users.map((sample) => renderAnalyticsUserValueCockpitBuyerSample(sample, summary, segment)).join('')}
                            </div>`
                            : ''}
                    </article>
                `).join('')}
            </div>
            <div class="analytics-user-value-cockpit__grid">
                <section class="analytics-user-value-cockpit__panel">
                    <div class="analytics-user-value-cockpit__panel-label">高价值用户样本</div>
                    ${buyerSnapshot.length > 0
                        ? `<div class="analytics-user-value-cockpit__samples">
                            ${buyerSnapshot.slice(0, 4).map((sample) => renderAnalyticsUserValueCockpitBuyerSample(sample, summary, { label: '高价值用户' })).join('')}
                        </div>`
                        : '<div class="analytics-user-value-cockpit__empty">当前窗口暂无成交用户样本</div>'}
                </section>
                <section class="analytics-user-value-cockpit__panel">
                    <div class="analytics-user-value-cockpit__panel-label">首购商品去向</div>
                    ${firstPurchaseDestinations.length > 0
                        ? `<div class="analytics-user-value-cockpit__product-rows">
                            ${firstPurchaseDestinations.map((row) => renderAnalyticsUserValueCockpitProductRow(row, '首购商品去向')).join('')}
                        </div>`
                        : '<div class="analytics-user-value-cockpit__empty">当前窗口暂无首购商品去向样本</div>'}
                </section>
                <section class="analytics-user-value-cockpit__panel">
                    <div class="analytics-user-value-cockpit__panel-label">后续复购去向</div>
                    ${postPurchaseDestinations.length > 0
                        ? `<div class="analytics-user-value-cockpit__product-rows">
                            ${postPurchaseDestinations.map((row) => renderAnalyticsUserValueCockpitProductRow(row, '后续复购去向')).join('')}
                        </div>`
                        : '<div class="analytics-user-value-cockpit__empty">当前窗口还没有形成后续复购去向样本</div>'}
                </section>
            </div>
            ${priorityReviewMarkup}
            ${writebackMarkup}
            ${historyMarkup}
    `;
}

function getAnalyticsGrowthNewUsersTodayState() {
    if (!globalThis.__analyticsGrowthNewUsersTodayState || typeof globalThis.__analyticsGrowthNewUsersTodayState !== 'object') {
        globalThis.__analyticsGrowthNewUsersTodayState = {
            hasValue: false,
            value: 0,
            label: '今日新增用户',
            tooltip: '今日新增用户加载中',
            sourceDate: '',
            siteLabel: ''
        };
    }

    return globalThis.__analyticsGrowthNewUsersTodayState;
}

function normalizeAnalyticsTrendDateKey(value) {
    if (!value) {
        return '';
    }

    if (typeof toAnalyticsIsoDate === 'function') {
        const normalizedValue = toAnalyticsIsoDate(value);
        if (normalizedValue) {
            return normalizedValue;
        }
    }

    return String(value).trim().slice(0, 10);
}

function buildAnalyticsGrowthNewUsersTodaySnapshot({ overview = null, trendRows = [] } = {}) {
    const normalizedOverview = overview && typeof overview === 'object' ? overview : {};
    const labels = typeof getAnalyticsNewUsersLabels === 'function'
        ? getAnalyticsNewUsersLabels()
        : {
            todayLabel: '今日新增用户',
            weekLabel: '近 7 天新增用户'
        };
    const siteParam = typeof getAnalyticsSiteParam === 'function'
        ? String(getAnalyticsSiteParam() || '').trim().toLowerCase()
        : '';
    const siteLabel = siteParam
        ? (typeof getAnalyticsSiteLabel === 'function' ? getAnalyticsSiteLabel(siteParam) : siteParam.toUpperCase())
        : '全站';
    const todayKey = normalizeAnalyticsTrendDateKey(new Date());
    const hasOverviewToday = normalizedOverview.new_users_today != null || normalizedOverview.site_attributed_new_users_today != null;
    const hasOverviewWeek = normalizedOverview.new_users_week != null;

    let hasValue = false;
    let value = 0;
    let sourceDate = '';

    if (hasOverviewToday) {
        value = normalizeAnalyticsCountValue(
            normalizedOverview.new_users_today ?? normalizedOverview.site_attributed_new_users_today
        );
        hasValue = true;
        sourceDate = todayKey;
    } else {
        const todayRow = (Array.isArray(trendRows) ? trendRows : []).find((row) => {
            const rowDate = normalizeAnalyticsTrendDateKey(row?.stat_date || row?.day || row?.date);
            return Boolean(rowDate) && rowDate === todayKey;
        });

        if (todayRow) {
            value = normalizeAnalyticsCountValue(todayRow?.new_users);
            hasValue = true;
            sourceDate = todayKey;
        }
    }

    const weekValue = hasOverviewWeek
        ? normalizeAnalyticsCountValue(normalizedOverview.new_users_week)
        : null;
    const tooltip = hasValue
        ? `${labels.todayLabel} ${formatNumber(value)}${weekValue != null ? ` / ${labels.weekLabel} ${formatNumber(weekValue)}` : ''}${sourceDate ? ` · ${sourceDate}` : ''}${siteLabel ? ` · ${siteLabel}` : ''}`
        : `当前暂无${labels.todayLabel}数据`;

    return {
        hasValue,
        value,
        label: String(labels.todayLabel || '今日新增用户').trim() || '今日新增用户',
        tooltip,
        sourceDate,
        siteLabel
    };
}

function syncAnalyticsGrowthNewUsersTodayDisplays(snapshot = {}) {
    const state = getAnalyticsGrowthNewUsersTodayState();
    state.hasValue = snapshot.hasValue === true;
    state.value = snapshot.hasValue === true ? normalizeAnalyticsCountValue(snapshot.value) : 0;
    state.label = String(snapshot.label || state.label || '今日新增用户').trim() || '今日新增用户';
    state.tooltip = String(snapshot.tooltip || '').trim() || `当前暂无${state.label}数据`;
    state.sourceDate = String(snapshot.sourceDate || '').trim();
    state.siteLabel = String(snapshot.siteLabel || '').trim();

    const valueText = state.hasValue ? formatNumber(state.value) : '--';
    const valueNode = document.getElementById('kpiGrowthNewUsersValue');
    const labelNode = document.getElementById('kpiGrowthNewUsersLabel');
    const cardNode = document.getElementById('kpiGrowthNewUsers');
    const summaryNode = document.getElementById('userTrendTodaySummary');
    const summaryValueNode = document.getElementById('userTrendTodaySummaryValue');

    if (valueNode) {
        valueNode.textContent = valueText;
        valueNode.title = state.tooltip;
    }
    if (labelNode) {
        labelNode.textContent = state.label;
        labelNode.title = state.tooltip;
    }
    if (cardNode) {
        cardNode.title = state.tooltip;
    }
    if (summaryValueNode) {
        summaryValueNode.textContent = valueText;
        summaryValueNode.title = state.tooltip;
    }
    if (summaryNode) {
        summaryNode.title = state.tooltip;
        summaryNode.setAttribute('aria-label', state.tooltip);
        summaryNode.dataset.empty = state.hasValue ? 'false' : 'true';
    }

    return state;
}

function syncAnalyticsGrowthNewUsersTodayFromSources(options = {}) {
    const snapshot = buildAnalyticsGrowthNewUsersTodaySnapshot(options);
    return syncAnalyticsGrowthNewUsersTodayDisplays(snapshot);
}

function renderAnalyticsUserTrendValuePanels({ productSummary = {}, trendRows = [] } = {}) {
    const commerceImpactContainer = document.getElementById('userGrowthCommerceImpact');
    const userValueContainer = document.getElementById(ANALYTICS_USER_VALUE_OVERVIEW_PANEL_ID);
    const userValueStandaloneContainer = document.getElementById(ANALYTICS_USER_VALUE_STANDALONE_PANEL_ID);
    const userValueStandaloneMeta = document.getElementById('userValueCockpitStandaloneMeta');

    if (commerceImpactContainer) {
        const commerceImpactSummary = buildAnalyticsUserCommerceImpactSummary(productSummary, trendRows);
        commerceImpactContainer.innerHTML = renderAnalyticsUserCommerceImpactSummary(commerceImpactSummary);
    }

    const userValueSummary = buildAnalyticsUserValueCockpitSummary(productSummary, trendRows);
    if (userValueContainer) {
        userValueContainer.innerHTML = renderAnalyticsUserValueCockpitSummary(userValueSummary);
    }
    if (userValueStandaloneContainer) {
        userValueStandaloneContainer.innerHTML = renderAnalyticsUserValueCockpitSummary(userValueSummary);
    }
    if (userValueStandaloneMeta) {
        userValueStandaloneMeta.textContent = userValueSummary?.hasSignal
            ? [
                userValueSummary.stateLabel || '',
                `成交 ${formatNumber(userValueSummary.buyerUsers || 0)}`,
                `复购 ${formatNumber(userValueSummary.repeatBuyers || 0)}`,
                `跨商品 ${formatNumber(userValueSummary.crossProductBuyers || 0)}`
            ].filter(Boolean).join(' · ')
            : '当前窗口暂无用户价值层信号';
    }
}

function renderAnalyticsUserTrendValuePanelsLoading() {
    const commerceImpactContainer = document.getElementById('userGrowthCommerceImpact');
    const userValueContainer = document.getElementById(ANALYTICS_USER_VALUE_OVERVIEW_PANEL_ID);
    const userValueStandaloneContainer = document.getElementById(ANALYTICS_USER_VALUE_STANDALONE_PANEL_ID);
    const userValueStandaloneMeta = document.getElementById('userValueCockpitStandaloneMeta');

    if (commerceImpactContainer) {
        commerceImpactContainer.innerHTML = renderAnalyticsProductLoadingState('商品影响用户层加载中...');
    }
    if (userValueContainer) {
        userValueContainer.innerHTML = renderAnalyticsProductLoadingState('用户价值驾驶舱加载中...');
    }
    if (userValueStandaloneContainer) {
        userValueStandaloneContainer.innerHTML = renderAnalyticsProductLoadingState('用户价值驾驶舱加载中...');
    }
    if (userValueStandaloneMeta) {
        userValueStandaloneMeta.textContent = '用户价值驾驶舱正在补齐...';
    }
}

function hasAnalyticsUserTrendValuePanelTargets() {
    return Boolean(
        document.getElementById('userGrowthCommerceImpact')
        || document.getElementById(ANALYTICS_USER_VALUE_OVERVIEW_PANEL_ID)
        || document.getElementById(ANALYTICS_USER_VALUE_STANDALONE_PANEL_ID)
        || document.getElementById('userValueCockpitStandaloneMeta')
    );
}

async function hydrateAnalyticsUserTrendValuePanels({ days = 30, trendRows = [], requestId = 0 } = {}) {
    if (!hasAnalyticsUserTrendValuePanelTargets()) {
        return;
    }

    renderAnalyticsUserTrendValuePanelsLoading();

    const productSummaryBundle = await getAnalyticsProductSummaryBundle({ days }).catch(() => null);
    if (requestId !== analyticsUserTrendRequestId) {
        return;
    }

    let productSummary = {};
    if (productSummaryBundle) {
        try {
            productSummary = getAnalyticsProductBundlePayloadOrThrow(
                productSummaryBundle,
                'summary',
                'Product summary unavailable'
            ) || {};
        } catch (error) {
            console.warn('[Analytics] Failed to read product summary for user value cockpit:', error);
        }
    }

    renderAnalyticsUserTrendValuePanels({
        productSummary,
        trendRows
    });
}

async function hydrateAnalyticsUserTrendSummaryWindow({ trendRows = [], requestId = 0 } = {}) {
    try {
        const summaryWindow = await getAnalyticsSummaryWindowData().catch(() => null);
        if (requestId !== analyticsUserTrendRequestId) {
            return;
        }

        const overview = summaryWindow?.overview && typeof summaryWindow.overview === 'object'
            ? summaryWindow.overview
            : {};
        if (!Object.keys(overview).length) {
            return;
        }

        syncAnalyticsGrowthNewUsersTodayFromSources({
            overview,
            trendRows
        });
    } catch (error) {
        console.warn('[Analytics] Failed to hydrate user trend summary window:', error);
    }
}

async function loadUserTrendChart(days = 30) {
    try {
        const requestId = ++analyticsUserTrendRequestId;
        const data = await fetchUserTrendData(days);

        if (requestId !== analyticsUserTrendRequestId) {
            return;
        }

        const ctx = document.getElementById('userTrendChart');
        if (!ctx) return;

        syncAnalyticsGrowthNewUsersTodayFromSources({
            trendRows: data
        });
        const summaryHydrationPromise = hydrateAnalyticsUserTrendSummaryWindow({ trendRows: data, requestId });

        const theme = getChartTheme();
        const activeUserLabels = getAnalyticsActiveUserLabels();
        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, chartColors.gradientStart);
        gradient.addColorStop(1, chartColors.gradientEnd);

        if (userTrendChart) {
            userTrendChart.destroy();
        }

        userTrendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map((d) => formatDate(d.stat_date)),
                datasets: [
                    {
                        label: activeUserLabels.seriesLabel,
                        data: data.map((d) => d.active_users),
                        borderColor: chartColors.primary,
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    },
                    {
                        label: getAnalyticsNewUsersLabels().seriesLabel,
                        data: data.map((d) => d.new_users),
                        borderColor: chartColors.success,
                        backgroundColor: 'transparent',
                        borderDash: [5, 5],
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: theme.text }
                    },
                    tooltip: {
                        callbacks: {
                            afterLabel(context) {
                                if (context.datasetIndex !== 0) return '';
                                const row = Array.isArray(data) ? data[context.dataIndex] : null;
                                const loginActiveUsers = normalizeAnalyticsCountValue(row?.login_active_users);
                                if (loginActiveUsers <= 0) return '';
                                return `登录活跃参考: ${formatNumber(loginActiveUsers)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

        await Promise.allSettled([
            summaryHydrationPromise,
            hydrateAnalyticsUserTrendValuePanels({ days, trendRows: data, requestId })
        ]);
    } catch (err) {
        console.error('[Analytics] Failed to load user trend:', err);
        syncAnalyticsGrowthNewUsersTodayDisplays({
            hasValue: false,
            label: typeof getAnalyticsNewUsersLabels === 'function' ? getAnalyticsNewUsersLabels().todayLabel : '今日新增用户',
            tooltip: '今日新增用户加载失败'
        });
        const commerceImpactContainer = document.getElementById('userGrowthCommerceImpact');
        const userValueContainer = document.getElementById(ANALYTICS_USER_VALUE_OVERVIEW_PANEL_ID);
        const userValueStandaloneContainer = document.getElementById(ANALYTICS_USER_VALUE_STANDALONE_PANEL_ID);
        const userValueStandaloneMeta = document.getElementById('userValueCockpitStandaloneMeta');
        if (commerceImpactContainer) {
            commerceImpactContainer.innerHTML = renderHintState('fas fa-users-viewfinder', '商品影响用户层加载失败', 'error');
        }
        if (userValueContainer) {
            userValueContainer.innerHTML = renderHintState('fas fa-user-group', '用户价值驾驶舱加载失败', 'error');
        }
        if (userValueStandaloneContainer) {
            userValueStandaloneContainer.innerHTML = renderHintState('fas fa-user-group', '用户价值驾驶舱加载失败', 'error');
        }
        if (userValueStandaloneMeta) {
            userValueStandaloneMeta.textContent = '用户价值驾驶舱加载失败';
        }
    }
}

function getChannelBreakdownMetricMeta(rows = []) {
    const metrics = [
        { key: 'event_count', unitLabel: '事件', tooltipSuffix: '次事件', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'user_count', unitLabel: '用户', tooltipSuffix: '位用户', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'unlock_success_count', unitLabel: '内容解锁', tooltipSuffix: '次解锁', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'verify_submit_count', unitLabel: '验证提交', tooltipSuffix: '次提交', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'recharge_success_count', unitLabel: '充值成功', tooltipSuffix: '次充值', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'shop_purchase_count', unitLabel: '商城成交', tooltipSuffix: '次成交', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'total_points', unitLabel: '积分', tooltipSuffix: '积分' },
        { key: 'used_codes', unitLabel: '已核销码', tooltipSuffix: '个核销码' },
        { key: 'total_codes', unitLabel: '兑换码', tooltipSuffix: '个兑换码' },
        { key: 'batch_count', unitLabel: '批次', tooltipSuffix: '个批次' }
    ];

    for (const metric of metrics) {
        if (rows.some((row) => (toNumericValue(row?.[metric.key]) || 0) > 0)) {
            return metric;
        }
    }

    return metrics[0];
}

function renderChannelBreakdownState(message, variant = 'empty') {
    const container = document.getElementById('channelBreakdownList');
    if (!(container instanceof HTMLElement)) return;
    container.innerHTML = renderHintState('fas fa-list-ul', message, variant);
}

function getChannelBreakdownActionConfig(metricKey = '') {
    switch (String(metricKey || '').trim()) {
        case 'verify_submit_count':
            return { destination: 'analytics-verify', sectionId: 'verifyEventFunnel', label: '看验证服务' };
        case 'recharge_success_count':
        case 'shop_purchase_count':
            return { destination: 'analytics-monetization', sectionId: 'commerceEventFunnel', label: '看积分与交易' };
        case 'total_points':
        case 'used_codes':
        case 'total_codes':
        case 'batch_count':
            return { destination: 'analytics-monetization', sectionId: 'pointsFlow', label: '看积分与交易' };
        default:
            return { destination: 'analytics-content', sectionId: 'topContentList', label: '看内容分栏' };
    }
}

function renderChannelBreakdownDetails(rows = [], metricMeta = {}, indicatorColors = []) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return renderHintState('fas fa-list-ul', '当前窗口暂无渠道明细');
    }

    const actionConfig = getChannelBreakdownActionConfig(metricMeta.key);

    return `
        <div class="analytics-recommendation-stack">
            ${rows.slice(0, 5).map((row, index) => {
                const primaryValue = toNumericValue(row?.[metricMeta.key]) || 0;
                const shareRate = toNumericValue(row?.[metricMeta.rateKey || 'share_rate']);
                const detailParts = [];
                const indicatorColor = indicatorColors[index % indicatorColors.length] || chartColors.primary;

                if (metricMeta.key !== 'user_count' && (toNumericValue(row?.user_count) || 0) > 0) {
                    detailParts.push(`覆盖 ${formatNumber(row.user_count)} 位用户`);
                }
                if (metricMeta.key !== 'event_count' && (toNumericValue(row?.event_count) || 0) > 0) {
                    detailParts.push(`事件 ${formatNumber(row.event_count)}`);
                }
                if (metricMeta.key !== 'unlock_success_count' && (toNumericValue(row?.unlock_success_count) || 0) > 0) {
                    detailParts.push(`解锁 ${formatNumber(row.unlock_success_count)}`);
                }
                if (metricMeta.key !== 'verify_submit_count' && (toNumericValue(row?.verify_submit_count) || 0) > 0) {
                    detailParts.push(`验证 ${formatNumber(row.verify_submit_count)}`);
                }
                if (metricMeta.key !== 'shop_purchase_count' && (toNumericValue(row?.shop_purchase_count) || 0) > 0) {
                    detailParts.push(`成交 ${formatNumber(row.shop_purchase_count)}`);
                }
                if (metricMeta.key !== 'used_codes' && (toNumericValue(row?.used_codes) || 0) > 0) {
                    detailParts.push(`核销 ${formatNumber(row.used_codes)}`);
                }
                if (shareRate !== null) {
                    detailParts.push(`占比 ${formatPercent(shareRate)}`);
                } else if ((toNumericValue(row?.redemption_rate) || 0) > 0) {
                    detailParts.push(`使用率 ${formatPercent(row.redemption_rate)}`);
                }

                return `
                    <article class="analytics-recommendation-item" style="--analytics-distribution-indicator:${escapeHtml(indicatorColor)};">
                        <div class="analytics-recommendation-item__top">
                            <span class="analytics-status-chip analytics-status-chip--accent">${escapeHtml(metricMeta.unitLabel || '样本')}</span>
                            <strong class="analytics-recommendation-item__title">${escapeHtml(row?.channel || '未分类')}</strong>
                        </div>
                        <div class="analytics-recommendation-item__summary">
                            ${escapeHtml(`${metricMeta.unitLabel || '样本'} ${formatNumber(primaryValue)}${detailParts.length ? ` · ${detailParts.join(' / ')}` : ''}`)}
                        </div>
                        <div class="analytics-recommendation-item__actions">
                            <button
                                type="button"
                                class="btn-sm btn-secondary"
                                data-admin-action="analytics-open-destination"
                                data-analytics-destination="${escapeHtml(actionConfig.destination)}"
                                data-analytics-context="${escapeHtml(serializeAnalyticsActionContext({ sectionId: actionConfig.sectionId }))}"
                            >
                                <i class="fas fa-arrow-right"></i> ${escapeHtml(actionConfig.label)}
                            </button>
                        </div>
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

async function fetchChannelBreakdownData(days = getAnalyticsRangeDays()) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsPanelSupportBundle({ days }),
        readSegment: getAnalyticsPanelSupportBundleSegment,
        segmentKey: 'channelBreakdown',
        unavailableMessage: 'Channel breakdown bundle unavailable',
        warningMessage: '[Analytics] Panel support bundle channel breakdown unavailable:',
        createSegmentError: createAnalyticsPanelSupportBundleSegmentError,
        directLoader: () => loadChannelBreakdownDirect(days)
    });
}

function ensureChannelChartCanvas() {
    const panel = document.getElementById('channelChartPanel');
    if (!(panel instanceof HTMLElement)) return null;

    let canvas = panel.querySelector('#channelChart');
    if (!(canvas instanceof HTMLCanvasElement)) {
        panel.innerHTML = '<canvas id="channelChart"></canvas>';
        canvas = panel.querySelector('#channelChart');
    }

    return canvas instanceof HTMLCanvasElement ? canvas : null;
}

function renderChannelChartState(message, variant = 'empty') {
    const panel = document.getElementById('channelChartPanel');
    if (!(panel instanceof HTMLElement)) return;

    if (channelChart) {
        channelChart.destroy();
        channelChart = null;
    }

    panel.innerHTML = renderHintState('fas fa-diagram-project', message, variant);
    renderChannelBreakdownState(variant === 'error' ? '渠道明细加载失败' : '当前窗口暂无渠道明细', variant);
}

async function loadChannelChart(days = getAnalyticsRangeDays()) {
    try {
        const data = await fetchChannelBreakdownData(days);

        const ctx = ensureChannelChartCanvas();
        if (!ctx) return;
        const detailContainer = document.getElementById('channelBreakdownList');

        const metricMeta = getChannelBreakdownMetricMeta(data || []);
        const chartRows = Array.isArray(data)
            ? data.filter((row) => (toNumericValue(row?.[metricMeta.key]) || 0) > 0)
            : [];

        if (chartRows.length === 0) {
            renderChannelChartState('暂无渠道分布数据');
            return;
        }

        const theme = getChartTheme();
        const colors = [chartColors.primary, chartColors.secondary, chartColors.success, chartColors.warning, chartColors.danger];
        const backgroundColors = chartRows.map((_, index) => colors[index % colors.length]);

        if (channelChart) {
            channelChart.destroy();
        }

        channelChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: chartRows.map((row) => row.channel || '未分类'),
                datasets: [{
                    data: chartRows.map((row) => toNumericValue(row?.[metricMeta.key]) || 0),
                    backgroundColor: backgroundColors,
                    borderWidth: 2,
                    borderColor: theme.background
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const row = chartRows[context.dataIndex] || {};
                                const rate = toNumericValue(row?.[metricMeta.rateKey || 'redemption_rate']);
                                const rateText = rate !== null
                                    ? ` (${trimTrailingZeros(rate.toFixed(2))}% ${metricMeta.rateLabel || '核销'})`
                                    : '';
                                return `${label}: ${formatNumber(value)} ${metricMeta.tooltipSuffix}${rateText}`;
                            }
                        }
                    }
                }
            }
        });

        if (detailContainer) {
            detailContainer.innerHTML = renderChannelBreakdownDetails(chartRows, metricMeta, backgroundColors);
        }
    } catch (err) {
        console.error('[Analytics] Failed to load channel chart:', err);
        renderChannelChartState('渠道分布加载失败', 'error');
    }
}

async function loadContentTrendChart(days = 30) {
    try {
        const data = await fetchContentTrendData(days);

        const ctx = document.getElementById('contentTrendChart');
        if (!ctx) return;

        const theme = getChartTheme();

        if (contentTrendChart) {
            contentTrendChart.destroy();
        }

        contentTrendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map((d) => formatDate(d.stat_date)),
                datasets: [
                    {
                        label: '评论',
                        data: data.map((d) => d.comments),
                        backgroundColor: chartColors.primary,
                        borderRadius: 4
                    },
                    {
                        label: '解锁',
                        data: data.map((d) => d.unlocks),
                        backgroundColor: chartColors.secondary,
                        borderRadius: 4
                    },
                    {
                        label: '点赞',
                        data: data.map((d) => d.likes),
                        backgroundColor: chartColors.success,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: theme.text }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { color: theme.text }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });
    } catch (err) {
        console.error('[Analytics] Failed to load content trend:', err);
    }
}

async function fetchTopContentData(limit = 10, days = getAnalyticsRangeDays()) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsPanelSupportBundle({ days }),
        readSegment: getAnalyticsPanelSupportBundleSegment,
        segmentKey: 'topContent',
        unavailableMessage: 'Top content bundle unavailable',
        warningMessage: '[Analytics] Panel support bundle top content unavailable:',
        createSegmentError: createAnalyticsPanelSupportBundleSegmentError,
        mapPayload: (payload) => payload.slice(0, Math.max(1, Number(limit) || 10)),
        directLoader: () => loadTopContentDirect(limit, days)
    });
}

function buildAnalyticsContentCommerceSummary(rows = []) {
    const promptBuckets = new Map();
    const productIds = new Set();
    let totalGmvPoints = 0;
    let totalPurchaseSuccessCount = 0;
    let totalPurchaseClickCount = 0;
    let totalDetailViewCount = 0;

    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const productId = String(row?.product_id || '').trim();
        const productName = String(row?.product_name || '').trim();
        const promptSources = Array.isArray(row?.prompt_sources) && row.prompt_sources.length > 0
            ? row.prompt_sources
            : (String(row?.top_prompt_id || '').trim()
                ? [{
                    prompt_id: row.top_prompt_id,
                    gmv_points: row.top_prompt_gmv_points,
                    purchase_success_count: row.top_prompt_purchase_success_count,
                    purchase_click_count: row.content_assisted_purchase_click_count,
                    detail_view_count: row.content_assisted_detail_view_count
                }]
                : []);

        promptSources.forEach((source) => {
            const promptId = String(source?.prompt_id || '').trim();
            if (!promptId) return;

            const bucket = promptBuckets.get(promptId) || {
                prompt_id: promptId,
                product_ids: new Set(),
                product_names: new Set(),
                product_entries: new Map(),
                user_samples: new Set(),
                detail_view_user_samples: new Set(),
                purchase_click_user_samples: new Set(),
                purchase_success_user_samples: new Set(),
                order_samples: new Map(),
                gmv_points: 0,
                purchase_success_count: 0,
                purchase_click_count: 0,
                detail_view_count: 0
            };

            if (productId) {
                bucket.product_ids.add(productId);
                productIds.add(productId);
            }
            if (productName) {
                bucket.product_names.add(productName);
            }

            (Array.isArray(source?.user_samples) ? source.user_samples : []).forEach((userId) => {
                const safeUserId = String(userId || '').trim();
                if (safeUserId) {
                    bucket.user_samples.add(safeUserId);
                }
            });
            (Array.isArray(source?.detail_view_user_samples) ? source.detail_view_user_samples : []).forEach((userId) => {
                const safeUserId = String(userId || '').trim();
                if (safeUserId) {
                    bucket.detail_view_user_samples.add(safeUserId);
                }
            });
            (Array.isArray(source?.purchase_click_user_samples) ? source.purchase_click_user_samples : []).forEach((userId) => {
                const safeUserId = String(userId || '').trim();
                if (safeUserId) {
                    bucket.purchase_click_user_samples.add(safeUserId);
                }
            });
            (Array.isArray(source?.purchase_success_user_samples) ? source.purchase_success_user_samples : []).forEach((userId) => {
                const safeUserId = String(userId || '').trim();
                if (safeUserId) {
                    bucket.purchase_success_user_samples.add(safeUserId);
                }
            });
            (Array.isArray(source?.order_samples) ? source.order_samples : []).forEach((sample) => {
                const orderId = String(sample?.order_id || '').trim();
                if (!orderId || bucket.order_samples.has(orderId)) {
                    return;
                }
                bucket.order_samples.set(orderId, {
                    order_id: orderId,
                    user_id: String(sample?.user_id || '').trim(),
                    product_id: String(sample?.product_id || productId || '').trim(),
                    product_name: String(sample?.product_name || productName || '').trim(),
                    site: String(sample?.site || '').trim().toLowerCase(),
                    total_points: roundTo(sample?.total_points, 2) || 0,
                    refund_status: String(sample?.refund_status || '').trim(),
                    delivery_status: String(sample?.delivery_status || '').trim(),
                    created_at: String(sample?.created_at || '').trim()
                });
            });

            const productEntryKey = productId || (productName ? `name:${productName}` : '');
            if (productEntryKey) {
                const existingProductEntry = bucket.product_entries.get(productEntryKey) || {
                    product_id: productId,
                    product_name: productName,
                    gmv_points: 0,
                    purchase_success_count: 0,
                    purchase_click_count: 0,
                    detail_view_count: 0
                };
                existingProductEntry.gmv_points += normalizeAnalyticsNumber(source?.gmv_points);
                existingProductEntry.purchase_success_count += normalizeAnalyticsCountValue(source?.purchase_success_count);
                existingProductEntry.purchase_click_count += normalizeAnalyticsCountValue(source?.purchase_click_count);
                existingProductEntry.detail_view_count += normalizeAnalyticsCountValue(source?.detail_view_count);
                bucket.product_entries.set(productEntryKey, existingProductEntry);
            }

            bucket.gmv_points += normalizeAnalyticsNumber(source?.gmv_points);
            bucket.purchase_success_count += normalizeAnalyticsCountValue(source?.purchase_success_count);
            bucket.purchase_click_count += normalizeAnalyticsCountValue(source?.purchase_click_count);
            bucket.detail_view_count += normalizeAnalyticsCountValue(source?.detail_view_count);
            promptBuckets.set(promptId, bucket);
        });
    });

    const promptRows = Array.from(promptBuckets.values())
        .map((row) => {
            const gmvPoints = roundTo(row.gmv_points, 2) || 0;
            const purchaseSuccessCount = normalizeAnalyticsCountValue(row.purchase_success_count);
            const purchaseClickCount = normalizeAnalyticsCountValue(row.purchase_click_count);
            const detailViewCount = normalizeAnalyticsCountValue(row.detail_view_count);
            const products = Array.from(row.product_entries.values())
                .map((product) => ({
                    product_id: String(product?.product_id || '').trim(),
                    product_name: String(product?.product_name || '').trim(),
                    gmv_points: roundTo(product?.gmv_points, 2) || 0,
                    purchase_success_count: normalizeAnalyticsCountValue(product?.purchase_success_count),
                    purchase_click_count: normalizeAnalyticsCountValue(product?.purchase_click_count),
                    detail_view_count: normalizeAnalyticsCountValue(product?.detail_view_count)
                }))
                .filter((product) => product.product_id || product.product_name)
                .sort((left, right) => (
                    normalizeAnalyticsNumber(right.gmv_points) - normalizeAnalyticsNumber(left.gmv_points)
                    || normalizeAnalyticsCountValue(right.purchase_success_count) - normalizeAnalyticsCountValue(left.purchase_success_count)
                    || normalizeAnalyticsCountValue(right.detail_view_count) - normalizeAnalyticsCountValue(left.detail_view_count)
                ));
            totalGmvPoints += gmvPoints;
            totalPurchaseSuccessCount += purchaseSuccessCount;
            totalPurchaseClickCount += purchaseClickCount;
            totalDetailViewCount += detailViewCount;

            return {
                prompt_id: row.prompt_id,
                product_count: row.product_ids.size,
                product_ids: products.map((product) => product.product_id).filter(Boolean),
                product_names: products.map((product) => product.product_name).filter(Boolean).slice(0, 3),
                products: products.slice(0, 3),
                primary_product_id: String(products[0]?.product_id || '').trim(),
                primary_product_name: String(products[0]?.product_name || '').trim(),
                user_samples: Array.from(row.user_samples).slice(0, 6),
                detail_view_user_samples: Array.from(row.detail_view_user_samples).slice(0, 6),
                purchase_click_user_samples: Array.from(row.purchase_click_user_samples).slice(0, 6),
                purchase_success_user_samples: Array.from(row.purchase_success_user_samples).slice(0, 6),
                order_samples: Array.from(row.order_samples.values())
                    .sort((left, right) => String(right?.created_at || '').localeCompare(String(left?.created_at || '')))
                    .slice(0, 6),
                gmv_points: gmvPoints,
                purchase_success_count: purchaseSuccessCount,
                purchase_click_count: purchaseClickCount,
                detail_view_count: detailViewCount
            };
        })
        .sort((left, right) => (
            normalizeAnalyticsNumber(right.gmv_points) - normalizeAnalyticsNumber(left.gmv_points)
            || normalizeAnalyticsCountValue(right.purchase_success_count) - normalizeAnalyticsCountValue(left.purchase_success_count)
            || normalizeAnalyticsCountValue(right.product_count) - normalizeAnalyticsCountValue(left.product_count)
        ));

    return {
        promptRows,
        promptMap: new Map(promptRows.map((row) => [row.prompt_id, row])),
        summary: {
            prompt_count: promptRows.length,
            product_count: productIds.size,
            gmv_points: roundTo(totalGmvPoints, 2) || 0,
            purchase_success_count: totalPurchaseSuccessCount,
            purchase_click_count: totalPurchaseClickCount,
            detail_view_count: totalDetailViewCount
        }
    };
}

function renderAnalyticsContentCommerceSummary(summary = {}) {
    const promptCount = normalizeAnalyticsCountValue(summary.prompt_count);
    if (promptCount <= 0) {
        return '';
    }

    return `
        <div class="analytics-content-commerce-summary">
            <div class="analytics-content-commerce-summary__head">
                <div>
                    <div class="analytics-content-commerce-summary__eyebrow">内容带货摘要</div>
                    <strong class="analytics-content-commerce-summary__title">当前窗口有 ${formatNumber(promptCount)} 个 Prompt 正在参与商品带货</strong>
                </div>
                <div class="analytics-content-commerce-summary__meta">
                    归因支付 ${formatNumber(summary.purchase_success_count || 0)} · 归因 GMV ${formatNumber(summary.gmv_points || 0)}
                </div>
            </div>
            <div class="analytics-content-commerce-summary__chips">
                <span class="analytics-content-commerce-summary__chip">带货商品 ${formatNumber(summary.product_count || 0)}</span>
                <span class="analytics-content-commerce-summary__chip">详情触达 ${formatNumber(summary.detail_view_count || 0)}</span>
                <span class="analytics-content-commerce-summary__chip">购买意图 ${formatNumber(summary.purchase_click_count || 0)}</span>
            </div>
            <div class="analytics-content-commerce-summary__actions">
                <button
                    type="button"
                    class="btn-sm btn-secondary"
                    ${buildAnalyticsProductDestinationAttrs('analytics-product', {
                        sectionId: 'productRankingsSection',
                        focusTargetId: 'productRankingsSection'
                    })}
                >
                    <i class="fas fa-cubes"></i> 看商品经营
                </button>
                <button
                    type="button"
                    class="btn-sm btn-secondary"
                    ${buildAnalyticsProductDestinationAttrs('analytics-product', {
                        sectionId: 'productFunnelSection',
                        focusTargetId: 'productFunnelSection'
                    })}
                >
                    <i class="fas fa-filter"></i> 看商品漏斗
                </button>
            </div>
        </div>
    `;
}

function buildAnalyticsTopContentCommerceLabel(row = {}) {
    return String(row?.prompt_title || row?.title || row?.prompt_id || '该 Prompt').trim() || '该 Prompt';
}

function buildAnalyticsContentCommerceOrderContext(row = {}, product = null) {
    const promptId = String(row?.prompt_id || '').trim();
    const promptLabel = buildAnalyticsTopContentCommerceLabel(row);
    const normalizedProduct = product && typeof product === 'object' ? product : {};
    const productId = String(normalizedProduct?.product_id || row?.primary_product_id || '').trim();
    const productName = String(normalizedProduct?.product_name || row?.primary_product_name || '').trim();
    const purchaseSuccessCount = normalizeAnalyticsCountValue(row?.purchase_success_count);
    const gmvPoints = normalizeAnalyticsNumber(row?.gmv_points);

    return {
        tab: 'orders',
        query: productName,
        queryLabel: '商品',
        productId,
        productName,
        sourceLabel: '内容带货下钻',
        summary: `${promptLabel} 当前归因支付 ${formatNumber(purchaseSuccessCount)}，归因 GMV ${formatNumber(gmvPoints)}。`,
        referenceLabel: promptId ? 'Prompt' : '内容',
        referenceValue: promptId || promptLabel,
        signalSourceName: '内容带货',
        signalLabel: '归因支付',
        signalValue: `${formatNumber(purchaseSuccessCount)} · GMV ${formatNumber(gmvPoints)}`,
        feedbackScope: 'content',
        feedbackEntityType: 'prompt',
        feedbackEntityId: promptId || promptLabel,
        feedbackEntityName: promptLabel,
        site: getAnalyticsSiteParam(),
        rangeLabel: buildAnalyticsRangeLabel()
    };
}

function renderAnalyticsTopContentCommerceProducts(row = {}) {
    const products = Array.isArray(row?.products) ? row.products.filter((product) => product && (product.product_id || product.product_name)) : [];
    if (!products.length) {
        return '';
    }

    const productButtons = products.map((product) => renderAnalyticsProductNameButton(
        product.product_name || product.product_id || '未命名商品',
        product.product_id,
        {
            compact: true,
            title: `查看 ${product.product_name || '商品'} 的单品详情`,
            detailContext: {
                productId: product.product_id,
                productName: product.product_name,
                referenceLabel: 'Prompt',
                referenceValue: buildAnalyticsTopContentCommerceLabel(row),
                signalLabel: '内容带货',
                signalValue: `GMV ${formatNumber(product.gmv_points || 0)} · 支付 ${formatNumber(product.purchase_success_count || 0)}`,
                focusTargetId: 'productContentBreakdownSection'
            }
        }
    )).join('');
    const extraCount = Math.max(0, normalizeAnalyticsCountValue(row?.product_count) - products.length);

    return `
        <div class="top-content-item__commerce-products">
            ${productButtons}
            ${extraCount > 0 ? `<span class="top-content-item__commerce-more">+${escapeHtml(formatNumber(extraCount))} 个商品</span>` : ''}
        </div>
    `;
}

function renderAnalyticsTopContentCommerceActions(row = {}) {
    const promptId = String(row?.prompt_id || '').trim();
    const primaryProductId = String(row?.primary_product_id || '').trim();
    const primaryProductName = String(row?.primary_product_name || '').trim();
    const promptLabel = buildAnalyticsTopContentCommerceLabel(row);
    const detailAction = promptId
        ? `
            <button
                type="button"
                class="btn-sm btn-secondary top-content-item__commerce-action"
                data-admin-action="analytics-open-content-commerce-detail"
                data-prompt-id="${escapeHtml(promptId)}"
                data-prompt-title="${escapeHtml(promptLabel)}"
            >
                <i class="fas fa-chart-column"></i> 看带货详情
            </button>
        `
        : '';
    const productAction = primaryProductId
        ? `
            <button
                type="button"
                class="btn-sm btn-secondary top-content-item__commerce-action"
                ${buildAnalyticsProductDestinationAttrs('analytics-product-detail', {
                    productId: primaryProductId,
                    productName: primaryProductName,
                    referenceLabel: 'Prompt',
                    referenceValue: promptLabel,
                    signalLabel: '内容带货',
                    signalValue: `GMV ${formatNumber(row?.gmv_points || 0)} · 支付 ${formatNumber(row?.purchase_success_count || 0)}`,
                    focusTargetId: 'productContentBreakdownSection'
                })}
            >
                <i class="fas fa-cube"></i> 看带货商品
            </button>
        `
        : '';
    const orderAction = primaryProductName
        ? `
            <button
                type="button"
                class="btn-sm btn-secondary top-content-item__commerce-action"
                ${buildAnalyticsProductDestinationAttrs('shop-orders', buildAnalyticsContentCommerceOrderContext(row, {
                    product_id: primaryProductId,
                    product_name: primaryProductName
                }))}
            >
                <i class="fas fa-cart-shopping"></i> 看订单链
            </button>
        `
        : '';

    if (!productAction && !orderAction) {
        return '';
    }

    return `
        <div class="top-content-item__commerce-actions">
            ${detailAction}
            ${productAction}
            ${orderAction}
        </div>
    `;
}

function renderAnalyticsTopContentCommerceNote(row = {}) {
    const promptId = String(row?.prompt_id || '').trim();
    if (!promptId) {
        return '';
    }

    return `
        <div class="top-content-item__commerce">
            <span class="top-content-item__commerce-chip">带货</span>
            <span>GMV ${formatNumber(row.gmv_points || 0)}</span>
            <span>支付 ${formatNumber(row.purchase_success_count || 0)}</span>
            <span>商品 ${formatNumber(row.product_count || 0)}</span>
            ${renderAnalyticsTopContentCommerceProducts(row)}
            ${renderAnalyticsTopContentCommerceActions(row)}
        </div>
    `;
}

function getAnalyticsContentCommerceDetailState() {
    if (!globalThis.__analyticsContentCommerceDetailState || typeof globalThis.__analyticsContentCommerceDetailState !== 'object') {
        globalThis.__analyticsContentCommerceDetailState = {
            rows: [],
            promptRows: [],
            summary: {},
            rowMap: new Map(),
            activePromptId: '',
            activePromptTitle: ''
        };
    }

    return globalThis.__analyticsContentCommerceDetailState;
}

function setAnalyticsContentCommerceDetailRows(rows = [], options = {}) {
    const state = getAnalyticsContentCommerceDetailState();
    const normalizedRows = (Array.isArray(rows) ? rows : [])
        .filter((row) => row && String(row?.prompt_id || '').trim())
        .map((row) => ({ ...row }));
    const rowMap = new Map(normalizedRows.map((row) => [String(row.prompt_id || '').trim(), row]));

    state.rows = normalizedRows;
    state.promptRows = normalizedRows.slice();
    state.summary = options?.summary && typeof options.summary === 'object'
        ? { ...options.summary }
        : {};
    state.rowMap = rowMap;

    if (!state.activePromptId || !rowMap.has(state.activePromptId)) {
        const firstRow = normalizedRows[0] || null;
        state.activePromptId = String(firstRow?.prompt_id || '').trim();
        state.activePromptTitle = String(firstRow?.prompt_title || '').trim();
    } else {
        const currentRow = rowMap.get(state.activePromptId) || null;
        state.activePromptTitle = String(currentRow?.prompt_title || state.activePromptTitle || '').trim();
    }

    return state;
}

function getActiveAnalyticsContentCommerceDetailRow() {
    const state = getAnalyticsContentCommerceDetailState();
    if (!state.activePromptId || !(state.rowMap instanceof Map)) {
        return null;
    }
    return state.rowMap.get(state.activePromptId) || null;
}

function buildAnalyticsContentCommerceGuidance(detail = {}) {
    const purchaseSuccessCount = normalizeAnalyticsCountValue(detail?.purchase_success_count);
    const purchaseClickCount = normalizeAnalyticsCountValue(detail?.purchase_click_count);
    const detailViewCount = normalizeAnalyticsCountValue(detail?.detail_view_count);
    const productCount = normalizeAnalyticsCountValue(detail?.product_count);
    const gmvPoints = normalizeAnalyticsNumber(detail?.gmv_points);

    if (purchaseSuccessCount > 0) {
        return {
            statusLabel: '带货生效',
            statusTone: 'success',
            reason: `这条内容已经带来 ${formatNumber(purchaseSuccessCount)} 笔归因支付、GMV ${formatNumber(gmvPoints)}，说明它不只是有流量，而是已经进入成交承接阶段。`,
            recommendation: productCount > 0
                ? '优先点进带货商品或订单链，确认当前成交是否伴随退款、履约或承接风险。'
                : '优先回看订单链，确认成交是否稳定、退款是否开始抬头。 ',
            verification: '后续观察归因支付、GMV 和关联商品是否仍保持在前列，同时确认退款和履约风险没有同步抬头。'
        };
    }

    if (purchaseClickCount > 0) {
        return {
            statusLabel: '意图待成交',
            statusTone: 'warning',
            reason: `这条内容已经把用户带到购买意图阶段（${formatNumber(purchaseClickCount)} 次），但还没有形成归因支付，问题更像卡在商品承接或支付前一跳。`,
            recommendation: '先看带货商品详情和订单链，确认是商品页承接弱、库存/履约顾虑，还是支付链路没有接住。',
            verification: '处理后重点回看购买意图是否继续增长、是否开始出现归因支付，以及关联商品漏斗里“意图 -> 支付”是否回升。'
        };
    }

    if (detailViewCount > 0) {
        return {
            statusLabel: '详情待转化',
            statusTone: 'accent',
            reason: `这条内容已经把用户带到商品详情（${formatNumber(detailViewCount)} 次），但还没有明显购买意图，当前更像“内容能带到店，但还没真正打到购买决策”。`,
            recommendation: '先看带货商品列表，排查主带货商品是否与内容主题匹配，再回商品漏斗确认详情页之后为什么没有继续走。 ',
            verification: '后续关注详情触达是否继续稳定，以及购买意图和归因支付是否开始出现。'
        };
    }

    return {
        statusLabel: '开始挂链',
        statusTone: 'accent',
        reason: `当前这条内容已被识别为带货链路的一部分，但信号还比较早期，更适合先确认挂链商品和承接路径是否合理。`,
        recommendation: '优先打开带货详情和带货商品，确认当前绑定的商品是不是你真正想放大的承接目标。',
        verification: '后续观察是否开始出现详情触达、购买意图或归因支付，而不是一直停留在早期挂链状态。'
    };
}

function isAnalyticsContentCommerceRefundedStatus(status = '') {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!normalizedStatus || normalizedStatus === 'none') {
        return false;
    }
    return normalizedStatus.includes('refund');
}

function isAnalyticsContentCommerceDeliveryRiskStatus(status = '') {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!normalizedStatus || ['delivered', 'success', 'completed', 'fulfilled', 'none'].includes(normalizedStatus)) {
        return false;
    }
    return [
        'pending',
        'processing',
        'retry',
        'dead_letter',
        'failed',
        'conflict',
        'unlock',
        'manual',
        'queue',
        'waiting'
    ].some((keyword) => normalizedStatus.includes(keyword));
}

function buildAnalyticsContentCommercePaymentsContext(detail = {}, issue = {}) {
    const products = Array.isArray(detail?.products) ? detail.products : [];
    const primaryProduct = products[0] || {};
    const promptId = String(detail?.prompt_id || '').trim();
    const promptLabel = buildAnalyticsTopContentCommerceLabel(detail);
    const issueTitle = String(issue?.title || '支付问题').trim() || '支付问题';
    const metric = String(issue?.metric || '').trim();
    const reason = String(issue?.reason || '').trim();

    return {
        sourceLabel: `内容带货详情 / ${issueTitle}`,
        summary: `${promptLabel} 当前命中 ${issueTitle}${reason ? `，${reason}` : ''}，适合先回到支付问题摘要确认是否已经影响成交承接。`,
        referenceLabel: 'Prompt',
        referenceValue: promptLabel,
        signalSourceName: '内容带货',
        signalLabel: issueTitle,
        signalValue: metric || `支付 ${formatNumber(detail?.purchase_success_count || 0)} · GMV ${formatNumber(detail?.gmv_points || 0)}`,
        productId: String(primaryProduct?.product_id || detail?.primary_product_id || '').trim(),
        productName: String(primaryProduct?.product_name || detail?.primary_product_name || '').trim(),
        feedbackScope: 'content',
        feedbackEntityType: 'prompt',
        feedbackEntityId: promptId || promptLabel,
        feedbackEntityName: promptLabel,
        site: getAnalyticsSiteParam(),
        rangeLabel: buildAnalyticsRangeLabel(),
        query: String(primaryProduct?.product_name || primaryProduct?.product_id || '').trim(),
        queryLabel: '商品',
        focusQueue: true,
        focusTargetId: 'paymentsOpsAlertQueuePanel'
    };
}

function buildAnalyticsContentCommerceTicketsContext(detail = {}, issue = {}) {
    const products = Array.isArray(detail?.products) ? detail.products : [];
    const primaryProduct = products[0] || {};
    const promptId = String(detail?.prompt_id || '').trim();
    const promptLabel = buildAnalyticsTopContentCommerceLabel(detail);
    const issueTitle = String(issue?.title || '售后问题').trim() || '售后问题';
    const metric = String(issue?.metric || '').trim();
    const reason = String(issue?.reason || '').trim();

    return {
        mode: 'pending',
        workspace: 'queue',
        status: 'pending',
        sourceLabel: `内容带货详情 / ${issueTitle}`,
        summary: `${promptLabel} 当前命中 ${issueTitle}${reason ? `，${reason}` : ''}，适合优先回到售后问题列表确认是否已开始堆积。`,
        referenceLabel: 'Prompt',
        referenceValue: promptLabel,
        signalLabel: issueTitle,
        signalValue: metric || `支付 ${formatNumber(detail?.purchase_success_count || 0)} · GMV ${formatNumber(detail?.gmv_points || 0)}`,
        productId: String(primaryProduct?.product_id || detail?.primary_product_id || '').trim(),
        productName: String(primaryProduct?.product_name || detail?.primary_product_name || '').trim(),
        feedbackScope: 'content',
        feedbackEntityType: 'prompt',
        feedbackEntityId: promptId || promptLabel,
        feedbackEntityName: promptLabel,
        site: getAnalyticsSiteParam(),
        rangeLabel: buildAnalyticsRangeLabel(),
        search: String(primaryProduct?.product_name || primaryProduct?.product_id || promptLabel).trim(),
        queryLabel: '商品',
        focusTargetId: 'ticketsQueueControls'
    };
}

function buildAnalyticsContentCommerceIssueCards(detail = {}) {
    const orderSamples = Array.isArray(detail?.order_samples) ? detail.order_samples : [];
    const purchaseIntentCount = normalizeAnalyticsCountValue(detail?.purchase_click_count);
    const purchaseSuccessCount = normalizeAnalyticsCountValue(detail?.purchase_success_count);
    const detailViewCount = normalizeAnalyticsCountValue(detail?.detail_view_count);
    const refundedOrders = orderSamples.filter((order) => isAnalyticsContentCommerceRefundedStatus(order?.refund_status));
    const deliveryRiskOrders = orderSamples.filter((order) => isAnalyticsContentCommerceDeliveryRiskStatus(order?.delivery_status));
    const pendingGap = Math.max(0, purchaseIntentCount - purchaseSuccessCount);
    const issues = [];

    if (pendingGap > 0) {
        issues.push({
            key: 'payment-gap',
            tone: 'warning',
            title: '有意图未成交',
            metric: `意图 ${formatNumber(purchaseIntentCount)} · 支付 ${formatNumber(purchaseSuccessCount)}`,
            reason: `当前还有 ${formatNumber(pendingGap)} 个购买意图没有走到支付，问题更像卡在支付前的承接链。`,
            recommendation: '先看支付问题，确认是否有支付失败、审核阻塞或支付前流失。',
            verification: '处理后回看归因支付是否开始追上购买意图，而不是继续只涨意图不涨支付。',
            actions: [
                {
                    label: '看支付问题',
                    icon: 'fas fa-credit-card',
                    destination: 'payments-queue',
                    context: buildAnalyticsContentCommercePaymentsContext(detail, {
                        title: '有意图未成交',
                        metric: `意图 ${formatNumber(purchaseIntentCount)} · 支付 ${formatNumber(purchaseSuccessCount)}`,
                        reason: `还有 ${formatNumber(pendingGap)} 个购买意图尚未成交`
                    })
                }
            ]
        });
    }

    if (refundedOrders.length > 0) {
        issues.push({
            key: 'refund-risk',
            tone: 'danger',
            title: '退款样本已出现',
            metric: `退款 ${formatNumber(refundedOrders.length)} 单`,
            reason: `当前带货订单样本里已出现退款，说明内容带来的成交已经开始碰到售后承接问题。`,
            recommendation: '优先看售后工单，再回支付问题确认退款异常是否和支付链路一起抬头。',
            verification: '后续重点看退款样本是否下降，以及这条内容的归因支付和 GMV 是否还能稳定维持。',
            actions: [
                {
                    label: '看售后工单',
                    icon: 'fas fa-headset',
                    destination: 'tickets',
                    context: buildAnalyticsContentCommerceTicketsContext(detail, {
                        title: '退款样本',
                        metric: `退款 ${formatNumber(refundedOrders.length)} 单`,
                        reason: '带货订单样本已经出现退款'
                    })
                },
                {
                    label: '看支付问题',
                    icon: 'fas fa-credit-card',
                    destination: 'payments-queue',
                    context: buildAnalyticsContentCommercePaymentsContext(detail, {
                        title: '退款样本',
                        metric: `退款 ${formatNumber(refundedOrders.length)} 单`,
                        reason: '带货订单样本已经出现退款'
                    })
                }
            ]
        });
    }

    if (deliveryRiskOrders.length > 0) {
        issues.push({
            key: 'delivery-risk',
            tone: 'accent',
            title: '履约风险样本',
            metric: `履约风险 ${formatNumber(deliveryRiskOrders.length)} 单`,
            reason: `当前带货订单样本里已有待重试、死信或待发货风险，商品履约承接需要优先复核。`,
            recommendation: '先看售后工单和履约链，确认是不是发货、重试或锁冲突正在影响带货承接。',
            verification: '处理后回看履约风险样本是否回落，以及归因支付后的发货成功是否开始恢复。',
            actions: [
                {
                    label: '看售后工单',
                    icon: 'fas fa-headset',
                    destination: 'tickets',
                    context: buildAnalyticsContentCommerceTicketsContext(detail, {
                        title: '履约风险样本',
                        metric: `履约风险 ${formatNumber(deliveryRiskOrders.length)} 单`,
                        reason: '带货订单样本已出现履约风险'
                    })
                }
            ]
        });
    }

    if (issues.length > 0) {
        return issues;
    }

    const hasCommerceSignal = purchaseSuccessCount > 0 || purchaseIntentCount > 0 || detailViewCount > 0;
    if (!hasCommerceSignal) {
        return [];
    }

    return [{
        key: 'steady',
        tone: 'success',
        title: '当前暂无明显支付/售后异常',
        metric: `支付 ${formatNumber(purchaseSuccessCount)} · 退款 0 · 履约风险 0`,
        reason: '当前内容带来的订单样本里还没有看到明显的退款或履约风险，适合继续观察带货承接是否能稳定放量。',
        recommendation: '继续看带货商品和订单链，优先确认是否能把详情/意图继续往支付放大。',
        verification: '后续持续回看归因支付、GMV 和订单样本，确认没有新的退款或履约风险抬头。',
        actions: []
    }];
}

function buildAnalyticsContentCommerceFeedbackVerificationStatus(entries = [], detail = {}) {
    const rows = Array.isArray(entries) ? entries : [];
    const latestEntry = rows[0] || {};
    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(rows);
    const promptLabel = buildAnalyticsTopContentCommerceLabel(detail);
    const activeIssues = buildAnalyticsContentCommerceIssueCards(detail).filter((issue) => issue && issue.key !== 'steady');
    const hasDangerIssue = activeIssues.some((issue) => String(issue?.tone || '').trim().toLowerCase() === 'danger');
    const hasWarningIssue = activeIssues.some((issue) => ['warning', 'accent'].includes(String(issue?.tone || '').trim().toLowerCase()));
    const latestStatusKey = String(latestEntry?.statusKey || '').trim().toLowerCase();

    if (!activeIssues.length && rows.length > 0 && Number(statusSummary.abnormal || 0) <= 0 && Number(statusSummary.review || 0) <= 0 && latestStatusKey !== 'abnormal' && latestStatusKey !== 'review') {
        return {
            key: 'passed',
            label: '验证已通过',
            tone: 'success',
            summary: `${promptLabel} 当前已经不再命中带货问题摘要，最近一轮处理已基本收口。`
        };
    }

    if (!activeIssues.length && (Number(statusSummary.review || 0) > 0 || latestStatusKey === 'review')) {
        return {
            key: 'pending',
            label: '仍待验证',
            tone: 'warning',
            summary: `${promptLabel} 最近一轮处理已经回落到待复查，但还需要继续观察带货支付、退款和履约风险是否稳定。`
        };
    }

    const pendingTone = Number(statusSummary.abnormal || 0) > 0 || latestStatusKey === 'abnormal' || hasDangerIssue
        ? 'danger'
        : (hasWarningIssue ? 'warning' : 'warning');

    return {
        key: 'pending',
        label: '仍待验证',
        tone: pendingTone,
        summary: activeIssues.length > 0
            ? `${promptLabel} 当前仍命中带货问题摘要，说明这条内容的支付、退款或履约承接还没有真正收口。`
            : `${promptLabel} 最近一轮处理还需要继续复查，确认这条内容的带货承接没有再次反弹。`
    };
}

function buildAnalyticsContentCommerceConclusionDigest(entries = [], detail = {}) {
    const rows = Array.isArray(entries) ? entries : [];
    const issueCards = buildAnalyticsContentCommerceIssueCards(detail);
    const activeIssues = issueCards.filter((issue) => issue && issue.key !== 'steady');
    const latestEntry = rows[0] || {};
    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(rows);
    const promptLabel = buildAnalyticsTopContentCommerceLabel(detail);
    const purchaseSuccessCount = normalizeAnalyticsCountValue(detail?.purchase_success_count);
    const purchaseClickCount = normalizeAnalyticsCountValue(detail?.purchase_click_count);
    const detailViewCount = normalizeAnalyticsCountValue(detail?.detail_view_count);
    const productCount = normalizeAnalyticsCountValue(detail?.product_count);
    const gmvPoints = normalizeAnalyticsNumber(detail?.gmv_points);
    const hasDangerIssue = activeIssues.some((issue) => String(issue?.tone || '').trim().toLowerCase() === 'danger');

    let tone = 'warning';
    let label = '待承接';
    let summary = `${promptLabel} 当前已经开始带货，但还需要继续确认详情、意图和支付之间的承接是否顺畅。`;

    if (Number(statusSummary.abnormal || 0) > 0 || hasDangerIssue) {
        tone = 'danger';
        label = '仍未收口';
        summary = `${promptLabel} 最近仍有异常回写或当前问题摘要没有消失，说明这条内容的带货问题还没有真正收口。`;
    } else if (Number(statusSummary.review || 0) > 0 || activeIssues.length > 0) {
        tone = 'warning';
        label = '待复查';
        summary = `${promptLabel} 当前已经形成带货链路，但仍存在待复查的支付、退款或履约问题，适合继续回看相关信号。`;
    } else if (purchaseSuccessCount > 0) {
        tone = 'success';
        label = '带货生效';
        summary = `${promptLabel} 当前已经形成归因支付和 GMV，说明这条内容不只是有流量，而是真的在带商品成交。`;
    } else if (purchaseClickCount > 0) {
        tone = 'warning';
        label = '意图待成交';
        summary = `${promptLabel} 已经把用户推到购买意图阶段，但还没有形成稳定支付，下一步更像要补承接而不是继续放量。`;
    } else if (detailViewCount > 0) {
        tone = 'warning';
        label = '详情待转化';
        summary = `${promptLabel} 已经能把用户带到商品详情，但还没有明显购买意图，当前更适合先优化内容和商品承接。`;
    }

    return {
        tone,
        label,
        title: '本轮内容经营结论',
        summary,
        evidenceItems: [
            productCount > 0 ? `带货商品 ${formatNumber(productCount)} 个` : '',
            detailViewCount > 0 ? `详情触达 ${formatNumber(detailViewCount)}` : '',
            purchaseClickCount > 0 ? `购买意图 ${formatNumber(purchaseClickCount)}` : '',
            purchaseSuccessCount > 0 ? `归因支付 ${formatNumber(purchaseSuccessCount)}` : '',
            gmvPoints > 0 ? `归因 GMV ${formatNumber(gmvPoints)}` : '',
            latestEntry?.createdAt ? `最近回写 ${formatAnalyticsResolutionFeedbackRelativeTime(latestEntry.createdAt)}` : ''
        ].filter(Boolean)
    };
}

function renderAnalyticsContentCommerceConclusionDigest(entries = [], detail = {}) {
    const digest = buildAnalyticsContentCommerceConclusionDigest(entries, detail);
    if (!digest) {
        return '';
    }

    return `
        <section class="analytics-product-conclusion-digest analytics-product-conclusion-digest--${escapeHtml(digest.tone || 'warning')}">
            <div class="analytics-product-conclusion-digest__top">
                <div>
                    <div class="analytics-product-conclusion-digest__eyebrow">${escapeHtml(digest.title || '本轮内容经营结论')}</div>
                    <strong>${escapeHtml(digest.label || '待复查')}</strong>
                </div>
                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(digest.tone || 'warning')}">${escapeHtml(digest.label || '待复查')}</span>
            </div>
            <p class="analytics-product-conclusion-digest__summary">${escapeHtml(digest.summary || '')}</p>
            <div class="analytics-product-conclusion-digest__chips">
                ${Array.isArray(digest.evidenceItems)
                    ? digest.evidenceItems.map((item) => `<span class="analytics-product-matrix-chip analytics-product-matrix-chip--${escapeHtml(digest.tone || 'warning')}">${escapeHtml(item)}</span>`).join('')
                    : ''}
            </div>
        </section>
    `;
}

function buildAnalyticsContentCommerceConclusionRecord(entries = [], detail = {}) {
    const rows = Array.isArray(entries) ? entries : [];
    if (!rows.length) {
        return null;
    }

    const latestEntry = rows[0] || {};
    const verificationState = buildAnalyticsContentCommerceFeedbackVerificationStatus(rows, detail);
    const promptLabel = buildAnalyticsTopContentCommerceLabel(detail);
    const promptId = String(detail?.prompt_id || '').trim();
    const evidence = [
        latestEntry?.statusLabel ? `最新回写 ${String(latestEntry.statusLabel).trim()}` : '',
        latestEntry?.actionLabel ? `最近动作 ${String(latestEntry.actionLabel).trim()}` : '',
        latestEntry?.referenceLabel || latestEntry?.referenceValue
            ? [String(latestEntry.referenceLabel || '').trim(), String(latestEntry.referenceValue || '').trim()].filter(Boolean).join(' · ')
            : '',
        String(latestEntry?.summary || '').trim()
    ].filter(Boolean).join(' · ');
    const verificationMethod = String(latestEntry?.verificationMethod || '').trim()
        || `继续回到内容带货详情，确认 ${promptLabel} 的归因支付、退款和履约风险是否一起回落。`;

    return {
        promptId,
        promptLabel,
        latestCreatedAt: Number(latestEntry?.createdAt || 0),
        tone: verificationState.tone,
        statusLabel: verificationState.label,
        title: verificationState.key === 'passed' ? '本轮复查已通过' : '本轮仍待复查',
        summary: verificationState.summary,
        evidence: evidence || `${promptLabel} 最近已有处理回写，建议继续回看带货链路是否已经稳定。`,
        verificationMethod
    };
}

function renderAnalyticsContentCommerceFeedbackNote(detail = {}) {
    const promptId = String(detail?.prompt_id || '').trim();
    const promptLabel = buildAnalyticsTopContentCommerceLabel(detail);
    const entries = getAnalyticsResolutionFeedbackEntriesForContent({
        promptId,
        promptTitle: promptLabel,
        limit: 4
    });

    if (!entries.length) {
        return `
            <section class="analytics-product-detail-card analytics-product-detail-card--wide">
                <div class="analytics-product-detail-card__head">
                    <strong>最近处理回写</strong>
                    <span>支付 / 售后结果还未回写到这条内容</span>
                </div>
                ${renderHintState('fas fa-reply', `当前还没有围绕 ${promptLabel} 的支付或售后处理回写，先从带货问题摘要进入处理。`)}
            </section>
        `;
    }

    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(entries);
    const record = buildAnalyticsContentCommerceConclusionRecord(entries, detail);

    return `
        <section class="analytics-product-detail-card analytics-product-detail-card--wide">
            <div class="analytics-product-detail-card__head">
                <strong>最近处理回写</strong>
                <span>支付 / 售后处理结果已回传到内容经营页</span>
            </div>
            <div class="analytics-writeback-summary">
                <span class="analytics-status-chip analytics-status-chip--success">已处理 ${escapeHtml(formatNumber(statusSummary.resolved || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--warning">待复查 ${escapeHtml(formatNumber(statusSummary.review || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--danger">仍异常 ${escapeHtml(formatNumber(statusSummary.abnormal || 0))}</span>
            </div>
            ${record
                ? `<div class="analytics-writeback-conclusions">
                        <div class="analytics-writeback-conclusions__head">
                            <strong>复查结论记录</strong>
                            <span>沉淀最近一轮内容复查结论，方便回看带货问题是否真正收口</span>
                        </div>
                        <div class="analytics-writeback-conclusions__list">
                            <div class="analytics-writeback-conclusion-card analytics-writeback-conclusion-card--${escapeHtml(record.tone || 'warning')}">
                                <div class="analytics-writeback-conclusion-card__top">
                                    <div>
                                        <div class="analytics-writeback-conclusion-card__title">${escapeHtml(record.title || '复查结论')}</div>
                                        <div class="analytics-writeback-conclusion-card__product">${escapeHtml(record.promptLabel || '该 Prompt')}</div>
                                    </div>
                                    <span class="analytics-status-chip analytics-status-chip--${escapeHtml(record.tone || 'warning')}">${escapeHtml(record.statusLabel || '仍待复查')}</span>
                                </div>
                                <div class="analytics-writeback-conclusion-card__summary">${escapeHtml(record.summary || '')}</div>
                                <div class="analytics-writeback-conclusion-card__meta">
                                    <span>最近回写 ${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(record.latestCreatedAt))}</span>
                                </div>
                                <div class="analytics-writeback-conclusion-card__evidence">
                                    <span>最近一次验证依据</span>
                                    <p>${escapeHtml(record.evidence || '请结合带货问题摘要和最近处理回写继续复查。')}</p>
                                </div>
                                <div class="analytics-writeback-conclusion-card__next-step">
                                    <span>下次复查建议</span>
                                    <p>${escapeHtml(record.verificationMethod || '继续回看带货支付、退款和履约风险是否一起回落。')}</p>
                                </div>
                            </div>
                        </div>
                   </div>`
                : ''}
            <div class="analytics-writeback-list">
                ${entries.map((entry) => `
                    <div class="analytics-writeback-item">
                        <div class="analytics-writeback-item__top">
                            <div class="analytics-writeback-item__chips">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.module === 'tickets' ? 'warning' : 'accent')}">${escapeHtml(entry?.module === 'tickets' ? '售后处理' : '支付处理')}</span>
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.tone || 'accent')}">${escapeHtml(entry?.statusLabel || '已处理')}</span>
                            </div>
                            <span class="analytics-writeback-item__time">${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(entry?.createdAt))}</span>
                        </div>
                        <div class="analytics-writeback-item__title">${escapeHtml(entry?.title || '处理已回写')}</div>
                        <div class="analytics-writeback-item__summary">${escapeHtml(entry?.summary || '')}</div>
                        <div class="analytics-writeback-item__meta">
                            ${entry?.actionLabel ? `<span>${escapeHtml(entry.actionLabel)}</span>` : ''}
                            ${entry?.referenceLabel || entry?.referenceValue ? `<span>${escapeHtml([entry.referenceLabel, entry.referenceValue].filter(Boolean).join(' · '))}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function renderAnalyticsContentCommerceConclusionHistory(detail = {}) {
    const promptId = String(detail?.prompt_id || '').trim();
    const promptLabel = buildAnalyticsTopContentCommerceLabel(detail);
    const entries = getAnalyticsResolutionFeedbackEntriesForContent({
        promptId,
        promptTitle: promptLabel,
        limit: 6
    });
    if (!entries.length) {
        return '';
    }

    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(entries);
    return `
        <section class="analytics-product-detail-card analytics-product-detail-card--wide">
            <div class="analytics-product-detail-card__head">
                <strong>历史复查结论</strong>
                <span>最近 ${escapeHtml(formatNumber(entries.length))} 条回写</span>
            </div>
            <div class="analytics-product-history-summary">
                <span class="analytics-status-chip analytics-status-chip--success">已处理 ${escapeHtml(formatNumber(statusSummary.resolved || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--warning">待复查 ${escapeHtml(formatNumber(statusSummary.review || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--danger">仍异常 ${escapeHtml(formatNumber(statusSummary.abnormal || 0))}</span>
            </div>
            <div class="analytics-product-history-note">按时间倒序保留这条内容最近一轮带货处理与复查结论，方便回看问题是否真正收口。</div>
            <div class="analytics-writeback-list">
                ${entries.map((entry) => `
                    <div class="analytics-writeback-item">
                        <div class="analytics-writeback-item__top">
                            <div class="analytics-writeback-item__chips">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.module === 'tickets' ? 'warning' : 'accent')}">${escapeHtml(entry?.module === 'tickets' ? '售后处理' : '支付处理')}</span>
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.tone || 'accent')}">${escapeHtml(entry?.statusLabel || '已处理')}</span>
                            </div>
                            <span class="analytics-writeback-item__time">${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(entry?.createdAt))}</span>
                        </div>
                        <div class="analytics-writeback-item__title">${escapeHtml(entry?.title || '复查结论')}</div>
                        <div class="analytics-writeback-item__summary">${escapeHtml(entry?.summary || '')}</div>
                        <div class="analytics-writeback-item__meta">
                            ${entry?.actionLabel ? `<span>${escapeHtml(entry.actionLabel)}</span>` : ''}
                            ${entry?.referenceLabel || entry?.referenceValue ? `<span>${escapeHtml([entry.referenceLabel, entry.referenceValue].filter(Boolean).join(' · '))}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function buildAnalyticsContentUserValueLinkGuidance(detail = {}) {
    const detailUserCount = Array.isArray(detail?.detail_view_user_samples) ? detail.detail_view_user_samples.length : 0;
    const intentUserCount = Array.isArray(detail?.purchase_click_user_samples) ? detail.purchase_click_user_samples.length : 0;
    const buyerUserCount = Array.isArray(detail?.purchase_success_user_samples) ? detail.purchase_success_user_samples.length : 0;
    const orderSampleCount = Array.isArray(detail?.order_samples) ? detail.order_samples.length : 0;
    const productCount = normalizeAnalyticsCountValue(detail?.product_count);

    if (buyerUserCount > 0) {
        return {
            statusLabel: buyerUserCount >= 2 || orderSampleCount >= 2 ? '已开始沉淀' : '已有首批成交',
            statusTone: buyerUserCount >= 2 || orderSampleCount >= 2 ? 'success' : 'warning',
            reason: buyerUserCount >= 2 || orderSampleCount >= 2
                ? '这条内容已经不只是带来浏览或意图，而是开始把用户真正送进支付和订单链。'
                : '这条内容已经带来了首批支付用户，但当前更像刚开始成单，用户价值还没有明显扩成复购层。',
            recommendation: buyerUserCount >= 2 || orderSampleCount >= 2
                ? '先看用户价值驾驶舱和订单样本，确认这批成交用户有没有继续进入复购、跨商品购买或高价值样本。'
                : '先看用户价值驾驶舱和支付/售后回写，确认这批首单用户有没有继续留在成交后链路里。',
            verification: buyerUserCount >= 2 || orderSampleCount >= 2
                ? '回看支付用户、订单样本和用户价值层，确认复购或跨商品购买没有掉回首单层。'
                : '回看支付用户和订单样本，确认没有新增退款/履约问题，同时观察是否开始出现复购样本。'
        };
    }

    if (intentUserCount > 0) {
        return {
            statusLabel: '意图待成交',
            statusTone: 'warning',
            reason: '这条内容已经把用户带到了购买意图阶段，但还没有真正转成成交用户，说明承接还卡在支付或订单前。 ',
            recommendation: '先看带货问题摘要和订单链，优先确认支付承接、退款样本或履约风险有没有挡住这批意图用户。',
            verification: '回看内容带货详情，确认购买意图用户是否开始转成支付用户，而不是继续停在意图层。'
        };
    }

    if (detailUserCount > 0 || productCount > 0) {
        return {
            statusLabel: '详情待转化',
            statusTone: 'accent',
            reason: '这条内容已经开始把流量导到商品详情，但还没有继续扩成明显购买意图，说明内容到商品承接还偏前段。',
            recommendation: '先看主带货商品和详情触达用户样本，确认内容承接的是不是只停在详情浏览，没有继续往下走。',
            verification: '回看详情触达用户和购买意图用户，确认内容带来的用户是否开始继续推进到意图层。'
        };
    }

    return {
        statusLabel: '继续观察',
        statusTone: 'neutral',
        reason: '当前窗口还没有明显的内容带货用户样本，适合继续观察内容消费和带货起量情况。',
        recommendation: '先看热门内容和带货商品是否开始起量，再决定要不要继续下钻到用户或订单链。',
        verification: '回看带货 Prompt、详情触达和带货商品数，确认内容是否开始进入带货链路。'
    };
}

function renderAnalyticsContentUserValueLink(detail = {}) {
    const promptLabel = buildAnalyticsTopContentCommerceLabel(detail);
    const detailUserCount = Array.isArray(detail?.detail_view_user_samples) ? detail.detail_view_user_samples.length : 0;
    const intentUserCount = Array.isArray(detail?.purchase_click_user_samples) ? detail.purchase_click_user_samples.length : 0;
    const buyerUserCount = Array.isArray(detail?.purchase_success_user_samples) ? detail.purchase_success_user_samples.length : 0;
    const orderSampleCount = Array.isArray(detail?.order_samples) ? detail.order_samples.length : 0;
    const guidance = buildAnalyticsContentUserValueLinkGuidance(detail);
    const primaryProduct = Array.isArray(detail?.products) ? (detail.products[0] || null) : null;

    return `
        <section class="analytics-product-detail-card analytics-product-detail-card--wide">
            <div class="analytics-product-detail-card__head">
                <strong>内容 -> 用户价值</strong>
                <span>${escapeHtml(promptLabel)} 的跨线承接判断</span>
            </div>
            <div class="analytics-product-history-summary">
                <span class="analytics-product-matrix-chip analytics-product-matrix-chip--${escapeHtml(guidance.statusTone || 'accent')}">${escapeHtml(guidance.statusLabel || '继续观察')}</span>
                <span class="analytics-product-matrix-chip analytics-product-matrix-chip--neutral">详情用户 ${escapeHtml(formatNumber(detailUserCount))}</span>
                <span class="analytics-product-matrix-chip analytics-product-matrix-chip--neutral">意图用户 ${escapeHtml(formatNumber(intentUserCount))}</span>
                <span class="analytics-product-matrix-chip analytics-product-matrix-chip--neutral">支付用户 ${escapeHtml(formatNumber(buyerUserCount))}</span>
                <span class="analytics-product-matrix-chip analytics-product-matrix-chip--neutral">订单样本 ${escapeHtml(formatNumber(orderSampleCount))}</span>
            </div>
            ${renderAnalyticsProductInlineGuidance(guidance)}
            <div class="analytics-content-detail__actions">
                <button
                    type="button"
                    class="btn-sm btn-secondary"
                    ${buildAnalyticsProductDestinationAttrs('analytics-growth', {
                        sectionId: ANALYTICS_USER_VALUE_SECTION_ID,
                        focusTargetId: ANALYTICS_USER_VALUE_SECTION_ID,
                        promptId: String(detail?.prompt_id || '').trim(),
                        promptTitle: promptLabel,
                        referenceLabel: 'Prompt',
                        referenceValue: promptLabel,
                        signalLabel: '内容 -> 用户价值',
                        signalValue: `支付用户 ${formatNumber(buyerUserCount)} · 订单样本 ${formatNumber(orderSampleCount)}`
                    })}
                >
                    <i class="fas fa-user-group"></i> 看用户价值
                </button>
                ${primaryProduct
                    ? `<button
                            type="button"
                            class="btn-sm btn-secondary"
                                ${buildAnalyticsProductDestinationAttrs('analytics-product-detail', {
                                    productId: primaryProduct.product_id,
                                    productName: primaryProduct.product_name,
                                    referenceLabel: 'Prompt',
                                    referenceValue: promptLabel,
                                    signalLabel: '内容 -> 用户价值',
                                    signalValue: `支付用户 ${formatNumber(buyerUserCount)} · 订单样本 ${formatNumber(orderSampleCount)}`,
                                    focusTargetId: 'productContentBreakdownSection'
                                })}
                        >
                            <i class="fas fa-cube"></i> 看主带货商品
                        </button>`
                    : ''}
            </div>
        </section>
    `;
}

function buildAnalyticsContentOperatingPriorityRows(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .filter((row) => row && String(row?.prompt_id || '').trim())
        .map((row) => ({
            ...row,
            __priorityScore: (
                normalizeAnalyticsNumber(row?.gmv_points) * 1000
                + normalizeAnalyticsCountValue(row?.purchase_success_count) * 100
                + normalizeAnalyticsCountValue(row?.purchase_click_count) * 10
                + normalizeAnalyticsCountValue(row?.detail_view_count)
                + normalizeAnalyticsCountValue(row?.score) / 100
            )
        }))
        .sort((left, right) => (
            normalizeAnalyticsNumber(right?.__priorityScore) - normalizeAnalyticsNumber(left?.__priorityScore)
            || normalizeAnalyticsNumber(right?.gmv_points) - normalizeAnalyticsNumber(left?.gmv_points)
            || normalizeAnalyticsCountValue(right?.purchase_success_count) - normalizeAnalyticsCountValue(left?.purchase_success_count)
            || normalizeAnalyticsCountValue(right?.purchase_click_count) - normalizeAnalyticsCountValue(left?.purchase_click_count)
        ))
        .slice(0, 3);
}

function renderAnalyticsContentOperatingPriorityList(rows = [], activePromptId = '') {
    const items = buildAnalyticsContentOperatingPriorityRows(rows);
    if (!items.length) {
        return renderHintState('fas fa-compass-drafting', '当前窗口暂无可以独立经营判断的内容样本');
    }

    return `
        <div class="analytics-content-operating-cockpit__priority-list">
            ${items.map((item, index) => {
                const promptId = String(item?.prompt_id || '').trim();
                const promptLabel = buildAnalyticsTopContentCommerceLabel(item);
                const guidance = buildAnalyticsContentCommerceGuidance(item);
                const primaryProduct = Array.isArray(item?.products) ? (item.products[0] || null) : null;
                const isActive = promptId && promptId === String(activePromptId || '').trim();
                return `
                    <article class="analytics-content-operating-cockpit__priority-item${isActive ? ' is-active' : ''}">
                        <div class="analytics-content-operating-cockpit__priority-top">
                            <div class="analytics-content-operating-cockpit__priority-rank">TOP ${index + 1}</div>
                            <div class="analytics-content-operating-cockpit__priority-metrics">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(guidance.statusTone || 'accent')}">${escapeHtml(guidance.statusLabel || '继续观察')}</span>
                                <span class="analytics-product-matrix-chip analytics-product-matrix-chip--neutral">支付 ${escapeHtml(formatNumber(item?.purchase_success_count || 0))}</span>
                                <span class="analytics-product-matrix-chip analytics-product-matrix-chip--neutral">GMV ${escapeHtml(formatNumber(item?.gmv_points || 0))}</span>
                            </div>
                        </div>
                        <div class="analytics-content-operating-cockpit__priority-summary">
                            <strong>${escapeHtml(promptLabel)}</strong>
                            <span>${escapeHtml(String(item?.category || '未分类').trim() || '未分类')} · 热度 ${escapeHtml(formatNumber(item?.score || 0))} · 带货商品 ${escapeHtml(formatNumber(item?.product_count || 0))}</span>
                        </div>
                        <div class="analytics-content-operating-cockpit__priority-note">${escapeHtml(guidance.reason || '')}</div>
                        <div class="analytics-content-operating-cockpit__priority-actions">
                            <button
                                type="button"
                                class="btn-sm btn-secondary"
                                data-admin-action="analytics-open-content-commerce-detail"
                                data-prompt-id="${escapeHtml(promptId)}"
                                data-prompt-title="${escapeHtml(promptLabel)}"
                            >
                                <i class="fas fa-chart-column"></i> 看带货详情
                            </button>
                            ${primaryProduct
                                ? `<button
                                        type="button"
                                        class="btn-sm btn-secondary"
                                        ${buildAnalyticsProductDestinationAttrs('shop-orders', buildAnalyticsContentCommerceOrderContext(item, primaryProduct))}
                                    >
                                        <i class="fas fa-cart-shopping"></i> 看订单链
                                    </button>`
                                : ''}
                            <button
                                type="button"
                                class="btn-sm btn-secondary"
                                ${buildAnalyticsProductDestinationAttrs('analytics-growth', {
                                    sectionId: ANALYTICS_USER_VALUE_SECTION_ID,
                                    focusTargetId: ANALYTICS_USER_VALUE_SECTION_ID,
                                    promptId,
                                    promptTitle: promptLabel,
                                    referenceLabel: 'Prompt',
                                    referenceValue: promptLabel,
                                    signalLabel: '内容经营',
                                    signalValue: `支付 ${formatNumber(item?.purchase_success_count || 0)} · GMV ${formatNumber(item?.gmv_points || 0)}`
                                })}
                            >
                                <i class="fas fa-user-group"></i> 看用户价值
                            </button>
                        </div>
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

function renderAnalyticsContentOperatingCockpit(state = {}) {
    const summary = state?.summary && typeof state.summary === 'object' ? state.summary : {};
    const promptRows = Array.isArray(state?.promptRows) ? state.promptRows : [];
    const activeDetail = state?.activeDetail && typeof state.activeDetail === 'object'
        ? state.activeDetail
        : (promptRows[0] || null);

    if (!activeDetail) {
        return renderHintState('fas fa-compass-drafting', '当前窗口暂无内容经营样本');
    }

    const promptLabel = buildAnalyticsTopContentCommerceLabel(activeDetail);
    const guidance = buildAnalyticsContentCommerceGuidance(activeDetail);
    const issues = buildAnalyticsContentCommerceIssueCards(activeDetail);
    const feedbackEntries = getAnalyticsResolutionFeedbackEntriesForContent({
        promptId: activeDetail?.prompt_id || '',
        promptTitle: promptLabel,
        limit: 6
    });
    const primaryProduct = Array.isArray(activeDetail?.products) ? (activeDetail.products[0] || null) : null;

    return `
        <div class="analytics-content-operating-cockpit">
            <section class="analytics-content-operating-cockpit__hero">
                <div class="analytics-content-operating-cockpit__copy">
                    <div class="analytics-content-operating-cockpit__eyebrow">内容经营页</div>
                    <strong>${escapeHtml(summary.prompt_count > 0
                        ? `当前窗口有 ${formatNumber(summary.prompt_count)} 个 Prompt 正在承担商品承接，当前最值得盯的是 ${promptLabel}`
                        : `${promptLabel} 是当前最值得继续跟进的内容样本`)}</strong>
                    <p>${escapeHtml(summary.prompt_count > 0
                        ? `归因支付 ${formatNumber(summary.purchase_success_count || 0)} · 归因 GMV ${formatNumber(summary.gmv_points || 0)} · 详情触达 ${formatNumber(summary.detail_view_count || 0)}`
                        : guidance.reason || '')}</p>
                </div>
                <div class="analytics-content-operating-cockpit__actions">
                    <button
                        type="button"
                        class="btn-sm btn-secondary"
                        ${buildAnalyticsProductDestinationAttrs('analytics-content', {
                            sectionId: 'topContentList',
                            focusTargetId: 'topContentList'
                        })}
                    >
                        <i class="fas fa-fire"></i> 看热门内容
                    </button>
                    <button
                        type="button"
                        class="btn-sm btn-secondary"
                        data-admin-action="analytics-open-prompt-gallery"
                        data-prompt-id="${escapeHtml(String(activeDetail?.prompt_id || '').trim())}"
                    >
                        <i class="fas fa-palette"></i> 去 Gallery
                    </button>
                    <button
                        type="button"
                        class="btn-sm btn-secondary"
                        data-admin-action="analytics-open-prompt-comments"
                        data-prompt-id="${escapeHtml(String(activeDetail?.prompt_id || '').trim())}"
                        data-prompt-title="${escapeHtml(encodeURIComponent(promptLabel))}"
                    >
                        <i class="fas fa-comments"></i> 看评论
                    </button>
                    <button
                        type="button"
                        class="btn-sm btn-secondary"
                        data-admin-action="analytics-open-prompt-homepage"
                        data-prompt-id="${escapeHtml(String(activeDetail?.prompt_id || '').trim())}"
                    >
                        <i class="fas fa-house"></i> 去 Homepage
                    </button>
                    <button
                        type="button"
                        class="btn-sm btn-secondary"
                        data-admin-action="analytics-open-content-commerce-detail"
                        data-prompt-id="${escapeHtml(String(activeDetail?.prompt_id || '').trim())}"
                        data-prompt-title="${escapeHtml(promptLabel)}"
                    >
                        <i class="fas fa-chart-column"></i> 看带货详情
                    </button>
                    ${primaryProduct
                        ? `<button
                                type="button"
                                class="btn-sm btn-secondary"
                                ${buildAnalyticsProductDestinationAttrs('analytics-product-detail', {
                                    productId: primaryProduct.product_id,
                                    productName: primaryProduct.product_name,
                                    referenceLabel: 'Prompt',
                                    referenceValue: promptLabel,
                                    signalLabel: '内容经营',
                                    signalValue: `支付 ${formatNumber(activeDetail?.purchase_success_count || 0)} · GMV ${formatNumber(activeDetail?.gmv_points || 0)}`,
                                    focusTargetId: 'productContentBreakdownSection'
                                })}
                            >
                                <i class="fas fa-cube"></i> 看主带货商品
                            </button>`
                        : ''}
                </div>
            </section>

            ${renderAnalyticsContentCommerceSummary(summary)}
            ${renderAnalyticsContentCommerceConclusionDigest(feedbackEntries, activeDetail)}

            <div class="analytics-product-metric-grid analytics-product-metric-grid--detail">
                ${renderAnalyticsProductMetricCard('带货商品', formatNumber(activeDetail?.product_count || 0), `主带货商品 ${primaryProduct?.product_name || '—'}`, 'default')}
                ${renderAnalyticsProductMetricCard('详情触达', formatNumber(activeDetail?.detail_view_count || 0), `内容浏览 ${formatNumber(activeDetail?.view_count || 0)}`, 'accent')}
                ${renderAnalyticsProductMetricCard('购买意图', formatNumber(activeDetail?.purchase_click_count || 0), `解锁 ${formatNumber(activeDetail?.unlock_count || 0)}`, 'warning')}
                ${renderAnalyticsProductMetricCard('归因支付', formatNumber(activeDetail?.purchase_success_count || 0), `订单样本 ${formatNumber(Array.isArray(activeDetail?.order_samples) ? activeDetail.order_samples.length : 0)}`, 'success')}
                ${renderAnalyticsProductMetricCard('归因 GMV', formatNumber(activeDetail?.gmv_points || 0), `热度 ${formatNumber(activeDetail?.score || 0)}`, 'success')}
            </div>

            ${renderAnalyticsProductInlineGuidance(guidance)}

            <section class="analytics-product-detail-card analytics-product-detail-card--wide">
                <div class="analytics-product-detail-card__head">
                    <strong>当前最值得盯的内容</strong>
                    <span>按成交、意图和详情触达综合排序</span>
                </div>
                ${renderAnalyticsContentOperatingPriorityList(promptRows, activeDetail?.prompt_id || '')}
            </section>

            <section class="analytics-product-detail-card analytics-product-detail-card--wide">
                <div class="analytics-product-detail-card__head">
                    <strong>当前问题摘要</strong>
                    <span>支付 / 售后 / 履约的即时经营判断</span>
                </div>
                <div class="analytics-content-detail-issue-grid">
                    ${issues.length > 0
                        ? issues.map((issue) => renderAnalyticsContentCommerceIssueCard(issue, activeDetail)).join('')
                        : renderHintState('fas fa-shield-check', '当前窗口暂无需要优先处理的内容经营问题')}
                </div>
            </section>

            ${renderAnalyticsContentUserValueLink(activeDetail)}
            ${renderAnalyticsContentCommerceFeedbackNote(activeDetail)}
            ${renderAnalyticsContentCommerceConclusionHistory(activeDetail)}
        </div>
    `;
}

function updateAnalyticsContentOperatingCockpitPanel(options = {}) {
    const container = document.getElementById('contentOperatingCockpitPanel');
    const meta = document.getElementById('contentOperatingCockpitMeta');
    if (!container) {
        return;
    }

    const status = String(options?.status || '').trim().toLowerCase();
    if (status === 'loading') {
        container.innerHTML = renderAnalyticsProductLoadingState('内容经营页加载中...');
        if (meta) meta.textContent = '内容经营页加载中';
        return;
    }

    if (status === 'error') {
        const message = String(options?.message || '内容经营页加载失败').trim() || '内容经营页加载失败';
        container.innerHTML = renderHintState('fas fa-compass-drafting', message, 'error');
        if (meta) meta.textContent = message;
        return;
    }

    const detailState = getAnalyticsContentCommerceDetailState();
    const activeDetail = getActiveAnalyticsContentCommerceDetailRow();
    const promptRows = Array.isArray(detailState?.promptRows) ? detailState.promptRows : [];
    const summary = detailState?.summary && typeof detailState.summary === 'object'
        ? detailState.summary
        : {};

    if (!activeDetail) {
        container.innerHTML = renderHintState('fas fa-compass-drafting', '当前窗口暂无内容经营样本');
        if (meta) meta.textContent = '当前窗口暂无内容经营样本';
        return;
    }

    container.innerHTML = renderAnalyticsContentOperatingCockpit({
        summary,
        promptRows,
        activeDetail
    });

    if (meta) {
        const guidance = buildAnalyticsContentCommerceGuidance(activeDetail);
        meta.textContent = [
            Number(summary?.prompt_count || 0) > 0 ? `${formatNumber(summary.prompt_count)} 个 Prompt` : '',
            guidance.statusLabel || '',
            buildAnalyticsTopContentCommerceLabel(activeDetail)
        ].filter(Boolean).join(' · ');
    }
}

function renderAnalyticsContentCommerceIssueCard(issue = {}, detail = {}) {
    const actions = Array.isArray(issue?.actions) ? issue.actions.filter(Boolean) : [];
    const tone = String(issue?.tone || 'neutral').trim().toLowerCase() || 'neutral';

    return `
        <article class="analytics-content-detail-issue-card analytics-content-detail-issue-card--${escapeHtml(tone)}">
            <div class="analytics-content-detail-issue-card__head">
                <div>
                    <span class="analytics-status-chip analytics-status-chip--${escapeHtml(tone)}">${escapeHtml(issue?.title || '问题摘要')}</span>
                    <strong>${escapeHtml(issue?.metric || '--')}</strong>
                </div>
            </div>
            <p class="analytics-content-detail-issue-card__reason">${escapeHtml(issue?.reason || '')}</p>
            ${actions.length > 0
                ? `<div class="analytics-content-detail-issue-card__actions">
                        ${actions.map((action) => `
                            <button
                                type="button"
                                class="btn-sm btn-secondary analytics-content-detail-issue-card__action"
                                ${buildAnalyticsProductDestinationAttrs(action.destination, action.context)}
                            >
                                <i class="${escapeHtml(action.icon || 'fas fa-arrow-right')}"></i> ${escapeHtml(action.label || '查看详情')}
                            </button>
                        `).join('')}
                   </div>`
                : ''}
        </article>
    `;
}

function renderAnalyticsContentCommerceDetailProductRow(product = {}, detail = {}) {
    const productId = String(product?.product_id || '').trim();
    const productName = String(product?.product_name || '').trim() || productId || '未命名商品';

    return `
        <div class="analytics-content-detail-product-row">
            <div class="analytics-content-detail-product-row__main">
                ${renderAnalyticsProductNameButton(productName, productId, {
                    compact: true,
                    className: 'analytics-content-detail-product-row__title',
                    title: `查看 ${productName} 的单品详情`,
                    detailContext: {
                        productId,
                        productName,
                        referenceLabel: 'Prompt',
                        referenceValue: buildAnalyticsTopContentCommerceLabel(detail),
                        signalLabel: '内容带货',
                        signalValue: `GMV ${formatNumber(product?.gmv_points || 0)} · 支付 ${formatNumber(product?.purchase_success_count || 0)}`,
                        focusTargetId: 'productContentBreakdownSection'
                    }
                })}
                <div class="analytics-content-detail-product-row__meta">
                    <span>详情 ${formatNumber(product?.detail_view_count || 0)}</span>
                    <span>意图 ${formatNumber(product?.purchase_click_count || 0)}</span>
                    <span>支付 ${formatNumber(product?.purchase_success_count || 0)}</span>
                    <span>GMV ${formatNumber(product?.gmv_points || 0)}</span>
                </div>
            </div>
            <div class="analytics-content-detail-product-row__actions">
                <button
                    type="button"
                    class="btn-sm btn-secondary analytics-content-detail-product-row__action"
                    ${buildAnalyticsProductDestinationAttrs('analytics-product-detail', {
                        productId,
                        productName,
                        referenceLabel: 'Prompt',
                        referenceValue: buildAnalyticsTopContentCommerceLabel(detail),
                        signalLabel: '内容带货',
                        signalValue: `GMV ${formatNumber(product?.gmv_points || 0)} · 支付 ${formatNumber(product?.purchase_success_count || 0)}`,
                        focusTargetId: 'productContentBreakdownSection'
                    })}
                >
                    <i class="fas fa-cube"></i> 单品详情
                </button>
                <button
                    type="button"
                    class="btn-sm btn-secondary analytics-content-detail-product-row__action"
                    ${buildAnalyticsProductDestinationAttrs('shop-orders', buildAnalyticsContentCommerceOrderContext(detail, product))}
                >
                    <i class="fas fa-cart-shopping"></i> 订单链
                </button>
            </div>
        </div>
    `;
}

function buildAnalyticsContentCommerceUserDetailContext(detail = {}, signalLabel = '', signalValue = '') {
    const products = Array.isArray(detail?.products) ? detail.products : [];
    const primaryProduct = products[0] || {};
    return {
        sourceLabel: `内容带货详情 / ${signalLabel || '带货用户'}`,
        summary: `${buildAnalyticsTopContentCommerceLabel(detail)} 当前命中 ${signalLabel || '带货用户'} 样本，适合回看用户在内容、商品与订单链里的承接情况。`,
        signalLabel: signalLabel || '内容带货',
        signalValue: String(signalValue || '').trim() || `GMV ${formatNumber(detail?.gmv_points || 0)} · 支付 ${formatNumber(detail?.purchase_success_count || 0)}`,
        productId: String(primaryProduct?.product_id || detail?.primary_product_id || '').trim(),
        productName: String(primaryProduct?.product_name || detail?.primary_product_name || '').trim(),
        referenceLabel: 'Prompt',
        referenceValue: buildAnalyticsTopContentCommerceLabel(detail),
        actionLabel: '回到内容带货详情',
        verificationMethod: '回到内容带货详情，继续确认这条内容的带货用户、订单链和带货商品是否仍在放大。',
        destination: 'analytics-content',
        destinationContext: {
            sectionId: 'contentCommerceDetailSection',
            focusTargetId: 'contentCommerceDetailSection'
        }
    };
}

function renderAnalyticsContentCommerceUserSample(userId = '', detail = {}, options = {}) {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) {
        return '';
    }

    const signalLabel = String(options?.signalLabel || '带货用户').trim() || '带货用户';
    const signalValue = String(options?.signalValue || '').trim();

    return `
        <button
            type="button"
            class="analytics-product-token analytics-product-token--user"
            ${buildAnalyticsOpenUserDetailAttrs(safeUserId, buildAnalyticsContentCommerceUserDetailContext(detail, signalLabel, signalValue))}
            title="查看 ${escapeHtml(safeUserId)} 的用户详情"
        >
            <span class="analytics-product-token__title">${escapeHtml(safeUserId)}</span>
            ${signalValue ? `<span class="analytics-product-token__meta">${escapeHtml(signalValue)}</span>` : ''}
        </button>
    `;
}

function renderAnalyticsContentCommerceUserSampleGroup(title = '', users = [], detail = {}, options = {}) {
    const safeUsers = (Array.isArray(users) ? users : []).map((userId) => String(userId || '').trim()).filter(Boolean);
    return `
        <div class="analytics-content-detail-sample-card">
            <div class="analytics-content-detail-sample-card__head">
                <strong>${escapeHtml(title || '用户样本')}</strong>
                <span>${escapeHtml(formatNumber(safeUsers.length))} 个</span>
            </div>
            <div class="analytics-product-token-list">
                ${safeUsers.length > 0
                    ? safeUsers.map((userId) => renderAnalyticsContentCommerceUserSample(userId, detail, options)).join('')
                    : renderHintState('fas fa-user-group', `当前窗口暂无${title || '用户样本'}`)}
            </div>
        </div>
    `;
}

function renderAnalyticsContentCommerceOrderSample(order = {}, detail = {}) {
    if (!order || !String(order?.order_id || '').trim()) {
        return '';
    }

    return renderAnalyticsProductOrderRow(order, {
        sourceLabel: '内容带货详情 / 订单样本',
        summary: `${buildAnalyticsTopContentCommerceLabel(detail)} 当前已形成归因订单样本，适合结合订单、支付和履约继续确认带货是否稳定。`,
        productId: String(order?.product_id || detail?.primary_product_id || '').trim(),
        productName: String(order?.product_name || detail?.primary_product_name || '').trim(),
        destination: 'analytics-content',
        destinationContext: {
            sectionId: 'contentCommerceDetailSection',
            focusTargetId: 'contentCommerceDetailSection'
        },
        actionLabel: '回到内容带货详情',
        verificationMethod: '回到内容带货详情，确认归因支付、订单样本和带货商品是否仍保持稳定。'
    });
}

function renderAnalyticsContentCommerceDetailPanel(detail = null) {
    if (!detail || !String(detail?.prompt_id || '').trim()) {
        return renderHintState('fas fa-store', '点击带货内容后，这里会展开内容详情级带货视图。');
    }

    const promptTitle = buildAnalyticsTopContentCommerceLabel(detail);
    const category = String(detail?.category || '未分类').trim();
    const contentFeedbackEntries = getAnalyticsResolutionFeedbackEntriesForContent({
        promptId: detail?.prompt_id || '',
        promptTitle,
        limit: 6
    });
    const guidance = buildAnalyticsContentCommerceGuidance(detail);
    const issueCards = buildAnalyticsContentCommerceIssueCards(detail);
    const conclusionDigestMarkup = renderAnalyticsContentCommerceConclusionDigest(contentFeedbackEntries, detail);
    const writebackMarkup = renderAnalyticsContentCommerceFeedbackNote(detail);
    const conclusionHistoryMarkup = renderAnalyticsContentCommerceConclusionHistory(detail);
    const products = Array.isArray(detail?.products) ? detail.products.filter((product) => product && (product.product_id || product.product_name)) : [];
    const primaryProduct = products[0] || null;

    return `
        <div class="analytics-content-detail">
            <section class="analytics-content-detail__hero">
                <div class="analytics-content-detail__headline">
                    <div class="analytics-product-shell__eyebrow">内容详情级带货视图</div>
                    <h4>${escapeHtml(promptTitle)}</h4>
                    <p>${escapeHtml(category)} · 热度 ${formatNumber(detail?.score || 0)} · 浏览 ${formatNumber(detail?.view_count || 0)} · 解锁 ${formatNumber(detail?.unlock_count || 0)} · 评论 ${formatNumber(detail?.comment_count || 0)}</p>
                </div>
                <div class="analytics-content-detail__actions">
                    <button
                        type="button"
                        class="btn-sm btn-secondary"
                        data-admin-action="analytics-view-context"
                        data-prompt-id="${escapeHtml(String(detail?.prompt_id || '').trim())}"
                    >
                        <i class="fas fa-arrow-up-right-from-square"></i> 看 Prompt 上下文
                    </button>
                    <button
                        type="button"
                        class="btn-sm btn-secondary"
                        data-admin-action="analytics-open-prompt-gallery"
                        data-prompt-id="${escapeHtml(String(detail?.prompt_id || '').trim())}"
                    >
                        <i class="fas fa-palette"></i> 去 Gallery
                    </button>
                    <button
                        type="button"
                        class="btn-sm btn-secondary"
                        data-admin-action="analytics-open-prompt-comments"
                        data-prompt-id="${escapeHtml(String(detail?.prompt_id || '').trim())}"
                        data-prompt-title="${escapeHtml(encodeURIComponent(promptTitle))}"
                    >
                        <i class="fas fa-comments"></i> 看评论
                    </button>
                    <button
                        type="button"
                        class="btn-sm btn-secondary"
                        data-admin-action="analytics-open-prompt-homepage"
                        data-prompt-id="${escapeHtml(String(detail?.prompt_id || '').trim())}"
                    >
                        <i class="fas fa-house"></i> 去 Homepage
                    </button>
                    ${primaryProduct
                        ? `<button
                                type="button"
                                class="btn-sm btn-secondary"
                                ${buildAnalyticsProductDestinationAttrs('analytics-product-detail', {
                                    productId: primaryProduct.product_id,
                                    productName: primaryProduct.product_name,
                                    referenceLabel: 'Prompt',
                                    referenceValue: promptTitle,
                                    signalLabel: '内容带货',
                                    signalValue: `GMV ${formatNumber(primaryProduct.gmv_points || 0)} · 支付 ${formatNumber(primaryProduct.purchase_success_count || 0)}`,
                                    focusTargetId: 'productContentBreakdownSection'
                                })}
                            >
                                <i class="fas fa-cube"></i> 看主带货商品
                            </button>`
                        : ''}
                    ${primaryProduct
                        ? `<button
                                type="button"
                                class="btn-sm btn-secondary"
                                ${buildAnalyticsProductDestinationAttrs('shop-orders', buildAnalyticsContentCommerceOrderContext(detail, primaryProduct))}
                            >
                                <i class="fas fa-cart-shopping"></i> 看订单链
                    </button>`
                        : ''}
                </div>
            </section>

            ${conclusionDigestMarkup}
            ${writebackMarkup}

            <div class="analytics-product-metric-grid analytics-product-metric-grid--detail">
                ${renderAnalyticsProductMetricCard('带货商品', formatNumber(detail?.product_count || 0), `主带货商品 ${primaryProduct?.product_name || '—'}`, 'default')}
                ${renderAnalyticsProductMetricCard('详情触达', formatNumber(detail?.detail_view_count || 0), `内容浏览 ${formatNumber(detail?.view_count || 0)}`, 'accent')}
                ${renderAnalyticsProductMetricCard('购买意图', formatNumber(detail?.purchase_click_count || 0), `解锁 ${formatNumber(detail?.unlock_count || 0)}`, 'success')}
                ${renderAnalyticsProductMetricCard('归因支付', formatNumber(detail?.purchase_success_count || 0), `评论 ${formatNumber(detail?.comment_count || 0)}`, 'warning')}
                ${renderAnalyticsProductMetricCard('归因 GMV', formatNumber(detail?.gmv_points || 0), `热度 ${formatNumber(detail?.score || 0)}`, 'success')}
            </div>

            ${renderAnalyticsContentUserValueLink(detail)}
            ${renderAnalyticsProductInlineGuidance(guidance)}

            <section class="analytics-product-detail-card analytics-product-detail-card--wide">
                <div class="analytics-product-detail-card__head">
                    <strong>带货问题摘要</strong>
                    <span>支付 / 售后问题视角</span>
                </div>
                <div class="analytics-content-detail-issue-grid">
                    ${issueCards.length > 0
                        ? issueCards.map((issue) => renderAnalyticsContentCommerceIssueCard(issue, detail)).join('')
                        : renderHintState('fas fa-shield-check', '当前窗口暂无支付或售后问题样本')}
                </div>
            </section>

            <section class="analytics-product-detail-card analytics-product-detail-card--wide">
                <div class="analytics-product-detail-card__head">
                    <strong>带货用户样本</strong>
                    <span>内容 -> 商品 -> 支付</span>
                </div>
                <div class="analytics-content-detail-sample-grid">
                    ${renderAnalyticsContentCommerceUserSampleGroup('详情触达用户', detail?.detail_view_user_samples, detail, {
                        signalLabel: '详情触达',
                        signalValue: `详情 ${formatNumber(detail?.detail_view_count || 0)}`
                    })}
                    ${renderAnalyticsContentCommerceUserSampleGroup('购买意图用户', detail?.purchase_click_user_samples, detail, {
                        signalLabel: '购买意图',
                        signalValue: `意图 ${formatNumber(detail?.purchase_click_count || 0)}`
                    })}
                    ${renderAnalyticsContentCommerceUserSampleGroup('支付用户', detail?.purchase_success_user_samples, detail, {
                        signalLabel: '归因支付',
                        signalValue: `支付 ${formatNumber(detail?.purchase_success_count || 0)} · GMV ${formatNumber(detail?.gmv_points || 0)}`
                    })}
                </div>
            </section>

            <section class="analytics-product-detail-card analytics-product-detail-card--wide">
                <div class="analytics-product-detail-card__head">
                    <strong>带货订单样本</strong>
                    <span>${formatNumber(Array.isArray(detail?.order_samples) ? detail.order_samples.length : 0)} 笔</span>
                </div>
                <div class="analytics-product-order-list">
                    ${Array.isArray(detail?.order_samples) && detail.order_samples.length > 0
                        ? detail.order_samples.map((order) => renderAnalyticsContentCommerceOrderSample(order, detail)).join('')
                        : renderHintState('fas fa-receipt', '当前窗口暂无带货订单样本')}
                </div>
            </section>

            ${conclusionHistoryMarkup}

            <section class="analytics-product-detail-card analytics-product-detail-card--wide">
                <div class="analytics-product-detail-card__head">
                    <strong>带货商品列表</strong>
                    <span>${formatNumber(products.length)} 个样本</span>
                </div>
                <div class="analytics-content-detail-product-list">
                    ${products.length > 0
                        ? products.map((product) => renderAnalyticsContentCommerceDetailProductRow(product, detail)).join('')
                        : renderHintState('fas fa-box-open', '当前窗口暂无带货商品样本')}
                </div>
            </section>
        </div>
    `;
}

function updateAnalyticsContentCommerceDetailPanel(options = {}) {
    const container = document.getElementById('contentCommerceDetailPanel');
    const meta = document.getElementById('contentCommerceDetailMeta');
    if (!container) {
        return;
    }

    const status = String(options?.status || '').trim().toLowerCase();
    if (status === 'loading') {
        container.innerHTML = renderAnalyticsProductLoadingState('内容带货详情加载中...');
        if (meta) meta.textContent = '内容带货详情加载中';
        return;
    }

    if (status === 'error') {
        const message = String(options?.message || '内容带货详情加载失败').trim() || '内容带货详情加载失败';
        container.innerHTML = renderHintState('fas fa-store', message, 'error');
        if (meta) meta.textContent = message;
        return;
    }

    const detail = getActiveAnalyticsContentCommerceDetailRow();
    if (!detail) {
        container.innerHTML = renderHintState('fas fa-store', '当前窗口暂无内容带货详情样本');
        if (meta) meta.textContent = '当前窗口暂无带货详情';
        return;
    }

    container.innerHTML = renderAnalyticsContentCommerceDetailPanel(detail);
    if (meta) meta.textContent = `Prompt 带货详情`;
}

function openAnalyticsContentCommerceDetail(promptId = '', options = {}) {
    const normalizedPromptId = String(promptId || '').trim();
    if (!normalizedPromptId) {
        return false;
    }

    const state = getAnalyticsContentCommerceDetailState();
    if (state.rowMap instanceof Map && !state.rowMap.has(normalizedPromptId)) {
        return false;
    }

    state.activePromptId = normalizedPromptId;
    state.activePromptTitle = String(options?.promptTitle || state.rowMap?.get?.(normalizedPromptId)?.prompt_title || '').trim();

    if (options?.syncRoute !== false && typeof syncAnalyticsRouteState === 'function') {
        syncAnalyticsRouteState({
            view: 'content',
            sectionId: 'contentCommerceDetailSection',
            promptId: normalizedPromptId
        });
    }

    if (typeof switchAnalyticsTab === 'function') {
        switchAnalyticsTab('content', {
            syncRoute: false,
            sectionId: 'contentCommerceDetailSection'
        });
    }

    updateAnalyticsContentCommerceDetailPanel();
    updateAnalyticsContentOperatingCockpitPanel();

    if (options.focus !== false && typeof focusAnalyticsDestinationTarget === 'function') {
        setTimeout(() => {
            focusAnalyticsDestinationTarget('contentCommerceDetailSection', { block: 'start' });
        }, 60);
    }

    return true;
}

window.openAnalyticsContentCommerceDetail = openAnalyticsContentCommerceDetail;

function primeAnalyticsProductDetailFromRouteState(routeState = {}, options = {}) {
    const requestedView = normalizeAnalyticsRouteTabId(routeState?.view || '') || getAnalyticsActiveTabId() || '';
    const normalizedProductId = String(routeState?.productId || '').trim();
    if (!normalizedProductId) {
        return false;
    }

    if (requestedView !== 'product-detail' && options.force !== true) {
        return false;
    }

    const normalizedProductName = String(routeState?.productName || '').trim();
    const normalizedDetailFocus = String(routeState?.detailFocus || '').trim();
    const normalizedFocusTargetId = String(routeState?.sectionId || options.focusTargetId || 'productDetailPanelSection').trim() || 'productDetailPanelSection';

    activeAnalyticsProductId = normalizedProductId;
    activeAnalyticsProductName = normalizedProductName || activeAnalyticsProductName || normalizedProductId;
    setActiveAnalyticsProductDetailFocus(normalizedDetailFocus, normalizedFocusTargetId);
    registerAnalyticsProductDetailCandidates([
        {
            productId: normalizedProductId,
            productName: activeAnalyticsProductName || normalizedProductId
        }
    ], {
        activeProductId: normalizedProductId,
        activeProductName: activeAnalyticsProductName || normalizedProductId,
        detailFocus: normalizedDetailFocus,
        focusTargetId: normalizedFocusTargetId
    });
    return true;
}

window.primeAnalyticsProductDetailFromRouteState = primeAnalyticsProductDetailFromRouteState;

async function restoreAnalyticsRouteState(options = {}) {
    const routeState = getAnalyticsRouteState();
    const requestedView = normalizeAnalyticsRouteTabId(routeState.view) || getAnalyticsActiveTabId() || 'overview';
    const shouldFocus = options.focus !== false;
    const sectionId = String(routeState.sectionId || '').trim();

    if (requestedView && typeof switchAnalyticsTab === 'function') {
        switchAnalyticsTab(requestedView, {
            syncRoute: false,
            sectionId
        });
    }

    if (requestedView === 'content' && routeState.promptId && typeof openAnalyticsContentCommerceDetail === 'function') {
        openAnalyticsContentCommerceDetail(routeState.promptId, {
            focus: shouldFocus,
            syncRoute: false
        });
        return true;
    }

    if ((requestedView === 'product' || requestedView === 'product-detail') && routeState.productId && typeof openAnalyticsProductDetail === 'function') {
        const normalizedRouteProductId = String(routeState.productId || '').trim();
        const normalizedFocusTargetId = sectionId || 'productDetailPanelSection';
        const normalizedDetailFocus = String(routeState.detailFocus || '').trim();
        const activeTabId = getAnalyticsActiveTabId();
        const currentProductId = String(activeAnalyticsProductId || '').trim();

        if (requestedView === 'product-detail' && normalizedRouteProductId && currentProductId === normalizedRouteProductId && activeTabId === 'product-detail') {
            setActiveAnalyticsProductDetailFocus(normalizedDetailFocus, normalizedFocusTargetId);
            refreshAnalyticsProductDetailNavigatorState(normalizedFocusTargetId);
            refreshAnalyticsProductDetailSelectorState({
                activeProductId: normalizedRouteProductId,
                activeProductName: activeAnalyticsProductName || normalizedRouteProductId,
                detailFocus: normalizedDetailFocus,
                focusTargetId: normalizedFocusTargetId
            });

            if (shouldFocus && typeof focusAnalyticsDestinationTarget === 'function') {
                setTimeout(() => {
                    focusAnalyticsDestinationTarget(normalizedFocusTargetId, { block: 'start' });
                }, 60);
            }
            return true;
        }

        openAnalyticsProductDetail(normalizedRouteProductId, {
            focus: shouldFocus,
            syncRoute: false,
            detailFocus: normalizedDetailFocus,
            focusTargetId: normalizedFocusTargetId
        });
        if (requestedView !== 'product-detail' && typeof syncAnalyticsRouteState === 'function') {
            syncAnalyticsRouteState({
                view: 'product-detail',
                sectionId: normalizedFocusTargetId,
                productId: normalizedRouteProductId,
                detailFocus: normalizedDetailFocus
            });
        }
        return true;
    }

    if (shouldFocus && sectionId && typeof focusAnalyticsDestinationTarget === 'function') {
        setTimeout(() => {
            focusAnalyticsDestinationTarget(sectionId, { block: 'start' });
        }, 80);
    }

    return true;
}

window.restoreAnalyticsRouteState = restoreAnalyticsRouteState;

async function loadTopContent(days = getAnalyticsRangeDays()) {
    updateAnalyticsContentOperatingCockpitPanel({ status: 'loading' });
    updateAnalyticsContentCommerceDetailPanel({ status: 'loading' });
    try {
        const [data, productRankBundle] = await Promise.all([
            fetchTopContentData(10, days),
            getAnalyticsProductRankBundle({ days }).catch(() => null)
        ]);

        const container = document.getElementById('topContentList');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无数据</div>';
            setAnalyticsContentCommerceDetailRows([]);
            updateAnalyticsContentOperatingCockpitPanel();
            updateAnalyticsContentCommerceDetailPanel();
            return;
        }

        const contentDrivenRows = productRankBundle
            ? (getAnalyticsProductBundlePayloadOrThrow(productRankBundle, 'contentDrivenTop', 'Product content-driven rank unavailable') || [])
            : [];
        const contentCommerce = buildAnalyticsContentCommerceSummary(contentDrivenRows);
        const detailRows = data.map((item) => {
            const promptId = String(item?.prompt_id || '').trim();
            if (!promptId) {
                return null;
            }
            const commerceRow = contentCommerce.promptMap.get(promptId) || null;
            if (!commerceRow) {
                return null;
            }

            return {
                ...commerceRow,
                prompt_id: promptId,
                prompt_title: String(item?.title || '').trim() || `Prompt ${promptId}`,
                category: String(item?.category || '').trim(),
                score: normalizeAnalyticsCountValue(item?.score),
                view_count: normalizeAnalyticsCountValue(item?.view_count),
                unlock_count: normalizeAnalyticsCountValue(item?.unlock_count),
                comment_count: normalizeAnalyticsCountValue(item?.comment_count)
            };
        }).filter(Boolean);
        setAnalyticsContentCommerceDetailRows(detailRows, {
            summary: contentCommerce.summary
        });
        updateAnalyticsContentOperatingCockpitPanel();
        updateAnalyticsContentCommerceDetailPanel();

        container.innerHTML = `
            ${renderAnalyticsContentCommerceSummary(contentCommerce.summary)}
            ${data.map((item, index) => {
            const promptId = String(item.prompt_id || '').trim();
            const rawTitle = String(item.title || '无标题');
            const escapedTitle = escapeHtml(rawTitle);
            const truncatedTitle = escapeHtml(truncate(rawTitle, 34));
            const commerceRow = promptId ? contentCommerce.promptMap.get(promptId) || null : null;
            const commerceContextRow = commerceRow
                ? {
                    ...commerceRow,
                    prompt_title: rawTitle
                }
                : null;

            return `
                <div class="top-content-item">
                    <span class="rank rank-${index + 1}">${index + 1}</span>
                    <div class="top-content-item__main">
                        ${promptId
                            ? `<button
                                    type="button"
                                    class="top-content-item__title top-content-item__title-btn"
                                    data-admin-action="analytics-view-context"
                                    data-prompt-id="${escapeHtml(promptId)}"
                                    title="${escapedTitle}"
                                    aria-label="查看 ${escapedTitle} 的上下文"
                                >${truncatedTitle}</button>`
                            : `<div class="top-content-item__title" title="${escapedTitle}">${truncatedTitle}</div>`}
                        <div class="top-content-item__meta">
                            <span>${escapeHtml(item.category || '未分类')}</span>
                            ${normalizeAnalyticsCountValue(item.score) > 0 ? `<span>热度 ${formatNumber(item.score)}</span>` : ''}
                            ${promptId ? `<span>ID ${escapeHtml(promptId)}</span>` : ''}
                        </div>
                        ${commerceContextRow ? renderAnalyticsTopContentCommerceNote(commerceContextRow) : ''}
                    </div>
                    <span class="stats">
                        ${normalizeAnalyticsCountValue(item.view_count) > 0
                            ? `<span class="view"><i class="fas fa-eye"></i> ${item.view_count}</span>`
                            : ''}
                        <span class="unlock"><i class="fas fa-unlock"></i> ${item.unlock_count}</span>
                        <span class="comment"><i class="fas fa-comment"></i> ${item.comment_count}</span>
                    </span>
                </div>
            `;
        }).join('')}
        `;
    } catch (err) {
        console.error('[Analytics] Failed to load top content:', err);
        const container = document.getElementById('topContentList');
        if (container) {
            container.innerHTML = '<div class="error-state">加载失败</div>';
        }
        setAnalyticsContentCommerceDetailRows([]);
        updateAnalyticsContentOperatingCockpitPanel({
            status: 'error',
            message: '内容经营页加载失败'
        });
        updateAnalyticsContentCommerceDetailPanel({
            status: 'error',
            message: '内容带货详情加载失败'
        });
    }
}

async function fetchCommunityStatsData(days = getAnalyticsRangeDays()) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsPanelSupportBundle({ days }),
        readSegment: getAnalyticsPanelSupportBundleSegment,
        segmentKey: 'communityStats',
        unavailableMessage: 'Community stats bundle unavailable',
        warningMessage: '[Analytics] Panel support bundle community stats unavailable:',
        createSegmentError: createAnalyticsPanelSupportBundleSegmentError,
        directLoader: () => loadAnalyticsRangeRpcRowsDirect('get_community_stats', days)
    });
}

async function fetchPointsDistributionData() {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsPanelSupportBundle(),
        readSegment: getAnalyticsPanelSupportBundleSegment,
        segmentKey: 'pointsDistribution',
        unavailableMessage: 'Points distribution bundle unavailable',
        warningMessage: '[Analytics] Panel support bundle points distribution unavailable:',
        createSegmentError: createAnalyticsPanelSupportBundleSegmentError,
        directLoader: () => loadAnalyticsStaticRpcRowsDirect('get_points_distribution')
    });
}

async function fetchRedemptionFunnelData(days = getAnalyticsRangeDays()) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsPanelSupportBundle({ days }),
        readSegment: getAnalyticsPanelSupportBundleSegment,
        segmentKey: 'redemptionFunnel',
        unavailableMessage: 'Redemption funnel bundle unavailable',
        warningMessage: '[Analytics] Panel support bundle redemption funnel unavailable:',
        createSegmentError: createAnalyticsPanelSupportBundleSegmentError,
        directLoader: () => loadAnalyticsRangeRpcRowsDirect('get_redemption_funnel', days)
    });
}

async function fetchActivityHeatmapData(days = getAnalyticsRangeDays(30)) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsVisualPanelBundle({ days }),
        readSegment: getAnalyticsVisualPanelBundleSegment,
        segmentKey: 'activityHeatmap',
        unavailableMessage: 'Activity heatmap bundle unavailable',
        warningMessage: '[Analytics] Visual panel bundle heatmap unavailable:',
        createSegmentError: createAnalyticsVisualPanelBundleSegmentError,
        allowDirectRetryOnEmpty: true,
        isPayloadEmpty: (payload) => !Array.isArray(payload) || payload.length === 0,
        directLoader: () => loadAnalyticsRangeRpcRowsDirect('get_activity_heatmap', days)
    });
}

async function fetchConversionFunnelData(days = getAnalyticsRangeDays(30)) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsVisualPanelBundle({ days }),
        readSegment: getAnalyticsVisualPanelBundleSegment,
        segmentKey: 'conversionFunnel',
        unavailableMessage: 'Conversion funnel bundle unavailable',
        warningMessage: '[Analytics] Visual panel bundle conversion funnel unavailable:',
        createSegmentError: createAnalyticsVisualPanelBundleSegmentError,
        isPayloadValid: (payload) => Array.isArray(payload),
        allowDirectRetryOnEmpty: true,
        isPayloadEmpty: (payload) => !Array.isArray(payload?.rows) || !payload.rows.some((row) => Number(row?.user_count || 0) > 0),
        mapPayload: (payload) => ({
            rows: payload
        }),
        directLoader: async () => ({
            rows: await loadAnalyticsRangeRpcRowsDirect('get_conversion_funnel_v2', days)
        })
    });
}

async function fetchRetentionCohortData(weeks = getAnalyticsCohortWeeks(), days = getAnalyticsRangeDays()) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsVisualPanelBundle({ days, weeks }),
        readSegment: getAnalyticsVisualPanelBundleSegment,
        segmentKey: 'retentionCohort',
        unavailableMessage: 'Retention cohort bundle unavailable',
        warningMessage: '[Analytics] Visual panel bundle retention cohort unavailable:',
        createSegmentError: createAnalyticsVisualPanelBundleSegmentError,
        directLoader: () => loadAnalyticsRangeRpcRowsDirect('get_retention_cohort', days, { p_weeks: weeks })
    });
}

async function fetchTopContributorsData(limit = 10) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsVisualPanelBundle(),
        readSegment: getAnalyticsVisualPanelBundleSegment,
        segmentKey: 'topContributors',
        unavailableMessage: 'Top contributors bundle unavailable',
        warningMessage: '[Analytics] Visual panel bundle contributors unavailable:',
        createSegmentError: createAnalyticsVisualPanelBundleSegmentError,
        mapPayload: (payload) => payload.slice(0, Math.max(1, Number(limit) || 10)),
        directLoader: () => loadAnalyticsStaticRpcRowsDirect('get_top_contributors', {
            p_limit: Math.max(1, Number(limit) || 10)
        })
    });
}

async function fetchGeoDistributionData() {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsVisualPanelBundle(),
        readSegment: getAnalyticsVisualPanelBundleSegment,
        segmentKey: 'geoDistribution',
        unavailableMessage: 'Geo distribution bundle unavailable',
        warningMessage: '[Analytics] Visual panel bundle geo distribution unavailable:',
        createSegmentError: createAnalyticsVisualPanelBundleSegmentError,
        allowDirectRetryOnEmpty: true,
        isPayloadEmpty: (payload) => !Array.isArray(payload) || !payload.some((row) => Number(row?.user_count || 0) > 0),
        directLoader: () => loadAnalyticsStaticRpcRowsDirect('get_geo_distribution_by_site')
    });
}

function sumPointsFlow(items = [], direction = 'in') {
    return roundTo(items.reduce((sum, item) => {
        const value = toNumericValue(item.value) || 0;

        if (direction === 'in' && item.target_node === '用户余额') {
            return sum + value;
        }

        if (direction === 'out' && item.source_node === '用户余额') {
            return sum + value;
        }

        return sum;
    }, 0), 1) || 0;
}

async function fetchPointsHealthData() {
    try {
        const rawSite = getAnalyticsSiteParam();
        const rpcSite = String(rawSite || '').trim().toLowerCase() === 'all'
            ? null
            : rawSite;
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_points_health', { p_site: rpcSite });
        if (error) throw error;
        if (data && typeof data === 'object') return data;
    } catch (err) {
        console.warn('[Analytics] get_points_health RPC failed, falling back to direct queries:', err);
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let balanceQuery = getAnalyticsSupabaseClient().from('points_balance').select('user_id,total_balance');
    balanceQuery = window.AdminSiteFilter?.applySiteFilter(balanceQuery) || balanceQuery;

    let ledgerQuery = supabaseClient
        .from('points_ledger')
        .select('user_id,amount,created_at')
        .lt('amount', 0)
        .gte('created_at', thirtyDaysAgo.toISOString());
    ledgerQuery = window.AdminSiteFilter?.applySiteFilter(ledgerQuery) || ledgerQuery;

    const [{ data: balanceRows, error: balanceError }, { data: spendRows, error: spendError }] = await Promise.all([
        balanceQuery,
        ledgerQuery
    ]);

    if (balanceError) throw balanceError;
    if (spendError) throw spendError;

    let totalCirculation = 0;
    let activeHolders = 0;

    (balanceRows || []).forEach((row) => {
        const balance = toNumericValue(row.total_balance) || 0;
        totalCirculation += balance;
        if (balance > 0) activeHolders += 1;
    });

    let monthlySpend = 0;
    const recentSpenders = new Set();

    (spendRows || []).forEach((row) => {
        const amount = toNumericValue(row.amount);
        if (amount === null || amount >= 0) return;

        monthlySpend += Math.abs(amount);
        if (row.user_id) recentSpenders.add(row.user_id);
    });

    const hoardingUsers = Math.max(activeHolders - recentSpenders.size, 0);
    const velocity = totalCirculation > 0 ? roundTo((monthlySpend / totalCirculation) * 100, 2) : 0;
    const hoardingRate = activeHolders > 0 ? roundTo((hoardingUsers / activeHolders) * 100, 2) : 0;

    return {
        total_circulation: roundTo(totalCirculation, 1) || 0,
        monthly_spend: roundTo(monthlySpend, 1) || 0,
        velocity: velocity || 0,
        hoarding_rate: hoardingRate || 0,
        active_holders: activeHolders,
        hoarding_users: hoardingUsers
    };
}

async function fetchPointsFlowData(days = 30) {
    try {
        const rangeParams = buildAnalyticsRangeRpcParams({}, { days });
        const data = await callAnalyticsRpcWithFallback('get_points_flow_v2', [
            rangeParams,
            buildAnalyticsLegacyRpcParams(rangeParams),
            buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
            {}
        ]);
        if (Array.isArray(data)) {
            return data.map((item) => ({
                ...item,
                value: roundTo(item.value, 1) || 0
            }));
        }
    } catch (err) {
        console.warn('[Analytics] get_points_flow_v2 RPC failed, falling back to legacy points flow:', err);
    }

    try {
        const rangeParams = buildAnalyticsRangeRpcParams({}, { days });
        const data = await callAnalyticsRpcWithFallback('get_points_flow', [
            rangeParams,
            buildAnalyticsLegacyRpcParams(rangeParams),
            buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
            {}
        ]);
        if (Array.isArray(data)) {
            return data.map((item) => ({
                ...item,
                value: roundTo(item.value, 1) || 0
            }));
        }
    } catch (err) {
        console.warn('[Analytics] get_points_flow RPC failed, falling back to direct ledger query:', err);
    }

    let query = supabaseClient
        .from('points_ledger')
        .select('amount,reason,reference_id,created_at');
    query = applyAnalyticsTimeRange(query, 'created_at');
    query = window.AdminSiteFilter?.applySiteFilter(query) || query;

    const { data, error } = await query;
    if (error) throw error;

    return buildPointsFlowFromLedger(data || []);
}

async function fetchPointsLeaderboardData(limit = 10) {
    return resolveAnalyticsBundleFirstData({
        loadBundle: () => getAnalyticsPanelSupportBundle(),
        readSegment: getAnalyticsPanelSupportBundleSegment,
        segmentKey: 'pointsLeaderboard',
        unavailableMessage: 'Points leaderboard bundle unavailable',
        warningMessage: '[Analytics] Panel support bundle points leaderboard unavailable:',
        createSegmentError: createAnalyticsPanelSupportBundleSegmentError,
        mapPayload: (payload) => payload
            .slice(0, Math.max(1, Number(limit) || 10))
            .map((row) => ({
                ...row,
                balance: roundTo(row.balance, 1) || 0,
                total_spent: roundTo(row.total_spent, 1) || 0
            })),
        directLoader: async () => {
            const rows = await loadAnalyticsStaticRpcRowsDirect('get_points_leaderboard', {
                p_limit: Math.max(1, Number(limit) || 10)
            });
            return Array.isArray(rows)
                ? rows
                    .slice(0, Math.max(1, Number(limit) || 10))
                    .map((row) => ({
                        ...row,
                        balance: roundTo(row.balance, 1) || 0,
                        total_spent: roundTo(row.total_spent, 1) || 0
                    }))
                : [];
        }
    });
}

function normalizeAnalyticsAvatarImageUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    if (/^(https?:|blob:|\/|\.\.?\/)/i.test(raw)) {
        return raw;
    }

    return '';
}

function getAnalyticsAvatarInitials(label = '') {
    const normalized = String(label || '').trim();
    if (!normalized) {
        return 'U';
    }

    const letters = Array.from(normalized.replace(/[\s@._-]+/g, ' ').trim())
        .filter((char) => /\S/.test(char));
    return letters.slice(0, 2).join('').toUpperCase() || 'U';
}

function bindPointsLeaderboardAvatarFallbacks(container = null) {
    if (!container || container.dataset.pointsLeaderboardAvatarFallbackBound === '1') {
        return;
    }

    container.dataset.pointsLeaderboardAvatarFallbackBound = '1';
    container.addEventListener('error', (event) => {
        const image = event.target instanceof HTMLImageElement ? event.target : null;
        if (!image || !image.matches('[data-analytics-avatar-fallback]')) {
            return;
        }

        const shell = image.closest('.leaderboard-avatar-shell');
        if (shell) {
            shell.classList.add('leaderboard-avatar-shell--fallback');
        }
        image.remove();
    }, true);
}

function renderPointsLeaderboardAvatar(user = {}) {
    const displayName = String(user?.username || user?.user_id || '匿名用户').trim() || '匿名用户';
    const initials = getAnalyticsAvatarInitials(displayName);
    const avatarUrl = normalizeAnalyticsAvatarImageUrl(user?.avatar_url);
    const fallback = `<span class="leaderboard-avatar-initials" aria-hidden="true">${escapeHtml(initials)}</span>`;

    if (!avatarUrl) {
        return `<span class="avatar leaderboard-avatar-shell leaderboard-avatar-shell--fallback" title="${escapeHtml(displayName)}">${fallback}</span>`;
    }

    return `
        <span class="avatar leaderboard-avatar-shell" title="${escapeHtml(displayName)}">
            ${fallback}
            <img
                src="${escapeHtml(avatarUrl)}"
                class="leaderboard-avatar-image"
                alt="${escapeHtml(displayName)} 头像"
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                data-analytics-avatar-fallback="${escapeHtml(initials)}">
        </span>
    `;
}

async function loadPointsStats(days = getAnalyticsRangeDays()) {
    try {
        const [data, weeklyFlow] = await Promise.all([
            fetchPointsHealthData(),
            fetchPointsFlowData(days)
        ]);

        const totalCirculation = toNumericValue(data?.total_circulation);
        const fallbackIncome = sumPointsFlow(weeklyFlow, 'in');
        const fallbackSpend = sumPointsFlow(weeklyFlow, 'out');
        const weeklyIncome = days === 7
            ? (toNumericValue(data?.weekly_income) ?? fallbackIncome)
            : fallbackIncome;
        const weeklySpend = days === 7
            ? (toNumericValue(data?.weekly_spend) ?? fallbackSpend)
            : fallbackSpend;

        const circulationEl = document.getElementById('kpiPointsValue');
        if (circulationEl && totalCirculation !== null) {
            circulationEl.textContent = formatNumber(totalCirculation);
        }

        const incomeEl = document.getElementById('kpiPointsInValue');
        if (incomeEl) {
            incomeEl.textContent = formatNumber(weeklyIncome);
        }

        const spendEl = document.getElementById('kpiPointsOutValue');
        if (spendEl) {
            spendEl.textContent = formatNumber(weeklySpend);
        }

        const velocityEl = document.getElementById('kpiPointsVelocityValue');
        if (velocityEl) {
            velocityEl.textContent = formatPercent(data?.velocity || 0);
        }
    } catch (err) {
        console.error('[Analytics] Failed to load points health:', err);

        const incomeEl = document.getElementById('kpiPointsInValue');
        const spendEl = document.getElementById('kpiPointsOutValue');
        const velocityEl = document.getElementById('kpiPointsVelocityValue');

        if (incomeEl) incomeEl.textContent = '--';
        if (spendEl) spendEl.textContent = '--';
        if (velocityEl) velocityEl.textContent = '--';
    }
}

async function loadPointsDistribution() {
    try {
        const data = await fetchPointsDistributionData();

        const ctx = document.getElementById('pointsDistChart');
        if (!ctx) return;

        const theme = getChartTheme();

        if (pointsDistributionChart) {
            pointsDistributionChart.destroy();
        }

        pointsDistributionChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map((d) => d.range_label),
                datasets: [{
                    label: '用户数',
                    data: data.map((d) => d.user_count),
                    backgroundColor: chartColors.primary,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctxValue) => `用户数: ${ctxValue.raw}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: theme.text }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });
    } catch (err) {
        console.error('[Analytics] Failed to load points distribution:', err);
        const ctx = document.getElementById('pointsDistChart');
        if (ctx?.parentElement) {
            ctx.parentElement.innerHTML = renderHintState('fas fa-chart-bar', '积分分布加载失败', 'error');
        }
    }
}

async function loadPointsLeaderboard() {
    try {
        const data = await fetchPointsLeaderboardData(10);
        const container = document.getElementById('pointsLeaderboard');
        if (!container) return;
        bindPointsLeaderboardAvatarFallbacks(container);

        if (!data || data.length === 0) {
            container.innerHTML = renderHintState('fas fa-trophy', '暂无积分排行榜数据');
            return;
        }

        container.innerHTML = data.map((user, index) => `
            <div class="leaderboard-item">
                <div class="rank rank-${index + 1}">${index + 1}</div>
                <div class="user-info">
                    ${renderPointsLeaderboardAvatar(user)}
                    <div class="details">
                        <div class="name">
                            ${user.user_id
                                ? `<button
                                    type="button"
                                    class="leaderboard-user-link"
                                    data-admin-action="analytics-open-user-detail"
                                    data-user-id="${encodeURIComponent(String(user.user_id).trim())}"
                                    title="查看用户详情"
                                    aria-label="查看 ${escapeHtml(user.username || '匿名用户')} 的用户详情"
                                >${escapeHtml(user.username || '匿名用户')}</button>`
                                : `<span>${escapeHtml(user.username || '匿名用户')}</span>`}
                        </div>
                        <div class="sub">总消费: ${formatNumber(user.total_spent)}</div>
                    </div>
                </div>
                <div class="points-value">
                    <i class="fas fa-coins text-warning"></i> ${formatNumber(user.balance)}
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('[Analytics] Failed to load leaderboard:', err);
        const container = document.getElementById('pointsLeaderboard');
        if (container) {
            container.innerHTML = renderHintState('fas fa-triangle-exclamation', '积分富豪榜加载失败', 'error');
        }
    }
}

async function loadRedemptionFunnel(days = getAnalyticsRangeDays()) {
    try {
        const data = await fetchRedemptionFunnelData(days);

        let ctx = document.getElementById('redemptionFunnelChart');
        if (!ctx) {
            // Canvas may have been destroyed by a previous empty-state render.
            // Find the parent chart-body container and recreate the canvas.
            const funnelCard = document.querySelector('.chart-card .chart-header h3 .fa-ticket-alt')
                ?.closest('.chart-card');
            const chartBody = funnelCard?.querySelector('.chart-body');
            if (chartBody) {
                chartBody.innerHTML = '<canvas id="redemptionFunnelChart"></canvas>';
                ctx = document.getElementById('redemptionFunnelChart');
            }
            if (!ctx) return;
        }

        if (!data || data.length === 0 || data.every((d) => d.count === 0)) {
            ctx.parentElement.innerHTML = `
                <div class="empty-state-hint">
                    <i class="fas fa-info-circle"></i>
                    <span>暂无兑换码数据</span>
                </div>
            `;
            return;
        }

        const redeemRate = data.find((d) => d.step === '已核销')?.conversion_rate;
        const rateEl = document.getElementById('kpiRedeemRateValue');
        if (rateEl && redeemRate !== undefined) {
            rateEl.textContent = `${redeemRate}%`;
        }

        const theme = getChartTheme();

        if (redemptionFunnelChart) {
            redemptionFunnelChart.destroy();
        }

        redemptionFunnelChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map((d) => d.step),
                datasets: [{
                    label: '数量',
                    data: data.map((d) => d.count),
                    backgroundColor: [chartColors.primary, chartColors.success, chartColors.secondary],
                    borderRadius: 4,
                    barPercentage: 0.5
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.raw} (${data[context.dataIndex].conversion_rate}%)`
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: theme.text, font: { weight: 'bold' } }
                    }
                }
            }
        });
    } catch (err) {
        console.error('[Analytics] Failed to load redemption funnel:', err);
        let ctx = document.getElementById('redemptionFunnelChart');
        if (!ctx) {
            const funnelCard = document.querySelector('.chart-card .chart-header h3 .fa-ticket-alt')
                ?.closest('.chart-card');
            const chartBody = funnelCard?.querySelector('.chart-body');
            if (chartBody) {
                chartBody.innerHTML = '<canvas id="redemptionFunnelChart"></canvas>';
                ctx = document.getElementById('redemptionFunnelChart');
            }
        }
        if (ctx?.parentElement) {
            ctx.parentElement.innerHTML = renderHintState('fas fa-ticket-alt', '兑换漏斗加载失败', 'error');
        }
    }
}

function renderOverviewBusinessMixSummary(summary = {}, container = null, recommendations = null) {
    if (!container) {
        return false;
    }

    container.innerHTML = renderAnalyticsCompactItems(summary.items, {
        iconClass: 'fas fa-compass-drafting',
        message: '当前窗口暂无经营主线数据'
    });

    if (recommendations) {
        recommendations.innerHTML = renderAnalyticsRecommendationItems(summary.recommendations, {
            iconClass: 'fas fa-list-check',
            message: '当前窗口暂无建议动作'
        });
    }

    return true;
}

function scheduleOverviewBusinessMixProductSignalsWarm(summary = {}, options = {}) {
    const requestId = Number(options?.requestId || 0);
    return new Promise((resolve) => {
        window.setTimeout(() => {
            void (async () => {
                if (requestId !== analyticsOverviewBusinessMixRequestId) {
                    return false;
                }

                const productSignals = await getOverviewBusinessMixProductSignalsData().catch(() => null);
                if (requestId !== analyticsOverviewBusinessMixRequestId || !productSignals) {
                    return false;
                }

                const container = document.getElementById('overviewBusinessMix');
                if (!container) {
                    return false;
                }

                renderOverviewBusinessMixSummary(
                    enrichOverviewBusinessMixSummaryWithProductSignals(summary, productSignals),
                    container,
                    document.getElementById('overviewActionRecommendations')
                );
                return true;
            })().then(resolve).catch((error) => {
                console.warn('[Analytics] Overview business mix product warm failed:', error);
                resolve(false);
            });
        }, 0);
    });
}

async function loadOverviewBusinessMix() {
    const container = document.getElementById('overviewBusinessMix');
    const recommendations = document.getElementById('overviewActionRecommendations');
    if (!container) return;
    const requestId = ++analyticsOverviewBusinessMixRequestId;

    try {
        const summary = await getOverviewBusinessMixSummaryData({ includeProductSignals: false });
        if (requestId !== analyticsOverviewBusinessMixRequestId) {
            return;
        }

        renderOverviewBusinessMixSummary(summary, container, recommendations);
        void scheduleOverviewBusinessMixProductSignalsWarm(summary, { requestId });
    } catch (err) {
        console.error('[Analytics] Failed to load overview business mix:', err);
        try {
            const [summaryWindow, commentsSummary] = await Promise.all([
                loadAnalyticsSummaryWindowFallbackData({ forceRefresh: true }).catch(() => ({})),
                getAnalyticsCommentsSummaryData({ forceRefresh: true }).catch(() => null)
            ]);
            const fallbackSummary = buildOverviewBusinessMixFallbackSummary({
                summaryWindow,
                commentsSummary
            });
            if (requestId !== analyticsOverviewBusinessMixRequestId) {
                return;
            }
            renderOverviewBusinessMixSummary(fallbackSummary, container, recommendations);
        } catch (fallbackErr) {
            console.error('[Analytics] Overview business mix fallback failed:', fallbackErr);
            container.innerHTML = renderHintState('fas fa-compass-drafting', '经营主线加载失败', 'error');
            if (recommendations) {
                recommendations.innerHTML = renderHintState('fas fa-list-check', '建议动作加载失败', 'error');
            }
        }
    }
}

async function loadOverviewDutyBoard() {
    const container = document.getElementById('overviewDutyBoard');
    if (!container) return;

    container.innerHTML = renderOverviewDutyBoardSkeleton();

    try {
        const [summaryWindowResult, overviewResult, verifyResult, growthResult, operationsResult] = await Promise.allSettled([
            getAnalyticsSummaryWindowData(),
            getOverviewBusinessMixSummaryData({ includeProductSignals: false }),
            getVerifyServiceSummaryData(),
            getGrowthSummaryData(),
            getOperationsHealthSnapshotData()
        ]);

        const summaryBundle = {
            summaryWindowData: summaryWindowResult.status === 'fulfilled' ? summaryWindowResult.value : null,
            overviewBusinessMix: overviewResult.status === 'fulfilled' ? overviewResult.value : null,
            verifyServiceSummary: verifyResult.status === 'fulfilled' ? verifyResult.value : null,
            growthSummary: growthResult.status === 'fulfilled' ? growthResult.value : null,
            operationsHealthSnapshot: operationsResult.status === 'fulfilled' ? operationsResult.value : null
        };

        container.innerHTML = renderAnalyticsDutyBoard(buildAnalyticsDutyBoardData(summaryBundle));
    } catch (err) {
        console.error('[Analytics] Failed to load overview duty board:', err);
        container.innerHTML = renderHintState('fas fa-clipboard-list', '今日待处理加载失败', 'error');
    }
}

function renderVerifyServiceSummaryUnavailableState(message = '') {
    const fallbackMessage = String(message || '').trim();
    const panelStates = [
        ['verifyStatusList', 'fas fa-signal', '验证状态暂未返回，请稍后刷新或打开 Verify Monitor。'],
        ['verifyRecentList', 'fas fa-list-check', '最近验证任务暂未返回，请稍后刷新或打开 Verify Monitor。'],
        ['verifyFailureList', 'fas fa-triangle-exclamation', '失败与阻塞暂未返回，请稍后刷新或打开 Verify Monitor。'],
        ['verifyActionRecommendations', 'fas fa-list-check', '建议动作暂未返回，请稍后刷新或打开 Verify Monitor。']
    ];

    panelStates.forEach(([containerId, iconClass, panelMessage]) => {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = renderHintState(iconClass, fallbackMessage || panelMessage, 'error');
        }
    });
}

if (typeof window !== 'undefined') {
    window.renderVerifyServiceSummaryUnavailableState = renderVerifyServiceSummaryUnavailableState;
}

async function loadVerifyServiceSummary() {
    const statusContainer = document.getElementById('verifyStatusList');
    const recentContainer = document.getElementById('verifyRecentList');
    const failureContainer = document.getElementById('verifyFailureList');
    const recommendations = document.getElementById('verifyActionRecommendations');

    if (!statusContainer && !recentContainer && !failureContainer) return;

    try {
        const summary = await getVerifyServiceSummaryData();
        const metrics = summary.metrics || {};

        const requestsEl = document.getElementById('kpiVerifyRequestsValue');
        const successRateEl = document.getElementById('kpiVerifySuccessRateValue');
        const queueEl = document.getElementById('kpiVerifyQueueValue');
        const pointsEl = document.getElementById('kpiVerifyPointsValue');

        if (requestsEl) requestsEl.textContent = formatNumber(metrics.requestCount || 0);
        if (successRateEl) successRateEl.textContent = formatPercent(metrics.successRate || 0);
        if (queueEl) queueEl.textContent = formatNumber(metrics.activeCount || 0);
        if (pointsEl) pointsEl.textContent = formatNumber(metrics.totalPointsCost || 0);

        if (statusContainer) {
            statusContainer.innerHTML = renderAnalyticsCompactItems(summary.statusItems, {
                iconClass: 'fas fa-signal',
                message: '当前窗口暂无验证状态数据'
            });
        }

        if (recentContainer) {
            recentContainer.innerHTML = renderAnalyticsCompactItems(summary.recentItems, {
                iconClass: 'fas fa-list-check',
                message: '当前窗口暂无验证任务'
            });
        }

        if (failureContainer) {
            failureContainer.innerHTML = renderAnalyticsCompactItems(summary.focusItems, {
                iconClass: 'fas fa-triangle-exclamation',
                message: '当前窗口没有失败或阻塞任务'
            });
        }

        if (recommendations) {
            recommendations.innerHTML = renderAnalyticsRecommendationItems(summary.recommendations, {
                iconClass: 'fas fa-list-check',
                message: '当前窗口暂无建议动作'
            });
        }
    } catch (err) {
        console.error('[Analytics] Failed to load verify summary:', err);
        try {
            const [snapshot, summaryWindow] = await Promise.all([
                getAnalyticsVerifyMonitorSnapshotData({ forceRefresh: true }).catch(() => null),
                loadAnalyticsSummaryWindowFallbackData({ forceRefresh: true }).catch(() => ({}))
            ]);
            const fallbackSummary = buildVerifyServiceSummaryFallback({
                snapshot,
                summaryWindow
            });
            const metrics = fallbackSummary.metrics || {};

            const requestsEl = document.getElementById('kpiVerifyRequestsValue');
            const successRateEl = document.getElementById('kpiVerifySuccessRateValue');
            const queueEl = document.getElementById('kpiVerifyQueueValue');
            const pointsEl = document.getElementById('kpiVerifyPointsValue');

            if (requestsEl) requestsEl.textContent = formatNumber(metrics.requestCount || 0);
            if (successRateEl) successRateEl.textContent = formatPercent(metrics.successRate || 0);
            if (queueEl) queueEl.textContent = formatNumber(metrics.activeCount || 0);
            if (pointsEl) pointsEl.textContent = formatNumber(metrics.totalPointsCost || 0);

            if (statusContainer) {
                statusContainer.innerHTML = renderAnalyticsCompactItems(fallbackSummary.statusItems, {
                    iconClass: 'fas fa-signal',
                    message: '当前窗口暂无验证状态数据'
                });
            }
            if (recentContainer) {
                recentContainer.innerHTML = renderAnalyticsCompactItems(fallbackSummary.recentItems, {
                    iconClass: 'fas fa-list-check',
                    message: '当前窗口暂无验证任务'
                });
            }
            if (failureContainer) {
                failureContainer.innerHTML = renderAnalyticsCompactItems(fallbackSummary.focusItems, {
                    iconClass: 'fas fa-triangle-exclamation',
                    message: '当前窗口没有失败或阻塞任务'
                });
            }
            if (recommendations) {
                recommendations.innerHTML = renderAnalyticsRecommendationItems(fallbackSummary.recommendations, {
                    iconClass: 'fas fa-list-check',
                    message: '当前窗口暂无建议动作'
                });
            }
        } catch (fallbackErr) {
            console.error('[Analytics] Verify summary fallback failed:', fallbackErr);
            renderVerifyServiceSummaryUnavailableState('验证服务摘要加载失败，请稍后刷新或打开 Verify Monitor。');
        }
    }
}

async function getAnalyticsOpsAlertHealthData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'opsAlertHealthData',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl('settings/ops-alert-health');
            const payload = await fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
            if (typeof window.normalizeAdminWorkbenchOpsAlertHealthPayload === 'function') {
                return window.normalizeAdminWorkbenchOpsAlertHealthPayload(payload);
            }
            return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function renderAnalyticsOpsCockpitStatGrid(items = []) {
    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!safeItems.length) {
        return '';
    }

    return `
        <div class="analytics-ops-cockpit__stats">
            ${safeItems.map((item) => `
                <div class="analytics-ops-cockpit__stat analytics-ops-cockpit__stat--${escapeHtml(item.tone || 'neutral')}">
                    <span>${escapeHtml(item.label || '指标')}</span>
                    <strong>${escapeHtml(String(item.value ?? '0'))}</strong>
                    ${item.meta ? `<em>${escapeHtml(item.meta)}</em>` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsOpsCockpitSampleList(items = [], emptyMessage = '当前没有需要额外关注的异常样本') {
    const safeItems = (Array.isArray(items) ? items : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 4);
    if (!safeItems.length) {
        return `
            <div class="analytics-ops-cockpit__samples analytics-ops-cockpit__samples--empty">
                <span>${escapeHtml(emptyMessage)}</span>
            </div>
        `;
    }

    return `
        <div class="analytics-ops-cockpit__samples">
            ${safeItems.map((item) => `<span class="analytics-ops-cockpit__sample-pill">${escapeHtml(item)}</span>`).join('')}
        </div>
    `;
}

function renderAnalyticsOpsCockpitActionRow(actions = []) {
    const safeActions = Array.isArray(actions) ? actions.filter((item) => item && item.destination) : [];
    if (!safeActions.length) {
        return '';
    }

    return `
        <div class="analytics-ops-cockpit__actions">
            ${safeActions.map((action) => `
                <button
                    type="button"
                    class="btn-sm btn-secondary"
                    ${buildAnalyticsProductDestinationAttrs(action.destination, action.context)}
                >
                    <i class="${escapeHtml(action.icon || 'fas fa-arrow-right')}"></i> ${escapeHtml(action.label || '查看')}
                </button>
            `).join('')}
        </div>
    `;
}

function buildAnalyticsOpsDestinationContext(entityType = '', entityName = '', extra = {}) {
    const normalizedEntityType = String(entityType || '').trim().toLowerCase() || 'ops';
    const normalizedEntityName = String(entityName || '').trim() || '运营问题';
    const defaults = {
        feedbackScope: 'ops',
        feedbackEntityType: normalizedEntityType,
        feedbackEntityId: normalizedEntityType,
        feedbackEntityName: normalizedEntityName,
        referenceLabel: '运营保障',
        referenceValue: normalizedEntityName,
        queryLabel: normalizedEntityName
    };

    return {
        ...defaults,
        ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {})
    };
}

function getAnalyticsResolutionFeedbackEntriesForOps(options = {}) {
    if (typeof window.getAnalyticsResolutionFeedbackEntries !== 'function') {
        return [];
    }

    const entries = window.getAnalyticsResolutionFeedbackEntries({
        feedbackScope: 'ops'
    });
    return Array.isArray(entries) ? entries.slice(0, Math.max(1, Number(options?.limit) || 12)) : [];
}

function getAnalyticsOpsFeedbackEntityDefinition(entityType = '', state = {}) {
    const normalized = String(entityType || '').trim().toLowerCase();
    const definitions = {
        payments: {
            label: '支付问题',
            actions: [
                {
                    label: '看支付问题',
                    destination: 'payments-queue',
                    icon: 'fas fa-credit-card',
                    context: buildAnalyticsOpsDestinationContext('payments', '支付问题', {
                        mode: 'ops',
                        focusQueue: true
                    })
                }
            ]
        },
        tickets: {
            label: '售后工单',
            actions: [
                {
                    label: '看售后工单',
                    destination: 'tickets-pending',
                    icon: 'fas fa-headset',
                    context: buildAnalyticsOpsDestinationContext('tickets', '售后工单', {
                        mode: 'pending'
                    })
                }
            ]
        },
        fulfillment: {
            label: '履约处理',
            actions: [
                {
                    label: '去履约处理',
                    destination: 'shop-fulfillment',
                    icon: 'fas fa-truck-fast',
                    context: buildAnalyticsOpsDestinationContext('fulfillment', '履约处理', {
                        tab: 'fulfillment'
                    })
                }
            ]
        },
        verify: {
            label: '验证服务',
            actions: [
                {
                    label: '看验证服务',
                    destination: 'analytics-verify',
                    icon: 'fas fa-shield-halved',
                    context: buildAnalyticsOpsDestinationContext('verify', '验证服务', {
                        sectionId: 'verifyStatusList',
                        focusTargetId: 'verifyStatusList'
                    })
                }
            ]
        },
        alerts: {
            label: '站外告警',
            actions: [
                {
                    label: '看告警健康',
                    destination: 'ops-alerts-health',
                    icon: 'fas fa-tower-broadcast',
                    context: buildAnalyticsOpsDestinationContext('alerts', '站外告警', {
                        view: 'health'
                    })
                }
            ]
        }
    };

    const fallbackLabel = String(state?.eyebrow || state?.title || normalized || '运营问题').trim() || '运营问题';
    return definitions[normalized] || {
        label: fallbackLabel,
        actions: Array.isArray(state?.actions) ? state.actions.slice(0, 1) : []
    };
}

function buildAnalyticsOpsFeedbackEntityRows(entries = [], entityStates = {}) {
    const grouped = new Map();

    (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const entityType = String(entry?.entityType || entry?.module || '').trim().toLowerCase();
        if (!entityType) {
            return;
        }

        const key = String(entry?.entityId || entityType).trim() || entityType;
        const current = grouped.get(key) || {
            key,
            entityType,
            entityId: String(entry?.entityId || '').trim(),
            entityName: String(entry?.entityName || '').trim(),
            latestCreatedAt: 0,
            latestEntry: null,
            resolvedCount: 0,
            reviewCount: 0,
            abnormalCount: 0
        };

        const statusKey = String(entry?.statusKey || '').trim().toLowerCase();
        if (statusKey === 'abnormal') {
            current.abnormalCount += 1;
        } else if (statusKey === 'review') {
            current.reviewCount += 1;
        } else {
            current.resolvedCount += 1;
        }

        const createdAt = Number(entry?.createdAt || 0);
        if (!current.latestEntry || createdAt >= current.latestCreatedAt) {
            current.latestCreatedAt = createdAt;
            current.latestEntry = entry;
        }

        grouped.set(key, current);
    });

    return Array.from(grouped.values())
        .map((row) => {
            const state = entityStates?.[row.entityType] || {};
            const definition = getAnalyticsOpsFeedbackEntityDefinition(row.entityType, state);
            const currentTone = String(state?.tone || '').trim().toLowerCase();
            const tone = row.abnormalCount > 0
                ? 'danger'
                : (row.reviewCount > 0
                    ? 'warning'
                    : (currentTone === 'danger'
                        ? 'danger'
                        : ((currentTone === 'warning' || currentTone === 'accent') ? 'warning' : 'success')));
            const statusLabel = row.abnormalCount > 0
                ? '仍异常'
                : (row.reviewCount > 0 ? '待复查' : (tone === 'success' ? '已处理' : '待复查'));
            const latestSummary = String(row?.latestEntry?.summary || '').trim();

            return {
                ...row,
                label: definition.label,
                currentTone,
                tone,
                statusLabel,
                summary: latestSummary || String(state?.summary || '').trim() || `${definition.label} 最近已有新的处理回写。`,
                reason: String(state?.guidance?.reason || '').trim() || latestSummary || `${definition.label} 最近仍有需要继续确认的处理回写。`,
                nextStep: String(state?.guidance?.nextStep || '').trim() || '回到对应处理页继续核对问题是否已经收口。',
                verify: String(state?.guidance?.verify || '').trim() || '处理后回到运营保障驾驶舱，确认对应问题卡是否已经回落。',
                actions: Array.isArray(definition.actions) ? definition.actions : []
            };
        });
}

function buildAnalyticsOpsFeedbackReviewRows(entries = [], entityStates = {}) {
    return buildAnalyticsOpsFeedbackEntityRows(entries, entityStates)
        .sort((left, right) => {
            const leftScore = (left.abnormalCount * 3) + (left.reviewCount * 2) + (left.resolvedCount > 0 ? 1 : 0);
            const rightScore = (right.abnormalCount * 3) + (right.reviewCount * 2) + (right.resolvedCount > 0 ? 1 : 0);
            if (rightScore !== leftScore) {
                return rightScore - leftScore;
            }
            return Number(right.latestCreatedAt || 0) - Number(left.latestCreatedAt || 0);
        })
        .slice(0, 4);
}

function buildAnalyticsOpsFeedbackVerificationStatus(row = {}) {
    const latestStatusKey = String(row?.latestEntry?.statusKey || '').trim().toLowerCase();
    const entityLabel = String(row?.label || row?.entityName || '该问题').trim() || '该问题';
    const currentTone = String(row?.currentTone || '').trim().toLowerCase();
    const hasActiveIssue = currentTone === 'danger' || currentTone === 'warning' || currentTone === 'accent';

    if (!hasActiveIssue && Number(row?.abnormalCount || 0) <= 0 && Number(row?.reviewCount || 0) <= 0 && latestStatusKey !== 'abnormal' && latestStatusKey !== 'review') {
        return {
            key: 'passed',
            label: '验证已通过',
            tone: 'success',
            summary: `${entityLabel} 当前已经回落到平稳中，可做一次回看后结束本轮跟进。`
        };
    }

    if (!hasActiveIssue && (Number(row?.reviewCount || 0) > 0 || latestStatusKey === 'review')) {
        return {
            key: 'pending',
            label: '仍待验证',
            tone: 'warning',
            summary: `${entityLabel} 最近处理结果已经回落，但仍需要再做一次复查确认。`
        };
    }

    return {
        key: 'pending',
        label: '仍待验证',
        tone: Number(row?.abnormalCount || 0) > 0 || currentTone === 'danger' || latestStatusKey === 'abnormal' ? 'danger' : 'warning',
        summary: `${entityLabel} 当前仍处在${String(row?.statusLabel || '待复查').trim() || '待复查'}状态，这轮问题还没有真正收口。`
    };
}

function buildAnalyticsOpsFeedbackEvidence(row = {}, verificationState = null) {
    const latestEntry = row?.latestEntry || {};
    const statusLabel = String(latestEntry?.statusLabel || row?.statusLabel || verificationState?.label || '').trim();
    const actionLabel = String(latestEntry?.actionLabel || latestEntry?.title || '').trim();
    const referenceLabel = String(latestEntry?.referenceLabel || '').trim();
    const referenceValue = String(latestEntry?.referenceValue || '').trim();
    const currentSummary = String(row?.summary || '').trim();

    if (verificationState?.key === 'passed') {
        const handledSummary = [
            statusLabel || '已处理',
            actionLabel,
            [referenceLabel, referenceValue].filter(Boolean).join(' · ')
        ].filter(Boolean).join(' · ');
        return handledSummary
            ? `最近一次处理结果已回写为 ${handledSummary}，且当前运营问题卡已经回落到平稳中。`
            : '最近一次处理结果已回写为已处理，且当前运营问题卡已经回落到平稳中。';
    }

    if (currentSummary) {
        const latestSummary = [actionLabel ? `最近动作 ${actionLabel}` : '', currentSummary].filter(Boolean).join(' · ');
        return latestSummary;
    }

    const referenceSummary = [statusLabel, [referenceLabel, referenceValue].filter(Boolean).join(' · '), String(latestEntry?.summary || '').trim()]
        .filter(Boolean)
        .join(' · ');
    if (referenceSummary) {
        return referenceSummary;
    }

    const entityLabel = String(row?.label || row?.entityName || '该问题').trim() || '该问题';
    return `${entityLabel} 最近仍有需要继续确认的处理回写，建议回看最新运营信号。`;
}

function buildAnalyticsOpsFeedbackTimeline(row = {}, verificationState = null) {
    const latestEntry = row?.latestEntry || {};
    const latestCreatedAt = Number(row?.latestCreatedAt || latestEntry?.createdAt || 0);
    const latestActionLabel = String(latestEntry?.actionLabel || latestEntry?.title || latestEntry?.statusLabel || '').trim() || '最近处理';
    const latestReference = [String(latestEntry?.referenceLabel || '').trim(), String(latestEntry?.referenceValue || '').trim()]
        .filter(Boolean)
        .join(' · ');
    const items = [];

    if (latestCreatedAt > 0) {
        items.push({
            label: '最近处理',
            summary: `${formatAnalyticsResolutionFeedbackRelativeTime(latestCreatedAt)}执行“${latestActionLabel}”${latestReference ? `，参考 ${latestReference}` : ''}。`
        });
    }

    items.push({
        label: '当前验证',
        summary: verificationState?.summary || '当前仍需要继续验证这轮处理是否真正生效。'
    });

    items.push({
        label: '下一步复查',
        summary: String(row?.verify || '').trim() || '回到运营保障驾驶舱，确认对应问题卡是否已经回落。'
    });

    return items;
}

function buildAnalyticsOpsConclusionRecords(entries = [], entityStates = {}, options = {}) {
    const limit = Math.max(1, Number(options?.limit || 4) || 4);

    return buildAnalyticsOpsFeedbackEntityRows(entries, entityStates)
        .map((row) => {
            const verificationState = buildAnalyticsOpsFeedbackVerificationStatus(row);

            return {
                ...row,
                tone: verificationState.tone,
                statusLabel: verificationState.label,
                title: verificationState.key === 'passed' ? '本轮复查已通过' : '本轮仍待复查',
                summary: verificationState.key === 'passed'
                    ? `${row.label} 最近一轮处理已基本收口，当前更适合做一次回看确认。`
                    : `${row.label} 当前仍需要继续复查，建议先按推荐动作回到对应处理页继续核对。`,
                evidence: buildAnalyticsOpsFeedbackEvidence(row, verificationState),
                verificationMethod: String(row?.verify || '').trim() || '回到运营保障驾驶舱，确认对应问题卡是否已经回落。',
                timeline: buildAnalyticsOpsFeedbackTimeline(row, verificationState)
            };
        })
        .sort((left, right) => {
            const leftScore = left.statusLabel === '验证已通过' ? 0 : (left.tone === 'danger' ? 3 : 2);
            const rightScore = right.statusLabel === '验证已通过' ? 0 : (right.tone === 'danger' ? 3 : 2);
            if (rightScore !== leftScore) {
                return rightScore - leftScore;
            }
            return Number(right.latestCreatedAt || 0) - Number(left.latestCreatedAt || 0);
        })
        .slice(0, limit);
}

function renderAnalyticsOpsConclusionRecords(entries = [], entityStates = {}, options = {}) {
    const records = buildAnalyticsOpsConclusionRecords(entries, entityStates, options);
    if (!records.length) {
        return '';
    }

    return `
        <div class="analytics-writeback-conclusions">
            <div class="analytics-writeback-conclusions__head">
                <strong>复查结论记录</strong>
                <span>沉淀最近一轮运营保障复查结论，方便回看问题是否真正收口</span>
            </div>
            <div class="analytics-writeback-conclusions__list">
                ${records.map((record) => `
                    <div class="analytics-writeback-conclusion-card analytics-writeback-conclusion-card--${escapeHtml(record.tone || 'warning')}">
                        <div class="analytics-writeback-conclusion-card__top">
                            <div>
                                <div class="analytics-writeback-conclusion-card__title">${escapeHtml(record.title || '复查结论')}</div>
                                <div class="analytics-writeback-conclusion-card__product">${escapeHtml(record.label || '运营问题')}</div>
                            </div>
                            <span class="analytics-status-chip analytics-status-chip--${escapeHtml(record.tone || 'warning')}">${escapeHtml(record.statusLabel || '仍待验证')}</span>
                        </div>
                        <div class="analytics-writeback-conclusion-card__summary">${escapeHtml(record.summary || '')}</div>
                        <div class="analytics-writeback-conclusion-card__meta">
                            <span>最近回写 ${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(record.latestCreatedAt))}</span>
                        </div>
                        <div class="analytics-writeback-conclusion-card__evidence">
                            <span>最近一次验证依据</span>
                            <p>${escapeHtml(record.evidence || '请结合当前问题卡和最近处理回写继续复查。')}</p>
                        </div>
                        <div class="analytics-writeback-conclusion-card__next-step">
                            <span>下次复查建议</span>
                            <p>${escapeHtml(record.verificationMethod || '回到运营保障驾驶舱确认问题是否已经回落。')}</p>
                        </div>
                        <div class="analytics-writeback-conclusion-card__actions">
                            ${renderAnalyticsOpsCockpitActionRow(record.actions)}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function buildAnalyticsOpsFeedbackOverviewState(entries = [], entityStates = {}) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    return {
        entries: safeEntries,
        statusSummary: buildAnalyticsResolutionFeedbackStatusSummary(safeEntries),
        reviewRows: buildAnalyticsOpsFeedbackReviewRows(safeEntries, entityStates),
        entityStates
    };
}

function buildAnalyticsOpsEntityFeedbackDigest(entries = [], entityType = '', state = {}) {
    const normalizedEntityType = String(entityType || '').trim().toLowerCase();
    if (!normalizedEntityType) {
        return null;
    }

    const scopedEntries = (Array.isArray(entries) ? entries : []).filter((entry) => (
        String(entry?.entityType || entry?.module || '').trim().toLowerCase() === normalizedEntityType
    ));
    if (!scopedEntries.length) {
        return null;
    }

    const statusSummary = buildAnalyticsResolutionFeedbackStatusSummary(scopedEntries);
    const latestEntry = scopedEntries[0] || null;
    const row = buildAnalyticsOpsFeedbackEntityRows(scopedEntries, {
        [normalizedEntityType]: state
    })[0] || {};
    const verificationState = buildAnalyticsOpsFeedbackVerificationStatus(row);
    const latestSummary = String(row?.summary || latestEntry?.summary || '').trim();
    const stateSummary = String(state?.summary || '').trim();
    const timeline = buildAnalyticsOpsFeedbackTimeline(row, verificationState);

    return {
        tone: verificationState.tone,
        label: verificationState.label,
        summary: latestSummary || stateSummary || `${String(state?.eyebrow || state?.title || '当前问题').trim()} 最近已有新的处理回写。`,
        meta: `最近回写 ${formatAnalyticsResolutionFeedbackRelativeTime(latestEntry?.createdAt)}`,
        statusSummary,
        verificationState,
        evidence: buildAnalyticsOpsFeedbackEvidence(row, verificationState),
        timeline
    };
}

function renderAnalyticsOpsFeedbackSummary(feedback = {}) {
    const entries = Array.isArray(feedback?.entries) ? feedback.entries : [];
    if (!entries.length) {
        return '';
    }

    const statusSummary = feedback?.statusSummary || buildAnalyticsResolutionFeedbackStatusSummary(entries);
    const reviewRows = Array.isArray(feedback?.reviewRows) ? feedback.reviewRows : [];
    const conclusionRecordsMarkup = renderAnalyticsOpsConclusionRecords(entries, feedback?.entityStates || {}, { limit: 4 });

    return `
        <div class="analytics-writeback-note analytics-writeback-note--ops">
            <div class="analytics-writeback-note__head">
                <strong>最近处理回写</strong>
                <span>支付 / 售后 / 履约处理结果会回传到运营保障驾驶舱</span>
            </div>
            <div class="analytics-writeback-summary">
                <span class="analytics-status-chip analytics-status-chip--success">已处理 ${escapeHtml(formatNumber(statusSummary.resolved || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--warning">待复查 ${escapeHtml(formatNumber(statusSummary.review || 0))}</span>
                <span class="analytics-status-chip analytics-status-chip--danger">仍异常 ${escapeHtml(formatNumber(statusSummary.abnormal || 0))}</span>
            </div>
            ${reviewRows.length ? `
                <div class="analytics-writeback-priority">
                    <div class="analytics-writeback-priority__head">
                        <strong>最该复查的问题</strong>
                        <span>仍异常优先，其次是待复查；帮助你先回到最需要继续盯的支付、售后或履约问题。</span>
                    </div>
                    <div class="analytics-ops-cockpit__issue-grid">
                        ${reviewRows.map((row, index) => `
                            <article class="analytics-ops-cockpit__issue-card analytics-ops-cockpit__issue-card--${escapeHtml(row.tone || 'warning')}">
                                <div class="analytics-ops-cockpit__issue-top">
                                    <div>
                                        <span class="analytics-ops-cockpit__issue-rank">TOP ${index + 1}</span>
                                        <strong class="analytics-ops-cockpit__issue-title">${escapeHtml(row.label || '运营问题')}</strong>
                                    </div>
                                    <div class="analytics-ops-cockpit__feedback-status">
                                        <span class="analytics-status-chip analytics-status-chip--${escapeHtml(row.tone || 'warning')}">${escapeHtml(row.statusLabel || '待复查')}</span>
                                        <span class="analytics-ops-cockpit__issue-metric">最近回写 ${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(row.latestCreatedAt))}</span>
                                    </div>
                                </div>
                                <p class="analytics-ops-cockpit__issue-copy"><span>当前判断</span>${escapeHtml(row.summary || '')}</p>
                                ${renderAnalyticsOpsCockpitActionRow(row.actions)}
                            </article>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            ${conclusionRecordsMarkup}
            <div class="analytics-writeback-list">
                ${entries.slice(0, 6).map((entry) => `
                    <div class="analytics-writeback-item">
                        <div class="analytics-writeback-item__top">
                            <div class="analytics-writeback-item__chips">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.module === 'tickets' ? 'warning' : (entry?.module === 'shop-orders' ? 'accent' : 'neutral'))}">${escapeHtml(entry?.entityName || entry?.referenceValue || entry?.referenceLabel || '运营问题')}</span>
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(entry?.tone || 'accent')}">${escapeHtml(entry?.statusLabel || '已处理')}</span>
                            </div>
                            <span class="analytics-writeback-item__time">${escapeHtml(formatAnalyticsResolutionFeedbackRelativeTime(entry?.createdAt))}</span>
                        </div>
                        <div class="analytics-writeback-item__title">${escapeHtml(entry?.title || '处理已回写')}</div>
                        <div class="analytics-writeback-item__summary">${escapeHtml(entry?.summary || '')}</div>
                        <div class="analytics-writeback-item__meta">
                            ${entry?.actionLabel ? `<span>${escapeHtml(entry.actionLabel)}</span>` : ''}
                            ${entry?.referenceLabel || entry?.referenceValue ? `<span>${escapeHtml([entry.referenceLabel, entry.referenceValue].filter(Boolean).join(' · '))}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderAnalyticsOpsEntityFeedbackDigest(digest = null) {
    if (!digest || typeof digest !== 'object') {
        return '';
    }

    const statusSummary = digest?.statusSummary || {};
    const verificationState = digest?.verificationState || {
        tone: digest?.tone || 'warning',
        label: digest?.label || '仍待验证',
        summary: digest?.summary || '请继续回看当前信号。'
    };
    const timeline = Array.isArray(digest?.timeline) ? digest.timeline : [];
    return `
        <div class="analytics-ops-cockpit__feedback-digest analytics-ops-cockpit__feedback-digest--${escapeHtml(digest.tone || 'accent')}">
            <div class="analytics-ops-cockpit__feedback-digest-top">
                <strong>最近处理回写</strong>
                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(digest.tone || 'accent')}">${escapeHtml(digest.label || '已处理')}</span>
            </div>
            <p>${escapeHtml(digest.summary || '')}</p>
            <div class="analytics-writeback-priority__verification analytics-writeback-priority__verification--${escapeHtml(verificationState.tone || 'warning')}">
                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(verificationState.tone || 'warning')}">${escapeHtml(verificationState.label || '仍待验证')}</span>
                <p>${escapeHtml(verificationState.summary || '请继续回看当前信号。')}</p>
            </div>
            <div class="analytics-writeback-priority__evidence">
                <span>最近一次验证依据</span>
                <p>${escapeHtml(digest.evidence || digest.summary || '请结合最近处理回写继续复查。')}</p>
            </div>
            ${timeline.length ? `
                <div class="analytics-writeback-priority__timeline">
                    <span class="analytics-writeback-priority__timeline-title">处理时间线</span>
                    ${timeline.map((item) => `
                        <div class="analytics-writeback-priority__timeline-item">
                            <strong>${escapeHtml(item?.label || '复查')}</strong>
                            <p>${escapeHtml(item?.summary || '')}</p>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            <div class="analytics-ops-cockpit__feedback-digest-meta">
                <span>${escapeHtml(digest.meta || '最近已有新的处理回写')}</span>
                <span>已处理 ${escapeHtml(formatNumber(statusSummary.resolved || 0))} / 待复查 ${escapeHtml(formatNumber(statusSummary.review || 0))} / 仍异常 ${escapeHtml(formatNumber(statusSummary.abnormal || 0))}</span>
            </div>
        </div>
    `;
}

function renderAnalyticsOpsCockpitGuidance(guidance = null) {
    return '';
}

function renderAnalyticsOpsCockpitIssueGrid(items = []) {
    const safeItems = Array.isArray(items) ? items.filter(Boolean).slice(0, 4) : [];
    if (!safeItems.length) {
        return '';
    }

    return `
        <div class="analytics-ops-cockpit__issue-grid">
            ${safeItems.map((item, index) => `
                <article class="analytics-ops-cockpit__issue-card analytics-ops-cockpit__issue-card--${escapeHtml(item.tone || 'neutral')}">
                    <div class="analytics-ops-cockpit__issue-top">
                        <div>
                            <span class="analytics-ops-cockpit__issue-rank">TOP ${index + 1}</span>
                            <strong class="analytics-ops-cockpit__issue-title">${escapeHtml(item.title || '优先问题')}</strong>
                        </div>
                        ${item.metric ? `<span class="analytics-ops-cockpit__issue-metric">${escapeHtml(item.metric)}</span>` : ''}
                    </div>
                    ${renderAnalyticsOpsCockpitActionRow(item.actions)}
                </article>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsOpsCockpitCard(state = {}, options = {}) {
    if (!state || typeof state !== 'object' || state.errorMessage) {
        return renderHintState(
            options.iconClass || 'fas fa-shield-halved',
            state?.errorMessage || options.errorMessage || '运营保障摘要加载失败',
            state?.errorMessage ? 'error' : ''
        );
    }

    return `
        <div class="analytics-ops-cockpit__panel analytics-ops-cockpit__panel--${escapeHtml(state.tone || 'neutral')}">
            <div class="analytics-ops-cockpit__panel-top">
                <div>
                    <div class="analytics-ops-cockpit__eyebrow">${escapeHtml(state.eyebrow || '运营保障')}</div>
                    <strong class="analytics-ops-cockpit__title">${escapeHtml(state.title || '运营保障')}</strong>
                </div>
                ${renderAnalyticsNavigatorStatus(state.statusLabel || '观察中', state.tone || 'neutral')}
            </div>
            <p class="analytics-ops-cockpit__summary">${escapeHtml(state.summary || '')}</p>
            ${renderAnalyticsOpsCockpitStatGrid(state.stats)}
            ${renderAnalyticsOpsCockpitSampleList(state.samples, state.emptySampleMessage)}
            ${renderAnalyticsOpsEntityFeedbackDigest(state.feedbackDigest)}
            ${renderAnalyticsOpsCockpitGuidance(state.guidance)}
            ${renderAnalyticsOpsCockpitActionRow(state.actions)}
        </div>
    `;
}

function buildAnalyticsOpsPriorityIssues({
    operationsHealthSnapshot = null,
    verifySummary = null,
    productSummary = {},
    productHealthPayloads = {},
    opsAlertHealth = {}
} = {}) {
    const issues = [];
    const opsMetrics = operationsHealthSnapshot?.metrics && typeof operationsHealthSnapshot.metrics === 'object'
        ? operationsHealthSnapshot.metrics
        : {};
    const verifyMetrics = verifySummary?.metrics && typeof verifySummary.metrics === 'object'
        ? verifySummary.metrics
        : {};
    const alertSummary = opsAlertHealth?.summary && typeof opsAlertHealth.summary === 'object'
        ? opsAlertHealth.summary
        : {};

    const paymentDeadLetters = normalizeAnalyticsCountValue(opsMetrics.paymentDeadLetterCount);
    const paymentAlerts = normalizeAnalyticsCountValue(opsMetrics.paymentAlertTotal);
    const paymentRetries = normalizeAnalyticsCountValue(opsMetrics.paymentRetryCount);
    const ticketCritical = normalizeAnalyticsCountValue(opsMetrics.ticketCriticalOverdueCount);
    const ticketPending = normalizeAnalyticsCountValue(opsMetrics.ticketPendingCount);
    const verifyFailed = normalizeAnalyticsCountValue(verifyMetrics.failedCount);
    const deliveryRiskCount = normalizeAnalyticsCountValue(productSummary?.delivery_risk_count);
    const refundedOrderCount = normalizeAnalyticsCountValue(productSummary?.refunded_order_count);
    const soldOutCount = Array.isArray(productHealthPayloads?.soldOutProducts) ? productHealthPayloads.soldOutProducts.length : 0;
    const lowStockCount = Array.isArray(productHealthPayloads?.lowStockProducts) ? productHealthPayloads.lowStockProducts.length : 0;
    const alertFailedCount = normalizeAnalyticsCountValue(alertSummary.failed_count);
    const alertDeadLetterCount = normalizeAnalyticsCountValue(alertSummary.dead_letter_count);

    if (paymentDeadLetters > 0) {
        issues.push({
            tone: 'danger',
            title: '支付死信仍在堆积',
            metric: `死信 ${formatNumber(paymentDeadLetters)}`,
            reason: '支付死信会直接卡住下游承接，继续放着会让退款、认领和对账问题一起积累。',
            nextStep: '先打开支付问题列表，优先处理死信和失败样本，再看待重试是否跟着下降。',
            verify: '支付死信归零，支付告警和待重试同步回落。',
            actions: [
                {
                    label: '看支付问题',
                    destination: 'payments-queue',
                    icon: 'fas fa-credit-card',
                    context: buildAnalyticsOpsDestinationContext('payments', '支付死信', {
                        mode: 'ops',
                        focusQueue: true,
                        feedbackEntityId: 'payments-dead-letter'
                    })
                }
            ]
        });
    }

    if (ticketCritical > 0) {
        issues.push({
            tone: 'danger',
            title: '售后 critical 工单待消化',
            metric: `critical ${formatNumber(ticketCritical)}`,
            reason: '高优和超时工单会直接放大退款、履约和用户体验问题，优先级高于普通积压。',
            nextStep: '先回售后工单队列处理高优和超时，再复查是否仍有新 critical 继续冒头。',
            verify: 'critical 和超时工单下降，最老等待时长回落。',
            actions: [
                {
                    label: '看售后工单',
                    destination: 'tickets-pending',
                    icon: 'fas fa-headset',
                    context: buildAnalyticsOpsDestinationContext('tickets', 'critical 工单', {
                        mode: 'pending',
                        feedbackEntityId: 'tickets-critical'
                    })
                }
            ]
        });
    }

    if (deliveryRiskCount > 0 || soldOutCount > 0) {
        issues.push({
            tone: deliveryRiskCount > 0 ? 'warning' : 'accent',
            title: deliveryRiskCount > 0 ? '履约风险仍在影响承接' : '售罄已开始影响承接',
            metric: deliveryRiskCount > 0
                ? `履约风险 ${formatNumber(deliveryRiskCount)}`
                : `售罄 ${formatNumber(soldOutCount)}`,
            reason: deliveryRiskCount > 0
                ? '履约异常会把成交直接拖成售后和投诉问题，需要先把承接链修通。'
                : '售罄会让有意图的流量直接流失，继续放量意义不大。',
            nextStep: deliveryRiskCount > 0
                ? '先去履约处理，看死信、待重试和待履约问题，再补库存或改发货策略。'
                : '先去库存管理补货或收缩入口，再观察低库存商品是否继续扩散。',
            verify: deliveryRiskCount > 0
                ? '履约风险和退款风险下降，待履约/死信样本回落。'
                : '售罄商品减少，低库存没有继续扩大。',
            actions: [
                {
                    label: deliveryRiskCount > 0 ? '去履约处理' : '去库存管理',
                    destination: deliveryRiskCount > 0 ? 'shop-fulfillment' : 'shop-inventory',
                    icon: deliveryRiskCount > 0 ? 'fas fa-truck-fast' : 'fas fa-warehouse',
                    context: buildAnalyticsOpsDestinationContext('fulfillment', deliveryRiskCount > 0 ? '履约风险' : '库存风险', {
                        tab: deliveryRiskCount > 0 ? 'fulfillment' : 'inventory',
                        feedbackEntityId: deliveryRiskCount > 0 ? 'fulfillment-delivery-risk' : 'fulfillment-stock-risk'
                    })
                }
            ]
        });
    }

    if (verifyFailed > 0) {
        issues.push({
            tone: 'warning',
            title: '验证失败仍需复核',
            metric: `失败 ${formatNumber(verifyFailed)}`,
            reason: '验证失败会直接影响关键服务承接，放着不管会让问题不断重复出现。',
            nextStep: '先看验证服务失败样本和活跃任务，确认是额度、调用失败还是卡在队列。',
            verify: '失败数回落，活跃任务和完成率恢复。',
            actions: [
                {
                    label: '看验证服务',
                    destination: 'analytics-verify',
                    icon: 'fas fa-shield-halved',
                    context: buildAnalyticsOpsDestinationContext('verify', '验证失败', {
                        sectionId: 'verifyFailureList',
                        focusTargetId: 'verifyFailureList',
                        feedbackEntityId: 'verify-failures'
                    })
                }
            ]
        });
    }

    if (alertDeadLetterCount > 0 || alertFailedCount > 0) {
        issues.push({
            tone: alertDeadLetterCount > 0 ? 'danger' : 'warning',
            title: '站外告警通道仍有失败投递',
            metric: `失败 ${formatNumber(alertFailedCount)} / 死信 ${formatNumber(alertDeadLetterCount)}`,
            reason: '告警通道失败会让真正的异常缺少通知承接，等于把发现问题这一步也一起失效。',
            nextStep: '先看告警健康和工作区，确认是通道配置、限流还是单一告警异常。',
            verify: '失败和死信下降，投递送达率恢复。',
            actions: [
                {
                    label: '看告警健康',
                    destination: 'ops-alerts-health',
                    icon: 'fas fa-tower-broadcast',
                    context: buildAnalyticsOpsDestinationContext('alerts', '站外告警死信', {
                        view: 'health',
                        feedbackEntityId: 'alerts-dead-letter'
                    })
                }
            ]
        });
    }

    if (!issues.length && (ticketPending > 0 || paymentAlerts > 0 || paymentRetries > 0 || refundedOrderCount > 0 || lowStockCount > 0)) {
        issues.push({
            tone: 'accent',
            title: '当前更适合按巡检节奏继续复核',
            metric: `工单 ${formatNumber(ticketPending)} / 告警 ${formatNumber(paymentAlerts)}`,
            reason: '目前没有必须立刻打断经营节奏的红色异常，但仍有支付、工单、库存或退款信号在持续出现。',
            nextStep: '按支付、工单、库存与退款风险顺序做常规复核，避免问题继续扩大。',
            verify: '待处理工单、支付告警、低库存和退款风险继续维持在低位。',
            actions: [
                {
                    label: '看运营总览',
                    destination: 'analytics-ops',
                    icon: 'fas fa-satellite-dish',
                    context: buildAnalyticsOpsDestinationContext('ops', '运营保障总览', {
                        sectionId: 'opsCockpitOverviewSection',
                        focusTargetId: 'opsCockpitOverviewSection',
                        feedbackEntityId: 'ops-overview'
                    })
                }
            ]
        });
    }

    return issues.slice(0, 4);
}

function buildAnalyticsOpsCockpitOverviewState({
    operationsHealthSnapshot = null,
    verifySummary = null,
    productSummary = {},
    productHealthPayloads = {},
    opsAlertHealth = {}
} = {}) {
    const opsMetrics = operationsHealthSnapshot?.metrics && typeof operationsHealthSnapshot.metrics === 'object'
        ? operationsHealthSnapshot.metrics
        : {};
    const verifyMetrics = verifySummary?.metrics && typeof verifySummary.metrics === 'object'
        ? verifySummary.metrics
        : {};
    const alertSummary = opsAlertHealth?.summary && typeof opsAlertHealth.summary === 'object'
        ? opsAlertHealth.summary
        : {};
    const verifyUnavailableMessage = String(verifySummary?.unavailableMessage || '').trim();
    const alertsUnavailableMessage = String(opsAlertHealth?.unavailableMessage || '').trim();

    const paymentAlerts = normalizeAnalyticsCountValue(opsMetrics.paymentAlertTotal);
    const paymentDeadLetters = normalizeAnalyticsCountValue(opsMetrics.paymentDeadLetterCount);
    const ticketPending = normalizeAnalyticsCountValue(opsMetrics.ticketPendingCount);
    const ticketCritical = normalizeAnalyticsCountValue(opsMetrics.ticketCriticalOverdueCount);
    const verifyFailed = normalizeAnalyticsCountValue(verifyMetrics.failedCount);
    const verifyActive = normalizeAnalyticsCountValue(verifyMetrics.activeCount);
    const deliveryRiskCount = normalizeAnalyticsCountValue(productSummary?.delivery_risk_count);
    const refundedOrderCount = normalizeAnalyticsCountValue(productSummary?.refunded_order_count);
    const lowStockCount = Array.isArray(productHealthPayloads?.lowStockProducts) ? productHealthPayloads.lowStockProducts.length : 0;
    const soldOutCount = Array.isArray(productHealthPayloads?.soldOutProducts) ? productHealthPayloads.soldOutProducts.length : 0;
    const alertFailedCount = normalizeAnalyticsCountValue(alertSummary.failed_count);
    const alertDeadLetterCount = normalizeAnalyticsCountValue(alertSummary.dead_letter_count);
    const enabledChannelCount = normalizeAnalyticsCountValue(alertSummary.enabled_channel_count);
    const attemptCount = normalizeAnalyticsCountValue(alertSummary.total_attempt_count);
    const deliveredCount = normalizeAnalyticsCountValue(alertSummary.delivered_count);
    const deliveryRate = attemptCount > 0 ? (roundTo((deliveredCount / attemptCount) * 100, 2) || 0) : 0;

    let tone = 'success';
    let statusLabel = '平稳中';
    let title = '运营保障当前没有明显堆积';
    let summary = '支付、售后、履约、验证和站外告警当前都没有出现需要优先处理的明显堆积。';

    if (paymentDeadLetters > 0 || ticketCritical > 0 || alertDeadLetterCount > 0) {
        tone = 'danger';
        statusLabel = '待处理';
        title = '运营保障里已有需要立刻处理的异常';
        summary = `当前支付死信 ${formatNumber(paymentDeadLetters)}、critical 工单 ${formatNumber(ticketCritical)}、站外告警死信 ${formatNumber(alertDeadLetterCount)}，建议优先回到处理页逐项消化。`;
    } else if (paymentAlerts > 0 || ticketPending > 0 || verifyFailed > 0 || deliveryRiskCount > 0 || alertFailedCount > 0 || soldOutCount > 0) {
        tone = 'warning';
        statusLabel = '待复核';
        title = '运营保障仍在影响经营承接';
        summary = `当前支付告警 ${formatNumber(paymentAlerts)}、待处理工单 ${formatNumber(ticketPending)}、验证失败 ${formatNumber(verifyFailed)}、履约风险 ${formatNumber(deliveryRiskCount)}，建议先看对应问题列表。`;
    } else if (verifyActive > 0 || lowStockCount > 0 || refundedOrderCount > 0) {
        tone = 'accent';
        statusLabel = '巡检中';
        title = '运营保障当前更适合按巡检节奏继续观察';
        summary = `当前活跃验证 ${formatNumber(verifyActive)}、低库存商品 ${formatNumber(lowStockCount)}、退款 ${formatNumber(refundedOrderCount)} 单，可继续沿验证、库存和售后链路复核。`;
    }

    const unavailableNotes = [
        verifyUnavailableMessage ? '验证服务数据暂未返回' : '',
        alertsUnavailableMessage ? '站外告警数据暂未返回' : ''
    ].filter(Boolean);
    if (unavailableNotes.length > 0) {
        if (tone === 'success') {
            tone = 'accent';
        }
        if (statusLabel === '平稳中') {
            statusLabel = '部分可用';
        }
        summary = [summary, unavailableNotes.join('；')].filter(Boolean).join(' ');
    }

    return {
        tone,
        statusLabel,
        title,
        summary,
        priorityIssues: buildAnalyticsOpsPriorityIssues({
            operationsHealthSnapshot,
            verifySummary,
            productSummary,
            productHealthPayloads,
            opsAlertHealth
        }),
        stats: [
            { label: '支付告警', value: formatNumber(paymentAlerts), tone: paymentDeadLetters > 0 ? 'danger' : (paymentAlerts > 0 ? 'warning' : 'neutral'), meta: `死信 ${formatNumber(paymentDeadLetters)}` },
            { label: '待处理工单', value: formatNumber(ticketPending), tone: ticketCritical > 0 ? 'danger' : (ticketPending > 0 ? 'warning' : 'neutral'), meta: `critical ${formatNumber(ticketCritical)}` },
            { label: '履约风险', value: formatNumber(deliveryRiskCount), tone: deliveryRiskCount > 0 ? 'warning' : 'neutral', meta: `退款 ${formatNumber(refundedOrderCount)}` },
            {
                label: '验证失败',
                value: verifyUnavailableMessage ? '—' : formatNumber(verifyFailed),
                tone: verifyUnavailableMessage ? 'neutral' : (verifyFailed > 0 ? 'warning' : 'neutral'),
                meta: verifyUnavailableMessage ? '暂未返回' : `活跃 ${formatNumber(verifyActive)}`
            },
            {
                label: '告警通道',
                value: alertsUnavailableMessage ? '—' : formatNumber(enabledChannelCount),
                tone: alertsUnavailableMessage ? 'neutral' : (alertDeadLetterCount > 0 || alertFailedCount > 0 ? 'warning' : 'success'),
                meta: alertsUnavailableMessage ? '暂未返回' : (attemptCount > 0 ? `送达 ${formatPercent(deliveryRate)}` : '暂无投递')
            }
        ],
        samples: [
            paymentDeadLetters > 0 ? `支付死信 ${formatNumber(paymentDeadLetters)} 条` : '',
            ticketCritical > 0 ? `critical 工单 ${formatNumber(ticketCritical)} 单` : '',
            deliveryRiskCount > 0 ? `履约风险 ${formatNumber(deliveryRiskCount)} 单` : '',
            verifyFailed > 0 ? `验证失败 ${formatNumber(verifyFailed)} 次` : '',
            alertFailedCount > 0 || alertDeadLetterCount > 0 ? `站外告警失败 ${formatNumber(alertFailedCount)} / 死信 ${formatNumber(alertDeadLetterCount)}` : ''
        ],
        actions: [
            {
                label: '看支付问题',
                destination: 'payments-overview',
                icon: 'fas fa-credit-card',
                context: buildAnalyticsOpsDestinationContext('payments', '支付问题', {
                    mode: 'overview'
                })
            },
            {
                label: '看售后工单',
                destination: 'tickets-pending',
                icon: 'fas fa-headset',
                context: buildAnalyticsOpsDestinationContext('tickets', '售后工单', {
                    mode: 'pending'
                })
            },
            {
                label: '去履约处理',
                destination: 'shop-fulfillment',
                icon: 'fas fa-truck-fast',
                context: buildAnalyticsOpsDestinationContext('fulfillment', '履约处理', {
                    tab: 'fulfillment'
                })
            },
            {
                label: '看站外告警',
                destination: 'ops-alerts-health',
                icon: 'fas fa-tower-broadcast',
                context: buildAnalyticsOpsDestinationContext('alerts', '站外告警', {
                    view: 'health'
                })
            }
        ]
    };
}

function buildAnalyticsOpsPaymentsState(snapshot = null) {
    const summary = snapshot?.payments?.summary && typeof snapshot.payments.summary === 'object'
        ? snapshot.payments.summary
        : {};
    const focusAlert = snapshot?.payments?.focusAlert || null;
    const paymentAlerts = normalizeAnalyticsCountValue(summary.alertTotal);
    const deadLetters = normalizeAnalyticsCountValue(summary.deadLetterCount);
    const retries = normalizeAnalyticsCountValue(summary.retryCount);
    const anomalies = normalizeAnalyticsCountValue(summary.anomalyCount);
    const topics = normalizeAnalyticsCountValue(summary.exceptionTopicCount);

    const tone = deadLetters > 0 ? 'danger' : (paymentAlerts > 0 || retries > 0 ? 'warning' : 'success');
    const statusLabel = deadLetters > 0 ? '待处理' : (paymentAlerts > 0 ? '待复核' : '平稳中');
    const title = deadLetters > 0
        ? '支付死信仍需优先处理'
        : (paymentAlerts > 0 ? '支付告警仍在影响承接' : '支付承接当前平稳');
    const summaryText = focusAlert?.message
        || focusAlert?.title
        || (paymentAlerts > 0
            ? `当前支付告警 ${formatNumber(paymentAlerts)}，待重试 ${formatNumber(retries)}，建议直接回到支付问题列表继续处理。`
            : '当前支付告警、死信和待重试都处在较低水平。');

    return {
        tone,
        statusLabel,
        eyebrow: '支付问题',
        title,
        summary: summaryText,
        guidance: {
            tone,
            reason: deadLetters > 0
                ? '支付死信会直接卡住支付承接，优先级高于普通支付告警。'
                : (paymentAlerts > 0 ? '支付告警和待重试仍在影响承接，继续放着会把问题带到退款和售后。': '当前更适合维持巡检频率，确认支付问题没有重新抬头。'),
            nextStep: deadLetters > 0
                ? '先打开支付问题列表处理死信，再复查待重试和失败专题。'
                : (paymentAlerts > 0 ? '先回支付问题列表看告警、失败样本和待重试，再确认异常专题是否收敛。': '继续按概览和专题巡检支付问题即可。'),
            verify: deadLetters > 0
                ? '支付死信归零，待重试和异常专题数量同步下降。'
                : (paymentAlerts > 0 ? '支付告警、待重试和异常专题继续回落。': '支付告警维持低位，没有新的死信样本出现。')
        },
        stats: [
            { label: '告警', value: formatNumber(paymentAlerts), tone: paymentAlerts > 0 ? 'warning' : 'neutral' },
            { label: '死信', value: formatNumber(deadLetters), tone: deadLetters > 0 ? 'danger' : 'neutral' },
            { label: '待重试', value: formatNumber(retries), tone: retries > 0 ? 'warning' : 'neutral' },
            { label: '异常样本', value: formatNumber(anomalies), tone: anomalies > 0 ? 'accent' : 'neutral', meta: `专题 ${formatNumber(topics)}` }
        ],
        samples: Array.isArray(snapshot?.samples?.paymentAlerts) ? snapshot.samples.paymentAlerts : [],
        emptySampleMessage: '当前窗口没有额外的支付异常样本。',
        actions: [
            {
                label: '看支付问题',
                destination: 'payments-queue',
                icon: 'fas fa-tower-broadcast',
                context: buildAnalyticsOpsDestinationContext('payments', '支付问题', {
                    mode: 'ops',
                    focusQueue: true
                })
            },
            {
                label: '看支付概览',
                destination: 'payments-overview',
                icon: 'fas fa-credit-card',
                context: buildAnalyticsOpsDestinationContext('payments', '支付概览', {
                    mode: 'overview'
                })
            }
        ]
    };
}

function buildAnalyticsOpsTicketsState(snapshot = null) {
    const backlog = snapshot?.tickets?.backlog && typeof snapshot.tickets.backlog === 'object'
        ? snapshot.tickets.backlog
        : {};
    const pending = normalizeAnalyticsCountValue(backlog.pendingCount);
    const overdue = normalizeAnalyticsCountValue(backlog.overdueCount);
    const critical = normalizeAnalyticsCountValue(backlog.criticalOverdueCount);
    const oldestWaitMinutes = normalizeAnalyticsCountValue(backlog.oldestWaitMinutes);
    const retryCount = normalizeAnalyticsCountValue(backlog.reminderRetryCount);
    const deadLetterCount = normalizeAnalyticsCountValue(backlog.reminderDeadLetterCount);

    const tone = critical > 0 ? 'danger' : (pending > 0 || overdue > 0 ? 'warning' : 'success');
    const statusLabel = critical > 0 ? '待处理' : (pending > 0 ? '待复核' : '平稳中');
    const title = critical > 0
        ? '售后高优和超时工单仍在堆积'
        : (pending > 0 ? '售后工单仍需继续收口' : '售后工单当前平稳');
    const summary = critical > 0 || pending > 0
        ? `当前待处理工单 ${formatNumber(pending)}，超时 ${formatNumber(overdue)}，critical ${formatNumber(critical)}，建议优先回到工单队列继续处理。`
        : '当前待处理、超时和 high priority 工单都处在较低水平。';

    return {
        tone,
        statusLabel,
        eyebrow: '售后工单',
        title,
        summary,
        guidance: {
            tone,
            reason: critical > 0
                ? 'critical 和超时工单会直接影响退款、履约和用户体验，优先级最高。'
                : (pending > 0 ? '待处理工单仍在堆积，如果不继续清理会拖慢后面的售后承接。': '当前工单队列更适合维持巡检频率。'),
            nextStep: critical > 0
                ? '先回售后工单队列处理 critical 和超时，再看普通待处理是否继续下降。'
                : (pending > 0 ? '继续在售后工单队列按待处理、超时和类别逐步收口。': '维持工单巡检和问题摘要观察即可。'),
            verify: critical > 0
                ? 'critical、超时和最老等待时长同步回落。'
                : (pending > 0 ? '待处理工单下降，提醒重试和死信没有继续抬升。': '工单积压保持低位。')
        },
        stats: [
            { label: '待处理', value: formatNumber(pending), tone: pending > 0 ? 'warning' : 'neutral' },
            { label: '超时', value: formatNumber(overdue), tone: overdue > 0 ? 'warning' : 'neutral' },
            { label: 'critical', value: formatNumber(critical), tone: critical > 0 ? 'danger' : 'neutral' },
            { label: '最老等待', value: oldestWaitMinutes > 0 ? formatAnalyticsMinutesWindow(oldestWaitMinutes) : '—', tone: oldestWaitMinutes > 0 ? 'accent' : 'neutral', meta: `提醒重试 ${formatNumber(retryCount)} / 死信 ${formatNumber(deadLetterCount)}` }
        ],
        samples: Array.isArray(snapshot?.samples?.ticketIssues) ? snapshot.samples.ticketIssues : [],
        emptySampleMessage: '当前窗口没有额外的工单异常样本。',
        actions: [
            {
                label: '看售后工单',
                destination: 'tickets-pending',
                icon: 'fas fa-headset',
                context: buildAnalyticsOpsDestinationContext('tickets', '售后工单', {
                    mode: 'pending'
                })
            },
            {
                label: '看问题摘要',
                destination: 'tickets-overview',
                icon: 'fas fa-clipboard-list',
                context: buildAnalyticsOpsDestinationContext('tickets', '工单概览', {
                    mode: 'overview'
                })
            }
        ]
    };
}

function buildAnalyticsOpsFulfillmentState(productSummary = {}, productHealthPayloads = {}) {
    const lowStockProducts = Array.isArray(productHealthPayloads?.lowStockProducts) ? productHealthPayloads.lowStockProducts : [];
    const soldOutProducts = Array.isArray(productHealthPayloads?.soldOutProducts) ? productHealthPayloads.soldOutProducts : [];
    const deliveryRiskProducts = Array.isArray(productHealthPayloads?.deliveryRiskProducts) ? productHealthPayloads.deliveryRiskProducts : [];
    const refundRiskProducts = Array.isArray(productHealthPayloads?.refundRiskProducts) ? productHealthPayloads.refundRiskProducts : [];
    const hints = Array.isArray(productHealthPayloads?.inventoryTurnoverHints) ? productHealthPayloads.inventoryTurnoverHints : [];
    const deliveryRiskCount = normalizeAnalyticsCountValue(productSummary?.delivery_risk_count);
    const refundedOrderCount = normalizeAnalyticsCountValue(productSummary?.refunded_order_count);

    const tone = deliveryRiskCount > 0 || soldOutProducts.length > 0
        ? 'warning'
        : (lowStockProducts.length > 0 || refundedOrderCount > 0 ? 'accent' : 'success');
    const statusLabel = deliveryRiskCount > 0 ? '待处理' : (lowStockProducts.length > 0 || refundedOrderCount > 0 ? '待复核' : '平稳中');
    const title = deliveryRiskCount > 0
        ? '库存与履约当前仍在影响承接'
        : (lowStockProducts.length > 0 || refundedOrderCount > 0 ? '库存与退款风险值得继续观察' : '库存与履约当前平稳');
    const summary = hints[0]?.summary
        || (deliveryRiskCount > 0
            ? `当前窗口履约风险 ${formatNumber(deliveryRiskCount)} 单，退款 ${formatNumber(refundedOrderCount)} 单，建议优先回看履约处理与库存健康。`
            : '当前库存、履约和退款风险都处在较低水平。');

    const sampleItems = [
        soldOutProducts[0] ? `${soldOutProducts[0].product_name || '商品'} 已售罄` : '',
        lowStockProducts[0] ? `${lowStockProducts[0].product_name || '商品'} 低库存 ${formatNumber(lowStockProducts[0].stock_count || 0)}` : '',
        deliveryRiskProducts[0] ? `${deliveryRiskProducts[0].product_name || '商品'} 履约风险 ${formatNumber(deliveryRiskProducts[0].delivery_risk_count || 0)} 单` : '',
        refundRiskProducts[0] ? `${refundRiskProducts[0].product_name || '商品'} 退款 ${formatNumber(refundRiskProducts[0].refunded_order_count || 0)} 单` : ''
    ];

    return {
        tone,
        statusLabel,
        eyebrow: '履约处理',
        title,
        summary,
        guidance: {
            tone,
            reason: deliveryRiskCount > 0
                ? '履约风险已经开始影响成交承接和售后，优先级高于普通库存巡检。'
                : (soldOutProducts.length > 0 || lowStockProducts.length > 0 ? '库存侧已经出现供给压力，如果继续放量会把流量浪费在售罄或低库存商品上。': '当前库存和履约风险较低，更适合常规巡检。'),
            nextStep: deliveryRiskCount > 0
                ? '先去履约处理看死信、待重试和待履约，再补库存或调整承接动作。'
                : (soldOutProducts.length > 0 || lowStockProducts.length > 0 ? '先去库存管理补货或收缩入口，再回看商品预警是否还在放大。': '保持库存与履约巡检，继续观察退款风险即可。'),
            verify: deliveryRiskCount > 0
                ? '履约风险、待履约和退款风险下降。'
                : (soldOutProducts.length > 0 || lowStockProducts.length > 0 ? '售罄减少，低库存没有继续扩大。': '库存、履约和退款风险维持低位。')
        },
        stats: [
            { label: '低库存', value: formatNumber(lowStockProducts.length), tone: lowStockProducts.length > 0 ? 'warning' : 'neutral' },
            { label: '售罄', value: formatNumber(soldOutProducts.length), tone: soldOutProducts.length > 0 ? 'danger' : 'neutral' },
            { label: '履约风险', value: formatNumber(deliveryRiskCount), tone: deliveryRiskCount > 0 ? 'warning' : 'neutral' },
            { label: '退款风险', value: formatNumber(refundedOrderCount), tone: refundedOrderCount > 0 ? 'accent' : 'neutral', meta: `周转提示 ${formatNumber(hints.length)}` }
        ],
        samples: sampleItems,
        emptySampleMessage: '当前窗口没有明显的库存与履约异常样本。',
        actions: [
            {
                label: '去履约处理',
                destination: 'shop-fulfillment',
                icon: 'fas fa-truck-fast',
                context: buildAnalyticsOpsDestinationContext('fulfillment', '履约处理', {
                    tab: 'fulfillment'
                })
            },
            {
                label: '去库存管理',
                destination: 'shop-inventory',
                icon: 'fas fa-warehouse',
                context: buildAnalyticsOpsDestinationContext('fulfillment', '库存管理', {
                    tab: 'inventory'
                })
            },
            {
                label: '看商品预警',
                destination: 'analytics-product',
                icon: 'fas fa-siren-on',
                context: buildAnalyticsOpsDestinationContext('fulfillment', '商品预警', {
                    sectionId: 'productAlertsSection',
                    focusTargetId: 'productAlertsSection'
                })
            }
        ]
    };
}

function buildAnalyticsOpsVerifyState(summary = null) {
    const unavailableMessage = String(summary?.unavailableMessage || '').trim();
    if (unavailableMessage) {
        return {
            tone: 'neutral',
            statusLabel: '暂不可用',
            eyebrow: '验证服务',
            title: '验证服务数据暂不可用',
            summary: unavailableMessage,
            guidance: {
                tone: 'neutral',
                reason: '当前没有成功拉取到验证服务摘要，所以这张卡先不做经营判断。',
                nextStep: '可以稍后刷新，或直接打开 Verify Monitor 查看最新任务和失败样本。',
                verify: '刷新后确认验证失败、活跃任务和完成率重新显示。'
            },
            stats: [
                { label: '验证请求', value: '—', tone: 'neutral' },
                { label: '完成率', value: '—', tone: 'neutral' },
                { label: '失败', value: '—', tone: 'neutral' },
                { label: '活跃', value: '—', tone: 'neutral' }
            ],
            samples: [],
            emptySampleMessage: '当前未取到验证服务摘要样本。',
            actions: [
                {
                    label: '看验证服务',
                    destination: 'analytics-verify',
                    icon: 'fas fa-shield-halved',
                    context: buildAnalyticsOpsDestinationContext('verify', '验证服务', {
                        sectionId: 'verifyStatusList',
                        focusTargetId: 'verifyStatusList'
                    })
                },
                { label: '打开 Verify Monitor', destination: 'verify-monitor', icon: 'fas fa-wave-square' }
            ]
        };
    }

    const metrics = summary?.metrics && typeof summary.metrics === 'object'
        ? summary.metrics
        : {};
    const failed = normalizeAnalyticsCountValue(metrics.failedCount);
    const active = normalizeAnalyticsCountValue(metrics.activeCount);
    const successRate = normalizeAnalyticsNumber(metrics.successRate);
    const requestCount = normalizeAnalyticsCountValue(metrics.requestCount);
    const focusItems = Array.isArray(summary?.focusItems) ? summary.focusItems : [];
    const recentItems = Array.isArray(summary?.recentItems) ? summary.recentItems : [];

    const tone = failed > 0 ? 'warning' : (active > 0 ? 'accent' : 'success');
    const statusLabel = failed > 0 ? '待复核' : (active > 0 ? '处理中' : '平稳中');
    const title = failed > 0
        ? '验证服务仍有失败样本'
        : (active > 0 ? '验证服务仍有活跃任务' : '验证服务当前平稳');
    const summaryText = failed > 0 || active > 0
        ? `当前验证失败 ${formatNumber(failed)}，活跃任务 ${formatNumber(active)}，建议优先看验证失败和任务列表。`
        : '当前验证失败和活跃任务都处在较低水平。';

    return {
        tone,
        statusLabel,
        eyebrow: '验证服务',
        title,
        summary: summaryText,
        guidance: {
            tone,
            reason: failed > 0
                ? '验证失败会直接影响服务承接，优先级高于普通活跃任务。'
                : (active > 0 ? '当前还有活跃任务在跑，适合继续巡检但不需要立刻打断其他链路。': '验证服务当前更适合按巡检节奏观察。'),
            nextStep: failed > 0
                ? '先看失败样本和任务列表，确认是额度、调用失败还是队列阻塞。'
                : (active > 0 ? '继续看活跃任务和完成率，确认没有新失败持续冒头。': '维持验证服务巡检即可。'),
            verify: failed > 0
                ? '失败数下降，完成率回升，活跃任务不再堆积。'
                : (active > 0 ? '活跃任务下降，完成率维持稳定。': '失败和活跃任务继续维持低位。')
        },
        stats: [
            { label: '验证请求', value: formatNumber(requestCount), tone: 'neutral' },
            { label: '完成率', value: formatPercent(successRate), tone: failed > 0 ? 'warning' : 'success' },
            { label: '失败', value: formatNumber(failed), tone: failed > 0 ? 'warning' : 'neutral' },
            { label: '活跃', value: formatNumber(active), tone: active > 0 ? 'accent' : 'neutral' }
        ],
        samples: [...focusItems, ...recentItems]
            .slice(0, 4)
            .map((item) => [item?.title, item?.meta].filter(Boolean).join(' · ')),
        emptySampleMessage: '当前窗口没有额外的验证问题样本。',
        actions: [
            {
                label: '看验证服务',
                destination: 'analytics-verify',
                icon: 'fas fa-shield-halved',
                context: buildAnalyticsOpsDestinationContext('verify', '验证服务', {
                    sectionId: 'verifyStatusList',
                    focusTargetId: 'verifyStatusList'
                })
            },
            { label: '打开 Verify Monitor', destination: 'verify-monitor', icon: 'fas fa-wave-square' }
        ]
    };
}

function buildAnalyticsOpsAlertsState(opsAlertHealth = {}) {
    const unavailableMessage = String(opsAlertHealth?.unavailableMessage || '').trim();
    if (unavailableMessage) {
        return {
            tone: 'neutral',
            statusLabel: '暂不可用',
            eyebrow: '站外告警',
            title: '站外告警数据暂不可用',
            summary: unavailableMessage,
            guidance: {
                tone: 'neutral',
                reason: '当前没有成功拉取到站外告警健康数据，所以这张卡先不做投递健康判断。',
                nextStep: '可以稍后刷新，或直接进入告警健康和工作区查看当前通道状态。',
                verify: '刷新后确认投递健康、通道状态和最近异常重新显示。'
            },
            stats: [
                { label: '已启用通道', value: '—', tone: 'neutral' },
                { label: '近窗投递', value: '—', tone: 'neutral' },
                { label: '失败', value: '—', tone: 'neutral' },
                { label: '死信', value: '—', tone: 'neutral', meta: '暂未返回' }
            ],
            samples: [],
            emptySampleMessage: '当前未取到站外告警通道样本。',
            actions: [
                {
                    label: '看告警健康',
                    destination: 'ops-alerts-health',
                    icon: 'fas fa-heart-pulse',
                    context: buildAnalyticsOpsDestinationContext('alerts', '告警健康', {
                        view: 'health'
                    })
                },
                {
                    label: '看告警工作区',
                    destination: 'ops-alerts-workspace',
                    icon: 'fas fa-bell',
                    context: buildAnalyticsOpsDestinationContext('alerts', '告警工作区', {
                        view: 'workspace'
                    })
                }
            ]
        };
    }

    const summary = opsAlertHealth?.summary && typeof opsAlertHealth.summary === 'object'
        ? opsAlertHealth.summary
        : {};
    const channels = Array.isArray(opsAlertHealth?.channels) ? opsAlertHealth.channels : [];
    const totalAttempts = normalizeAnalyticsCountValue(summary.total_attempt_count);
    const deliveredCount = normalizeAnalyticsCountValue(summary.delivered_count);
    const failedCount = normalizeAnalyticsCountValue(summary.failed_count);
    const deadLetterCount = normalizeAnalyticsCountValue(summary.dead_letter_count);
    const enabledChannelCount = normalizeAnalyticsCountValue(summary.enabled_channel_count);
    const configIssueCount = normalizeAnalyticsCountValue(summary.config_issue_count);
    const deliveryRate = totalAttempts > 0 ? (roundTo((deliveredCount / totalAttempts) * 100, 2) || 0) : 0;
    const hasConfigIssues = configIssueCount > 0 || channels.some((channel) => Array.isArray(channel?.errors) && channel.errors.some(Boolean));

    const tone = deadLetterCount > 0
        ? 'danger'
        : (failedCount > 0
            ? 'warning'
            : (hasConfigIssues ? 'warning' : (enabledChannelCount > 0 ? 'success' : 'neutral')));
    const statusLabel = deadLetterCount > 0
        ? '待处理'
        : (failedCount > 0
            ? '待复核'
            : (hasConfigIssues ? '配置异常' : (enabledChannelCount > 0 ? '平稳中' : '未配置')));
    const title = deadLetterCount > 0
        ? '站外告警当前仍有死信和失败投递'
        : (failedCount > 0
            ? '站外告警通道仍需继续复核'
            : (hasConfigIssues
                ? '站外告警通道存在密钥或配置异常'
                : (enabledChannelCount > 0 ? '站外告警通道当前平稳' : '站外告警通道尚未完全配置')));
    const summaryText = hasConfigIssues
        ? `当前发现 ${formatNumber(configIssueCount || channels.filter((channel) => Array.isArray(channel?.errors) && channel.errors.some(Boolean)).length)} 条通道配置异常，建议先修复密钥后再看投递健康。`
        : (totalAttempts > 0
            ? `最近窗口共记录 ${formatNumber(totalAttempts)} 次投递，送达 ${formatNumber(deliveredCount)}，失败 ${formatNumber(failedCount)}，死信 ${formatNumber(deadLetterCount)}。`
            : '最近窗口暂无站外告警投递记录，可继续观察通道健康和配置状态。');

    return {
        tone,
        statusLabel,
        eyebrow: '站外告警',
        title,
        summary: summaryText,
        guidance: {
            tone,
            reason: deadLetterCount > 0
                ? '站外告警死信意味着异常通知本身可能失效，需要先恢复发现问题的能力。'
                : (failedCount > 0
                    ? '告警失败会削弱问题发现链路，建议尽快确认是否是通道或配置问题。'
                    : (hasConfigIssues ? '当前至少有一条通道密钥或配置异常，系统还不能稳定完成对外告警。': '当前告警通道更适合按健康巡检频率继续观察。')),
            nextStep: deadLetterCount > 0
                ? '先看告警健康和工作区，优先处理死信与失败最多的通道。'
                : (failedCount > 0
                    ? '先看告警健康和通道状态，再确认失败是否集中在单个告警或单个通道。'
                    : (hasConfigIssues ? '先进入告警健康，确认是哪条通道的密钥解密失败或配置不完整。': '保持告警通道巡检即可。')),
            verify: deadLetterCount > 0
                ? '死信和失败下降，送达率回升。'
                : (failedCount > 0
                    ? '失败样本减少，通道状态恢复平稳。'
                    : (hasConfigIssues ? '错误通道恢复为已配置状态，健康卡不再提示密钥异常。': '投递送达率维持稳定。'))
        },
        stats: [
            { label: '已启用通道', value: formatNumber(enabledChannelCount), tone: enabledChannelCount > 0 ? 'success' : 'neutral' },
            { label: '近窗投递', value: formatNumber(totalAttempts), tone: 'neutral' },
            { label: '失败', value: formatNumber(failedCount), tone: failedCount > 0 ? 'warning' : 'neutral' },
            { label: '死信', value: formatNumber(deadLetterCount), tone: deadLetterCount > 0 ? 'danger' : 'neutral', meta: totalAttempts > 0 ? `送达 ${formatPercent(deliveryRate)}` : '暂无投递' }
        ],
        samples: channels.slice(0, 4).map((channel) => {
            const label = String(channel?.label || channel?.key || '通道').trim();
            const status = String(channel?.health_label || channel?.status || '未配置').trim();
            const errors = Array.isArray(channel?.errors) ? channel.errors.filter(Boolean) : [];
            if (errors.length > 0) {
                return `${label} · ${status} · ${String(errors[0]).trim()}`;
            }
            return `${label} · ${status} · 失败 ${formatNumber(channel?.failed_count || 0)} / 死信 ${formatNumber(channel?.dead_letter_count || 0)}`;
        }),
        emptySampleMessage: '当前窗口没有额外的告警通道异常样本。',
        actions: [
            {
                label: '看告警健康',
                destination: 'ops-alerts-health',
                icon: 'fas fa-heart-pulse',
                context: buildAnalyticsOpsDestinationContext('alerts', '告警健康', {
                    view: 'health'
                })
            },
            {
                label: '看告警工作区',
                destination: 'ops-alerts-workspace',
                icon: 'fas fa-bell',
                context: buildAnalyticsOpsDestinationContext('alerts', '告警工作区', {
                    view: 'workspace'
                })
            }
        ]
    };
}

function renderAnalyticsOpsCockpitOverview(state = {}) {
    if (!state || typeof state !== 'object' || state.errorMessage) {
        return renderHintState('fas fa-satellite-dish', state?.errorMessage || '运营保障总览加载失败', state?.errorMessage ? 'error' : '');
    }

    return `
        <div class="analytics-ops-cockpit__overview analytics-ops-cockpit__overview--${escapeHtml(state.tone || 'neutral')}">
            <div class="analytics-ops-cockpit__overview-top">
                <div class="analytics-ops-cockpit__overview-copy">
                    <div class="analytics-ops-cockpit__eyebrow">OPS COCKPIT</div>
                    <strong class="analytics-ops-cockpit__overview-title">${escapeHtml(state.title || '运营保障总览')}</strong>
                    <p class="analytics-ops-cockpit__summary">${escapeHtml(state.summary || '')}</p>
                </div>
                ${renderAnalyticsNavigatorStatus(state.statusLabel || '观察中', state.tone || 'neutral')}
            </div>
            ${renderAnalyticsOpsCockpitStatGrid(state.stats)}
            ${renderAnalyticsOpsCockpitSampleList(state.samples, '当前窗口没有需要额外提示的运营异常样本。')}
            ${renderAnalyticsOpsCockpitIssueGrid(state.priorityIssues)}
            ${renderAnalyticsOpsFeedbackSummary(state.feedback)}
            ${renderAnalyticsOpsCockpitActionRow(state.actions)}
        </div>
    `;
}

async function loadOperationsCockpit() {
    const overviewContainer = document.getElementById('opsCockpitOverview');
    const paymentsContainer = document.getElementById('opsPaymentsPanel');
    const ticketsContainer = document.getElementById('opsTicketsPanel');
    const fulfillmentContainer = document.getElementById('opsFulfillmentPanel');
    const verifyContainer = document.getElementById('opsVerifyPanel');
    const alertsContainer = document.getElementById('opsAlertsPanel');

    if (!overviewContainer && !paymentsContainer && !ticketsContainer && !fulfillmentContainer && !verifyContainer && !alertsContainer) {
        return;
    }

    const overviewMeta = document.getElementById('opsCockpitOverviewMeta');
    const paymentsMeta = document.getElementById('opsPaymentsMeta');
    const ticketsMeta = document.getElementById('opsTicketsMeta');
    const fulfillmentMeta = document.getElementById('opsFulfillmentMeta');
    const verifyMeta = document.getElementById('opsVerifyMeta');
    const alertsMeta = document.getElementById('opsAlertsMeta');

    if (overviewContainer) overviewContainer.innerHTML = renderAnalyticsProductLoadingState('运营保障总览加载中...');
    if (paymentsContainer) paymentsContainer.innerHTML = renderAnalyticsProductLoadingState('支付问题加载中...');
    if (ticketsContainer) ticketsContainer.innerHTML = renderAnalyticsProductLoadingState('售后工单加载中...');
    if (fulfillmentContainer) fulfillmentContainer.innerHTML = renderAnalyticsProductLoadingState('履约处理加载中...');
    if (verifyContainer) verifyContainer.innerHTML = renderAnalyticsProductLoadingState('验证服务加载中...');
    if (alertsContainer) alertsContainer.innerHTML = renderAnalyticsProductLoadingState('站外告警加载中...');

    if (overviewMeta) overviewMeta.textContent = '支付 / 工单 / 履约 / 验证 / 告警';
    if (paymentsMeta) paymentsMeta.textContent = '告警 / 死信 / 待重试';
    if (ticketsMeta) ticketsMeta.textContent = '待处理 / 超时 / 高优';
    if (fulfillmentMeta) fulfillmentMeta.textContent = '库存 / 履约 / 退款风险';
    if (verifyMeta) verifyMeta.textContent = '失败 / 活跃 / 队列';
    if (alertsMeta) alertsMeta.textContent = '投递健康 / 通道状态 / 最近异常';

    const requestState = {
        operationsHealthSnapshot: null,
        verifySummary: null,
        productSummary: {},
        productHealthPayloads: {},
        opsAlertHealth: null
    };
    const requestStatus = {
        operationsHealthSnapshot: 'pending',
        verifySummary: 'pending',
        productDashboardBundle: 'pending',
        opsAlertHealth: 'pending'
    };
    const opsFeedbackEntries = getAnalyticsResolutionFeedbackEntriesForOps({ limit: 12 });
    const buildVerifySummaryUnavailableState = (message = '') => ({
        metrics: {},
        statusItems: [],
        recentItems: [],
        focusItems: [],
        recommendations: [],
        unavailableMessage: String(message || '验证服务摘要暂不可用，请稍后刷新或直接进入 Verify Monitor。').trim()
            || '验证服务摘要暂不可用，请稍后刷新或直接进入 Verify Monitor。'
    });
    const buildOpsAlertHealthUnavailableState = (message = '') => {
        const fallbackFactory = typeof window.getAdminWorkbenchDefaultOpsAlertHealthState === 'function'
            ? window.getAdminWorkbenchDefaultOpsAlertHealthState
            : null;
        const fallbackState = fallbackFactory ? fallbackFactory() : {
            status: 'error',
            fetched_at: '',
            summary: {
                lookback_hours: 72,
                total_job_count: 0,
                total_attempt_count: 0,
                delivered_count: 0,
                failed_count: 0,
                dead_letter_count: 0,
                enabled_channel_count: 0
            },
            channels: [],
            message: ''
        };

        return {
            ...fallbackState,
            status: 'error',
            unavailable: true,
            unavailableMessage: String(message || '站外告警健康暂不可用，请稍后刷新或直接进入告警健康页。').trim()
                || '站外告警健康暂不可用，请稍后刷新或直接进入告警健康页。'
        };
    };
    const attachOpsFeedbackDigestSafely = (state, entityType = '') => {
        if (!state || typeof state !== 'object') {
            return state;
        }

        try {
            state.feedbackDigest = buildAnalyticsOpsEntityFeedbackDigest(opsFeedbackEntries, entityType, state);
        } catch (error) {
            console.error(`[Analytics] Ops cockpit ${entityType || 'unknown'} feedback digest failed:`, error);
            state.feedbackDigest = null;
        }

        return state;
    };
    const getOpsCockpitFailedParts = () => {
        const parts = [];
        if (requestStatus.operationsHealthSnapshot === 'rejected') {
            parts.push('支付/工单');
        }
        if (requestStatus.productDashboardBundle === 'rejected') {
            parts.push('履约');
        }
        if (requestStatus.verifySummary === 'rejected') {
            parts.push('验证');
        }
        if (requestStatus.opsAlertHealth === 'rejected') {
            parts.push('告警');
        }
        return parts;
    };
    const renderVerifyUnavailableCard = (message = '') => {
        const verifyState = attachOpsFeedbackDigestSafely(
            buildAnalyticsOpsVerifyState(buildVerifySummaryUnavailableState(message)),
            'verify'
        );
        if (verifyContainer) {
            verifyContainer.innerHTML = renderAnalyticsOpsCockpitCard(verifyState, {
                iconClass: 'fas fa-shield-halved',
                errorMessage: '验证服务加载失败'
            });
        }
        if (verifyMeta) {
            verifyMeta.textContent = '数据暂不可用';
        }
    };
    const renderAlertsUnavailableCard = (message = '') => {
        const alertsState = attachOpsFeedbackDigestSafely(
            buildAnalyticsOpsAlertsState(buildOpsAlertHealthUnavailableState(message)),
            'alerts'
        );
        if (alertsContainer) {
            alertsContainer.innerHTML = renderAnalyticsOpsCockpitCard(alertsState, {
                iconClass: 'fas fa-tower-broadcast',
                errorMessage: '站外告警加载失败'
            });
        }
        if (alertsMeta) {
            alertsMeta.textContent = '数据暂不可用';
        }
    };

    const updateOverviewLoadingMeta = () => {
        if (!overviewMeta) {
            return;
        }

        const loadedParts = [];
        if (requestStatus.operationsHealthSnapshot === 'fulfilled') {
            loadedParts.push('支付/工单');
        }
        if (requestStatus.productDashboardBundle === 'fulfilled') {
            loadedParts.push('履约');
        }
        if (requestStatus.verifySummary === 'fulfilled') {
            loadedParts.push('验证');
        }
        if (requestStatus.opsAlertHealth === 'fulfilled') {
            loadedParts.push('告警');
        }

        overviewMeta.textContent = loadedParts.length > 0
            ? `已加载 ${loadedParts.join(' / ')} · 总览汇总中`
            : '支付 / 工单 / 履约 / 验证 / 告警';
    };

    const readProductDashboardBundle = (bundle = null) => {
        let productSummary = {};
        let productHealthPayloads = {};

        if (!bundle) {
            return { productSummary, productHealthPayloads };
        }

        try {
            productSummary = getAnalyticsProductBundlePayloadOrThrow(
                bundle,
                'summary',
                'Product summary unavailable'
            ) || {};
        } catch (error) {
            console.warn('[Analytics] Failed to read product summary for ops cockpit:', error);
        }

        try {
            productHealthPayloads = {
                lowStockProducts: getAnalyticsProductBundlePayloadOrThrow(bundle, 'lowStockProducts', 'Low-stock product health unavailable') || [],
                soldOutProducts: getAnalyticsProductBundlePayloadOrThrow(bundle, 'soldOutProducts', 'Sold-out product health unavailable') || [],
                deliveryRiskProducts: getAnalyticsProductBundlePayloadOrThrow(bundle, 'deliveryRiskProducts', 'Delivery risk product health unavailable') || [],
                refundRiskProducts: getAnalyticsProductBundlePayloadOrThrow(bundle, 'refundRiskProducts', 'Refund risk product health unavailable') || [],
                inventoryTurnoverHints: getAnalyticsProductBundlePayloadOrThrow(bundle, 'inventoryTurnoverHints', 'Inventory turnover hints unavailable') || []
            };
        } catch (error) {
            console.warn('[Analytics] Failed to read product health payloads for ops cockpit:', error);
        }

        return { productSummary, productHealthPayloads };
    };

    const renderEntityCards = (forceFallback = false) => {
        if (requestStatus.operationsHealthSnapshot === 'fulfilled') {
            const paymentsState = attachOpsFeedbackDigestSafely(
                buildAnalyticsOpsPaymentsState(requestState.operationsHealthSnapshot),
                'payments'
            );
            const ticketsState = attachOpsFeedbackDigestSafely(
                buildAnalyticsOpsTicketsState(requestState.operationsHealthSnapshot),
                'tickets'
            );

            try {
                if (paymentsContainer) {
                    paymentsContainer.innerHTML = renderAnalyticsOpsCockpitCard(paymentsState, { iconClass: 'fas fa-credit-card', errorMessage: '支付问题加载失败' });
                }
            } catch (error) {
                console.error('[Analytics] Failed to render ops cockpit payments card:', error);
                if (paymentsContainer) {
                    paymentsContainer.innerHTML = renderHintState('fas fa-credit-card', '支付问题数据暂不可用', 'neutral');
                }
            }
            try {
                if (ticketsContainer) {
                    ticketsContainer.innerHTML = renderAnalyticsOpsCockpitCard(ticketsState, { iconClass: 'fas fa-headset', errorMessage: '售后工单加载失败' });
                }
            } catch (error) {
                console.error('[Analytics] Failed to render ops cockpit tickets card:', error);
                if (ticketsContainer) {
                    ticketsContainer.innerHTML = renderHintState('fas fa-headset', '售后工单数据暂不可用', 'neutral');
                }
            }
            if (paymentsMeta) {
                paymentsMeta.textContent = `告警 ${formatNumber(requestState.operationsHealthSnapshot?.metrics?.paymentAlertTotal || 0)} / 死信 ${formatNumber(requestState.operationsHealthSnapshot?.metrics?.paymentDeadLetterCount || 0)} / 重试 ${formatNumber(requestState.operationsHealthSnapshot?.metrics?.paymentRetryCount || 0)}`;
            }
            if (ticketsMeta) {
                ticketsMeta.textContent = `待处理 ${formatNumber(requestState.operationsHealthSnapshot?.metrics?.ticketPendingCount || 0)} / 超时 ${formatNumber(requestState.operationsHealthSnapshot?.metrics?.ticketOverdueCount || 0)} / critical ${formatNumber(requestState.operationsHealthSnapshot?.metrics?.ticketCriticalOverdueCount || 0)}`;
            }
        } else if (forceFallback && requestStatus.operationsHealthSnapshot === 'rejected') {
            if (paymentsContainer) paymentsContainer.innerHTML = renderHintState('fas fa-credit-card', '支付问题加载失败', 'error');
            if (ticketsContainer) ticketsContainer.innerHTML = renderHintState('fas fa-headset', '售后工单加载失败', 'error');
        }

        if (requestStatus.productDashboardBundle === 'fulfilled') {
            const fulfillmentState = attachOpsFeedbackDigestSafely(
                buildAnalyticsOpsFulfillmentState(requestState.productSummary, requestState.productHealthPayloads),
                'fulfillment'
            );
            try {
                if (fulfillmentContainer) {
                    fulfillmentContainer.innerHTML = renderAnalyticsOpsCockpitCard(fulfillmentState, { iconClass: 'fas fa-truck-fast', errorMessage: '履约处理加载失败' });
                }
            } catch (error) {
                console.error('[Analytics] Failed to render ops cockpit fulfillment card:', error);
                if (fulfillmentContainer) {
                    fulfillmentContainer.innerHTML = renderHintState('fas fa-truck-fast', '履约处理数据暂不可用', 'neutral');
                }
            }
            if (fulfillmentMeta) {
                fulfillmentMeta.textContent = `低库存 ${formatNumber((requestState.productHealthPayloads.lowStockProducts || []).length)} / 售罄 ${formatNumber((requestState.productHealthPayloads.soldOutProducts || []).length)} / 履约风险 ${formatNumber(requestState.productSummary.delivery_risk_count || 0)}`;
            }
        } else if (forceFallback && requestStatus.productDashboardBundle === 'rejected') {
            if (fulfillmentContainer) fulfillmentContainer.innerHTML = renderHintState('fas fa-truck-fast', '履约处理加载失败', 'error');
        }

        if (requestStatus.verifySummary === 'fulfilled') {
            const verifyState = attachOpsFeedbackDigestSafely(
                buildAnalyticsOpsVerifyState(requestState.verifySummary),
                'verify'
            );
            try {
                if (verifyContainer) {
                    verifyContainer.innerHTML = renderAnalyticsOpsCockpitCard(verifyState, { iconClass: 'fas fa-shield-halved', errorMessage: '验证服务加载失败' });
                }
            } catch (error) {
                console.error('[Analytics] Failed to render ops cockpit verify card:', error);
                renderVerifyUnavailableCard(error?.message || '验证服务摘要暂不可用，请稍后刷新或直接进入 Verify Monitor。');
            }
            if (verifyMeta) {
                verifyMeta.textContent = requestState.verifySummary?.unavailableMessage
                    ? '数据暂不可用'
                    : `失败 ${formatNumber(requestState.verifySummary?.metrics?.failedCount || 0)} / 活跃 ${formatNumber(requestState.verifySummary?.metrics?.activeCount || 0)} / 完成率 ${formatPercent(requestState.verifySummary?.metrics?.successRate || 0)}`;
            }
        } else if (forceFallback && requestStatus.verifySummary === 'rejected') {
            renderVerifyUnavailableCard('验证服务摘要暂不可用，请稍后刷新或直接进入 Verify Monitor。');
        }

        if (requestStatus.opsAlertHealth === 'fulfilled') {
            const alertsState = attachOpsFeedbackDigestSafely(
                buildAnalyticsOpsAlertsState(requestState.opsAlertHealth),
                'alerts'
            );
            try {
                if (alertsContainer) {
                    alertsContainer.innerHTML = renderAnalyticsOpsCockpitCard(alertsState, { iconClass: 'fas fa-tower-broadcast', errorMessage: '站外告警加载失败' });
                }
            } catch (error) {
                console.error('[Analytics] Failed to render ops cockpit alerts card:', error);
                renderAlertsUnavailableCard(error?.message || '站外告警健康暂不可用，请稍后刷新或直接进入告警健康页。');
            }
            if (alertsMeta) {
                alertsMeta.textContent = requestState.opsAlertHealth?.unavailableMessage
                    ? '数据暂不可用'
                    : `通道 ${formatNumber(requestState.opsAlertHealth?.summary?.enabled_channel_count || 0)} / 失败 ${formatNumber(requestState.opsAlertHealth?.summary?.failed_count || 0)} / 死信 ${formatNumber(requestState.opsAlertHealth?.summary?.dead_letter_count || 0)}`;
            }
        } else if (forceFallback && requestStatus.opsAlertHealth === 'rejected') {
            renderAlertsUnavailableCard('站外告警健康暂不可用，请稍后刷新或直接进入告警健康页。');
        }
    };

    const renderOverview = (forceFallback = false) => {
        const hasAnySource = Object.values(requestStatus).some((status) => status === 'fulfilled');
        const allReady = Object.values(requestStatus).every((status) => status !== 'pending');
        const failedParts = getOpsCockpitFailedParts();

        if (!hasAnySource && !forceFallback) {
            return;
        }

        if (!allReady && !forceFallback) {
            updateOverviewLoadingMeta();
            return;
        }

        if (!hasAnySource) {
            if (overviewContainer) overviewContainer.innerHTML = renderHintState('fas fa-shield-halved', '运营保障驾驶舱加载失败', 'error');
            if (overviewMeta) overviewMeta.textContent = '运营保障驾驶舱加载失败';
            return;
        }

        let overviewState = null;
        try {
            overviewState = buildAnalyticsOpsCockpitOverviewState({
                operationsHealthSnapshot: requestState.operationsHealthSnapshot,
                verifySummary: requestState.verifySummary,
                productSummary: requestState.productSummary,
                productHealthPayloads: requestState.productHealthPayloads,
                opsAlertHealth: requestState.opsAlertHealth
            });
        } catch (error) {
            console.error('[Analytics] Failed to build ops cockpit overview state:', error);
            if (overviewContainer) {
                overviewContainer.innerHTML = renderHintState('fas fa-satellite-dish', '运营保障总览数据暂不可用', 'neutral');
            }
            if (overviewMeta) {
                overviewMeta.textContent = '总览暂不可用，请以下方分块为准';
            }
            return;
        }

        if (Array.isArray(overviewState?.stats)) {
            if (requestStatus.operationsHealthSnapshot === 'rejected') {
                overviewState.stats[0] = { label: '支付告警', value: '—', tone: 'neutral', meta: '暂未返回' };
                overviewState.stats[1] = { label: '待处理工单', value: '—', tone: 'neutral', meta: '暂未返回' };
            }
            if (requestStatus.productDashboardBundle === 'rejected') {
                overviewState.stats[2] = { label: '履约风险', value: '—', tone: 'neutral', meta: '暂未返回' };
            }
            if (requestStatus.verifySummary === 'rejected') {
                overviewState.stats[3] = { label: '验证失败', value: '—', tone: 'neutral', meta: '暂未返回' };
            }
            if (requestStatus.opsAlertHealth === 'rejected') {
                overviewState.stats[4] = { label: '告警通道', value: '—', tone: 'neutral', meta: '暂未返回' };
            }
        }

        if (failedParts.length > 0) {
            if (overviewState.tone === 'success') {
                overviewState.tone = 'accent';
            }
            if (overviewState.statusLabel === '平稳中') {
                overviewState.statusLabel = '部分可用';
            }
            overviewState.summary = [
                String(overviewState.summary || '').trim(),
                `以下分块暂未返回：${failedParts.join(' / ')}。`
            ].filter(Boolean).join(' ');
        }

        const opsFeedbackEntityStates = {
            payments: buildAnalyticsOpsPaymentsState(requestState.operationsHealthSnapshot),
            tickets: buildAnalyticsOpsTicketsState(requestState.operationsHealthSnapshot),
            fulfillment: buildAnalyticsOpsFulfillmentState(requestState.productSummary, requestState.productHealthPayloads),
            verify: buildAnalyticsOpsVerifyState(requestState.verifySummary),
            alerts: buildAnalyticsOpsAlertsState(requestState.opsAlertHealth)
        };
        try {
            overviewState.feedback = buildAnalyticsOpsFeedbackOverviewState(opsFeedbackEntries, opsFeedbackEntityStates);
        } catch (error) {
            console.error('[Analytics] Failed to build ops cockpit feedback overview state:', error);
            overviewState.feedback = null;
        }

        if (overviewContainer) {
            overviewContainer.innerHTML = renderAnalyticsOpsCockpitOverview(overviewState);
        }
        if (overviewMeta) {
            const unavailableParts = [
                requestStatus.operationsHealthSnapshot === 'rejected' ? '支付/工单' : '',
                requestStatus.productDashboardBundle === 'rejected' ? '履约' : '',
                (requestStatus.verifySummary === 'rejected' || requestState.verifySummary?.unavailableMessage) ? '验证' : '',
                (requestStatus.opsAlertHealth === 'rejected' || requestState.opsAlertHealth?.unavailableMessage) ? '告警' : ''
            ].filter(Boolean);
            overviewMeta.textContent = unavailableParts.length > 0
                ? `${overviewState.statusLabel} · 支付 ${formatNumber(overviewState?.stats?.[0]?.value || 0)} / 工单 ${formatNumber(requestState.operationsHealthSnapshot?.metrics?.ticketPendingCount || 0)} · ${unavailableParts.join('/')}暂未返回`
                : `${overviewState.statusLabel} · 支付 ${formatNumber(overviewState?.stats?.[0]?.value || 0)} / 工单 ${formatNumber(requestState.operationsHealthSnapshot?.metrics?.ticketPendingCount || 0)}`;
        }
    };

    const requests = [
        ['operationsHealthSnapshot', getOperationsHealthSnapshotData()],
        ['verifySummary', (async () => {
            try {
                return await getVerifyServiceSummaryData();
            } catch (error) {
                console.warn('[Analytics] Ops cockpit verify summary unavailable, falling back:', error);
                try {
                    if (typeof buildVerifyServiceSummaryFallback === 'function') {
                        const [snapshot, summaryWindow] = await Promise.all([
                            getAnalyticsVerifyMonitorSnapshotData({ forceRefresh: true }).catch(() => null),
                            loadAnalyticsSummaryWindowFallbackData({ forceRefresh: true }).catch(() => ({}))
                        ]);
                        return buildVerifyServiceSummaryFallback({
                            snapshot,
                            summaryWindow: summaryWindow || {}
                        });
                    }
                } catch (fallbackError) {
                    console.warn('[Analytics] Ops cockpit verify summary fallback failed:', fallbackError);
                }
                return buildVerifySummaryUnavailableState(error?.message || '验证服务摘要暂不可用，请稍后刷新或直接进入 Verify Monitor。');
            }
        })()],
        ['productDashboardBundle', getAnalyticsProductDashboardBundle()],
        ['opsAlertHealth', (async () => {
            try {
                return await getAnalyticsOpsAlertHealthData();
            } catch (error) {
                console.warn('[Analytics] Ops cockpit ops-alert health unavailable, using neutral fallback:', error);
                return buildOpsAlertHealthUnavailableState(error?.message || '站外告警健康暂不可用，请稍后刷新或直接进入告警健康页。');
            }
        })()]
    ];

    await Promise.allSettled(requests.map(([key, promise]) => Promise.resolve(promise)
        .then((value) => {
            if (key === 'productDashboardBundle') {
                const { productSummary, productHealthPayloads } = readProductDashboardBundle(value);
                requestState.productSummary = productSummary;
                requestState.productHealthPayloads = productHealthPayloads;
            } else {
                requestState[key] = value;
            }
            requestStatus[key] = 'fulfilled';
            renderEntityCards(false);
            renderOverview(false);
            return value;
        })
        .catch((error) => {
            requestStatus[key] = 'rejected';
            return Promise.reject(error);
        })));

    renderEntityCards(true);
    renderOverview(true);
}

function enrichAnalyticsGrowthSummaryWithProductSignals(summary = {}, productSummary = {}) {
    const result = {
        ...(summary && typeof summary === 'object' ? summary : {}),
        breakdownItems: Array.isArray(summary?.breakdownItems) ? [...summary.breakdownItems] : [],
        recommendations: Array.isArray(summary?.recommendations) ? [...summary.recommendations] : []
    };

    const viewUsers = normalizeAnalyticsCountValue(productSummary.view_user_count);
    const detailViewUsers = normalizeAnalyticsCountValue(productSummary.detail_view_user_count);
    const purchaseIntentUsers = normalizeAnalyticsCountValue(productSummary.purchase_click_user_count);
    const buyerUsers = normalizeAnalyticsCountValue(productSummary.unique_buyer_count);
    const refundedOrders = normalizeAnalyticsCountValue(productSummary.refunded_order_count);
    const influencedUsers = Math.max(viewUsers, detailViewUsers, purchaseIntentUsers, buyerUsers, 0);

    if (influencedUsers <= 0) {
        return result;
    }

    result.breakdownItems.unshift({
        title: '商品影响用户层',
        value: formatNumber(influencedUsers),
        meta: `浏览 ${formatNumber(viewUsers)} / 详情 ${formatNumber(detailViewUsers)} / 意图 ${formatNumber(purchaseIntentUsers)} / 成交 ${formatNumber(buyerUsers)}`,
        badgeLabel: '商品',
        badgeTone: buyerUsers > 0 ? 'success' : (purchaseIntentUsers > 0 ? 'warning' : 'accent'),
        summary: buyerUsers > 0
            ? '用户增长里已经能看到商品经营开始带来成交用户。'
            : (purchaseIntentUsers > 0
                ? '用户已经进入商品购买意图阶段，但还没有完全形成成交。'
                : '当前商品信号主要停留在浏览和详情层，适合继续看内容带货与商品承接。'),
        actionLabel: '查看商品经营',
        destination: 'analytics-product',
        icon: 'fas fa-box-open',
        context: {
            sectionId: buyerUsers > 0 ? 'productOverviewSection' : 'productFunnelSection'
        }
    });

    if (purchaseIntentUsers > 0 && buyerUsers <= 0) {
        result.recommendations.unshift({
            tone: 'warning',
            level: '建议跟进',
            title: '商品用户已出现购买意图但还没转成成交',
            summary: `当前窗口已有 ${formatNumber(purchaseIntentUsers)} 位用户进入商品购买意图，但成交用户仍为 ${formatNumber(buyerUsers)}，建议优先回看商品漏斗和支付承接。`,
            actionLabel: '查看商品漏斗',
            destination: 'analytics-product',
            icon: 'fas fa-filter-circle-dollar',
            context: {
                sectionId: 'productFunnelSection'
            }
        });
    } else if (buyerUsers > 0 && refundedOrders > 0) {
        result.recommendations.unshift({
            tone: 'warning',
            level: '建议复核',
            title: '商品成交用户里已经出现退款风险',
            summary: `当前窗口商品成交用户 ${formatNumber(buyerUsers)} 位，其中已出现 ${formatNumber(refundedOrders)} 笔退款，建议同步复核商品承接、售后解释和履约质量。`,
            actionLabel: '查看库存与履约健康',
            destination: 'analytics-product',
            icon: 'fas fa-triangle-exclamation',
            context: {
                sectionId: 'productHealthSection'
            }
        });
    } else if (viewUsers > 0 && purchaseIntentUsers <= 0) {
        result.recommendations.unshift({
            tone: 'accent',
            level: '持续观察',
            title: '商品经营已经影响用户浏览，但还停留在前链路',
            summary: `当前窗口已有 ${formatNumber(viewUsers)} 位用户进入商品浏览，但购买意图用户只有 ${formatNumber(purchaseIntentUsers)}，建议先看商品结构和带货内容是否把用户带进详情。`,
            actionLabel: '查看商品总盘',
            destination: 'analytics-product',
            icon: 'fas fa-chart-line',
            context: {
                sectionId: 'productOverviewSection'
            }
        });
    }

    return result;
}

function applyGrowthSummaryPanelState(summary = {}, options = {}) {
    const breakdownContainer = document.getElementById('growthBreakdownList');
    const recommendations = document.getElementById('growthActionRecommendations');
    if (!breakdownContainer) {
        return false;
    }

    const summaryWindow = options?.summaryWindow && typeof options.summaryWindow === 'object'
        ? options.summaryWindow
        : {};
    const overview = summaryWindow?.overview && typeof summaryWindow.overview === 'object'
        ? summaryWindow.overview
        : {};
    syncAnalyticsGrowthNewUsersTodayFromSources({
        overview
    });

    const metrics = summary?.metrics && typeof summary.metrics === 'object'
        ? summary.metrics
        : {};

    const messagesEl = document.getElementById('kpiGrowthMessagesValue');
    const interactionsEl = document.getElementById('kpiGrowthInteractionsValue');
    const referralEl = document.getElementById('kpiGrowthReferralRewardsValue');
    const checkinEl = document.getElementById('kpiGrowthCheckinRewardsValue');

    if (messagesEl) messagesEl.textContent = formatNumber(metrics.guestbookMessageCount || 0);
    if (interactionsEl) interactionsEl.textContent = formatNumber(metrics.interactionCount || 0);
    if (referralEl) referralEl.textContent = formatNumber(metrics.referralRewardPoints || 0);
    if (checkinEl) checkinEl.textContent = formatNumber(metrics.checkinRewardPoints || 0);

    breakdownContainer.innerHTML = renderAnalyticsCompactItems(summary?.breakdownItems, {
        iconClass: 'fas fa-bullhorn',
        message: '当前窗口暂无裂变与激励数据'
    });

    if (recommendations) {
        recommendations.innerHTML = renderAnalyticsRecommendationItems(summary?.recommendations, {
            iconClass: 'fas fa-list-check',
            message: '当前窗口暂无建议动作'
        });
    }

    return true;
}

function scheduleGrowthSummaryProductSignalsWarm(summary = {}, options = {}) {
    const requestId = Number(options?.requestId || 0);
    const summaryWindow = options?.summaryWindow && typeof options.summaryWindow === 'object'
        ? options.summaryWindow
        : {};

    return new Promise((resolve) => {
        window.setTimeout(() => {
            void (async () => {
                if (requestId !== analyticsGrowthSummaryRequestId) {
                    return false;
                }

                const productSummaryBundle = await getAnalyticsProductSummaryBundle().catch(() => null);
                if (requestId !== analyticsGrowthSummaryRequestId || !productSummaryBundle) {
                    return false;
                }

                try {
                    const productSummary = getAnalyticsProductBundlePayloadOrThrow(
                        productSummaryBundle,
                        'summary',
                        'Product summary unavailable'
                    ) || {};
                    if (requestId !== analyticsGrowthSummaryRequestId) {
                        return false;
                    }
                    applyGrowthSummaryPanelState(
                        enrichAnalyticsGrowthSummaryWithProductSignals(summary, productSummary),
                        { summaryWindow }
                    );
                    return true;
                } catch (error) {
                    console.warn('[Analytics] Failed to read product summary for growth summary:', error);
                    return false;
                }
            })().then(resolve).catch((error) => {
                console.warn('[Analytics] Growth summary product warm failed:', error);
                resolve(false);
            });
        }, 0);
    });
}

async function loadGrowthSummary() {
    const breakdownContainer = document.getElementById('growthBreakdownList');
    if (!breakdownContainer) return;
    const requestId = ++analyticsGrowthSummaryRequestId;

    try {
        const [summary, summaryWindow] = await Promise.all([
            getGrowthSummaryData(),
            getAnalyticsSummaryWindowData().catch(() => null)
        ]);
        if (requestId !== analyticsGrowthSummaryRequestId) {
            return;
        }
        applyGrowthSummaryPanelState(summary, { summaryWindow });
        void scheduleGrowthSummaryProductSignalsWarm(summary, { requestId, summaryWindow });
    } catch (err) {
        console.error('[Analytics] Failed to load growth summary:', err);
        try {
            const [summaryWindow, commentsSummary] = await Promise.all([
                loadAnalyticsSummaryWindowFallbackData({ forceRefresh: true }).catch(() => ({})),
                getAnalyticsCommentsSummaryData({ forceRefresh: true }).catch(() => null)
            ]);
            if (requestId !== analyticsGrowthSummaryRequestId) {
                return;
            }
            const fallbackSummary = buildGrowthSummaryFallback({
                summaryWindow,
                commentsSummary
            });
            applyGrowthSummaryPanelState(fallbackSummary, { summaryWindow });
            void scheduleGrowthSummaryProductSignalsWarm(fallbackSummary, { requestId, summaryWindow });
        } catch (fallbackErr) {
            if (requestId !== analyticsGrowthSummaryRequestId) {
                return;
            }
            console.error('[Analytics] Growth summary fallback failed:', fallbackErr);
            syncAnalyticsGrowthNewUsersTodayDisplays({
                hasValue: false,
                label: typeof getAnalyticsNewUsersLabels === 'function' ? getAnalyticsNewUsersLabels().todayLabel : '今日新增用户',
                tooltip: '今日新增用户加载失败'
            });
            breakdownContainer.innerHTML = renderHintState('fas fa-bullhorn', '裂变与激励摘要加载失败', 'error');
            const recommendations = document.getElementById('growthActionRecommendations');
            if (recommendations) recommendations.innerHTML = renderHintState('fas fa-list-check', '建议动作加载失败', 'error');
        }
    }
}

async function loadEventFunnelPanels() {
    const commerceContainer = document.getElementById('commerceEventFunnel');
    const verifyContainer = document.getElementById('verifyEventFunnel');
    const growthContainer = document.getElementById('growthEventFunnel');
    const verifyMeta = document.getElementById('verifyEventFunnelMeta');

    if (!commerceContainer && !verifyContainer && !growthContainer) {
        return;
    }

    try {
        const summaryWindow = await loadAnalyticsSummaryWindowFallbackData();
        const commerceView = buildCommerceEventFunnelViewData(summaryWindow);
        let verifyView = buildVerifyEventFunnelViewData(summaryWindow);
        if ((!Array.isArray(verifyView?.items) || !verifyView.items.length) && typeof getVerifyServiceSummaryData === 'function') {
            const verifySummary = await getVerifyServiceSummaryData().catch(() => null);
            const compatibilityView = buildVerifyEventFunnelFallbackViewData(verifySummary || {});
            if (Array.isArray(compatibilityView?.items) && compatibilityView.items.length) {
                verifyView = compatibilityView;
            }
        }
        const growthView = buildGrowthEventFunnelViewData(summaryWindow);

        if (commerceContainer) {
            commerceContainer.innerHTML = renderAnalyticsCompactItems(commerceView.items, {
                iconClass: 'fas fa-credit-card',
                message: '真实交易事件开始采集中'
            });
        }

        if (verifyContainer) {
            verifyContainer.innerHTML = renderAnalyticsCompactItems(verifyView.items, {
                iconClass: 'fas fa-shuffle',
                message: verifyView?.compatibilityMode
                    ? '真实验证事件缺失，已切到验证任务兼容口径'
                    : '真实验证事件开始采集中'
            });
        }
        if (verifyMeta) {
            verifyMeta.textContent = verifyView?.compatibilityMode
                ? '兼容口径：验证任务摘要'
                : '真实验证事件';
        }

        if (growthContainer) {
            growthContainer.innerHTML = renderAnalyticsCompactItems(growthView.items, {
                iconClass: 'fas fa-seedling',
                message: '真实增长事件开始采集中'
            });
        }
    } catch (err) {
        console.error('[Analytics] Failed to load event funnel panels:', err);
        if (commerceContainer) {
            commerceContainer.innerHTML = renderAnalyticsCompactItems([], {
                iconClass: 'fas fa-credit-card',
                message: '当前窗口暂无真实交易事件'
            });
        }
        if (verifyContainer) {
            verifyContainer.innerHTML = renderAnalyticsCompactItems([], {
                iconClass: 'fas fa-shuffle',
                message: '当前窗口暂无真实验证事件'
            });
        }
        if (verifyMeta) {
            verifyMeta.textContent = '真实验证事件';
        }
        if (growthContainer) {
            growthContainer.innerHTML = renderAnalyticsCompactItems([], {
                iconClass: 'fas fa-seedling',
                message: '当前窗口暂无真实增长事件'
            });
        }
    }
}

function renderActivityHeatmapRows(container, data = []) {
    const rows = Array.isArray(data) ? data : [];
    const heatmapMeta = getAnalyticsMetricMeta(rows, {
        isProxyMetric: false,
        metricBasis: 'effective_business_event_heatmap',
        metricLabel: '真实业务事件热度'
    });
    const metricHint = renderAnalyticsMetricHint(rows, {
        fallback: {
            isProxyMetric: false,
            metricBasis: 'effective_business_event_heatmap',
            metricLabel: '真实业务事件热度'
        },
        proxyDetail: '当前数据库仍在返回旧登录热力图，请执行最新 heatmap migration 后切到真实业务事件热度。',
        realDetail: '当前热力图按真实业务事件绘制，适合观察浏览、解锁、验证、充值等行为高峰。'
    });
    const emptyMessage = heatmapMeta.isProxyMetric ? '当前窗口暂无登录活动数据' : '当前窗口暂无业务事件数据';
    const unitLabel = heatmapMeta.isProxyMetric ? '次登录' : '次事件';

    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const matrix = Array(7).fill(null).map(() => Array(24).fill(0));
    let maxCount = 0;
    let totalCount = 0;

    rows.forEach((row) => {
        matrix[row.day_of_week][row.hour_of_day] = row.activity_count;
        totalCount += row.activity_count;
        if (row.activity_count > maxCount) maxCount = row.activity_count;
    });

    if (totalCount === 0) {
        container.innerHTML = `
            ${renderHintState('fas fa-info-circle', emptyMessage)}
            ${metricHint}
        `;
        return;
    }

    let html = '<div class="heatmap-grid">';
    html += '<div class="heatmap-row header"><div class="heatmap-label"></div>';
    for (let hour = 0; hour < 24; hour += 2) {
        html += `<div class="heatmap-hour">${hour}</div>`;
    }
    html += '</div>';

    for (let day = 0; day < 7; day += 1) {
        html += `<div class="heatmap-row"><div class="heatmap-label">${dayNames[day]}</div>`;
        for (let hour = 0; hour < 24; hour += 1) {
            const count = matrix[day][hour];
            const intensity = maxCount > 0 ? count / maxCount : 0;
            html += `<div class="heatmap-cell ${getHeatmapToneClass(count, intensity)}" title="${dayNames[day]} ${hour}:00 - ${count} ${unitLabel}"></div>`;
        }
        html += '</div>';
    }
    html += '</div>';
    html += `
        <div class="heatmap-legend">
            <span class="legend-label">少</span>
            <div class="legend-gradient"></div>
            <span class="legend-label">多</span>
        </div>
    `;
    html += metricHint;

    container.innerHTML = html;
}

async function loadActivityHeatmap(days = getAnalyticsRangeDays(30)) {
    const container = document.getElementById('activityHeatmap');
    if (!container) return;

    try {
        renderActivityHeatmapRows(container, await fetchActivityHeatmapData(days));
    } catch (err) {
        console.error('[Analytics] Failed to load heatmap:', err);
        try {
            renderActivityHeatmapRows(container, await loadAnalyticsRangeRpcRowsDirect('get_activity_heatmap', days));
        } catch (fallbackErr) {
            console.error('[Analytics] Heatmap direct retry failed:', fallbackErr);
            container.innerHTML = renderHintState('fas fa-clock', '活跃时段热力图加载失败', 'error');
        }
    }
}

async function loadTopContributors() {
    try {
        const data = await fetchTopContributorsData(10);

        const container = document.getElementById('topContributorsList');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无数据</div>';
            return;
        }

        container.innerHTML = data.map((user, index) => {
            const userId = String(user.user_id || '').trim();
            const username = escapeHtml(user.username || '匿名用户');

            return `
                <div class="contributor-item">
                    <span class="rank rank-${index + 1}">${index + 1}</span>
                    <img class="contributor-avatar" src="${user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.user_id}`}" alt="avatar">
                    <div class="contributor-info">
                        ${userId
                            ? `<button
                                    type="button"
                                    class="contributor-name contributor-name-btn"
                                    data-admin-action="analytics-open-user-detail"
                                    data-user-id="${encodeURIComponent(userId)}"
                                    title="查看用户详情"
                                    aria-label="查看 ${username} 的用户详情"
                                >${username}</button>`
                            : `<span class="contributor-name">${username}</span>`}
                        <span class="contributor-stats">
                            <span><i class="fas fa-comment"></i> ${user.comment_count}</span>
                            <span><i class="fas fa-envelope"></i> ${user.message_count}</span>
                            <span><i class="fas fa-heart"></i> ${user.total_likes_received}</span>
                        </span>
                    </div>
                    <span class="contributor-score">${Math.round(user.contribution_score)}</span>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('[Analytics] Failed to load contributors:', err);
        const container = document.getElementById('topContributorsList');
        if (container) container.innerHTML = '<div class="error-state">加载失败</div>';
    }
}

async function loadCommunityChart(days = 30) {
    try {
        const data = await fetchCommunityStatsData(days);

        const ctx = document.getElementById('communityChart');
        if (!ctx) return;

        const theme = getChartTheme();

        if (communityChart) {
            communityChart.destroy();
        }

        communityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map((d) => formatDate(d.stat_date)),
                datasets: [
                    {
                        label: '留言',
                        data: data.map((d) => d.messages),
                        borderColor: chartColors.primary,
                        backgroundColor: 'transparent',
                        tension: 0.4
                    },
                    {
                        label: '评论',
                        data: data.map((d) => d.comments),
                        borderColor: chartColors.secondary,
                        backgroundColor: 'transparent',
                        tension: 0.4
                    },
                    {
                        label: '点赞',
                        data: data.map((d) => d.likes),
                        borderColor: chartColors.success,
                        backgroundColor: 'transparent',
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: theme.text }
                    }
                },
                scales: {
                    x: {
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });
    } catch (err) {
        console.error('[Analytics] Failed to load community chart:', err);
    }
}

function renderConversionFunnelState(container, conversionData = {}) {
    const rows = Array.isArray(conversionData?.rows) ? conversionData.rows : [];
    const hasRealEvents = rows.some((row) => Number(row?.user_count || 0) > 0);
    const funnelMetricHint = renderAnalyticsMetricHint(rows, {
        fallback: {
            isProxyMetric: false,
            metricBasis: 'user_events',
            metricLabel: '真实业务事件漏斗'
        },
        realDetail: '当前漏斗按 Prompt 浏览、解锁点击、内容解锁三段真实事件计算。'
    });

    if (rows.length === 0 || !hasRealEvents) {
        container.innerHTML = `
            <div class="analytics-funnel-chart-pane analytics-funnel-chart-pane--empty">
                <div class="empty-state-hint">
                    <i class="fas fa-filter"></i>
                    <span>当前窗口暂无真实转化事件</span>
                </div>
            </div>
            ${funnelMetricHint || ''}
        `;
        return;
    }

    container.innerHTML = `
        <div class="analytics-funnel-chart-pane">
            <canvas id="funnelChart"></canvas>
        </div>
        ${funnelMetricHint || ''}
    `;

    const theme = getChartTheme();
    const ctx = container.querySelector('#funnelChart');
    if (!ctx) return;

    if (funnelChart) funnelChart.destroy();

    funnelChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: rows.map((d) => d.step_name),
            datasets: [{
                label: '用户数',
                data: rows.map((d) => d.user_count),
                backgroundColor: [
                    'rgba(107, 158, 206, 0.8)',
                    'rgba(139, 92, 246, 0.8)',
                    'rgba(34, 197, 94, 0.8)'
                ],
                borderRadius: 8
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const rate = rows[context.dataIndex]?.conversion_rate || 0;
                            return `${context.raw} 用户 (${rate}%)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: theme.grid },
                    ticks: { color: theme.text }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: theme.text }
                }
            }
        }
    });
}

async function loadConversionFunnel(days = getAnalyticsRangeDays(30)) {
    const container = document.getElementById('conversionFunnel');
    if (!container) return;

    try {
        renderConversionFunnelState(container, await fetchConversionFunnelData(days));
    } catch (err) {
        console.error('[Analytics] Failed to load funnel:', err);
        try {
            renderConversionFunnelState(container, {
                rows: await loadAnalyticsRangeRpcRowsDirect('get_conversion_funnel_v2', days)
            });
        } catch (fallbackErr) {
            console.error('[Analytics] Conversion funnel direct retry failed:', fallbackErr);
            container.innerHTML = renderHintState('fas fa-filter', '转化漏斗加载失败', 'error');
        }
    }
}

async function loadRetentionCohort(weeks = getAnalyticsCohortWeeks()) {
    try {
        const rows = await fetchRetentionCohortData(weeks);

        const container = document.getElementById('retentionCohort');
        if (!container) return;
        const metricHint = renderAnalyticsMetricHint(rows, {
            fallback: {
                isProxyMetric: false,
                metricBasis: 'site_attributed_cohort_effective_business_activity',
                metricLabel: '首站点归因 cohort + 真实业务回访'
            },
            proxyDetail: '当前数据库仍在返回旧登录留存，请执行最新 retention migration 后切到真实业务回访留存。',
            realDetail: '当前留存按首站点归因 cohort + 真实业务事件回访计算，更接近真实复访质量。'
        });

        if (rows.length === 0) {
            container.innerHTML = `
                ${renderHintState('fas fa-th', '暂无留存数据')}
                ${metricHint}
            `;
            return;
        }

        let html = `
            <table class="cohort-table">
                <thead>
                    <tr>
                        <th>注册周</th>
                        <th>W0</th>
                        <th>W1</th>
                        <th>W2</th>
                        <th>W3</th>
                        <th>W4</th>
                    </tr>
                </thead>
                <tbody>
        `;

        rows.forEach((row) => {
            html += `<tr>
                <td>${row.cohort_week}</td>
                <td class="${getCohortToneClass(row.week_0)}">${row.week_0 || 0}%</td>
                <td class="${getCohortToneClass(row.week_1)}">${row.week_1 || 0}%</td>
                <td class="${getCohortToneClass(row.week_2)}">${row.week_2 || 0}%</td>
                <td class="${getCohortToneClass(row.week_3)}">${row.week_3 || 0}%</td>
                <td class="${getCohortToneClass(row.week_4)}">${row.week_4 || 0}%</td>
            </tr>`;
        });

        html += `</tbody></table>${metricHint}`;
        container.innerHTML = html;
    } catch (err) {
        console.error('[Analytics] Failed to load retention cohort:', err);
    }
}

async function loadPointsFlow(days = getAnalyticsRangeDays(30)) {
    try {
        const data = await fetchPointsFlowData(days);
        const container = document.getElementById('pointsFlow');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = renderHintState('fas fa-exchange-alt', '暂无积分流向数据');
            return;
        }

        const inflows = data.filter((d) => d.target_node === '用户余额');
        const outflows = data.filter((d) => d.source_node === '用户余额');

        let html = '<div class="points-flow-container">';
        html += '<div class="flow-section"><h4><i class="fas fa-arrow-right flow-section-icon flow-section-icon--inflow"></i> 收入来源</h4>';
        inflows.forEach((item) => {
            html += `<div class="flow-item inflow">
                <span class="flow-label">${item.source_node}</span>
                <span class="flow-value">+${formatNumber(item.value)}</span>
            </div>`;
        });
        html += '</div>';

        html += '<div class="flow-section"><h4><i class="fas fa-arrow-left flow-section-icon flow-section-icon--outflow"></i> 消费去向</h4>';
        outflows.forEach((item) => {
            html += `<div class="flow-item outflow">
                <span class="flow-label">${item.target_node}</span>
                <span class="flow-value">-${formatNumber(item.value)}</span>
            </div>`;
        });
        html += '</div></div>';

        container.innerHTML = html;
    } catch (err) {
        console.error('[Analytics] Failed to load points flow:', err);
        const container = document.getElementById('pointsFlow');
        if (container) {
            container.innerHTML = renderHintState('fas fa-triangle-exclamation', '积分流向加载失败', 'error');
        }
    }
}

async function loadGeoDistribution() {
    try {
        const data = await fetchGeoDistributionData();

        const chartPanel = document.getElementById('geoChartPanel');
        const detailContainer = document.getElementById('geoBreakdownList');

        if (!data || data.length === 0) {
            if (chartPanel) chartPanel.innerHTML = `<div class="empty-state-hint">
                <i class="fas fa-globe-asia"></i>
                <span>暂无地理数据</span>
            </div>`;
            if (detailContainer) detailContainer.innerHTML = '';
            return;
        }

        const theme = getChartTheme();
        const ctx = document.getElementById('geoChart');
        if (!ctx) return;

        const geoColors = [
            '#6b9ece', '#8b5cf6', '#22c55e', '#f59e0b',
            '#ef4444', '#ec4899', '#14b8a6', '#64748b',
            '#a78bfa', '#fb923c', '#38bdf8', '#4ade80'
        ];

        const totalUsers = data.reduce((sum, d) => sum + (d.user_count || 0), 0);

        if (geoChart) geoChart.destroy();

        geoChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.map((d) => d.region),
                datasets: [{
                    data: data.map((d) => d.user_count),
                    backgroundColor: data.map((_, i) => geoColors[i % geoColors.length]),
                    borderWidth: 2,
                    borderColor: theme.background
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '56%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                const value = context.raw || 0;
                                const pct = totalUsers > 0 ? ((value / totalUsers) * 100).toFixed(1) : '0.0';
                                return `${context.label}: ${formatNumber(value)} 用户 (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });

        if (detailContainer) {
            const sorted = data.slice().sort((a, b) => (b.user_count || 0) - (a.user_count || 0));
            const items = sorted.map((row, idx) => {
                const color = geoColors[data.indexOf(row) % geoColors.length];
                const count = row.user_count || 0;
                const pct = totalUsers > 0 ? ((count / totalUsers) * 100).toFixed(1) : '0.0';
                return `<div class="analytics-compact-item analytics-geo-item" style="--analytics-distribution-indicator:${escapeHtml(color)};">
                    <div class="analytics-compact-item__top">
                        <div class="analytics-compact-item__heading">
                            <span class="analytics-compact-item__title">
                                <span class="analytics-geo-swatch" style="background:${color}"></span>
                                ${escapeHtml(row.region || '未知')}
                            </span>
                            <div class="analytics-compact-item__meta">占比 ${pct}%</div>
                        </div>
                        <span class="analytics-compact-item__value">${formatNumber(count)}</span>
                    </div>
                </div>`;
            });
            detailContainer.innerHTML = `<div class="analytics-compact-stack">${items.join('')}</div>`;
        }
    } catch (err) {
        console.error('[Analytics] Geo distribution error:', err);
        const chartPanel = document.getElementById('geoChartPanel');
        if (chartPanel) {
            chartPanel.innerHTML = `<div class="error-state">
                <i class="fas fa-triangle-exclamation"></i>
                <span>地理分布加载失败</span>
            </div>`;
        }
    }
}
