// Modal visibility is now handled entirely by CSS :not(.active) rules
// No JavaScript initialization needed

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
        if (profit > 0) {
            profitDisplay.style.color = 'var(--success-color)';
        } else if (profit < 0) {
            profitDisplay.style.color = 'var(--danger-color)';
        } else {
            profitDisplay.style.color = 'var(--text-color)';
        }

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
        // 清除关闭状态相关的类和内联样式，确保正常显示
        modal.classList.remove('closing');
        modal.style.backdropFilter = '';
        modal.style.webkitBackdropFilter = '';
        modal.style.background = '';

        // 强制重排以确保样式清除生效
        void modal.offsetWidth;

        // 添加 active 类以显示模态框
        modal.classList.add('active');
        document.body.classList.add('no-scroll'); // Lock body scroll
        switchAuthView(view);
    }
}

function toggleLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        // 立即添加 closing 类来清除 backdrop-filter，防止残留
        modal.classList.add('closing');

        // 移除 active 类开始关闭动画
        modal.classList.remove('active');

        // 等待过渡动画完成后，确保元素完全隐藏
        setTimeout(() => {
            if (!modal.classList.contains('active')) {
                // 强制清除所有视觉效果
                modal.style.backdropFilter = 'none';
                modal.style.webkitBackdropFilter = 'none';
                modal.style.background = 'transparent';
                // 移除 closing 类
                modal.classList.remove('closing');
                document.body.classList.remove('no-scroll'); // Unlock body scroll
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
        document.body.classList.add('no-scroll'); // Lock body scroll
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
    const modals = document.querySelectorAll('.modal-overlay');
    modals.forEach(modal => {
        modal.classList.remove('active');
        // Immediately remove all inline styles for synchronized animation
        modal.style.removeProperty('visibility');
        modal.style.removeProperty('opacity');
        modal.style.removeProperty('display');
    });

    // Restore Scroll
    document.body.classList.remove('no-scroll');

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
        // Fix: Animation 'forwards' locks the transform property.
        // We must remove the animation after it finishes to allow JS transforms.
        card.addEventListener('animationend', () => {
            card.style.opacity = '1'; // Ensure it stays visible
            card.style.animation = 'none'; // Release the lock
        }, { once: true });

        // Safety fallback in case animation event is missed or browser quirks
        setTimeout(() => {
            if (getComputedStyle(card).animationName !== 'none') {
                card.style.opacity = '1';
                card.style.animation = 'none';
            }
        }, 1000);
    });

    // Magnetic card effect - hybrid approach (Smooth Entry + Fast Tracking)
    cards.forEach(card => {
        let enterTimeout;

        card.addEventListener('mouseenter', () => {
            // 1. Initial Entry: Smooth transition for "float out"
            // We use 0.2s for transform (lift) and keep box-shadow smooth
            card.style.transition = 'transform 0.2s ease-out, box-shadow 0.25s ease-out';

            // 2. After entry animation completes, switch to fast tracking
            clearTimeout(enterTimeout);
            enterTimeout = setTimeout(() => {
                // Switch to fast transition for magnetic effect
                // Using linear for tracking feels more responsive
                card.style.transition = 'transform 0.05s linear, box-shadow 0.25s ease-out';
            }, 200); // Wait for the 0.2s entry animation
        });

        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;

            const moveX = x * 0.05;
            const moveY = y * 0.05;

            card.style.transform = `translateY(-8px) translate(${moveX}px, ${moveY}px)`;
        });

        card.addEventListener('mouseleave', () => {
            clearTimeout(enterTimeout);
            // Reset to default transition (defined in CSS)
            card.style.transition = '';
            card.style.transform = '';
        });
    });

    /* AGGRESSIVE FIX: View More Button Hover - Force with setInterval */
    const viewMoreBtn = document.querySelector('.guestbook-view-more');
    if (viewMoreBtn) {
        let isHovering = false;

        viewMoreBtn.addEventListener('mouseenter', function () {
            isHovering = true;
        });

        viewMoreBtn.addEventListener('mouseleave', function () {
            isHovering = false;
        });

        // Force styles every 50ms
        setInterval(() => {
            if (viewMoreBtn) {
                if (isHovering) {
                    viewMoreBtn.style.setProperty('transform', 'translateY(-2px)', 'important');
                    viewMoreBtn.style.setProperty('color', '#ff85c0', 'important');
                    viewMoreBtn.style.setProperty('text-shadow', '0 4px 12px rgba(244, 114, 182, 0.6)', 'important');
                } else {
                    viewMoreBtn.style.setProperty('transform', 'translateZ(0)', 'important');
                    viewMoreBtn.style.setProperty('color', '#f472b6', 'important');
                    viewMoreBtn.style.setProperty('text-shadow', 'none', 'important');
                }
            }
        }, 50);

        console.log('✅ Aggressive View More hover initialized');
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

            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
        });
    });

    // Lightbox Implementation
    function initLightbox() {
        // Create lightbox element if it doesn't exist
        if (!document.querySelector('.lightbox-overlay')) {
            const lightbox = document.createElement('div');
            lightbox.className = 'lightbox-overlay';
            lightbox.innerHTML = '<img class="lightbox-image" src="" alt="Preview">';
            document.body.appendChild(lightbox);

            // Close on click
            lightbox.addEventListener('click', () => {
                lightbox.classList.remove('active');
                setTimeout(() => {
                    lightbox.style.display = 'none';
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
                lightbox.style.display = 'flex';
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

// Function 1: Send Verification Code
function sendVerificationCode() {
    const emailInput = document.getElementById('reg-mail');
    const sendBtn = document.getElementById('sendBtn');
    const email = emailInput.value;

    // 1. Validate email format
    if (!email || !email.includes('@')) {
        alert("请先填写正确的邮箱地址！");
        return;
    }

    // ✅ 检查 EmailJS 是否已加载
    if (typeof emailjs === 'undefined') {
        alert("邮件服务加载中，请稍后再试...");
        console.error('❌ EmailJS not loaded');
        return;
    }

    // 2. Generate 6-digit random number
    generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
    console.log("Debug: Verification Code is " + generatedCode); // For debugging

    // 3. Change button state (prevent duplicate clicks)
    sendBtn.disabled = true;
    sendBtn.innerText = "发送中...";

    // ✅ 添加超时处理 (30秒后自动恢复按钮)
    const timeoutId = setTimeout(() => {
        if (sendBtn.innerText === "发送中...") {
            console.warn('⚠️ 验证码发送超时');
            alert("发送超时，请检查网络后重试。");
            sendBtn.disabled = false;
            sendBtn.innerText = "重新获取";
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
            alert(`验证码已发送至 ${email}，请查收！`);
            startCountdown(sendBtn); // Start countdown
        }, function (error) {
            clearTimeout(timeoutId); // 清除超时
            console.log('FAILED...', error);
            alert("发送失败，请检查网络或稍后重试。");
            sendBtn.disabled = false;
            sendBtn.innerText = "重新获取";
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
            btnElement.innerText = "重新获取";
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
    const isLoggedIn = navAvatar && navAvatar.style.display !== 'none';

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
            // Remove inline styles instead of setting to 'none'
            modal.style.removeProperty('backdrop-filter');
            modal.style.removeProperty('-webkit-backdrop-filter');
            modal.style.removeProperty('background');
            modal.style.removeProperty('visibility');
            modal.style.removeProperty('opacity');
            modal.style.removeProperty('display');
        });

        // Unlock body scroll
        document.body.classList.remove('no-scroll');

        console.log('✅ All modals closed, homepage is clean');
    }
});
