(function () {
    // State
    let notifications = [];
    let unreadCount = 0;
    let isExpanded = false;
    let notifScrollLocked = false;
    let notifSavedScrollY = 0;
    let notifTouchStartY = 0;
    const MAX_COLLAPSED = 3;

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
        drawer.innerHTML = `
            <div class="notif-drawer-header">
                <span class="notif-drawer-title" data-i18n="nav.notification">通知中心</span>
                <div class="notif-clear-all" data-notif-action="clear-all" role="button" tabindex="0">
                    <i class="fas fa-times icon-x"></i>
                    <span class="text-clear" data-i18n="nav.clearAll">全部清除</span>
                </div>
            </div>
            <div class="notif-drawer-list" id="notifDrawerList">
                <div class="notif-empty" data-i18n="nav.noNotifications">暂无通知</div>
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

        switch (actionEl.dataset.notifAction) {
            case 'clear-all':
                window.clearAllNotifications?.(e);
                break;
            default:
                break;
        }
    }

    // Unified Event Delegate
    function handleDrawerListClick(e) {
        // 1. Handle Expand Button
        const expandBtn = e.target.closest('.notif-expand-btn');
        if (expandBtn) {
            e.stopPropagation();
            if (window.expandNotifications) window.expandNotifications();
            return;
        }

        // 2. Handle Notification Click
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
            drawer.classList.add('active');
            backdrop.classList.add('active');
            lockNotificationBackgroundScroll();
            isExpanded = false;
            renderNotifications();
        }
    };

    function closeDrawer() {
        const drawer = document.getElementById('notifDrawer');
        const backdrop = document.getElementById('notifBackdrop');
        if (drawer) drawer.classList.remove('active');
        if (backdrop) backdrop.classList.remove('active');
        unlockNotificationBackgroundScroll();
    }

    // Core Functions
    window.initNotificationSystem = async function () {
        const user = await getCurrentUser();
        const wrapper = document.getElementById('navNotifWrapper');

        if (!user) {
            if (wrapper) wrapper.hidden = true;
            return;
        }

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
                notifications.unshift(payload.new);
                unreadCount++;
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
            notifications = data || [];
            unreadCount = notifications.filter(n => !n.is_read).length;

            updateBadge();
        } catch (err) {
            console.error('Failed to load notifications:', err);
        }
    }

    function updateBadge() {
        const badge = document.getElementById('notifBadge');
        if (badge) {
            badge.hidden = unreadCount <= 0;
        }

        // Also update avatar and dropdown badges (B+D Hybrid)
        if (typeof window.updateNotificationBadges === 'function') {
            window.updateNotificationBadges(unreadCount > 0);
        }
    }

    function renderNotifications(animateExpansion = false) {
        const list = document.getElementById('notifDrawerList');
        if (!list) return;

        if (!notifications.length) {
            list.innerHTML = `<div class="notif-empty" data-i18n="nav.noNotifications">${window.i18n?.t('nav.noNotifications') || '暂无通知'}</div>`;
            return;
        }

        const displayList = isExpanded ? notifications : notifications.slice(0, MAX_COLLAPSED);
        const remaining = notifications.length - MAX_COLLAPSED;

        let html = displayList.map((n, index) => {
            let iconClass = 'fa-info-circle';
            let typeClass = 'info';
            if (n.type === 'warning') { iconClass = 'fa-exclamation-triangle'; typeClass = 'warning'; }
            if (n.type === 'success') { iconClass = 'fa-check-circle'; typeClass = 'success'; }

            // Add animation class directly during render if expanding
            let animClass = '';
            // Only animate new items (those beyond the collapsed limit) when expanding
            if (animateExpansion && index >= MAX_COLLAPSED) {
                animClass = 'sliding-in';
            }

            return `
                <div class="notif-card ${!n.is_read ? 'unread' : ''} ${animClass}" data-id="${n.id}">
                    <div class="notif-card-close">
                        <i class="fas fa-times"></i>
                    </div>
                    <div class="notif-card-header">
                        <div class="notif-card-icon ${typeClass}">
                            <i class="fas ${iconClass}"></i>
                        </div>
                        <div class="notif-card-info">
                            <div class="notif-card-title">${escapeHtml(n.title)}</div>
                            <div class="notif-card-body">${escapeHtml(n.content)}</div>
                        </div>
                        <div class="notif-card-time">${formatTimeAgo(n.created_at)}</div>
                    </div>
                </div>
            `;
        }).join('');

        if (!isExpanded && remaining > 0) {
            html += `
                <div id="notifExpandWrapper" class="notif-expand-wrapper">
                    <div class="notif-expand-btn">
                        <span>还有 ${remaining} 个通知</span>
                        <i class="fas fa-chevron-down"></i>
                    </div>
                </div>
            `;
        }

        list.innerHTML = html;
    }

    window.expandNotifications = function () {
        isExpanded = true;
        renderNotifications(true);
    };

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

        // Handle Layout Updates
        const list = document.getElementById('notifDrawerList');
        // Scenario 0: List Empty
        if (notifications.length === 0) {
            if (list) list.innerHTML = `<div class="notif-empty" data-i18n="nav.noNotifications">${window.i18n?.t('nav.noNotifications') || '暂无通知'}</div>`;
            localStorage.removeItem('notifications_v1');
        }
        // Scenario 1: Collapsed Mode - Need to pull in a stored notification
        else if (!isExpanded && notifications.length >= MAX_COLLAPSED) {
            const nextItem = notifications[MAX_COLLAPSED - 1];
            const expandWrapper = document.getElementById('notifExpandWrapper');

            // Manually create the card if we have a next item and a place to put it
            if (nextItem && expandWrapper) {
                // Clone standard logic from render
                let iconClass = 'fa-info-circle';
                let typeClass = 'info';
                if (nextItem.type === 'warning') { iconClass = 'fa-exclamation-triangle'; typeClass = 'warning'; }
                if (nextItem.type === 'success') { iconClass = 'fa-check-circle'; typeClass = 'success'; }

                const newCardHTML = `
                    <div class="notif-card ${!nextItem.is_read ? 'unread' : ''} sliding-in" data-id="${nextItem.id}">
                        <div class="notif-card-close">
                            <i class="fas fa-times"></i>
                        </div>
                        <div class="notif-card-header">
                            <div class="notif-card-icon ${typeClass}">
                                <i class="fas ${iconClass}"></i>
                            </div>
                            <div class="notif-card-info">
                                <div class="notif-card-title">${escapeHtml(nextItem.title)}</div>
                                <div class="notif-card-body">${escapeHtml(nextItem.content)}</div>
                            </div>
                            <div class="notif-card-time">${formatTimeAgo(nextItem.created_at)}</div>
                        </div>
                    </div>
                `;

                // Insert before the expand button
                expandWrapper.insertAdjacentHTML('beforebegin', newCardHTML);
            }

            // Update Expand Button Text
            updateExpandButtonText();
        }
        // Scenario 2: Expanded or Small List
        else {
            // If we drop below MAX_COLLAPSED, we might need to remove the expand button if it exists
            // But usually in expanded mode it doesn't exist.
            // If we were in collapsed mode but deleted the 4th item (so now 3), the wrapper should be removed?
            // Actually if we simply delete one by one, we just need to ensure the expand button is gone if items < MAX

            if (notifications.length < MAX_COLLAPSED) {
                const expandWrapper = document.getElementById('notifExpandWrapper');
                if (expandWrapper) expandWrapper.remove();
            } else {
                updateExpandButtonText();
            }
        }

        // Background DB Delete
        if (window.supabaseClient && id) {
            window.supabaseClient
                .from('system_notifications')
                .delete()
                .eq('id', id)
                .then(error => { if (error) console.error(error) });
        }
    }

    function updateExpandButtonText() {
        const expandBtnSpan = document.querySelector('.notif-expand-btn span');
        if (expandBtnSpan) {
            const remaining = Math.max(0, notifications.length - MAX_COLLAPSED);
            expandBtnSpan.textContent = `还有 ${remaining} 个通知`;
        }
    }

    window.clearAllNotifications = function (e) {
        if (e) e.stopPropagation();

        if (confirm('确定要清除所有通知吗？')) {
            const listContainer = document.getElementById('notifDrawerList');
            const cards = Array.from(listContainer.querySelectorAll('.notif-card'));

            if (cards.length === 0) return;

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



    window.markAllNotificationsRead = async function () {
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
