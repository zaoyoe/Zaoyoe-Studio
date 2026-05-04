(function () {
    const PERSONAL_MESSAGE_TITLE = '个人消息';
    const EMPTY_PERSONAL_MESSAGE_TEXT = '暂无个人消息';
    const EMPTY_ADMIN_PERSONAL_MESSAGE_TEXT = '暂无个人提醒';
    const ADMIN_PERSONAL_NOTIFICATION_ALLOW_TITLE_PATTERNS = [
        /客服回复/,
        /系统公告/,
        /账号/,
        /权限/,
        /安全/,
        /指派/,
        /提醒/,
        /审核/,
        /处理结果/,
        /个人消息/
    ];
    const ADMIN_OPS_NOTIFICATION_BLOCK_TITLE_PATTERNS = [
        /库存/,
        /补货/,
        /履约/,
        /支付/,
        /验证/,
        /工单超时/,
        /风险/,
        /异常登录/,
        /客服消息汇总/,
        /购买成功汇总/,
        /充值成功汇总/,
        /库存与补货汇总/,
        /工单超时汇总/,
        /履约失败汇总/,
        /支付通道异常汇总/,
        /验证额度告警汇总/,
        /验证堆积告警汇总/,
        /验证失败率告警汇总/
    ];
    const ADMIN_PERSONAL_CATEGORY_META = Object.freeze({
        assignment: Object.freeze({
            label: '待办转交',
            icon: 'fa-user-check',
            tone: 'assignment',
            defaultType: 'info'
        }),
        security: Object.freeze({
            label: '安全提醒',
            icon: 'fa-shield-halved',
            tone: 'security',
            defaultType: 'alert'
        }),
        announcement: Object.freeze({
            label: '公告协同',
            icon: 'fa-bullhorn',
            tone: 'announcement',
            defaultType: 'info'
        }),
        admin_notice: Object.freeze({
            label: '管理通知',
            icon: 'fa-bell',
            tone: 'admin-notice',
            defaultType: 'info'
        })
    });
    const ADMIN_PERSONAL_FILTER_ORDER = Object.freeze([
        'all',
        'assignment',
        'security',
        'announcement',
        'admin_notice'
    ]);
    const NOTIFICATION_READ_FILTER_ORDER = Object.freeze([
        'all',
        'unread',
        'read'
    ]);
    const NOTIFICATION_PINNED_STORAGE_KEY = 'notifications_pinned_v1';
    const NOTIFICATION_FILTER_STORAGE_KEY = 'notifications_filters_v1';
    const NOTIFICATION_LOADING_TEXT = '正在加载个人消息...';
    const ADMIN_NOTIFICATION_LOADING_TEXT = '正在加载个人提醒...';
    const NOTIFICATION_LOAD_ERROR_TEXT = '个人消息加载失败，请稍后重试';
    const NOTIFICATION_CLIENT_READY_TIMEOUT_MS = 10000;
    const NOTIFICATION_ADMIN_ACCESS_READY_TIMEOUT_MS = 1800;
    const NOTIFICATION_READY_POLL_MS = 120;
    const NOTIFICATION_RUNTIME_RETRY_MS = 1400;
    const NOTIFICATION_SWIPE_OPEN_THRESHOLD_PX = 54;
    const NOTIFICATION_SWIPE_MAX_OFFSET_PX = 188;
    const NOTIFICATION_SWIPE_CLICK_SUPPRESS_MS = 520;
    const NOTIFICATION_SWIPE_INTENT_THRESHOLD_PX = 14;
    const NOTIFICATION_SWIPE_CLICK_DRAG_THRESHOLD_PX = 24;
    const NOTIFICATION_TAP_ACTIVATE_THRESHOLD_PX = 10;

    // State
    let notifications = [];
    let unreadCount = 0;
    let notificationsLoaded = false;
    let notificationsLoading = false;
    let notificationLoadError = '';
    let notificationInitPromise = null;
    let notificationFetchPromise = null;
    let notificationActiveUserId = '';
    let notificationRealtimeChannel = null;
    let notificationRealtimeUserId = '';
    let notifSwipeShell = null;
    let notifSwipePointerId = null;
    let notifSwipeStartX = 0;
    let notifSwipeStartY = 0;
    let notifSwipeDeltaX = 0;
    let notifSwipeRawDeltaX = 0;
    let notifSwipeRawDeltaY = 0;
    let notifSwipeTracking = false;
    let notifSwipeLocked = false;
    let notifSwipePointerCaptureTarget = null;
    let notifSwipeSuppressClickShell = null;
    let notifSwipeSuppressClickUntil = 0;
    let notifScrollLocked = false;
    let notifSavedScrollY = 0;
    let notifTouchStartY = 0;
    const restoredNotificationFilterState = loadNotificationFilterState();
    let preferredAdminNotificationFilter = restoredNotificationFilterState.adminCategory;
    let currentAdminNotificationFilter = restoredNotificationFilterState.adminCategory;
    let currentNotificationReadFilter = restoredNotificationFilterState.readFilter;
    let pinnedNotificationIds = loadPinnedNotificationIds();
    const NOTIFICATION_MOBILE_MOTION_MS = 360;
    const NOTIFICATION_MOBILE_ENTRY_MS = 1480;
    const NOTIFICATION_MOBILE_CLOSE_MS = 1080;
    const NOTIFICATION_CHROME_REPAINT_FALLBACK_MS = 96;
    const NOTIFICATION_CHROME_REPAINT_LATE_MS = 220;
    let notificationChromeRepaintTimerIds = [];
    let notificationDrawerOpeningTimerId = null;
    let notificationDrawerClosingTimerId = null;
    let notificationContentEntryTimerId = null;
    let notificationRuntimeRetryTimerId = null;
    let currentNotificationViewer = {
        isAdmin: false
    };

    function normalizeText(value) {
        return String(value || '').trim();
    }

    function isSupabaseClientReady() {
        return Boolean(
            window.supabaseClient
            && typeof window.supabaseClient.from === 'function'
            && window.supabaseClient.auth
            && typeof window.supabaseClient.auth.getUser === 'function'
        );
    }

    function waitForRuntime(predicate, timeoutMs, pollMs = NOTIFICATION_READY_POLL_MS, eventName = '') {
        if (typeof predicate === 'function' && predicate()) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const startedAt = Date.now();
            let timerId = 0;
            let settled = false;

            const cleanup = () => {
                if (timerId) {
                    window.clearTimeout(timerId);
                    timerId = 0;
                }
                if (eventName) {
                    window.removeEventListener(eventName, checkReady);
                }
            };

            const finish = (ready) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(Boolean(ready));
            };

            const schedule = () => {
                timerId = window.setTimeout(checkReady, Math.max(40, Number(pollMs) || NOTIFICATION_READY_POLL_MS));
            };

            function checkReady() {
                if (typeof predicate === 'function' && predicate()) {
                    finish(true);
                    return;
                }
                if ((Date.now() - startedAt) >= Math.max(0, Number(timeoutMs) || 0)) {
                    finish(false);
                    return;
                }
                schedule();
            }

            if (eventName) {
                window.addEventListener(eventName, checkReady);
            }
            schedule();
        });
    }

    async function waitForSupabaseClientReady() {
        const ready = await waitForRuntime(
            isSupabaseClientReady,
            NOTIFICATION_CLIENT_READY_TIMEOUT_MS,
            NOTIFICATION_READY_POLL_MS,
            'zaoyoe:supabase-client-state'
        );
        return ready ? window.supabaseClient : null;
    }

    async function waitForAdminAccessRuntime() {
        await waitForRuntime(
            () => typeof window.AdminAccess?.getCurrentAdminAccess === 'function',
            NOTIFICATION_ADMIN_ACCESS_READY_TIMEOUT_MS,
            NOTIFICATION_READY_POLL_MS
        );
    }

    function clearNotificationRuntimeRetryTimer() {
        if (notificationRuntimeRetryTimerId) {
            window.clearTimeout(notificationRuntimeRetryTimerId);
            notificationRuntimeRetryTimerId = null;
        }
    }

    function scheduleNotificationRuntimeRetry() {
        if (notificationRuntimeRetryTimerId || notificationsLoaded) {
            return;
        }

        notificationRuntimeRetryTimerId = window.setTimeout(() => {
            notificationRuntimeRetryTimerId = null;
            if (notificationsLoaded) {
                return;
            }
            void window.initNotificationSystem?.({ forceRefresh: true });
        }, NOTIFICATION_RUNTIME_RETRY_MS);
    }

    function keepNotificationDrawerLoadingAndRetry() {
        if (notifications.length === 0) {
            notificationsLoading = true;
        }
        notificationLoadError = '';
        renderOpenNotificationDrawer();
        scheduleNotificationRuntimeRetry();
    }

    function normalizeAdminNotificationFilterValue(value) {
        const normalized = normalizeText(value).toLowerCase();
        return ADMIN_PERSONAL_FILTER_ORDER.includes(normalized) ? normalized : 'all';
    }

    function normalizeNotificationReadFilterValue(value) {
        const normalized = normalizeText(value).toLowerCase();
        return NOTIFICATION_READ_FILTER_ORDER.includes(normalized) ? normalized : 'all';
    }

    function loadNotificationFilterState() {
        if (typeof window === 'undefined' || !window.localStorage) {
            return {
                adminCategory: 'all',
                readFilter: 'all'
            };
        }

        try {
            const raw = window.localStorage.getItem(NOTIFICATION_FILTER_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return {
                adminCategory: normalizeAdminNotificationFilterValue(parsed?.adminCategory || parsed?.admin_category),
                readFilter: normalizeNotificationReadFilterValue(parsed?.readFilter || parsed?.read_filter)
            };
        } catch (error) {
            console.warn('Failed to restore notification filters:', error?.message || error);
            return {
                adminCategory: 'all',
                readFilter: 'all'
            };
        }
    }

    function persistNotificationFilterState() {
        if (typeof window === 'undefined' || !window.localStorage) {
            return;
        }

        const payload = {
            adminCategory: normalizeAdminNotificationFilterValue(preferredAdminNotificationFilter),
            readFilter: normalizeNotificationReadFilterValue(currentNotificationReadFilter)
        };

        if (payload.adminCategory === 'all' && payload.readFilter === 'all') {
            window.localStorage.removeItem(NOTIFICATION_FILTER_STORAGE_KEY);
            return;
        }

        window.localStorage.setItem(NOTIFICATION_FILTER_STORAGE_KEY, JSON.stringify(payload));
    }

    function syncNotificationFilterStateForViewer() {
        preferredAdminNotificationFilter = normalizeAdminNotificationFilterValue(preferredAdminNotificationFilter);
        currentNotificationReadFilter = normalizeNotificationReadFilterValue(currentNotificationReadFilter);
        currentAdminNotificationFilter = currentNotificationViewer.isAdmin
            ? preferredAdminNotificationFilter
            : 'all';
    }

    function loadPinnedNotificationIds() {
        if (typeof window === 'undefined' || !window.localStorage) {
            return new Set();
        }

        try {
            const raw = window.localStorage.getItem(NOTIFICATION_PINNED_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return new Set(
                (Array.isArray(parsed) ? parsed : [])
                    .map((value) => normalizeText(value))
                    .filter(Boolean)
            );
        } catch (error) {
            console.warn('Failed to restore pinned notifications:', error?.message || error);
            return new Set();
        }
    }

    function persistPinnedNotificationIds() {
        if (typeof window === 'undefined' || !window.localStorage) {
            return;
        }

        const values = Array.from(pinnedNotificationIds).filter(Boolean);
        if (!values.length) {
            window.localStorage.removeItem(NOTIFICATION_PINNED_STORAGE_KEY);
            return;
        }

        window.localStorage.setItem(NOTIFICATION_PINNED_STORAGE_KEY, JSON.stringify(values));
    }

    function getNotificationId(notificationOrId) {
        if (notificationOrId && typeof notificationOrId === 'object') {
            return normalizeText(notificationOrId.id);
        }
        return normalizeText(notificationOrId);
    }

    function syncNotificationPinnedState(sourceNotifications = notifications) {
        let shouldPersist = false;
        (Array.isArray(sourceNotifications) ? sourceNotifications : []).forEach((notification) => {
            const notificationId = getNotificationId(notification);
            if (!notificationId) {
                notification.is_pinned = notification?.is_pinned === true;
                return;
            }

            if (notification?.is_pinned === true && !pinnedNotificationIds.has(notificationId)) {
                pinnedNotificationIds.add(notificationId);
                shouldPersist = true;
            }

            notification.is_pinned = pinnedNotificationIds.has(notificationId) || notification?.is_pinned === true;
        });

        if (shouldPersist) {
            persistPinnedNotificationIds();
        }

        return sourceNotifications;
    }

    function prunePinnedNotificationIds(sourceNotifications = notifications) {
        const activeIds = new Set(
            (Array.isArray(sourceNotifications) ? sourceNotifications : [])
                .map((notification) => getNotificationId(notification))
                .filter(Boolean)
        );
        let changed = false;

        Array.from(pinnedNotificationIds).forEach((notificationId) => {
            if (!activeIds.has(notificationId)) {
                pinnedNotificationIds.delete(notificationId);
                changed = true;
            }
        });

        if (changed) {
            persistPinnedNotificationIds();
        }
    }

    function getSortedNotifications(sourceNotifications = notifications) {
        return [...(Array.isArray(sourceNotifications) ? sourceNotifications : [])].sort((left, right) => {
            const pinnedDelta = Number(right?.is_pinned === true) - Number(left?.is_pinned === true);
            if (pinnedDelta !== 0) {
                return pinnedDelta;
            }

            const unreadDelta = Number(left?.is_read !== true) - Number(right?.is_read !== true);
            if (unreadDelta !== 0) {
                return unreadDelta;
            }

            return String(right?.created_at || '').localeCompare(String(left?.created_at || ''));
        });
    }

    function getNotificationEmptyText() {
        if (currentNotificationViewer.isAdmin && currentAdminNotificationFilter !== 'all') {
            const filterMeta = ADMIN_PERSONAL_CATEGORY_META[currentAdminNotificationFilter];
            if (filterMeta) {
                if (currentNotificationReadFilter === 'unread') {
                    return `暂无未读${filterMeta.label}`;
                }
                if (currentNotificationReadFilter === 'read') {
                    return `暂无已读${filterMeta.label}`;
                }
                return `暂无${filterMeta.label}`;
            }
        }

        if (currentNotificationReadFilter === 'unread') {
            return currentNotificationViewer.isAdmin ? '暂无未读提醒' : '暂无未读消息';
        }

        if (currentNotificationReadFilter === 'read') {
            return currentNotificationViewer.isAdmin ? '暂无已读提醒' : '暂无已读消息';
        }

        return currentNotificationViewer.isAdmin
            ? EMPTY_ADMIN_PERSONAL_MESSAGE_TEXT
            : EMPTY_PERSONAL_MESSAGE_TEXT;
    }

    function getNotificationLoadingText() {
        return currentNotificationViewer.isAdmin
            ? ADMIN_NOTIFICATION_LOADING_TEXT
            : NOTIFICATION_LOADING_TEXT;
    }

    function getNotificationLoadingHtml() {
        const label = escapeHtml(getNotificationLoadingText());
        return `
            <div class="notif-empty notif-empty--loading" role="status" aria-label="${label}">
                <span class="notif-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span>
            </div>
        `;
    }

    function renderNotificationLoadingState(list) {
        const existingLoading = list?.querySelector?.('.notif-empty--loading');
        if (existingLoading instanceof HTMLElement) {
            existingLoading.setAttribute('aria-label', getNotificationLoadingText());
            return;
        }
        list.innerHTML = getNotificationLoadingHtml();
    }

    function getNotificationLoadErrorText() {
        return notificationLoadError || NOTIFICATION_LOAD_ERROR_TEXT;
    }

    function matchesAnyPattern(value, patterns = []) {
        return patterns.some((pattern) => pattern.test(value));
    }

    function normalizeNotificationScope(value) {
        const normalized = normalizeText(value).toLowerCase();
        if (['unspecified', 'user_personal', 'admin_personal'].includes(normalized)) {
            return normalized;
        }
        return '';
    }

    function normalizeNotificationCategory(value) {
        return normalizeText(value).toLowerCase();
    }

    function inferLegacyAdminPersonalCategory(notification) {
        const title = normalizeText(notification?.title);
        const content = normalizeText(notification?.content);
        const combinedText = `${title}\n${content}`;
        if (!combinedText.trim()) {
            return '';
        }

        if (/(转交|指派|代办)/.test(combinedText)) {
            return 'assignment';
        }
        if (/(异常登录|安全|账号|权限)/.test(combinedText)) {
            return 'security';
        }
        if (/(系统公告|站内公告|公告)/.test(combinedText)) {
            return 'announcement';
        }
        if (matchesAnyPattern(combinedText, ADMIN_PERSONAL_NOTIFICATION_ALLOW_TITLE_PATTERNS)) {
            return 'admin_notice';
        }

        return '';
    }

    function getAdminPersonalNotificationCategory(notification) {
        const explicitCategory = normalizeNotificationCategory(notification?.category);
        if (ADMIN_PERSONAL_CATEGORY_META[explicitCategory]) {
            return explicitCategory;
        }

        const inferredCategory = inferLegacyAdminPersonalCategory(notification);
        if (inferredCategory) {
            return inferredCategory;
        }

        return normalizeNotificationScope(notification?.scope) === 'admin_personal'
            ? 'admin_notice'
            : '';
    }

    function getAdminPersonalNotificationMeta(notification) {
        const category = getAdminPersonalNotificationCategory(notification);
        if (!category) {
            return null;
        }

        const meta = ADMIN_PERSONAL_CATEGORY_META[category];
        if (!meta) {
            return null;
        }

        return {
            key: category,
            ...meta
        };
    }

    function shouldShowAdminPersonalNotification(notification) {
        const scope = normalizeNotificationScope(notification?.scope);
        const category = getAdminPersonalNotificationCategory(notification);
        if (scope === 'admin_personal') {
            return true;
        }
        if (scope === 'user_personal') {
            return Boolean(category);
        }

        const title = normalizeText(notification?.title);
        const content = normalizeText(notification?.content);
        const combinedText = `${title}\n${content}`;

        if (!title && !content) {
            return false;
        }

        if (matchesAnyPattern(combinedText, ADMIN_OPS_NOTIFICATION_BLOCK_TITLE_PATTERNS)) {
            return false;
        }

        if (category) {
            return true;
        }

        return false;
    }

    function shouldShowUserPersonalNotification(notification) {
        const scope = normalizeNotificationScope(notification?.scope);
        if (scope === 'admin_personal') {
            return false;
        }
        if (scope === 'user_personal') {
            return true;
        }

        const title = normalizeText(notification?.title);
        const content = normalizeText(notification?.content);
        const combinedText = `${title}\n${content}`;

        if (!title && !content) {
            return false;
        }

        return !matchesAnyPattern(combinedText, ADMIN_OPS_NOTIFICATION_BLOCK_TITLE_PATTERNS);
    }

    function shouldIncludeNotification(notification) {
        if (!notification || typeof notification !== 'object') {
            return false;
        }

        if (!currentNotificationViewer.isAdmin) {
            return shouldShowUserPersonalNotification(notification);
        }

        return shouldShowAdminPersonalNotification(notification);
    }

    async function resolveNotificationViewer() {
        try {
            await waitForAdminAccessRuntime();
            const access = await window.AdminAccess?.getCurrentAdminAccess?.({ forceRefresh: true });
            currentNotificationViewer = {
                isAdmin: Boolean(access?.isAdmin)
            };
        } catch (error) {
            console.warn('Failed to resolve notification viewer access:', error?.message || error);
            currentNotificationViewer = {
                isAdmin: false
            };
        }

        syncNotificationFilterStateForViewer();
    }

    function getDrawerListFromTarget(target) {
        if (!target || typeof target.closest !== 'function') return null;
        const cardList = target.closest('.notif-card-list');
        if (cardList instanceof HTMLElement) {
            return cardList;
        }

        const module = target.closest('.notif-module-container');
        const moduleCardList = module?.querySelector?.('.notif-card-list');
        if (moduleCardList instanceof HTMLElement) {
            return moduleCardList;
        }

        return target.closest('#notifDrawerList');
    }

    function canScrollInList(container, deltaY) {
        if (!container) return false;
        const maxScrollTop = container.scrollHeight - container.clientHeight;
        if (maxScrollTop <= 0) return false;
        if (deltaY < 0 && container.scrollTop <= 0) return false;
        if (deltaY > 0 && container.scrollTop >= maxScrollTop - 1) return false;
        return true;
    }

    function handleNotifTouchStart(e) {
        if (!notifScrollLocked) return;
        notifTouchStartY = e.touches?.[0]?.clientY ?? 0;
    }

    function handleNotifTouchMove(e) {
        if (!notifScrollLocked) return;

        const list = getDrawerListFromTarget(e.target);
        if (!list) {
            e.preventDefault();
            return;
        }

        const currentY = e.touches?.[0]?.clientY ?? notifTouchStartY;
        const deltaY = notifTouchStartY - currentY;
        if (!canScrollInList(list, deltaY)) {
            e.preventDefault();
        }
        notifTouchStartY = currentY;
    }

    function handleNotifWheel(e) {
        if (!notifScrollLocked) return;

        const list = getDrawerListFromTarget(e.target);
        if (!list) {
            e.preventDefault();
            return;
        }

        if (!canScrollInList(list, e.deltaY)) {
            e.preventDefault();
        }
    }

    function lockNotificationBackgroundScroll() {
        if (notifScrollLocked) return;

        notifSavedScrollY = window.scrollY || window.pageYOffset || 0;

        document.documentElement.classList.add('notif-scroll-locked');
        document.body.classList.add('notif-scroll-locked');

        document.addEventListener('touchstart', handleNotifTouchStart, { passive: true });
        document.addEventListener('touchmove', handleNotifTouchMove, { passive: false });
        document.addEventListener('wheel', handleNotifWheel, { passive: false });

        notifScrollLocked = true;
    }

    function unlockNotificationBackgroundScroll() {
        if (!notifScrollLocked) return;

        document.removeEventListener('touchstart', handleNotifTouchStart);
        document.removeEventListener('touchmove', handleNotifTouchMove);
        document.removeEventListener('wheel', handleNotifWheel);

        document.documentElement.classList.remove('notif-scroll-locked');
        document.body.classList.remove('notif-scroll-locked');
        window.scrollTo(0, notifSavedScrollY);
        notifScrollLocked = false;
    }

    // Create Drawer HTML
    function createDrawerHTML() {
        if (document.getElementById('notifDrawer')) return;

        const backdrop = document.createElement('div');
        backdrop.id = 'notifBackdrop';
        backdrop.className = 'notif-backdrop';
        backdrop.onclick = closeDrawer;
        document.body.appendChild(backdrop);

        const drawer = document.createElement('div');
        drawer.id = 'notifDrawer';
        drawer.className = 'notif-drawer';
        drawer.setAttribute('aria-label', PERSONAL_MESSAGE_TITLE);
        drawer.innerHTML = `
            <div class="notif-drawer-list" id="notifDrawerList">
                <div class="notif-empty" data-i18n="nav.noNotifications">${getNotificationEmptyText()}</div>
            </div>
            <div class="notif-drawer-footer">
                <button type="button" class="notif-close-btn" data-notif-action="close-drawer" aria-label="收起通知">
                    <i class="fas fa-chevron-up"></i>
                    <span>收起通知</span>
                </button>
            </div>
        `;
        document.body.appendChild(drawer);
        drawer.addEventListener('click', handleDrawerClick);

        // Attach Event Delegation
        const list = document.getElementById('notifDrawerList');
        if (list) {
            list.addEventListener('click', handleDrawerListClick);
            list.addEventListener('keydown', handleDrawerListKeydown);
            list.addEventListener('pointerdown', handleNotificationCardPointerDown);
            list.addEventListener('pointermove', handleNotificationCardPointerMove);
            list.addEventListener('pointerup', handleNotificationCardPointerEnd);
            list.addEventListener('pointercancel', handleNotificationCardPointerCancel);
            list.addEventListener('wheel', handleNotificationCardWheel, { passive: false });
        }
    }

    function handleDrawerClick(e) {
        const actionEl = e.target.closest('[data-notif-action]');
        if (!actionEl) {
            closeNotificationActionRails();
            return;
        }

        if (actionEl.getAttribute('aria-disabled') === 'true') {
            e.preventDefault();
            return;
        }

        switch (actionEl.dataset.notifAction) {
            case 'mark-all-read':
                window.markAllNotificationsRead?.();
                break;
            case 'clear-all':
                window.clearAllNotifications?.(e);
                break;
            case 'close-drawer':
                closeDrawer();
                break;
            case 'clear-read':
                window.clearReadNotifications?.(e);
                break;
            default:
                break;
        }
    }

    // Unified Event Delegate
    function handleDrawerListClick(e) {
        const readFilterBtn = e.target.closest('[data-notif-action="filter-read"]');
        if (readFilterBtn instanceof HTMLElement) {
            e.preventDefault();
            e.stopPropagation();
            cancelNotificationDrawerOpeningAnimation();
            currentNotificationReadFilter = normalizeNotificationReadFilterValue(readFilterBtn.dataset.notifReadFilter || 'all');
            persistNotificationFilterState();
            renderNotifications({ animateCards: true });
            return;
        }

        const filterBtn = e.target.closest('[data-notif-action="filter-category"]');
        if (filterBtn instanceof HTMLElement) {
            e.preventDefault();
            e.stopPropagation();
            cancelNotificationDrawerOpeningAnimation();
            preferredAdminNotificationFilter = normalizeAdminNotificationFilterValue(filterBtn.dataset.notifCategory || 'all');
            currentAdminNotificationFilter = currentNotificationViewer.isAdmin
                ? preferredAdminNotificationFilter
                : 'all';
            persistNotificationFilterState();
            renderNotifications({ animateCards: true });
            return;
        }

        const clearReadBtn = e.target.closest('[data-notif-action="clear-read"]');
        if (clearReadBtn instanceof HTMLElement) {
            e.preventDefault();
            e.stopPropagation();
            window.clearReadNotifications?.(e);
            return;
        }

        const pinBtn = e.target.closest('[data-notif-action="toggle-pin"]');
        if (pinBtn instanceof HTMLElement) {
            e.preventDefault();
            e.stopPropagation();
            window.toggleNotificationPin?.(pinBtn.dataset.notifId || '');
            return;
        }

        const markReadBtn = e.target.closest('[data-notif-action="mark-read"]');
        if (markReadBtn instanceof HTMLElement) {
            e.preventDefault();
            e.stopPropagation();
            if (markReadBtn.getAttribute('aria-disabled') === 'true') {
                return;
            }
            const shell = markReadBtn.closest('.notif-card-shell');
            const card = shell?.querySelector('.notif-card') || null;
            window.markNotificationRead?.(markReadBtn.dataset.notifId || '', card);
            closeNotificationActionRails();
            return;
        }

        const deleteBtn = e.target.closest('[data-notif-action="delete-notification"]');
        if (deleteBtn instanceof HTMLElement) {
            e.preventDefault();
            e.stopPropagation();
            const id = deleteBtn.dataset.notifId || '';
            const shell = deleteBtn.closest('.notif-card-shell');
            if (id && window.deleteNotification) {
                window.deleteNotification(null, id, shell);
            }
            return;
        }

        const shell = getNotificationShellFromTarget(e.target);
        if (shouldSuppressNotificationCardClick(shell)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // 1. Handle Notification Click
        const card = e.target.closest('.notif-card') || shell?.querySelector?.('.notif-card');
        if (card) {
            if (shell?.classList.contains('is-actions-open')) {
                e.preventDefault();
                e.stopPropagation();
                closeNotificationActionRails();
                return;
            }

            // Normal Card Click (Mark Read)
            const id = card.dataset.id;

            if (id && window.handleNotifClick) {
                window.handleNotifClick(id, card);
            }
            e.stopPropagation();
            return;
        }

        if (closeNotificationActionRails()) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function handleDrawerListKeydown(e) {
        if (e.key !== 'Enter' && e.key !== ' ') {
            return;
        }
        if (e.target?.closest?.('[data-notif-action]')) {
            return;
        }

        const card = e.target?.closest?.('.notif-card');
        const shell = getNotificationShellFromTarget(card || e.target);
        if (!shell) {
            return;
        }

        if (activateNotificationCardShell(shell)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function getNotificationShellFromTarget(target) {
        if (!target || typeof target.closest !== 'function') {
            return null;
        }
        const shell = target.closest('.notif-card-shell');
        return shell instanceof HTMLElement ? shell : null;
    }

    function closeNotificationActionRails(exceptShell = null) {
        let closedCount = 0;
        document.querySelectorAll('.notif-card-shell.is-actions-open').forEach((shell) => {
            if (exceptShell && shell === exceptShell) {
                return;
            }
            shell.classList.remove('is-actions-open');
            shell.style.removeProperty('--notif-card-swipe-x');
            closedCount += 1;
        });
        return closedCount > 0;
    }

    function shouldSuppressNotificationCardClick(shell) {
        if (!notifSwipeSuppressClickShell) {
            return false;
        }

        if (Date.now() > notifSwipeSuppressClickUntil) {
            notifSwipeSuppressClickShell = null;
            notifSwipeSuppressClickUntil = 0;
            return false;
        }

        return !shell || shell === notifSwipeSuppressClickShell;
    }

    function suppressNextNotificationCardClick(shell) {
        if (!(shell instanceof HTMLElement)) {
            return;
        }
        notifSwipeSuppressClickShell = shell;
        notifSwipeSuppressClickUntil = Date.now() + NOTIFICATION_SWIPE_CLICK_SUPPRESS_MS;
    }

    function stopNotificationActivationEvent(event) {
        if (event?.cancelable) {
            event.preventDefault();
        }
        event?.stopPropagation?.();
    }

    function activateNotificationCardShell(shell) {
        if (!(shell instanceof HTMLElement) || shell.classList.contains('exit')) {
            return false;
        }

        const card = shell.querySelector('.notif-card');
        if (!(card instanceof HTMLElement)) {
            return false;
        }

        if (shell.classList.contains('is-actions-open')) {
            closeNotificationActionRails();
            return true;
        }

        const id = card.dataset.id || '';
        if (!id || typeof window.handleNotifClick !== 'function') {
            return false;
        }

        window.handleNotifClick(id, card);
        return true;
    }

    function resetNotificationSwipeState() {
        if (notifSwipePointerCaptureTarget && notifSwipePointerId != null) {
            try {
                if (notifSwipePointerCaptureTarget.hasPointerCapture?.(notifSwipePointerId)) {
                    notifSwipePointerCaptureTarget.releasePointerCapture?.(notifSwipePointerId);
                }
            } catch (_) {
                // Ignore capture cleanup differences across browsers and synthetic smoke events.
            }
        }
        if (notifSwipeShell) {
            notifSwipeShell.classList.remove('is-swiping');
            notifSwipeShell.style.removeProperty('--notif-card-swipe-x');
        }
        notifSwipeShell = null;
        notifSwipePointerId = null;
        notifSwipePointerCaptureTarget = null;
        notifSwipeStartX = 0;
        notifSwipeStartY = 0;
        notifSwipeDeltaX = 0;
        notifSwipeRawDeltaX = 0;
        notifSwipeRawDeltaY = 0;
        notifSwipeTracking = false;
        notifSwipeLocked = false;
    }

    function handleNotificationCardPointerDown(event) {
        if (event.button && event.button !== 0) {
            return;
        }
        if (event.target?.closest?.('[data-notif-action]')) {
            return;
        }

        const shell = getNotificationShellFromTarget(event.target);
        if (!shell || shell.classList.contains('exit')) {
            return;
        }

        notifSwipeShell = shell;
        notifSwipePointerId = event.pointerId;
        notifSwipePointerCaptureTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : shell;
        try {
            notifSwipePointerCaptureTarget?.setPointerCapture?.(event.pointerId);
        } catch (_) {
            // Some synthetic/local smoke events do not support pointer capture.
        }
        notifSwipeStartX = Number(event.clientX || 0);
        notifSwipeStartY = Number(event.clientY || 0);
        notifSwipeDeltaX = 0;
        notifSwipeRawDeltaX = 0;
        notifSwipeRawDeltaY = 0;
        notifSwipeTracking = true;
        notifSwipeLocked = false;
    }

    function handleNotificationCardPointerMove(event) {
        if (!notifSwipeTracking || !notifSwipeShell || event.pointerId !== notifSwipePointerId) {
            return;
        }

        const deltaX = Number(event.clientX || 0) - notifSwipeStartX;
        const deltaY = Number(event.clientY || 0) - notifSwipeStartY;
        notifSwipeRawDeltaX = deltaX;
        notifSwipeRawDeltaY = deltaY;
        if (!notifSwipeLocked) {
            const intentThreshold = event.pointerType === 'mouse'
                ? NOTIFICATION_SWIPE_INTENT_THRESHOLD_PX + 4
                : NOTIFICATION_SWIPE_INTENT_THRESHOLD_PX;
            if (Math.abs(deltaX) < intentThreshold && Math.abs(deltaY) < intentThreshold) {
                return;
            }
            if (Math.abs(deltaY) > Math.abs(deltaX)) {
                resetNotificationSwipeState();
                return;
            }
            notifSwipeLocked = true;
            notifSwipeShell.classList.add('is-swiping');
            closeNotificationActionRails(notifSwipeShell);
        }

        if (event.cancelable) {
            event.preventDefault();
        }

        const wasOpen = notifSwipeShell.classList.contains('is-actions-open');
        const baseOffset = wasOpen ? -NOTIFICATION_SWIPE_MAX_OFFSET_PX : 0;
        const offset = Math.max(-NOTIFICATION_SWIPE_MAX_OFFSET_PX, Math.min(0, baseOffset + deltaX));
        notifSwipeDeltaX = offset;
        notifSwipeShell.style.setProperty('--notif-card-swipe-x', `${Math.round(offset)}px`);
    }

    function getNotificationSwipeEndDelta(event) {
        const hasClientX = event && typeof event.clientX === 'number';
        const hasClientY = event && typeof event.clientY === 'number';
        return {
            x: hasClientX ? Number(event.clientX) - notifSwipeStartX : notifSwipeRawDeltaX,
            y: hasClientY ? Number(event.clientY) - notifSwipeStartY : notifSwipeRawDeltaY
        };
    }

    function handleNotificationCardPointerEnd(event) {
        if (!notifSwipeTracking || !notifSwipeShell || event.pointerId !== notifSwipePointerId) {
            return;
        }

        const shell = notifSwipeShell;
        const endDelta = getNotificationSwipeEndDelta(event);
        notifSwipeRawDeltaX = endDelta.x;
        notifSwipeRawDeltaY = endDelta.y;

        if (
            !notifSwipeLocked
            && Math.abs(endDelta.x) <= NOTIFICATION_TAP_ACTIVATE_THRESHOLD_PX
            && Math.abs(endDelta.y) <= NOTIFICATION_TAP_ACTIVATE_THRESHOLD_PX
        ) {
            if (activateNotificationCardShell(shell)) {
                suppressNextNotificationCardClick(shell);
                stopNotificationActivationEvent(event);
            }
            resetNotificationSwipeState();
            return;
        }

        const shouldOpen = notifSwipeLocked
            ? notifSwipeDeltaX <= -NOTIFICATION_SWIPE_OPEN_THRESHOLD_PX
                || endDelta.x <= -NOTIFICATION_SWIPE_OPEN_THRESHOLD_PX
            : shell.classList.contains('is-actions-open');
        const shouldSuppressClick = notifSwipeLocked
            && (shouldOpen || Math.abs(notifSwipeRawDeltaX) >= NOTIFICATION_SWIPE_CLICK_DRAG_THRESHOLD_PX);

        if (shouldSuppressClick) {
            suppressNextNotificationCardClick(shell);
            stopNotificationActivationEvent(event);
        }

        shell.classList.toggle('is-actions-open', shouldOpen);
        shell.classList.remove('is-swiping');
        shell.style.removeProperty('--notif-card-swipe-x');
        if (shouldOpen) {
            closeNotificationActionRails(shell);
        }

        resetNotificationSwipeState();
    }

    function handleNotificationCardPointerCancel(event) {
        if (!notifSwipeTracking || !notifSwipeShell || event.pointerId !== notifSwipePointerId) {
            resetNotificationSwipeState();
            return;
        }

        const shell = notifSwipeShell;
        if (notifSwipeLocked) {
            const shouldOpen = notifSwipeDeltaX <= -NOTIFICATION_SWIPE_OPEN_THRESHOLD_PX
                || notifSwipeRawDeltaX <= -NOTIFICATION_SWIPE_OPEN_THRESHOLD_PX;
            shell.classList.toggle('is-actions-open', shouldOpen);
            shell.classList.remove('is-swiping');
            shell.style.removeProperty('--notif-card-swipe-x');
            if (shouldOpen) {
                closeNotificationActionRails(shell);
                suppressNextNotificationCardClick(shell);
            }
        }

        resetNotificationSwipeState();
    }

    function handleNotificationCardWheel(event) {
        const shell = getNotificationShellFromTarget(event.target);
        if (!shell || event.target?.closest?.('[data-notif-action]')) {
            return;
        }

        const deltaX = Number(event.deltaX || 0);
        const deltaY = Number(event.deltaY || 0);
        if (Math.abs(deltaX) < 18 || Math.abs(deltaX) <= Math.abs(deltaY)) {
            return;
        }

        if (event.cancelable) {
            event.preventDefault();
        }
        event.stopPropagation?.();

        if (deltaX > 0) {
            closeNotificationActionRails(shell);
            shell.classList.add('is-actions-open');
        } else {
            shell.classList.remove('is-actions-open');
        }
        shell.classList.remove('is-swiping');
        shell.style.removeProperty('--notif-card-swipe-x');
    }

    // Toggle Drawer
    window.toggleNotifMenu = function (e) {
        if (e && typeof e.stopPropagation === 'function') {
            e.stopPropagation();
        }
        createDrawerHTML();

        const drawer = document.getElementById('notifDrawer');
        const backdrop = document.getElementById('notifBackdrop');

        if (drawer.classList.contains('active')) {
            closeDrawer();
        } else {
            const shouldStartLoad = !notificationsLoaded || !notificationActiveUserId || notificationLoadError;
            if (shouldStartLoad && !notifications.length) {
                notificationsLoading = true;
                notificationLoadError = '';
            }
            clearNotificationDrawerMotionTimers();
            drawer.classList.remove('notif-drawer-closing');
            backdrop.classList.remove('notif-backdrop-closing');
            drawer.classList.add('active', 'notif-drawer-opening');
            backdrop.classList.add('active');
            lockNotificationBackgroundScroll();
            renderNotifications();
            if (shouldStartLoad) {
                void window.initNotificationSystem?.();
            }
            notificationDrawerOpeningTimerId = window.setTimeout(() => {
                drawer.classList.remove('notif-drawer-opening');
                notificationDrawerOpeningTimerId = null;
            }, NOTIFICATION_MOBILE_ENTRY_MS);
        }
    };

    function refreshSafariChromeAfterNotificationClose() {
        const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

        if (typeof window.syntheticThemeChromeMenuTap === 'function') {
            window.syntheticThemeChromeMenuTap(theme);
            return;
        }

        window.applySiteThemeChrome?.(theme, { forceRepaint: true });
    }

    function clearScheduledNotificationChromeRefresh() {
        notificationChromeRepaintTimerIds.forEach((timerId) => {
            window.clearTimeout(timerId);
        });
        notificationChromeRepaintTimerIds = [];
    }

    function refreshSafariChromeIfNotificationClosed() {
        const drawer = document.getElementById('notifDrawer');
        const backdrop = document.getElementById('notifBackdrop');

        if (drawer?.classList.contains('active') || backdrop?.classList.contains('active')) {
            return;
        }

        refreshSafariChromeAfterNotificationClose();
    }

    function scheduleSafariChromeRefreshAfterNotificationClose() {
        clearScheduledNotificationChromeRefresh();
        const scheduleFrame = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : (callback) => window.setTimeout(callback, 0);

        scheduleFrame(refreshSafariChromeIfNotificationClosed);
        notificationChromeRepaintTimerIds = [
            window.setTimeout(refreshSafariChromeIfNotificationClosed, NOTIFICATION_CHROME_REPAINT_FALLBACK_MS),
            window.setTimeout(refreshSafariChromeIfNotificationClosed, NOTIFICATION_CHROME_REPAINT_LATE_MS)
        ];
    }

    function detachNotificationBackdropFromChrome(backdrop, restoreDelay = NOTIFICATION_CHROME_REPAINT_LATE_MS + 80) {
        backdrop.style.setProperty('transition', 'none', 'important');
        backdrop.style.setProperty('opacity', '0', 'important');
        backdrop.style.setProperty('visibility', 'hidden', 'important');
        backdrop.style.setProperty('backdrop-filter', 'none', 'important');
        backdrop.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
        void backdrop.offsetHeight;

        window.setTimeout(() => {
            backdrop.style.removeProperty('transition');
            backdrop.style.removeProperty('opacity');
            backdrop.style.removeProperty('visibility');
            backdrop.style.removeProperty('backdrop-filter');
            backdrop.style.removeProperty('-webkit-backdrop-filter');
        }, restoreDelay);
    }

    function detachNotificationDrawerFromChrome(drawer, restoreDelay = NOTIFICATION_CHROME_REPAINT_LATE_MS + 80) {
        drawer.style.setProperty('transition', 'none', 'important');
        drawer.style.setProperty('opacity', '0', 'important');
        drawer.style.setProperty('visibility', 'hidden', 'important');
        drawer.style.setProperty('pointer-events', 'none', 'important');
        drawer.style.setProperty('transform', 'translate3d(0, -110%, 0)', 'important');
        drawer.style.setProperty('top', '-110%', 'important');
        void drawer.offsetHeight;

        window.setTimeout(() => {
            drawer.style.removeProperty('transition');
            drawer.style.removeProperty('opacity');
            drawer.style.removeProperty('visibility');
            drawer.style.removeProperty('pointer-events');
            drawer.style.removeProperty('transform');
            drawer.style.removeProperty('top');
        }, restoreDelay);
    }

    function detachNotificationChromeLayers(drawer, backdrop) {
        if (backdrop) {
            detachNotificationBackdropFromChrome(backdrop);
        }
        if (drawer) {
            detachNotificationDrawerFromChrome(drawer);
        }
    }

    function closeDrawer() {
        const drawer = document.getElementById('notifDrawer');
        const backdrop = document.getElementById('notifBackdrop');
        const wasOpen = drawer?.classList.contains('active') || backdrop?.classList.contains('active');

        closeNotificationActionRails();
        resetNotificationSwipeState();

        if (wasOpen && isMobileNotificationViewport()) {
            clearNotificationDrawerMotionTimers();
            drawer?.classList.remove('notif-drawer-opening');
            drawer?.classList.add('notif-drawer-closing');
            backdrop?.classList.add('notif-backdrop-closing');
            notificationDrawerClosingTimerId = window.setTimeout(() => {
                drawer?.classList.remove('active', 'notif-drawer-closing');
                backdrop?.classList.remove('active', 'notif-backdrop-closing');
                notificationDrawerClosingTimerId = null;
                unlockNotificationBackgroundScroll();
                scheduleSafariChromeRefreshAfterNotificationClose();
            }, NOTIFICATION_MOBILE_CLOSE_MS);
            return;
        }

        clearNotificationDrawerMotionTimers();
        if (wasOpen) {
            detachNotificationChromeLayers(drawer, backdrop);
        }
        if (drawer) drawer.classList.remove('active', 'notif-drawer-opening', 'notif-drawer-closing');
        if (backdrop) backdrop.classList.remove('active', 'notif-backdrop-closing');
        unlockNotificationBackgroundScroll();

        if (wasOpen) {
            scheduleSafariChromeRefreshAfterNotificationClose();
        }
    }

    // Core Functions
    window.initNotificationSystem = async function (options = {}) {
        if (notificationInitPromise) {
            return notificationInitPromise;
        }

        const forceRefresh = options?.forceRefresh === true;
        if (!notificationsLoaded || !notificationActiveUserId || forceRefresh) {
            notificationsLoading = notifications.length === 0 || !notificationsLoaded;
            notificationLoadError = '';
            renderOpenNotificationDrawer();
        }

        notificationInitPromise = (async () => {
            const wrapper = document.getElementById('navNotifWrapper');
            const client = await waitForSupabaseClientReady();
            if (!client) {
                keepNotificationDrawerLoadingAndRetry();
                return [];
            }
            clearNotificationRuntimeRetryTimer();

            const user = await getCurrentUser();
            const userId = normalizeText(user?.id);

            if (!userId) {
                resetNotificationState();
                if (wrapper) wrapper.hidden = true;
                return [];
            }

            if (notificationActiveUserId && notificationActiveUserId !== userId) {
                resetNotificationState({ keepRealtime: false });
            }
            notificationActiveUserId = userId;

            await resolveNotificationViewer();

            if (wrapper) wrapper.hidden = false;
            if (notificationsLoaded && notificationActiveUserId === userId && !forceRefresh) {
                setupNotificationRealtime(userId);
                return notifications;
            }

            await fetchNotifications(userId, { forceRefresh });
            setupNotificationRealtime(userId);
            return notifications;
        })().catch((error) => {
            notificationLoadError = NOTIFICATION_LOAD_ERROR_TEXT;
            notificationsLoading = false;
            notificationsLoaded = false;
            updateBadge();
            renderOpenNotificationDrawer();
            console.error('Failed to initialize notifications:', error);
            return [];
        }).finally(() => {
            notificationInitPromise = null;
        });

        return notificationInitPromise;
    };

    function resetNotificationState(options = {}) {
        const keepRealtime = options?.keepRealtime === true;
        notifications = [];
        unreadCount = 0;
        notificationsLoaded = false;
        notificationsLoading = false;
        notificationLoadError = '';
        notificationActiveUserId = '';
        notificationFetchPromise = null;
        clearNotificationRuntimeRetryTimer();

        if (!keepRealtime) {
            removeNotificationRealtimeChannel();
        }

        updateBadge();
        renderOpenNotificationDrawer();
    }

    if (window.__ZAOYOE_LOCAL_SMOKE__) {
        window.__resetNotificationSystemForSmoke = function () {
            resetNotificationState({ keepRealtime: false });
        };
    }

    window.addEventListener('zaoyoe:supabase-client-state', (event) => {
        const status = normalizeText(event?.detail?.status).toLowerCase();
        if (status !== 'ready') {
            return;
        }
        clearNotificationRuntimeRetryTimer();
        if (!notificationsLoaded || notificationLoadError || notificationsLoading) {
            void window.initNotificationSystem?.({ forceRefresh: true });
        }
    });

    async function getCurrentUser() {
        if (!isSupabaseClientReady()) {
            return null;
        }

        const { data, error } = await window.supabaseClient.auth.getUser();
        if (error) {
            console.warn('Failed to resolve notification user:', error?.message || error);
            return null;
        }

        return data?.user || null;
    }

    function removeNotificationRealtimeChannel() {
        if (!notificationRealtimeChannel) {
            notificationRealtimeUserId = '';
            return;
        }

        const channel = notificationRealtimeChannel;
        notificationRealtimeChannel = null;
        notificationRealtimeUserId = '';

        try {
            if (typeof window.supabaseClient?.removeChannel === 'function') {
                window.supabaseClient.removeChannel(channel);
                return;
            }
            channel?.unsubscribe?.();
        } catch (error) {
            console.warn('Failed to remove notification realtime channel:', error?.message || error);
        }
    }

    function setupNotificationRealtime(userId) {
        const normalizedUserId = normalizeText(userId);
        if (!normalizedUserId || !window.supabaseClient || typeof window.supabaseClient.channel !== 'function') {
            return;
        }

        if (notificationRealtimeChannel && notificationRealtimeUserId === normalizedUserId) {
            return;
        }

        removeNotificationRealtimeChannel();

        notificationRealtimeChannel = window.supabaseClient
            .channel(`public:system_notifications:${normalizedUserId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'system_notifications',
                filter: `user_id=eq.${normalizedUserId}`
            }, payload => {
                if (!shouldIncludeNotification(payload.new)) {
                    return;
                }
                const nextNotification = syncNotificationPinnedState([payload.new])[0] || payload.new;
                notifications.unshift(nextNotification);
                notifications = getSortedNotifications(notifications);
                notificationsLoaded = true;
                notificationLoadError = '';
                if (nextNotification.is_read !== true) {
                    unreadCount++;
                }
                updateBadge();
                renderNotifications();
            })
            .subscribe();
        notificationRealtimeUserId = normalizedUserId;
    }

    async function fetchNotifications(userId, options = {}) {
        const normalizedUserId = normalizeText(userId);
        if (!normalizedUserId || !isSupabaseClientReady()) {
            return [];
        }

        if (notificationFetchPromise) {
            return notificationFetchPromise;
        }

        const forceRefresh = options?.forceRefresh === true;
        if (notificationsLoaded && notificationActiveUserId === normalizedUserId && !forceRefresh) {
            return notifications;
        }

        notificationsLoading = notifications.length === 0 || !notificationsLoaded;
        notificationLoadError = '';
        renderOpenNotificationDrawer();

        const currentFetchPromise = (async () => {
            try {
                const { data, error } = await window.supabaseClient
                    .from('system_notifications')
                    .select('*')
                    .eq('user_id', normalizedUserId)
                    .order('created_at', { ascending: false })
                    .limit(50);

                if (error) throw error;
                if (notificationActiveUserId !== normalizedUserId) {
                    return notifications;
                }

                const shouldAnimateLoadedNotifications = notificationsLoading === true;
                notifications = syncNotificationPinnedState((data || []).filter((row) => shouldIncludeNotification(row)));
                notifications = getSortedNotifications(notifications);
                prunePinnedNotificationIds(notifications);
                unreadCount = notifications.filter(n => !n.is_read).length;
                notificationsLoaded = true;
                notificationsLoading = false;
                notificationLoadError = '';

                updateBadge();
                renderOpenNotificationDrawer({
                    animateCards: shouldAnimateLoadedNotifications,
                    restartDrawerEntry: shouldAnimateLoadedNotifications
                });
                return notifications;
            } catch (err) {
                if (notificationActiveUserId === normalizedUserId) {
                    notificationLoadError = NOTIFICATION_LOAD_ERROR_TEXT;
                    notificationsLoaded = false;
                    notificationsLoading = false;
                    updateBadge();
                    renderOpenNotificationDrawer();
                }
                console.error('Failed to load notifications:', err);
                return [];
            } finally {
                if (notificationFetchPromise === currentFetchPromise) {
                    notificationFetchPromise = null;
                }
            }
        })();

        notificationFetchPromise = currentFetchPromise;
        return currentFetchPromise;
    }

    function renderOpenNotificationDrawer(options = {}) {
        const drawer = document.getElementById('notifDrawer');
        if (drawer?.classList.contains('active')) {
            renderNotifications(options);
        }
    }

    function updateBadge() {
        const badge = document.getElementById('notifBadge');
        if (badge) {
            badge.hidden = unreadCount <= 0;
        }

        updateDrawerActionState();

        // Also update avatar and dropdown badges (B+D Hybrid)
        if (typeof window.updateNotificationBadges === 'function') {
            window.updateNotificationBadges(unreadCount > 0);
        }
    }

    function updateDrawerActionState() {
        const markReadButton = document.querySelector('[data-notif-action="mark-all-read"]');
        if (markReadButton) {
            const disabled = unreadCount <= 0;
            markReadButton.classList.toggle('is-disabled', disabled);
            markReadButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        }

        const clearAllButton = document.querySelector('[data-notif-action="clear-all"]');
        if (clearAllButton) {
            const disabled = notifications.length <= 0;
            clearAllButton.classList.toggle('is-disabled', disabled);
            clearAllButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        }

        const clearReadButton = document.querySelector('[data-notif-action="clear-read"]');
        if (clearReadButton) {
            const disabled = getCurrentCategoryReadNotifications().length <= 0;
            clearReadButton.classList.toggle('is-disabled', disabled);
            clearReadButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        }
    }

    function getNotificationVisualMeta(notification) {
        let iconClass = 'fa-info-circle';
        let typeClass = 'info';
        if (notification?.type === 'warning') { iconClass = 'fa-exclamation-triangle'; typeClass = 'warning'; }
        if (notification?.type === 'success') { iconClass = 'fa-check-circle'; typeClass = 'success'; }
        if (notification?.type === 'alert') { iconClass = 'fa-triangle-exclamation'; typeClass = 'alert'; }

        const adminCategoryMeta = currentNotificationViewer.isAdmin
            ? getAdminPersonalNotificationMeta(notification)
            : null;
        if (adminCategoryMeta?.icon) {
            iconClass = adminCategoryMeta.icon;
        }
        if (adminCategoryMeta?.defaultType && notification?.type !== 'success' && notification?.type !== 'warning' && notification?.type !== 'alert') {
            typeClass = adminCategoryMeta.defaultType;
        }

        return {
            iconClass,
            typeClass,
            categoryMeta: adminCategoryMeta
        };
    }

    function getCategoryFilteredNotifications(sourceNotifications = notifications) {
        if (!currentNotificationViewer.isAdmin || currentAdminNotificationFilter === 'all') {
            return Array.isArray(sourceNotifications) ? sourceNotifications : [];
        }

        return (Array.isArray(sourceNotifications) ? sourceNotifications : []).filter((notification) => (
            getAdminPersonalNotificationCategory(notification) === currentAdminNotificationFilter
        ));
    }

    function getReadFilteredNotifications(sourceNotifications = notifications) {
        const safeNotifications = Array.isArray(sourceNotifications) ? sourceNotifications : [];
        if (currentNotificationReadFilter === 'unread') {
            return safeNotifications.filter((notification) => notification?.is_read !== true);
        }
        if (currentNotificationReadFilter === 'read') {
            return safeNotifications.filter((notification) => notification?.is_read === true);
        }
        return safeNotifications;
    }

    function getFilteredNotifications(sourceNotifications = notifications) {
        return getSortedNotifications(
            getReadFilteredNotifications(
                getCategoryFilteredNotifications(sourceNotifications)
            )
        );
    }

    function getCurrentCategoryReadNotifications(sourceNotifications = notifications) {
        return getCategoryFilteredNotifications(sourceNotifications).filter((notification) => notification?.is_read === true);
    }

    function buildAdminNotificationFilterStrip(sourceNotifications = notifications) {
        if (!currentNotificationViewer.isAdmin || !sourceNotifications.length) {
            return '';
        }

        const countByCategory = sourceNotifications.reduce((accumulator, notification) => {
            const category = getAdminPersonalNotificationCategory(notification);
            if (category) {
                accumulator[category] = (accumulator[category] || 0) + 1;
            }
            return accumulator;
        }, {});

        const filterButtons = ADMIN_PERSONAL_FILTER_ORDER.map((filterKey) => {
            const isAll = filterKey === 'all';
            const meta = isAll
                ? { label: '全部提醒', tone: 'all' }
                : ADMIN_PERSONAL_CATEGORY_META[filterKey];
            if (!meta) {
                return '';
            }

            const count = isAll
                ? sourceNotifications.length
                : Number(countByCategory[filterKey] || 0);

            return `
                <button
                    type="button"
                    class="notif-filter-chip${currentAdminNotificationFilter === filterKey ? ' is-active' : ''}"
                    data-notif-action="filter-category"
                    data-notif-category="${escapeHtml(filterKey)}"
                >
                    <span>${escapeHtml(meta.label)}</span>
                    <strong>${count}</strong>
                </button>
            `;
        }).join('');
        return `
            <div class="notif-filter-strip" data-notif-filter-strip="admin">
                ${filterButtons}
            </div>
        `;
    }

    function buildNotificationReadFilterStrip(sourceNotifications = notifications) {
        if (!notifications.length) {
            return '';
        }

        const safeNotifications = Array.isArray(sourceNotifications) ? sourceNotifications : [];
        const countMap = {
            all: safeNotifications.length,
            unread: safeNotifications.filter((notification) => notification?.is_read !== true).length,
            read: safeNotifications.filter((notification) => notification?.is_read === true).length
        };
        const clearReadDisabled = countMap.read <= 0;
        const markReadDisabled = unreadCount <= 0;
        const readFilterMeta = {
            all: '全部',
            unread: '未读',
            read: '已读'
        };

        return `
            <div class="notif-filter-strip notif-filter-strip--status" data-notif-filter-strip="read">
                ${NOTIFICATION_READ_FILTER_ORDER.map((filterKey) => `
                    <button
                        type="button"
                        class="notif-filter-chip${currentNotificationReadFilter === filterKey ? ' is-active' : ''}"
                        data-notif-action="filter-read"
                        data-notif-read-filter="${escapeHtml(filterKey)}"
                    >
                        <span>${escapeHtml(readFilterMeta[filterKey] || filterKey)}</span>
                        <strong>${Number(countMap[filterKey] || 0)}</strong>
                    </button>
                `).join('')}
                <button
                    type="button"
                    class="notif-filter-chip notif-mark-read notif-mark-read-chip${markReadDisabled ? ' is-disabled' : ''}"
                    data-notif-action="mark-all-read"
                    aria-disabled="${markReadDisabled ? 'true' : 'false'}"
                >
                    <i class="fas fa-envelope-open-text"></i>
                    <span>全部已读</span>
                </button>
                <button
                    type="button"
                    class="notif-filter-chip notif-clear-read-chip${clearReadDisabled ? ' is-disabled' : ''}"
                    data-notif-action="clear-read"
                    aria-disabled="${clearReadDisabled ? 'true' : 'false'}"
                >
                    <span>清除已读</span>
                </button>
            </div>
        `;
    }

    function wrapNotificationFilterControls(...htmlParts) {
        const html = htmlParts.filter(Boolean).join('');
        if (!html.trim()) {
            return '';
        }

        return `
            <div class="notif-filter-panel" data-notif-filter-panel>
                ${html}
            </div>
        `;
    }

    function wrapNotificationModule(filterHtml = '', contentHtml = '') {
        return `
            <div class="notif-module-shell" data-notif-module-shell>
                <div class="notif-filter-title" data-notif-filter-title>通知</div>
                <div class="notif-module-container" data-notif-module-container>
                    ${filterHtml}
                    <div class="notif-card-list" data-notif-card-list>
                        ${contentHtml}
                    </div>
                </div>
            </div>
        `;
    }

    function isMobileNotificationViewport() {
        return window.matchMedia?.('(max-width: 768px)')?.matches === true;
    }

    function clearNotificationDrawerOpeningTimer() {
        if (notificationDrawerOpeningTimerId) {
            window.clearTimeout(notificationDrawerOpeningTimerId);
            notificationDrawerOpeningTimerId = null;
        }
        if (notificationContentEntryTimerId) {
            window.clearTimeout(notificationContentEntryTimerId);
            notificationContentEntryTimerId = null;
        }
    }

    function clearNotificationDrawerClosingTimer() {
        if (notificationDrawerClosingTimerId) {
            window.clearTimeout(notificationDrawerClosingTimerId);
            notificationDrawerClosingTimerId = null;
        }
    }

    function clearNotificationDrawerMotionTimers() {
        clearNotificationDrawerOpeningTimer();
        clearNotificationDrawerClosingTimer();
    }

    function setNotificationDrawerLoadingState(isLoading) {
        const drawer = document.getElementById('notifDrawer');
        if (!drawer) {
            return;
        }

        const active = isLoading === true;
        drawer.classList.toggle('notif-drawer-loading', active);
        drawer.setAttribute('aria-busy', active ? 'true' : 'false');
    }

    function playNotificationContentEntryAnimation() {
        const drawer = document.getElementById('notifDrawer');
        if (!drawer?.classList.contains('active')) {
            return;
        }

        if (notificationContentEntryTimerId) {
            window.clearTimeout(notificationContentEntryTimerId);
            notificationContentEntryTimerId = null;
        }
        drawer.classList.remove('notif-drawer-content-entering');
        void drawer.offsetHeight;
        drawer.classList.add('notif-drawer-content-entering');
        notificationContentEntryTimerId = window.setTimeout(() => {
            drawer.classList.remove('notif-drawer-content-entering');
            notificationContentEntryTimerId = null;
        }, 760);
    }

    function cancelNotificationDrawerOpeningAnimation() {
        clearNotificationDrawerOpeningTimer();
        document.getElementById('notifDrawer')?.classList.remove('notif-drawer-opening');
    }

    function renderNotifications(options = {}) {
        const list = document.getElementById('notifDrawerList');
        if (!list) return;

        const shouldAnimateCards = Boolean(options?.animateCards);
        const shouldRestartDrawerEntry = shouldAnimateCards && options?.restartDrawerEntry === true;
        const isLoadingState = !notifications.length && notificationsLoading && !notificationLoadError;
        setNotificationDrawerLoadingState(isLoadingState);

        if (!notifications.length) {
            if (isLoadingState) {
                renderNotificationLoadingState(list);
                updateDrawerActionState();
                return;
            }

            if (notificationLoadError) {
                list.innerHTML = `<div class="notif-empty notif-empty--error">${getNotificationLoadErrorText()}</div>`;
                updateDrawerActionState();
                return;
            }

            list.innerHTML = `<div class="notif-empty" data-i18n="nav.noNotifications">${getNotificationEmptyText()}</div>`;
            updateDrawerActionState();
            return;
        }

        if (shouldAnimateCards && !shouldRestartDrawerEntry) {
            cancelNotificationDrawerOpeningAnimation();
        }

        notifications = getSortedNotifications(syncNotificationPinnedState(notifications));
        const categoryFilteredNotifications = getCategoryFilteredNotifications(notifications);
        const filteredNotifications = getFilteredNotifications(notifications);
        const filterStripHtml = buildAdminNotificationFilterStrip(notifications);
        const readFilterStripHtml = buildNotificationReadFilterStrip(categoryFilteredNotifications);
        const combinedFilterHtml = wrapNotificationFilterControls(filterStripHtml, readFilterStripHtml);
        const displayList = filteredNotifications;

        if (!filteredNotifications.length) {
            list.innerHTML = wrapNotificationModule(combinedFilterHtml, `
                <div class="notif-empty" data-i18n="nav.noNotifications">${getNotificationEmptyText()}</div>
            `);
            updateDrawerActionState();
            return;
        }

        let html = wrapNotificationModule(combinedFilterHtml, displayList.map((n, index) => {
            const visualMeta = getNotificationVisualMeta(n);
            const categoryBadgeHtml = visualMeta.categoryMeta
                ? `<span class="notif-card-tag notif-card-tag--${escapeHtml(visualMeta.categoryMeta.tone)}">${escapeHtml(visualMeta.categoryMeta.label)}</span>`
                : '';
            const pinnedClass = n.is_pinned ? ' is-pinned' : '';
            const pinLabel = n.is_pinned ? '取消置顶' : '置顶';
            const readActionDisabled = n.is_read === true;
            const animClass = shouldAnimateCards ? ' notif-card-filter-enter' : '';

            return `
                <div
                    class="notif-card-shell${animClass}"
                    data-id="${escapeHtml(String(n.id || ''))}"
                    data-notif-category="${escapeHtml(visualMeta.categoryMeta?.key || normalizeNotificationCategory(n.category) || '')}"
                >
                    <div class="notif-card-actions" aria-label="通知操作">
                        <button
                            type="button"
                            class="notif-card-action notif-card-action--pin${n.is_pinned ? ' is-active' : ''}"
                            data-notif-action="toggle-pin"
                            data-notif-id="${escapeHtml(String(n.id || ''))}"
                            aria-pressed="${n.is_pinned ? 'true' : 'false'}"
                        >
                            <i class="fas fa-thumbtack"></i>
                            <span>${escapeHtml(pinLabel)}</span>
                        </button>
                        <button
                            type="button"
                            class="notif-card-action notif-card-action--delete"
                            data-notif-action="delete-notification"
                            data-notif-id="${escapeHtml(String(n.id || ''))}"
                        >
                            <i class="fas fa-trash-alt"></i>
                            <span>删除</span>
                        </button>
                        <button
                            type="button"
                            class="notif-card-action notif-card-action--read${readActionDisabled ? ' is-disabled' : ''}"
                            data-notif-action="mark-read"
                            data-notif-id="${escapeHtml(String(n.id || ''))}"
                            aria-disabled="${readActionDisabled ? 'true' : 'false'}"
                        >
                            <i class="fas fa-envelope-open-text"></i>
                            <span>已读</span>
                        </button>
                    </div>
                    <div
                        class="notif-card ${!n.is_read ? 'unread' : ''}${pinnedClass}"
                        data-id="${escapeHtml(String(n.id || ''))}"
                        data-notif-category="${escapeHtml(visualMeta.categoryMeta?.key || normalizeNotificationCategory(n.category) || '')}"
                        role="button"
                        tabindex="0"
                        aria-expanded="false"
                    >
                    <div class="notif-card-header">
                        <div class="notif-card-info">
                            <div class="notif-card-title-row">
                                <div class="notif-card-title">${escapeHtml(n.title)}</div>
                                ${categoryBadgeHtml}
                            </div>
                            <div class="notif-card-body">${escapeHtml(n.content)}</div>
                        </div>
                        <div class="notif-card-time">${formatTimeAgo(n.created_at)}</div>
                    </div>
                    </div>
                </div>
            `;
        }).join(''));

        list.innerHTML = html;
        if (shouldRestartDrawerEntry) {
            playNotificationContentEntryAnimation();
        }
        updateDrawerActionState();
    }

    window.handleNotifClick = function (id, el) {
        if (el) {
            const expanded = el.classList.toggle('expanded');
            el.closest('.notif-card-shell')?.classList.toggle('is-expanded', expanded);
            el.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }

        window.markNotificationRead?.(id, el, { rerender: false });
    };

    window.markNotificationRead = function (id, el = null, options = {}) {
        const note = notifications.find(n => n.id === id);
        if (!note || note.is_read) {
            return false;
        }

        note.is_read = true;
        unreadCount = Math.max(0, unreadCount - 1);
        updateBadge();
        if (el) el.classList.remove('unread');
        if (options?.rerender !== false) {
            renderNotifications();
        }

        if (window.supabaseClient) {
            window.supabaseClient
                .from('system_notifications')
                .update({ is_read: true })
                .eq('id', id)
                .then(() => { });
        }

        return true;
    };

    window.toggleNotificationPin = function (id) {
        const notificationId = getNotificationId(id);
        if (!notificationId) {
            return false;
        }

        const note = notifications.find((notification) => getNotificationId(notification) === notificationId);
        if (!note) {
            return false;
        }

        note.is_pinned = note.is_pinned !== true;
        if (note.is_pinned) {
            pinnedNotificationIds.add(notificationId);
        } else {
            pinnedNotificationIds.delete(notificationId);
        }

        persistPinnedNotificationIds();
        notifications = getSortedNotifications(notifications);
        renderNotifications();
        return note.is_pinned;
    };

    window.deleteNotification = function (e, id, targetCard = null) {
        if (e) e.stopPropagation();

        const card = targetCard || (e ? (e.target.closest('.notif-card-shell') || e.target.closest('.notif-card')) : null);

        if (!card) return;

        if (card.classList.contains('exit')) return;

        // Start Exit Animation
        card.classList.add('exit');

        // Wait for animation end to clean up
        card.addEventListener('animationend', () => {
            handleDeleteCleanup(id, card);
        }, { once: true });

        // Safety Fallback: Force cleanup if animation event fails (e.g. tab backgrounded)
        setTimeout(() => {
            if (card && card.parentNode) {
                handleDeleteCleanup(id, card);
            }
        }, 600); // slightly longer than animation
    };

    // Helper for cleanup after animation
    async function handleDeleteCleanup(id, cardElement) {
        // Remove from DOM immediately
        if (cardElement && cardElement.parentNode) {
            cardElement.remove();
        }

        // Update Data State
        const index = notifications.findIndex(n => n.id === id);
        if (index > -1) {
            if (!notifications[index].is_read) {
                unreadCount = Math.max(0, unreadCount - 1);
                updateBadge();
            }
            notifications.splice(index, 1);
        }

        if (notifications.length === 0) {
            localStorage.removeItem('notifications_v1');
        }

        prunePinnedNotificationIds(notifications);

        renderNotifications();

        // Background DB Delete
        if (window.supabaseClient && id) {
            window.supabaseClient
                .from('system_notifications')
                .delete()
                .eq('id', id)
                .then(error => { if (error) console.error(error) });
        }
    }

    window.clearAllNotifications = function (e) {
        if (e) e.stopPropagation();

        if (notifications.length === 0) {
            return;
        }

        if (confirm('确定要清除所有通知吗？')) {
            const listContainer = document.getElementById('notifDrawerList');
            const cards = Array.from(listContainer.querySelectorAll('.notif-card-shell'));

            if (cards.length === 0) {
                completeClearAll();
                return;
            }

            // Apply exit class with stagger
            cards.forEach((card, index) => {
                setTimeout(() => {
                    card.classList.add('exit');
                    // Listen for the last one to clear all
                    if (index === cards.length - 1) {
                        card.addEventListener('animationend', () => {
                            completeClearAll();
                        }, { once: true });
                    }
                }, index * 50);
            });
        }
    };

    async function completeClearAll() {
        notifications = [];
        unreadCount = 0;
        pinnedNotificationIds.clear();
        persistPinnedNotificationIds();
        updateBadge();
        localStorage.removeItem('notifications_v1');
        renderNotifications();

        const user = await getCurrentUser();
        if (user) {
            window.supabaseClient
                .from('system_notifications')
                .delete()
                .eq('user_id', user.id)
                .then();
        }
    }

    window.clearReadNotifications = function (e) {
        if (e) e.stopPropagation();

        const readNotifications = getCurrentCategoryReadNotifications();
        if (!readNotifications.length) {
            return false;
        }

        const readIds = readNotifications.map((notification) => getNotificationId(notification)).filter(Boolean);
        if (!readIds.length) {
            return false;
        }

        const confirmText = readIds.length === 1
            ? '确定要彻底删除这 1 条已读通知吗？'
            : `确定要彻底删除这 ${readIds.length} 条已读通知吗？`;
        if (!confirm(confirmText)) {
            return false;
        }

        const readIdSet = new Set(readIds);
        const listContainer = document.getElementById('notifDrawerList');
        const visibleReadCards = listContainer
            ? Array.from(listContainer.querySelectorAll('.notif-card-shell')).filter((card) => readIdSet.has(getNotificationId(card.dataset.id)))
            : [];

        if (!visibleReadCards.length) {
            completeClearReadNotifications(readIds);
            return true;
        }

        visibleReadCards.forEach((card, index) => {
            window.setTimeout(() => {
                card.classList.add('exit');
                if (index === visibleReadCards.length - 1) {
                    card.addEventListener('animationend', () => {
                        completeClearReadNotifications(readIds);
                    }, { once: true });
                }
            }, index * 50);
        });

        window.setTimeout(() => {
            if (readIds.some((id) => notifications.some((notification) => getNotificationId(notification) === id))) {
                completeClearReadNotifications(readIds);
            }
        }, (visibleReadCards.length * 50) + 700);

        return true;
    };

    async function completeClearReadNotifications(readIds = []) {
        const readIdSet = new Set(readIds.map((id) => getNotificationId(id)).filter(Boolean));
        if (!readIdSet.size) {
            return false;
        }

        notifications = notifications.filter((notification) => !readIdSet.has(getNotificationId(notification)));
        unreadCount = notifications.filter((notification) => notification?.is_read !== true).length;
        prunePinnedNotificationIds(notifications);
        updateBadge();

        if (notifications.length === 0) {
            localStorage.removeItem('notifications_v1');
        }

        renderNotifications({ animateCards: false });
        await deleteNotificationsByIds(Array.from(readIdSet));
        return true;
    }

    async function deleteNotificationsByIds(ids = []) {
        const notificationIds = ids.map((id) => getNotificationId(id)).filter(Boolean);
        if (!window.supabaseClient || !notificationIds.length) {
            return;
        }

        try {
            const deleteQuery = window.supabaseClient
                .from('system_notifications')
                .delete();

            if (typeof deleteQuery.in === 'function') {
                await deleteQuery.in('id', notificationIds);
                return;
            }

            await Promise.all(notificationIds.map((id) => (
                window.supabaseClient
                    .from('system_notifications')
                    .delete()
                    .eq('id', id)
            )));
        } catch (error) {
            console.error('Failed to delete read notifications:', error);
        }
    }



    window.markAllNotificationsRead = async function () {
        if (unreadCount <= 0) {
            return false;
        }

        notifications.forEach(n => n.is_read = true);
        unreadCount = 0;
        updateBadge();
        renderNotifications();

        const user = await getCurrentUser();
        if (user) {
            await window.supabaseClient
                .from('system_notifications')
                .update({ is_read: true })
                .eq('user_id', user.id);
        }

        return true;
    };

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTimeAgo(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);
        if (seconds < 60) return '刚刚';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}分钟前`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}小时前`;
        return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
    }

    function scheduleInitialNotificationInit() {
        setTimeout(() => {
            window.initNotificationSystem?.();
        }, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleInitialNotificationInit, { once: true });
    } else {
        scheduleInitialNotificationInit();
    }

    window.refreshNotifications = function () {
        return window.initNotificationSystem?.({ forceRefresh: true });
    };

})();
