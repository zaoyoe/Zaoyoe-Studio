document.addEventListener('DOMContentLoaded', () => {
    const costInput = document.getElementById('cost');
    const shippingInput = document.getElementById('shipping');
    const sellingInput = document.getElementById('selling');

    const profitDisplay = document.getElementById('profit');
    const marginDisplay = document.getElementById('margin');
    const roiDisplay = document.getElementById('roi');

    const inputs = [costInput, shippingInput, sellingInput];

    function calculate() {
        const cost = parseFloat(costInput.value) || 0;
        const shipping = parseFloat(shippingInput.value) || 0;
        const selling = parseFloat(sellingInput.value) || 0;

        // Calculate Profit
        const totalCost = cost + shipping;
        const profit = selling - totalCost;

        // Calculate Margin (Profit / Selling Price)
        let margin = 0;
        if (selling > 0) {
            margin = (profit / selling) * 100;
        }

        // Calculate ROI (Profit / Total Cost)
        let roi = 0;
        if (totalCost > 0) {
            roi = (profit / totalCost) * 100;
        }

        // Update UI
        updateDisplay(profit, margin, roi);
    }

    function updateDisplay(profit, margin, roi) {
        // Format Currency
        profitDisplay.textContent = `¥${profit.toFixed(2)}`;

        // Color coding for profit
        profitDisplay.classList.toggle('profit-positive', profit > 0);
        profitDisplay.classList.toggle('profit-negative', profit < 0);
        profitDisplay.classList.toggle('profit-neutral', profit === 0);

        // Format Percentages
        marginDisplay.textContent = `${margin.toFixed(1)}%`;
        roiDisplay.textContent = `${roi.toFixed(1)}%`;
    }

    // Add event listeners to all inputs if they exist
    if (costInput && shippingInput && sellingInput) {
        inputs.forEach(input => {
            input.addEventListener('input', calculate);
        });
    }
});

/* =========================================
   Shop Page Logic
   ========================================= */

// Clock Functionality
function updateClock() {
    const dateElement = document.getElementById('current-date');
    const timeElement = document.getElementById('current-time');

    if (dateElement && timeElement) {
        const now = new Date();

        // Format Date: 2025年11月23日
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        dateElement.textContent = `${year}年${month}月${day}日`;

        // Format Time: 09:15:21
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        timeElement.textContent = `${hours}:${minutes}:${seconds}`;
    }
}

// Run clock immediately and then every second
updateClock();
setInterval(updateClock, 1000);

// --- Auth Modal Logic (Dual Mode) ---
function openAuthModal(view = 'login') {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.remove('closing');
        modal.classList.add('active');
        if (window.iOSScrollLock) window.iOSScrollLock.lock(modal); // Lock body scroll
        switchAuthView(view);
    }
}

function toggleLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.add('closing');
        modal.classList.remove('active');

        setTimeout(() => {
            if (!modal.classList.contains('active')) {
                modal.classList.remove('closing');
                if (window.iOSScrollLock) window.iOSScrollLock.unlock(); // Unlock body scroll
            }
        }, 350); // 等待过渡动画完成（0.3s）+ 额外缓冲时间
    }
}

let loginOverlayMouseDownTarget = null;

function handleLoginOverlayClick(event) {
    // Track mousedown to differentiate clicks from drags
    // Only close if mousedown and mouseup both happened on overlay (not a drag)
    if (event.type === 'mousedown') {
        loginOverlayMouseDownTarget = event.target;
    } else if (event.type === 'mouseup') {
        // Only close if both mousedown and mouseup were on the overlay
        // This prevents closing when dragging text selection
        if (event.target.classList.contains('login-overlay') &&
            loginOverlayMouseDownTarget &&
            loginOverlayMouseDownTarget.classList.contains('login-overlay')) {
            toggleLoginModal();
        }
        loginOverlayMouseDownTarget = null;
    }
}

function switchAuthView(view) {
    const loginView = document.getElementById('loginView');
    const registerView = document.getElementById('registerView');
    const resetView = document.getElementById('resetView');

    // Hide all first
    loginView.classList.add('hidden');
    registerView.classList.add('hidden');
    if (resetView) resetView.classList.add('hidden');

    // Show requested view
    if (view === 'login') {
        loginView.classList.remove('hidden');
    } else if (view === 'register') {
        registerView.classList.remove('hidden');
    } else if (view === 'reset') {
        if (resetView) resetView.classList.remove('hidden');
    }
}

// --- Coming Soon Modal Logic ---
// Global scroll position tracker

function openModal(modalId) {
    console.log('🔵 openModal called with:', modalId);
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        if (window.iOSScrollLock) window.iOSScrollLock.lockLight(modal); // Lock body scroll (light mode to preserve transparency)
        console.log('✅ Modal opened:', modalId);
    } else {
        console.error('❌ Modal not found:', modalId);
    }
}

let modalOverlayMouseDownTarget = null; // Declare globally

function closeModal(event) {
    // Track mousedown to differentiate clicks from drags
    if (event.type === 'mousedown') {
        modalOverlayMouseDownTarget = event.target;
    } else if (event.type === 'mouseup') {
        // Only close if both mousedown and mouseup were on the overlay
        // This prevents closing when dragging text selection or clicking inputs
        if (event.target.classList.contains('modal-overlay') &&
            modalOverlayMouseDownTarget &&
            modalOverlayMouseDownTarget.classList.contains('modal-overlay')) {
            closeAllModals();
        }
        modalOverlayMouseDownTarget = null;
    }

    // Also close if clicked on close buttons, regardless of drag
    if (event.target.closest('.close-btn') ||
        event.target.closest('.close-pill-btn') ||
        event.target.closest('.mac-dot.red') ||
        event.target.closest('.modal-close-icon')) {
        closeAllModals();
    }
}

function closeAllModals() {
    if (typeof window.__cleanupProfileModalAfterClose === 'function') {
        window.__cleanupProfileModalAfterClose();
    }

    const modals = document.querySelectorAll('.modal-overlay');
    modals.forEach(modal => {
        modal.classList.remove('active');
    });

    // Restore Scroll
    if (window.iOSScrollLock) window.iOSScrollLock.unlock();

}

function setLegacyRuntimeStyles(target, styles = {}, priority = '') {
    if (!target?.style) return;

    const style = target.style;
    const setProperty = style['setProperty']?.bind(style);
    if (typeof setProperty !== 'function') return;

    Object.entries(styles).forEach(([name, value]) => {
        setProperty(name, String(value), priority);
    });
}

/* =========================================
   Guestbook Logic with Image Upload
   ========================================= */


function copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('已复制到剪贴板: ' + text);
    }).catch(err => {
        console.error('无法复制', err);
    });
}

// Magnetic Hover Effect
function initMagneticEffect(selector) {
    const cards = document.querySelectorAll(selector);

    cards.forEach(card => {
        card.addEventListener('animationend', () => {
            card.classList.add('glass-box-runtime-ready');
        }, { once: true });

        setTimeout(() => {
            if (getComputedStyle(card).animationName !== 'none') {
                card.classList.add('glass-box-runtime-ready');
            }
        }, 1000);
    });

    cards.forEach(card => {
        let enterTimeout;
        let activeAnimation = null;

        const cancelActiveAnimation = () => {
            if (activeAnimation) {
                activeAnimation.cancel();
                activeAnimation = null;
            }
        };

        const animateCardTransform = (transform, duration = 60, easing = 'linear') => {
            cancelActiveAnimation();
            activeAnimation = card.animate(
                [{ transform }],
                { duration, easing, fill: 'forwards' }
            );
        };

        card.addEventListener('mouseenter', () => {
            card.classList.add('glass-box-magnetic-entering');
            card.classList.remove('glass-box-magnetic-tracking');
            clearTimeout(enterTimeout);
            enterTimeout = setTimeout(() => {
                card.classList.remove('glass-box-magnetic-entering');
                card.classList.add('glass-box-magnetic-tracking');
            }, 200);
        });

        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;

            const moveX = x * 0.015; // Reduced from 0.05 for subtler wobble
            const moveY = y * 0.015;

            animateCardTransform(`translateY(-2px) translate(${moveX}px, ${moveY}px)`);
        });

        card.addEventListener('mouseleave', () => {
            clearTimeout(enterTimeout);
            card.classList.remove('glass-box-magnetic-entering', 'glass-box-magnetic-tracking');
            cancelActiveAnimation();
        });
    });

    const viewMoreBtn = document.querySelector('.guestbook-view-more');
    if (viewMoreBtn) {
        console.log('✅ View More hover uses stylesheet state');
    }
}

// Mouse Tracking for Glow Effect
document.addEventListener('DOMContentLoaded', () => {
    // Initialize for Shop Page
    initMagneticEffect('.glass-box');

    // Mouse Follow Effect
    const cards = document.querySelectorAll('.glass-box');

    cards.forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            setLegacyRuntimeStyles(card, {
                '--mouse-x': `${x}px`,
                '--mouse-y': `${y}px`
            });
        });
    });

    // Lightbox Implementation
    function initLightbox() {
        // Create lightbox element if it doesn't exist
        if (!document.querySelector('.lightbox-overlay')) {
            const lightbox = document.createElement('div');
            lightbox.className = 'lightbox-overlay';
            lightbox.hidden = true;
            lightbox.innerHTML = '<img class="lightbox-image" src="" alt="Preview">';
            document.body.appendChild(lightbox);

            // Close on click
            lightbox.addEventListener('click', () => {
                lightbox.classList.remove('active');
                setTimeout(() => {
                    lightbox.hidden = true;
                }, 300);
            });
        }

        const lightbox = document.querySelector('.lightbox-overlay');
        const lightboxImg = lightbox.querySelector('.lightbox-image');
        const images = document.querySelectorAll('.notion-content img');

        images.forEach(img => {
            img.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent bubbling
                lightboxImg.src = img.src;
                lightbox.hidden = false;
                // Force reflow
                lightbox.offsetHeight;
                lightbox.classList.add('active');
            });
        });
    }

    // Initialize Lightbox
    initLightbox();
});

// --- EmailJS Configuration & Logic ---
let generatedCode = null; // Stores the real system-generated code
const serviceID = "service_1bvx7vq"; // Replace with your Service ID
const templateID = "template_ieu7m97"; // Replace with your Template ID

function showAuthMessageOrAlert(message, type = 'error', targetView = 'register') {
    if (typeof window.showAuthMessage === 'function' && window.showAuthMessage(message, type, targetView)) {
        return;
    }

    alert(message);
}

function authPopupT(key, fallback) {
    return window.i18n?.t(key, fallback) || fallback;
}

function formatAuthPopupText(key, fallback, vars = {}) {
    let text = authPopupT(key, fallback);
    Object.entries(vars).forEach(([name, value]) => {
        text = text.split(`{${name}}`).join(String(value));
    });
    return text;
}

// Function 1: Send Verification Code
function sendVerificationCode() {
    const emailInput = document.getElementById('reg-email');
    const sendBtn = document.getElementById('sendBtn');
    const email = emailInput.value;
    const sendingLabel = authPopupT('auth.sendingCode', '发送中...');
    const idleLabel = authPopupT('auth.getShort', '获取');

    // 1. Validate email format
    if (!email || !email.includes('@')) {
        showAuthMessageOrAlert(authPopupT('auth.invalidEmailNotice', '请先填写正确的邮箱地址！'));
        return;
    }

    // ✅ 检查 EmailJS 是否已加载
    if (typeof emailjs === 'undefined') {
        showAuthMessageOrAlert(authPopupT('auth.emailServiceLoading', '邮件服务加载中，请稍后再试...'));
        console.error('❌ EmailJS not loaded');
        return;
    }

    // 2. Generate 6-digit random number
    generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
    console.log("Debug: Verification Code is " + generatedCode); // For debugging

    // 3. Change button state (prevent duplicate clicks)
    sendBtn.disabled = true;
    sendBtn.innerText = sendingLabel;

    // ✅ 添加超时处理 (30秒后自动恢复按钮)
    const timeoutId = setTimeout(() => {
        if (sendBtn.innerText === sendingLabel) {
            console.warn('⚠️ 验证码发送超时');
            showAuthMessageOrAlert(authPopupT('auth.sendTimeout', '发送超时，请检查网络后重试。'));
            sendBtn.disabled = false;
            sendBtn.innerText = idleLabel;
        }
    }, 30000);

    // 4. Call EmailJS to send
    const templateParams = {
        to_email: email, // Corresponds to recipient logic in template
        code: generatedCode // Corresponds to {{code}} in template
    };

    emailjs.send(serviceID, templateID, templateParams)
        .then(function (response) {
            clearTimeout(timeoutId); // 清除超时
            console.log('SUCCESS!', response.status, response.text);
            showAuthMessageOrAlert(
                formatAuthPopupText('auth.codeSentNotice', '验证码已发送至 {email}，请查收。', { email }),
                'success'
            );
            startCountdown(sendBtn); // Start countdown
        }, function (error) {
            clearTimeout(timeoutId); // 清除超时
            console.log('FAILED...', error);
            showAuthMessageOrAlert(authPopupT('auth.sendFailedNotice', '发送失败，请检查网络或稍后重试。'));
            sendBtn.disabled = false;
            sendBtn.innerText = idleLabel;
        });
}

// Function 2: Button Countdown
function startCountdown(btnElement) {
    let seconds = 60;
    btnElement.innerText = `${seconds}s`;

    const timer = setInterval(() => {
        seconds--;
        btnElement.innerText = `${seconds}s`;

        if (seconds <= 0) {
            clearInterval(timer);
            btnElement.disabled = false;
            btnElement.innerText = authPopupT('auth.getShort', '获取');
            // Optional: Invalidate code after timeout
            // generatedCode = null; 
        }
    }, 1000);
}

// ✅ 全局函数：处理 Auth 按钮点击
window.toggleAuthMenu = function (e) {
    console.log('🔘 toggleAuthMenu called');

    // Check if user is logged in (based on avatar visibility)
    const navAvatar = document.getElementById('navUserAvatar');
    const isLoggedIn = navAvatar && navAvatar.classList.contains('show');

    if (isLoggedIn) {
        // Toggle Dropdown
        const dropdown = document.getElementById('userDropdown');
        const overlay = document.getElementById('dropdownOverlay');

        if (dropdown) {
            dropdown.classList.toggle('active');

            // Toggle overlay
            if (overlay) {
                overlay.classList.toggle('active');
            }

            console.log('🔽 Dropdown toggled:', dropdown.classList.contains('active'));
        }
    } else {
        // Trigger Login
        console.log('🔐 Triggering login flow');
        if (typeof window.handleAuthClick === 'function') {
            window.handleAuthClick(e);
        } else {
            console.error('❌ window.handleAuthClick is not defined');
        }
    }
};

// Global click to close dropdown
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('userDropdown');
    const overlay = document.getElementById('dropdownOverlay');
    const btn = document.getElementById('authBtn');

    if (dropdown && dropdown.classList.contains('active')) {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
        }
    }
});


// Close dropdown when clicking outside
document.addEventListener('click', (event) => {
    const topNav = document.querySelector('.top-right-nav');
    const dropdown = document.getElementById('userDropdown');
    const overlay = document.getElementById('dropdownOverlay');

    if (topNav && dropdown && !topNav.contains(event.target)) {
        dropdown.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    }
});

// Close dropdown when clicking on overlay
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('dropdownOverlay');
    if (overlay) {
        overlay.addEventListener('click', () => {
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) {
                dropdown.classList.remove('active');
                overlay.classList.remove('active');
            }
        });
    }
});


/* =========================================
   CRITICAL FIX: Event Listeners for Modal Triggers
   ========================================= */
// Add event listeners to all elements with data-modal-target attribute
// This ensures click handlers work properly after script.js is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('📌 Setting up modal click handlers...');

    document.querySelectorAll('[data-modal-target]').forEach(element => {
        element.addEventListener('click', function (event) {
            // Prevent default for links
            if (this.tagName === 'A') {
                event.preventDefault();
            }

            const modalId = this.getAttribute('data-modal-target');
            console.log(`🎯 Clicked element with modal target: ${modalId}`);

            if (typeof openModal === 'function') {
                openModal(modalId);
            } else {
                console.error('❌ openModal is not defined when trying to open:', modalId);
            }
        });
    });

    const modalTriggers = document.querySelectorAll('[data-modal-target]');
    console.log(`✅ Initialized ${modalTriggers.length} modal click handlers`);
});

/* =========================================
   Mobile UX: Auto-close modals on page return
   ========================================= */
// When user navigates back from guestbook.html (or other pages), 
// close all modals to show a clean homepage
window.addEventListener('pageshow', (event) => {
    // Check if page is being restored from cache (back/forward navigation)
    if (event.persisted) {
        console.log('📱 Page restored from cache, closing all modals');

        // Close all modal overlays
        const modals = document.querySelectorAll('.modal-overlay, .login-overlay');
        modals.forEach(modal => {
            modal.classList.remove('active');
            modal.classList.remove('closing');
        });

        // Unlock body scroll
        if (window.iOSScrollLock) window.iOSScrollLock.unlock();

        console.log('✅ All modals closed, homepage is clean');
    }
});
