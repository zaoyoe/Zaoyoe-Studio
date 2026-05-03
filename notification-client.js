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

    // State
    let notifications = [];
    let unreadCount = 0;
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
    let currentNotificationViewer = {
        isAdmin: false
    };

    function normalizeText(value) {
        return String(value || '').trim();
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
            <div class="notif-drawer-header">
                <div class="notif-drawer-actions">
                    <div class="notif-clear-all" data-notif-action="clear-all" role="button" tabindex="0" aria-disabled="true">
                        <i class="fas fa-times icon-x"></i>
                        <span class="text-clear" data-i18n="nav.clearAll">全部清除</span>
                    </div>
                </div>
            </div>
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
        if (list) list.addEventListener('click', handleDrawerListClick);
    }

    function handleDrawerClick(e) {
        const actionEl = e.target.closest('[data-notif-action]');
        if (!actionEl) {
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

        // 1. Handle Notification Click
        const card = e.target.closest('.notif-card');
        if (card) {
            // Check if it was the Close Button
            const closeBtn = e.target.closest('.notif-card-close');
            if (closeBtn) {
                e.preventDefault(); // Prevent default action
                e.stopPropagation(); // Stop bubbling to card click

                // Extract ID from card dataset
                const id = card.dataset.id;

                if (id && window.deleteNotification) {
                    window.deleteNotification(null, id, card);
                }
                return;
            }

            // Normal Card Click (Mark Read)
            const id = card.dataset.id;

            if (id && window.handleNotifClick) {
                window.handleNotifClick(id, card);
            }
        }
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
            clearNotificationDrawerMotionTimers();
            drawer.classList.remove('notif-drawer-closing');
            backdrop.classList.remove('notif-backdrop-closing');
            drawer.classList.add('active', 'notif-drawer-opening');
            backdrop.classList.add('active');
            lockNotificationBackgroundScroll();
            renderNotifications();
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
    window.initNotificationSystem = async function () {
        const user = await getCurrentUser();
        const wrapper = document.getElementById('navNotifWrapper');

        if (!user) {
        if (wrapper) wrapper.hidden = true;
            return;
        }

        await resolveNotificationViewer();

        if (wrapper) wrapper.hidden = false;
        fetchNotifications(user.id);

        window.supabaseClient
            .channel('public:system_notifications')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'system_notifications',
                filter: `user_id=eq.${user.id}`
            }, payload => {
                if (!shouldIncludeNotification(payload.new)) {
                    return;
                }
                const nextNotification = syncNotificationPinnedState([payload.new])[0] || payload.new;
                notifications.unshift(nextNotification);
                notifications = getSortedNotifications(notifications);
                if (nextNotification.is_read !== true) {
                    unreadCount++;
                }
                updateBadge();
                renderNotifications();
            })
            .subscribe();
    };

    async function getCurrentUser() {
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        return user;
    }

    async function fetchNotifications(userId) {
        try {
            const { data, error } = await window.supabaseClient
                .from('system_notifications')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;
            notifications = syncNotificationPinnedState((data || []).filter((row) => shouldIncludeNotification(row)));
            notifications = getSortedNotifications(notifications);
            prunePinnedNotificationIds(notifications);
            unreadCount = notifications.filter(n => !n.is_read).length;

            updateBadge();
            renderOpenNotificationDrawer();
        } catch (err) {
            console.error('Failed to load notifications:', err);
        }
    }

    function renderOpenNotificationDrawer() {
        const drawer = document.getElementById('notifDrawer');
        if (drawer?.classList.contains('active')) {
            renderNotifications();
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
        const markReadDisabled = unreadCount <= 0;

        return `
            <div class="notif-filter-strip" data-notif-filter-strip="admin">
                ${filterButtons}
                <button
                    type="button"
                    class="notif-filter-chip notif-mark-read notif-mark-read-chip${markReadDisabled ? ' is-disabled' : ''}"
                    data-notif-action="mark-all-read"
                    aria-disabled="${markReadDisabled ? 'true' : 'false'}"
                >
                    <i class="fas fa-envelope-open-text"></i>
                    <span>全部已读</span>
                </button>
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
                    class="notif-filter-chip notif-clear-read-chip${clearReadDisabled ? ' is-disabled' : ''}"
                    data-notif-action="clear-read"
                    aria-disabled="${clearReadDisabled ? 'true' : 'false'}"
                >
                    <span>清除已读</span>
                </button>
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

    function cancelNotificationDrawerOpeningAnimation() {
        clearNotificationDrawerOpeningTimer();
        document.getElementById('notifDrawer')?.classList.remove('notif-drawer-opening');
    }

    function renderNotifications(options = {}) {
        const list = document.getElementById('notifDrawerList');
        if (!list) return;

        const shouldAnimateCards = Boolean(options?.animateCards);

        if (!notifications.length) {
            list.innerHTML = `<div class="notif-empty" data-i18n="nav.noNotifications">${getNotificationEmptyText()}</div>`;
            updateDrawerActionState();
            return;
        }

        notifications = getSortedNotifications(syncNotificationPinnedState(notifications));
        const categoryFilteredNotifications = getCategoryFilteredNotifications(notifications);
        const filteredNotifications = getFilteredNotifications(notifications);
        const filterStripHtml = buildAdminNotificationFilterStrip(notifications);
        const readFilterStripHtml = buildNotificationReadFilterStrip(categoryFilteredNotifications);
        const combinedFilterHtml = `${filterStripHtml}${readFilterStripHtml}`;
        const displayList = filteredNotifications;

        if (!filteredNotifications.length) {
            list.innerHTML = `
                ${combinedFilterHtml}
                <div class="notif-empty" data-i18n="nav.noNotifications">${getNotificationEmptyText()}</div>
            `;
            updateDrawerActionState();
            return;
        }

        let html = `${combinedFilterHtml}${displayList.map((n, index) => {
            const visualMeta = getNotificationVisualMeta(n);
            const categoryBadgeHtml = visualMeta.categoryMeta
                ? `<span class="notif-card-tag notif-card-tag--${escapeHtml(visualMeta.categoryMeta.tone)}">${escapeHtml(visualMeta.categoryMeta.label)}</span>`
                : '';
            const pinnedClass = n.is_pinned ? ' is-pinned' : '';
            const pinLabel = n.is_pinned ? '取消置顶' : '置顶';
            const animClass = shouldAnimateCards ? ' notif-card-filter-enter' : '';

            return `
                <div
                    class="notif-card ${!n.is_read ? 'unread' : ''}${pinnedClass}${animClass}"
                    data-id="${n.id}"
                    data-notif-category="${escapeHtml(visualMeta.categoryMeta?.key || normalizeNotificationCategory(n.category) || '')}"
                >
                    <div class="notif-card-close">
                        <i class="fas fa-times"></i>
                    </div>
                    <div class="notif-card-header">
                        <div class="notif-card-icon ${visualMeta.typeClass}">
                            <i class="fas ${visualMeta.iconClass}"></i>
                        </div>
                        <div class="notif-card-info">
                            <div class="notif-card-title-row">
                                <div class="notif-card-title">${escapeHtml(n.title)}</div>
                                ${categoryBadgeHtml}
                                <button
                                    type="button"
                                    class="notif-card-pin${n.is_pinned ? ' is-active' : ''}"
                                    data-notif-action="toggle-pin"
                                    data-notif-id="${escapeHtml(String(n.id || ''))}"
                                    aria-pressed="${n.is_pinned ? 'true' : 'false'}"
                                    title="${escapeHtml(pinLabel)}"
                                >
                                    <i class="fas fa-thumbtack"></i>
                                </button>
                            </div>
                            <div class="notif-card-body">${escapeHtml(n.content)}</div>
                        </div>
                        <div class="notif-card-time">${formatTimeAgo(n.created_at)}</div>
                    </div>
                </div>
            `;
        }).join('')}`;

        list.innerHTML = html;
        updateDrawerActionState();
    }

    window.handleNotifClick = function (id, el) {
        // Toggle expanded state to show full text
        if (el) {
            el.classList.toggle('expanded');
        }

        const note = notifications.find(n => n.id === id);
        if (note && !note.is_read) {
            note.is_read = true;
            unreadCount = Math.max(0, unreadCount - 1);
            updateBadge();
            if (el) el.classList.remove('unread');

            window.supabaseClient
                .from('system_notifications')
                .update({ is_read: true })
                .eq('id', id)
                .then(() => { });
        }
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

        const card = targetCard || (e ? e.target.closest('.notif-card') : null);

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
            const cards = Array.from(listContainer.querySelectorAll('.notif-card'));

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
            ? Array.from(listContainer.querySelectorAll('.notif-card')).filter((card) => readIdSet.has(getNotificationId(card.dataset.id)))
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

        renderNotifications({ animateCards: true });
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

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initNotificationSystem, 1000);
    });

    window.refreshNotifications = initNotificationSystem;

})();
