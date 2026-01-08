(function () {
    // macOS-style Notification Center Styles
    const style = document.createElement('style');
    style.textContent = `
        /* Blurred Backdrop when drawer is open */
        .notif-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 2150;
            opacity: 0;
            visibility: hidden;
            transition: all 0.35s ease;
        }
        .notif-backdrop.active {
            opacity: 1;
            visibility: visible;
        }
        
        /* Notification Drawer - floating style (transparent container) */
        .notif-drawer {
            position: fixed;
            top: 70px;
            right: -400px;
            width: 380px;
            max-height: calc(100vh - 100px);
            z-index: 2200;
            
            /* Transparent container */
            background: transparent;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            border: none;
            box-shadow: none;
            
            display: flex;
            flex-direction: column;
            
            transition: right 0.35s cubic-bezier(0.4, 0, 0.2, 1);
            pointer-events: none; 
        }
        /* Allow interaction with header and list */
        .notif-drawer-header,
        .notif-drawer-list {
            pointer-events: auto;
        }
        .notif-drawer.active {
            right: 20px;
        }
        
        /* Header */
        .notif-drawer-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0px; /* Adjust padding since no border */
            margin-bottom: 8px; /* Space between header and list */
            border-bottom: none;
        }
        .notif-drawer-title {
            font-size: 1.1rem; /* Slightly larger for floating header */
            font-weight: 600;
            color: rgba(255, 255, 255, 0.95);
            text-shadow: 0 2px 4px rgba(0,0,0,0.3); /* Add shadow for readability */
        }
        .notif-clear-all {
             /* Adjust to sit nicely without container */
             background: rgba(0,0,0,0.2);
             backdrop-filter: blur(10px);
        }
        
        /* Clear All Button - X transforms to text on hover (no slide) */
        .notif-clear-all {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px 10px;
            cursor: pointer;
            border-radius: 6px;
            background: transparent;
            transition: background 0.2s, padding 0.2s;
            min-width: 24px;
            height: 24px;
        }
        .notif-clear-all:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        .notif-clear-all .icon-x {
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.5);
            transition: opacity 0.15s;
        }
        .notif-clear-all .text-clear {
            position: absolute;
            font-size: 0.7rem;
            color: rgba(255, 255, 255, 0.8);
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.15s;
        }
        .notif-clear-all:hover .icon-x {
            opacity: 0;
        }
        .notif-clear-all:hover .text-clear {
            opacity: 1;
        }
        
        /* Notification List - Simplified */
        .notif-drawer-list {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden; /* No overflow needed anymore */
            padding: 8px 12px;
            scrollbar-width: none;
        }
        .notif-drawer-list::-webkit-scrollbar {
            display: none;
        }
        
        /* Single Notification Card - Clean, Contained */
        .notif-card {
            position: relative;
            z-index: 1; /* Base stacking level */
            background: rgba(30, 40, 55, 0.7); /* Darker, more visible */
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 12px 14px; /* Balanced padding, button is outside */
            margin-bottom: 8px;
            cursor: pointer;
            overflow: visible; /* Allow close button to hang off edge */
            transition: background 0.2s, transform 0.2s, z-index 0s;
        }
        .notif-card:hover {
            z-index: 100; /* Lift well above siblings on hover */
            isolation: isolate; /* Create stacking context */
            background: rgba(40, 55, 75, 0.8);
            transform: translateY(-2px);
        }
        .notif-card.unread {
            background: rgba(60, 50, 90, 0.75);
            border-left: 3px solid #818cf8;
        }
        
        /* Card Close Button - Corner Badge Style */
        .notif-card-close {
            position: absolute;
            top: -6px;
            left: -6px;
            right: auto;
            transform: scale(0.9);
            z-index: 10; /* Ensure above card content */
            pointer-events: auto; /* Explicitly enable clicks */
            
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            
            background: rgba(255, 255, 255, 0.08);
            border: none;
            border-radius: 50%;
            cursor: pointer;
            
            opacity: 0;
            transition: opacity 0.15s, background 0.15s, transform 0.15s;
        }
        .notif-card:hover .notif-card-close {
            opacity: 1;
            transform: scale(1);
        }
        .notif-card-close:hover {
            background: #ef4444;
        }
        .notif-card-close i {
            font-size: 0.6rem;
            color: rgba(255, 255, 255, 0.8);
        }
        .notif-card-close:hover i {
            color: #fff;
        }
        
        /* Card Content */
        .notif-card-header {
            display: flex;
            align-items: flex-start;
            gap: 8px;
        }
        .notif-card-icon {
            width: 24px;
            height: 24px;
            border-radius: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .notif-card-icon.info { background: rgba(96, 165, 250, 0.2); color: #60a5fa; }
        .notif-card-icon.warning { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
        .notif-card-icon.success { background: rgba(52, 211, 153, 0.2); color: #34d399; }
        .notif-card-icon i { font-size: 0.65rem; }
        
        .notif-card-info {
            flex: 1;
            min-width: 0;
        }
        .notif-card-title {
            font-size: 0.78rem;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.88);
            margin-bottom: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .notif-card-body {
            font-size: 0.72rem;
            color: rgba(255, 255, 255, 0.5);
            line-height: 1.35;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .notif-card-time {
            font-size: 0.65rem;
            color: rgba(255, 255, 255, 0.35);
            white-space: nowrap;
            margin-left: auto;
            flex-shrink: 0;
        }
        
        /* Expand Button - clean minimal pill */
        .notif-expand-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 3px;
            padding: 4px 10px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .notif-expand-btn:hover {
            background: rgba(255, 255, 255, 0.08);
        }
        .notif-expand-btn span {
            font-size: 0.62rem;
            color: rgba(255, 255, 255, 0.5);
        }
        .notif-expand-btn i {
            font-size: 0.4rem;
            color: rgba(255, 255, 255, 0.35);
        }
        
        /* Empty State */
        .notif-empty {
            text-align: center;
            padding: 30px 16px;
            color: rgba(255, 255, 255, 0.3);
            font-size: 0.75rem;
        }
        
        /* Badge */
        .notif-badge {
            position: absolute;
            top: 8px;
            right: 8px;
            width: 8px;
            height: 8px;
            background: #ef4444;
            border-radius: 50%;
            border: 1.5px solid rgba(30, 30, 40, 0.9);
            box-shadow: 0 0 5px #ef4444;
        }
        
        /* Animations */
        /* Enter Animation (Height + Slide) */
        @keyframes notifSlideIn {
            0% { transform: translateY(-15px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
        }
        
        /* Unified Exit Animation */
        @keyframes notifExit {
            0% {
                transform: translateX(0);
                opacity: 1;
                max-height: 150px; /* Large enough to fit content */
                margin-bottom: 6px;
                padding-top: 10px;
                padding-bottom: 10px;
                border-width: 1px;
            }
            40% {
                transform: translateX(100%);
                opacity: 0;
                max-height: 150px;
                margin-bottom: 6px;
                padding-top: 10px;
                padding-bottom: 10px;
                border-width: 1px;
            }
            100% {
                transform: translateX(100%);
                opacity: 0;
                max-height: 0;
                margin-bottom: 0;
                padding-top: 0;
                padding-bottom: 0;
                border-width: 0;
            }
        }

        .notif-card.exit {
            transition: none !important;
            transform: none !important; /* Reset any hover transform */
            animation: notifExit 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
            pointer-events: none;
            z-index: 0 !important; /* Drop below others */
        }

        @keyframes notifEnter {
            0% {
                opacity: 0;
                transform: translateY(20px);
                max-height: 0;
                margin-bottom: 0;
                padding-top: 0;
                padding-bottom: 0;
                border-width: 0;
            }
            100% {
                opacity: 1;
                transform: translateY(0);
                max-height: 150px;
                margin-bottom: 6px;
                padding-top: 10px;
                padding-bottom: 10px;
                border-width: 1px;
            }
        }

        .notif-card.sliding-in {
            animation: notifEnter 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
    `;
    document.head.appendChild(style);

    // State
    let notifications = [];
    let unreadCount = 0;
    let isExpanded = false;
    const MAX_COLLAPSED = 3;

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
                <span class="notif-drawer-title">通知中心</span>
                <div class="notif-clear-all" onclick="clearAllNotifications(event)">
                    <i class="fas fa-times icon-x"></i>
                    <span class="text-clear">全部清除</span>
                </div>
            </div>
            <div class="notif-drawer-list" id="notifDrawerList">
                <div class="notif-empty">暂无通知</div>
            </div>
        `;
        document.body.appendChild(drawer);

        // Attach Event Delegation
        const list = document.getElementById('notifDrawerList');
        if (list) list.addEventListener('click', handleDrawerListClick);
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
        e.stopPropagation();
        createDrawerHTML();

        const drawer = document.getElementById('notifDrawer');
        const backdrop = document.getElementById('notifBackdrop');

        if (drawer.classList.contains('active')) {
            closeDrawer();
        } else {
            drawer.classList.add('active');
            backdrop.classList.add('active');
            isExpanded = false;
            renderNotifications();
        }
    };

    function closeDrawer() {
        const drawer = document.getElementById('notifDrawer');
        const backdrop = document.getElementById('notifBackdrop');
        if (drawer) drawer.classList.remove('active');
        if (backdrop) backdrop.classList.remove('active');
    }

    // Core Functions
    window.initNotificationSystem = async function () {
        const user = await getCurrentUser();
        const wrapper = document.getElementById('navNotifWrapper');

        if (!user) {
            if (wrapper) wrapper.style.display = 'none';
            return;
        }

        if (wrapper) wrapper.style.display = 'block';
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
        if (!badge) return;
        badge.style.display = unreadCount > 0 ? 'block' : 'none';
    }

    function renderNotifications(animateExpansion = false) {
        const list = document.getElementById('notifDrawerList');
        if (!list) return;

        if (!notifications.length) {
            list.innerHTML = `<div class="notif-empty">暂无通知</div>`;
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
                <div id="notifExpandWrapper" style="text-align: center; padding: 8px 0;">
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
        const note = notifications.find(n => n.id === id);
        if (note && !note.is_read) {
            note.is_read = true;
            unreadCount = Math.max(0, unreadCount - 1);
            updateBadge();
            el.classList.remove('unread');

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
            if (list) list.innerHTML = '<div class="notif-empty">暂无通知</div>';
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
