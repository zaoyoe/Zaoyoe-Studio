/**
 * Admin Analytics Runtime Controls
 * Date-range controls, refresh orchestration, and realtime toolbar helpers.
 */

let autoRefreshInterval = null;
let currentRefreshIntervalMs = 300000;
const ANALYTICS_ONLINE_USERS_CACHE_TTL_MS = 60000;
const analyticsOnlineUsersCache = {
    key: '',
    count: null,
    expiresAt: 0,
    pending: null,
    pendingKey: ''
};

function closeAnalyticsDateRangeDropdown() {
    document.getElementById('dateRangeDropdown')?.classList.remove('open');
    document.getElementById('inlineCalendar')?.classList.remove('visible');
}

function syncAnalyticsPresetButtonState(days = getAnalyticsRangeDays()) {
    const normalizedDays = Number(days);
    document.querySelectorAll('.preset-btn').forEach((button) => {
        button.classList.toggle('active', Number(button.dataset.range || 0) === normalizedDays);
    });
}

function initDateRangeControls() {
    const existingRange = getAnalyticsRangeState();
    const presetRange = buildAnalyticsPresetRange(DEFAULT_ANALYTICS_DAYS);

    if (existingRange.startDate && existingRange.endDate) {
        syncAnalyticsDateRange(
            existingRange.startDate,
            existingRange.endDate,
            existingRange.days,
            buildAnalyticsRangeLabel(existingRange)
        );
    } else {
        syncAnalyticsDateRange(presetRange.start, presetRange.end, presetRange.days, '最近 7 天');
    }

    syncAnalyticsPresetButtonState(getAnalyticsRangeDays());

    if (!analyticsRuntime.outsideClickBound) {
        document.addEventListener('click', (event) => {
            if (!event.target.closest('.date-range-dropdown')) {
                closeAnalyticsDateRangeDropdown();
            }
        });
        analyticsRuntime.outsideClickBound = true;
    }
}

function toggleDateRangeDropdown() {
    const dropdown = document.getElementById('dateRangeDropdown');
    if (!dropdown) return;

    const nextOpen = !dropdown.classList.contains('open');
    dropdown.classList.toggle('open', nextOpen);

    if (nextOpen) {
        initInlineCalendar();
    } else {
        document.getElementById('inlineCalendar')?.classList.remove('visible');
    }
}

function selectPresetRange(days) {
    const presetRange = buildAnalyticsPresetRange(days);
    const labels = { 7: '最近 7 天', 30: '最近 30 天', 90: '最近 90 天', 365: '最近 1 年' };

    syncAnalyticsDateRange(
        presetRange.start,
        presetRange.end,
        presetRange.days,
        labels[presetRange.days] || `最近 ${presetRange.days} 天`
    );

    syncAnalyticsPresetButtonState(presetRange.days);
    closeAnalyticsDateRangeDropdown();
    void refreshChartsWithDateRange(presetRange.days);
}

function initInlineCalendar() {
    const state = getAnalyticsInlineCalendarRuntimeState();
    const today = normalizeAnalyticsDate(new Date());
    const { days, startDate, endDate } = getAnalyticsRangeState();
    const normalizedEnd = normalizeAnalyticsDate(endDate) || today;
    const normalizedStart = normalizeAnalyticsDate(startDate) || buildAnalyticsPresetRange(days, normalizedEnd).start;

    state.year = normalizedEnd.getFullYear();
    state.month = normalizedEnd.getMonth();
    state.startDate = normalizedStart;
    state.endDate = normalizedEnd;
    state.selectingEnd = false;

    renderInlineCalendar();
    updateCustomDateDisplays();
    document.getElementById('inlineCalendar')?.classList.add('visible');
}

function renderInlineCalendar() {
    const state = getAnalyticsInlineCalendarRuntimeState();
    const { year, month, startDate, endDate } = state;
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    const title = document.getElementById('calendarTitle');
    if (title) title.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    const today = normalizeAnalyticsDate(new Date());

    let html = '';

    for (let index = startDayOfWeek - 1; index >= 0; index -= 1) {
        const day = prevMonthLastDay - index;
        html += `<div class="cal-day other-month" data-admin-action="analytics-inline-select-date" data-analytics-year="${year}" data-analytics-month="${month - 1}" data-analytics-day="${day}">${day}</div>`;
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = normalizeAnalyticsDate(new Date(year, month, day));
        const classes = ['cal-day'];

        if (today && date?.getTime() === today.getTime()) {
            classes.push('today');
        }

        if (startDate && endDate) {
            const start = normalizeAnalyticsDate(startDate);
            const end = normalizeAnalyticsDate(endDate);
            if (date?.getTime() === start?.getTime()) {
                classes.push('range-start');
            } else if (date?.getTime() === end?.getTime()) {
                classes.push('range-end');
            } else if (date > start && date < end) {
                classes.push('in-range');
            }
        } else if (startDate && date?.getTime() === normalizeAnalyticsDate(startDate)?.getTime()) {
            classes.push('selected');
        }

        html += `<div class="${classes.join(' ')}" data-admin-action="analytics-inline-select-date" data-analytics-year="${year}" data-analytics-month="${month}" data-analytics-day="${day}">${day}</div>`;
    }

    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day += 1) {
        html += `<div class="cal-day other-month" data-admin-action="analytics-inline-select-date" data-analytics-year="${year}" data-analytics-month="${month + 1}" data-analytics-day="${day}">${day}</div>`;
    }

    const container = document.getElementById('calendarDays');
    if (container) {
        container.innerHTML = html;
    }
}

function selectInlineDate(year, month, day, event) {
    event?.stopPropagation?.();

    const state = getAnalyticsInlineCalendarRuntimeState();
    const date = normalizeAnalyticsDate(new Date(year, month, day));
    if (!date) return;

    if (!state.selectingEnd || !state.startDate) {
        state.startDate = date;
        state.endDate = null;
        state.selectingEnd = true;
    } else {
        if (date < state.startDate) {
            state.endDate = state.startDate;
            state.startDate = date;
        } else {
            state.endDate = date;
        }
        state.selectingEnd = false;
    }

    state.year = year;
    state.month = month;

    renderInlineCalendar();
    updateCustomDateDisplays();
}

function updateCustomDateDisplays() {
    const state = getAnalyticsInlineCalendarRuntimeState();
    const startEl = document.getElementById('customStartDisplay');
    const endEl = document.getElementById('customEndDisplay');
    const hintEl = document.getElementById('calendarHint');
    const formatDisplay = (value) => `${value.getFullYear()}/${value.getMonth() + 1}/${value.getDate()}`;

    if (startEl) {
        startEl.textContent = state.startDate ? formatDisplay(state.startDate) : '选择开始日期';
    }

    if (endEl) {
        endEl.textContent = state.endDate ? formatDisplay(state.endDate) : '选择结束日期';
    }

    if (hintEl) {
        if (!state.startDate) {
            hintEl.textContent = '选择开始日期';
        } else if (state.selectingEnd) {
            hintEl.textContent = '选择结束日期';
        } else if (state.endDate) {
            hintEl.textContent = `${state.startDate.getMonth() + 1}/${state.startDate.getDate()} — ${state.endDate.getMonth() + 1}/${state.endDate.getDate()}`;
        } else {
            hintEl.textContent = '选择结束日期';
        }
    }
}

function changeInlineMonth(delta) {
    const state = getAnalyticsInlineCalendarRuntimeState();
    state.month += delta;

    if (state.month > 11) {
        state.month = 0;
        state.year += 1;
    } else if (state.month < 0) {
        state.month = 11;
        state.year -= 1;
    }

    renderInlineCalendar();
}

function resetInlineCalendar() {
    const state = getAnalyticsInlineCalendarRuntimeState();
    state.startDate = null;
    state.endDate = null;
    state.selectingEnd = false;
    renderInlineCalendar();
    updateCustomDateDisplays();
}

function setInlineToday() {
    const state = getAnalyticsInlineCalendarRuntimeState();
    const today = normalizeAnalyticsDate(new Date());
    const presetRange = buildAnalyticsPresetRange(DEFAULT_ANALYTICS_DAYS, today);

    state.year = today.getFullYear();
    state.month = today.getMonth();
    state.endDate = today;

    if (!state.startDate || state.startDate > today) {
        state.startDate = presetRange.start;
    }

    state.selectingEnd = false;
    renderInlineCalendar();
    updateCustomDateDisplays();
}

function toggleInlineCalendar(event) {
    event?.stopPropagation?.();

    const calendar = document.getElementById('inlineCalendar');
    if (!calendar) return;

    const nextVisible = !calendar.classList.contains('visible');
    calendar.classList.toggle('visible', nextVisible);

    if (nextVisible) {
        const state = getAnalyticsInlineCalendarRuntimeState();
        if (!state.startDate && !state.endDate) {
            initInlineCalendar();
            return;
        }

        renderInlineCalendar();
        updateCustomDateDisplays();
    }
}

function applyCustomRange() {
    const state = getAnalyticsInlineCalendarRuntimeState();

    if (!state.startDate || !state.endDate) {
        showToast('请选择开始和结束日期', 'error');
        return;
    }

    if (state.startDate > state.endDate) {
        showToast('开始日期不能晚于结束日期', 'error');
        return;
    }

    const days = getAnalyticsRangeDayDiff(state.startDate, state.endDate);
    syncAnalyticsDateRange(state.startDate, state.endDate, days);
    syncAnalyticsPresetButtonState(days);
    closeAnalyticsDateRangeDropdown();
    void refreshChartsWithDateRange(days);
}

async function refreshChartsWithDateRange(days) {
    console.log(`[Analytics] Refreshing charts for ${days} days`);

    try {
        const globalDateRange = getAnalyticsGlobalDateRangeState();
        if (Number.isFinite(Number(days)) && Number(days) > 0) {
            globalDateRange.days = Number(days);
        }
        resetAnalyticsAICache();
        await reloadAnalyticsDashboard({ reason: 'date-range-change' });
    } catch (error) {
        console.error('[Analytics] Error refreshing charts:', error);
    }
}

function ensureAnalyticsAutoRefreshState() {
    const toggle = document.getElementById('autoRefreshToggle');
    if (!toggle || !toggle.checked || !isAnalyticsModuleVisible()) {
        stopAutoRefresh();
        return;
    }

    startAutoRefresh();
}

function initRealtimeFeatures() {
    try {
        const savedInterval = window.localStorage?.getItem('analyticsAutoRefreshInterval');
        if (savedInterval) {
            currentRefreshIntervalMs = parseInt(savedInterval, 10) || currentRefreshIntervalMs;
            const selectEl = document.getElementById('autoRefreshInterval');
            if (selectEl) {
                selectEl.value = savedInterval;
            }
        }
    } catch (_error) {
        // Ignore storage failures and keep the default interval.
    }

    const toggle = document.getElementById('autoRefreshToggle');
    if (toggle && !toggle.dataset.analyticsBound) {
        toggle.addEventListener('change', function () {
            if (this.checked) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });
        toggle.dataset.analyticsBound = '1';
    }

    ensureAnalyticsAutoRefreshState();
    void updateOnlineUsers();
    updateLastUpdateTime();
}

function updateAutoRefreshInterval(ms) {
    currentRefreshIntervalMs = parseInt(ms, 10) || currentRefreshIntervalMs;

    try {
        window.localStorage?.setItem('analyticsAutoRefreshInterval', String(currentRefreshIntervalMs));
    } catch (_error) {
        // Ignore storage failures and keep the in-memory interval only.
    }

    const toggle = document.getElementById('autoRefreshToggle');
    if (toggle?.checked) {
        stopAutoRefresh();
        startAutoRefresh();
    }

    const intervalText = {
        60000: '1分钟',
        180000: '3分钟',
        300000: '5分钟',
        600000: '10分钟',
        900000: '15分钟',
        1800000: '30分钟'
    }[currentRefreshIntervalMs] || '5分钟';

    const toggleContainer = document.querySelector('.auto-refresh-toggle');
    if (toggleContainer) {
        toggleContainer.title = `自动刷新 (${intervalText})`;
    }

    showToast(`自动刷新间隔已更新为 ${intervalText}`, 'success');
}

function getAnalyticsRefreshButtonIcons() {
    return Array.from(document.querySelectorAll(
        '[data-admin-action="analytics-refresh-data"] i.fa-sync-alt, .btn-icon-sm i.fa-redo'
    ));
}

function getAnalyticsRefreshIndicatorScopeId() {
    if (typeof getActiveAnalyticsSidebarModuleId === 'function') {
        return String(getActiveAnalyticsSidebarModuleId() || '').trim().toLowerCase();
    }

    const activeModuleId = String(document.querySelector('.module-container.active')?.id || '')
        .replace(/^module-/, '')
        .trim()
        .toLowerCase();
    return activeModuleId;
}

function isAnalyticsRefreshIndicatorScopeActive() {
    const scopeId = getAnalyticsRefreshIndicatorScopeId();
    return scopeId === 'growth-center' || scopeId === 'commerce-center';
}

function syncAnalyticsRefreshIndicator() {
    const isBusy = Number(analyticsRuntime.refreshIndicatorBusyCount || 0) > 0
        && isAnalyticsModuleVisible()
        && isAnalyticsRefreshIndicatorScopeActive();
    analyticsRuntime.refreshIndicatorActive = isBusy;

    getAnalyticsRefreshButtonIcons().forEach((icon) => {
        icon.classList.toggle('fa-spin', isBusy);
        const button = icon.closest('button');
        if (button) {
            button.classList.toggle('is-loading', isBusy);
            button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
        }
    });
}

function beginAnalyticsRefreshIndicator() {
    if (!isAnalyticsModuleVisible() || !isAnalyticsRefreshIndicatorScopeActive()) {
        return () => {};
    }

    analyticsRuntime.refreshIndicatorBusyCount = Number(analyticsRuntime.refreshIndicatorBusyCount || 0) + 1;
    syncAnalyticsRefreshIndicator();

    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        analyticsRuntime.refreshIndicatorBusyCount = Math.max(0, Number(analyticsRuntime.refreshIndicatorBusyCount || 0) - 1);
        syncAnalyticsRefreshIndicator();
    };
}

function startAutoRefresh() {
    if (autoRefreshInterval || !isAnalyticsModuleVisible()) return;

    autoRefreshInterval = setInterval(() => {
        void refreshAllAnalytics({ silent: true, reason: 'auto-refresh' });
    }, currentRefreshIntervalMs);

    console.log(`[Analytics] Auto refresh started (${currentRefreshIntervalMs / 1000}s interval)`);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }

    console.log('[Analytics] Auto refresh stopped');
}

function toggleCustomDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    document.querySelectorAll('.custom-dropdown.open').forEach((element) => {
        if (element.id !== dropdownId) {
            element.classList.remove('open');
        }
    });

    dropdown.classList.toggle('open');
}

function selectDropdownOption(dropdownId, value, label) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const valueEl = dropdown.querySelector('.dropdown-value');
    if (valueEl) {
        valueEl.textContent = label;
    }

    dropdown.querySelectorAll('.dropdown-option').forEach((option) => {
        option.classList.toggle('selected', option.dataset.value === value);
    });

    dropdown.classList.remove('open');

    if (dropdownId === 'refreshIntervalDropdown') {
        updateAutoRefreshInterval(value);
    } else if (dropdownId === 'lockoutDurationDropdown') {
        void saveSecurityDropdownSetting('lockout_duration', parseInt(value, 10));
    } else if (dropdownId === 'sessionTimeoutDropdown') {
        void saveSecurityDropdownSetting('session_timeout', parseInt(value, 10));
    }
}

async function saveSecurityDropdownSetting(key, value) {
    try {
        const { data: currentData } = await getAnalyticsSupabaseClient()
            .from('system_config')
            .select('value')
            .eq('key', 'security')
            .single();

        const config = currentData?.value || {
            login_lockout_attempts: 5,
            lockout_duration: 900000,
            session_timeout: 3600000
        };

        config[key] = value;

        const { error } = await getAnalyticsSupabaseClient().rpc('update_system_config', {
            p_key: 'security',
            p_value: config
        });

        if (error) throw error;

        console.log(`✅ 安全设置已保存: ${key} = ${value}`);
        if (typeof showToast === 'function') {
            showToast('设置已保存', 'success');
        }
    } catch (error) {
        console.error('保存安全设置失败:', error);
        if (typeof showToast === 'function') {
            showToast(`保存失败: ${error.message}`, 'error');
        }
    }
}

if (!analyticsRuntime.customDropdownOutsideClickBound) {
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.custom-dropdown')) {
            document.querySelectorAll('.custom-dropdown.open').forEach((element) => element.classList.remove('open'));
        }
    });
    analyticsRuntime.customDropdownOutsideClickBound = true;
}

async function refreshAllAnalytics(options = {}) {
    console.log('[Analytics] Refreshing all data...');
    const { silent = false, reason = 'manual-refresh' } = options;

    if (!isAnalyticsModuleVisible()) {
        stopAutoRefresh();
        return;
    }

    try {
        if (reason !== 'auto-refresh') {
            resetAnalyticsAICache();
        }

        await reloadAnalyticsDashboard({
            reason,
            force: reason === 'manual-refresh'
        });

        if (!silent && typeof showToast === 'function') {
            showToast('数据已刷新', 'success');
        }
    } catch (error) {
        console.error('[Analytics] Refresh error:', error);
        if (!silent && typeof showToast === 'function') {
            showToast('刷新失败', 'error');
        }
    } finally {
        syncAnalyticsRefreshIndicator();
    }
}

async function updateOnlineUsers() {
    let requestPromise = null;
    try {
        const countEl = document.getElementById('onlineUsersCount');
        if (!countEl) return;
        const options = arguments[0] || {};
        const force = options?.force === true;
        const cacheKey = window.AdminSiteFilter?.getSiteFilter?.() || 'all';
        const cacheValid = (
            !force
            && analyticsOnlineUsersCache.key === cacheKey
            && Number.isFinite(analyticsOnlineUsersCache.count)
            && analyticsOnlineUsersCache.expiresAt > Date.now()
        );

        if (cacheValid) {
            countEl.textContent = String(analyticsOnlineUsersCache.count);
            return analyticsOnlineUsersCache.count;
        }

        if (!force && analyticsOnlineUsersCache.pending && analyticsOnlineUsersCache.pendingKey === cacheKey) {
            const pendingCount = await analyticsOnlineUsersCache.pending;
            const latestCountEl = document.getElementById('onlineUsersCount');
            if (latestCountEl && (window.AdminSiteFilter?.getSiteFilter?.() || 'all') === cacheKey) {
                latestCountEl.textContent = String(pendingCount);
            }
            return pendingCount;
        }

        requestPromise = (async () => {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const siteParam = window.AdminSiteFilter?.getSiteParam?.() || null;
            const analyticsClient = getAnalyticsSupabaseClient();

            if (typeof analyticsClient?.rpc === 'function') {
                try {
                    const { data, error } = await analyticsClient.rpc('get_online_user_count', {
                        p_window_minutes: 5,
                        p_site: siteParam
                    });
                    const rpcCount = Number(data);
                    if (!error && Number.isFinite(rpcCount)) {
                        return Math.max(0, rpcCount);
                    }
                } catch (_error) {
                    // Keep the table-based fallback for environments that have not
                    // applied the online-user RPC migration yet.
                }
            }

            const uniqueUsers = new Set();
            const addUserIds = (rows = []) => {
                rows.forEach((row) => {
                    if (row?.user_id) {
                        uniqueUsers.add(row.user_id);
                    }
                });
            };
            await Promise.allSettled([
                (async () => {
                    try {
                        let commentsQuery = getAnalyticsSupabaseClient()
                            .from('prompt_comments')
                            .select('user_id')
                            .gte('created_at', fiveMinutesAgo);
                        commentsQuery = window.AdminSiteFilter?.applySiteFilter(commentsQuery) || commentsQuery;
                        const { data } = await commentsQuery;
                        addUserIds(Array.isArray(data) ? data : []);
                    } catch (_error) {
                        console.warn('[Analytics] Comments query failed');
                    }
                })(),
                (async () => {
                    try {
                        let likesQuery = getAnalyticsSupabaseClient()
                            .from('comment_likes')
                            .select('user_id')
                            .gte('created_at', fiveMinutesAgo);
                        likesQuery = window.AdminSiteFilter?.applySiteFilter(likesQuery) || likesQuery;
                        const { data } = await likesQuery;
                        addUserIds(Array.isArray(data) ? data : []);
                    } catch (_error) {
                        console.warn('[Analytics] Likes query failed');
                    }
                })(),
                (async () => {
                    try {
                        let eventsQuery = getAnalyticsSupabaseClient()
                            .from('user_events')
                            .select('user_id')
                            .gte('created_at', fiveMinutesAgo);
                        eventsQuery = window.AdminSiteFilter?.applySiteFilter(eventsQuery) || eventsQuery;
                        const { data } = await eventsQuery;
                        addUserIds(Array.isArray(data) ? data : []);
                    } catch (_error) {
                        // user_events may be unavailable in some environments.
                    }
                })()
            ]);

            if (uniqueUsers.size === 0 && !siteParam) {
                try {
                    // profiles has no site column in the current schema, so only use
                    // this coarse fallback for the all-sites view.
                    const { count } = await getAnalyticsSupabaseClient()
                        .from('profiles')
                        .select('*', { count: 'exact', head: true })
                        .gte('updated_at', fiveMinutesAgo);

                    return Number(count || 0);
                } catch (_error) {
                    // Fall through to the default zero state below.
                }
            }

            return uniqueUsers.size;
        })();

        analyticsOnlineUsersCache.pending = requestPromise;
        analyticsOnlineUsersCache.pendingKey = cacheKey;

        const count = await requestPromise;
        analyticsOnlineUsersCache.key = cacheKey;
        analyticsOnlineUsersCache.count = count;
        analyticsOnlineUsersCache.expiresAt = Date.now() + ANALYTICS_ONLINE_USERS_CACHE_TTL_MS;

        const latestCountEl = document.getElementById('onlineUsersCount');
        if (latestCountEl && (window.AdminSiteFilter?.getSiteFilter?.() || 'all') === cacheKey) {
            latestCountEl.textContent = String(count);
        }

        return count;
    } catch (error) {
        console.warn('[Analytics] Online users error:', error.message);
        const countEl = document.getElementById('onlineUsersCount');
        if (countEl) {
            countEl.textContent = '0';
        }
        return 0;
    } finally {
        if (requestPromise && analyticsOnlineUsersCache.pending === requestPromise) {
            analyticsOnlineUsersCache.pending = null;
            analyticsOnlineUsersCache.pendingKey = '';
        }
    }
}

function updateLastUpdateTime() {
    const element = document.getElementById('lastUpdateTime');
    const timeLabel = getAnalyticsRefreshTimeLabel();
    if (element) {
        element.textContent = timeLabel;
    }
    updateAnalyticsPanelNotes(timeLabel);
}

function viewPromptContext(promptId) {
    if (!promptId) return;
    window.open(`prompts.html#prompt-${promptId}`, '_blank');
}

document.addEventListener('DOMContentLoaded', () => {
    const initAnalyticsBoot = () => {
        setTimeout(initDateRangeControls, 500);
        setTimeout(initRealtimeFeatures, 1000);
    };

    if (window.adminStudioAccessGranted) {
        initAnalyticsBoot();
        return;
    }

    window.addEventListener('adminStudioAccessGranted', initAnalyticsBoot, { once: true });
});

window.toggleDateRangeDropdown = toggleDateRangeDropdown;
window.selectPresetRange = selectPresetRange;
window.applyCustomRange = applyCustomRange;
window.changeInlineMonth = changeInlineMonth;
window.selectInlineDate = selectInlineDate;
window.resetInlineCalendar = resetInlineCalendar;
window.setInlineToday = setInlineToday;
window.toggleInlineCalendar = toggleInlineCalendar;
window.updateAutoRefreshInterval = updateAutoRefreshInterval;
window.toggleCustomDropdown = toggleCustomDropdown;
window.selectDropdownOption = selectDropdownOption;
window.refreshAllAnalytics = refreshAllAnalytics;
window.viewPromptContext = viewPromptContext;
window.ensureAnalyticsAutoRefreshState = ensureAnalyticsAutoRefreshState;
window.beginAnalyticsRefreshIndicator = beginAnalyticsRefreshIndicator;
window.syncAnalyticsRefreshIndicator = syncAnalyticsRefreshIndicator;
window.updateOnlineUsers = updateOnlineUsers;
window.updateLastUpdateTime = updateLastUpdateTime;
