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

function handleLoginOverlayClick(event) {
    // 只关闭模态框，如果点击的是 overlay 本身（不是 login-card 或其子元素）
    if (event.target.classList.contains('login-overlay')) {
        toggleLoginModal();
    }
    // 如果点击的是 login-card 或其子元素，不关闭模态框，让事件正常传播
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

function closeModal(event) {
    // Close if clicked on overlay or close button
    if (event.target.classList.contains('modal-overlay') ||
        event.target.closest('.close-btn') ||
        event.target.closest('.close-pill-btn') ||
        event.target.closest('.mac-dot.red') ||
        event.target.closest('.modal-close-icon')) {

        const modals = document.querySelectorAll('.modal-overlay');
        modals.forEach(modal => {
            modal.classList.remove('active');
            // Immediately remove all inline styles for synchronized animation
            modal.style.removeProperty('visibility');
            modal.style.removeProperty('opacity');
            modal.style.removeProperty('display');
        });
        document.body.classList.remove('no-scroll'); // Unlock body scroll
    }
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
        }, 1000); // Wait slightly longer than animation duration

        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            // Reduced sensitivity: Divisor 25 (was 8) for subtle premium feel
            const deltaX = (x - centerX) / 25;
            const deltaY = (y - centerY) / 25;

            card.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1.01)`;
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
        });
    });
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
    const emailInput = document.getElementById('reg-email');
    const sendBtn = document.getElementById('sendBtn');
    const email = emailInput.value;

    // 1. Validate email format
    if (!email || !email.includes('@')) {
        alert("请先填写正确的邮箱地址！");
        return;
    }

    // 2. Generate 6-digit random number
    generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
    console.log("Debug: Verification Code is " + generatedCode); // For debugging

    // 3. Change button state (prevent duplicate clicks)
    sendBtn.disabled = true;
    sendBtn.innerText = "发送中...";

    // 4. Call EmailJS to send
    const templateParams = {
        to_email: email, // Corresponds to recipient logic in template
        code: generatedCode // Corresponds to {{code}} in template
    };

    emailjs.send(serviceID, templateID, templateParams)
        .then(function (response) {
            console.log('SUCCESS!', response.status, response.text);
            alert(`验证码已发送至 ${email}，请查收！`);
            startCountdown(sendBtn); // Start countdown
        }, function (error) {
            console.log('FAILED...', error);
            alert("发送失败，请检查网络或配置。");
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






// updateResetButtonCountdown function is still used by LeanCloud version
function updateResetButtonCountdown(button, originalText) {
    if (!button) return;

    if (resetCooldownSeconds > 0) {
        button.textContent = `已发送 (${resetCooldownSeconds}s)`;
        button.disabled = true;
        resetCooldownSeconds--;
        resetCooldownTimer = setTimeout(() => updateResetButtonCountdown(button, originalText), 1000);
    } else {
        button.textContent = originalText;
        button.disabled = false;
        if (resetCooldownTimer) {
            clearTimeout(resetCooldownTimer);
            resetCooldownTimer = null;
        }
    }
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
        if (dropdown) {
            dropdown.classList.toggle('active');
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
    const btn = document.getElementById('authBtn');

    if (dropdown && dropdown.classList.contains('active')) {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.classList.remove('active');
        }
    }
});

// Anti-flicker: Load cached profile immediately
function loadCachedProfile() {
    try {
        const cached = localStorage.getItem('cached_user_profile');
        if (cached) {
            const data = JSON.parse(cached);
            const btnSpan = document.getElementById('authBtnText');
            const defaultIcon = document.getElementById('defaultAuthIcon');
            const navAvatar = document.getElementById('navUserAvatar');

            if (btnSpan) btnSpan.textContent = data.displayName;
            if (defaultIcon) defaultIcon.style.display = 'none';
            if (navAvatar) {
                navAvatar.src = data.avatarUrl;
                navAvatar.style.display = 'block';
            }
        }
    } catch (e) {
        console.error('Error loading cached profile:', e);
    }
}

// Call immediately
loadCachedProfile();     // Hide dropdown if open
// Hide dropdown if open
const dropdown = document.getElementById('userDropdown');
if (dropdown) dropdown.classList.remove('active');

// Function 8: Handle Avatar Upload
async function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Check size (limit to 2MB)
    if (file.size > 2 * 1024 * 1024) {
        alert("图片大小不能超过 2MB");
        return;
    }

    // Use LeanCloud authentication instead of Firebase
    const currentUser = AV.User.current();

    if (!currentUser) {
        alert("请先登录");
        return;
    }

    // Convert to Base64 and Resize
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = async function () {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Resize to 200x200 max
            const maxSize = 200;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height *= maxSize / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width *= maxSize / height;
                    height = maxSize;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            // Get Base64 string (JPEG, 0.8 quality)
            const base64String = canvas.toDataURL('image/jpeg', 0.8);

            try {
                console.log('🖼️ Starting avatar upload...');
                console.log('📦 Base64 size:', Math.round(base64String.length / 1024), 'KB');

                // ✅ 关键优化：使用 fetch({ useMasterKey: false }) 确保使用用户自己的会话
                console.log('📡 Fetching latest user data before update...');
                await currentUser.fetch({ useMasterKey: false });
                console.log('✅ User data fetched successfully');

                // Save avatar to LeanCloud user profile
                console.log('💾 Updating LeanCloud user avatar...');
                currentUser.set('avatarUrl', base64String);
                await currentUser.save();
                console.log('✅ LeanCloud user avatar updated');

                // Trigger LeanCloud UI update
                console.log('🎨 Updating UI...');
                if (typeof updateLeanCloudUserUI === 'function') {
                    await updateLeanCloudUserUI(currentUser);
                } else if (typeof updateUserUI === 'function') {
                    updateUserUI({
                        objectId: currentUser.id,
                        username: currentUser.get('username'),
                        email: currentUser.get('email'),
                        nickname: currentUser.get('nickname') || currentUser.get('username'),
                        avatarUrl: base64String
                    });
                }
                console.log('✅ UI updated');

                alert("头像更新成功！");

            } catch (error) {
                console.error("❌ Error updating avatar:", error);

                // 添加详细错误日志用于调试
                console.log('🔍 Error details:', {
                    code: error.code,
                    message: error.message,
                    codeType: typeof error.code,
                    fullError: error
                });

                // ✅ 改进的ACL错误检测 - 更宽松更可靠
                const errorStr = (error.message || error.toString() || '').toLowerCase();
                const errorCode = String(error.code || '');
                const is403Error = errorCode === '403' || errorStr.includes('403');
                const isACLError = errorStr.includes('forbidden') || errorStr.includes('acl');

                console.log('🔍 ACL Error Check:', {
                    is403Error,
                    isACLError,
                    willAttemptFix: is403Error || isACLError
                });

                if (is403Error || isACLError) {
                    console.log('🔧 Attempting to auto-fix ACL for existing user...');
                    try {
                        // ✅ 关键修复：重新fetch确保最新数据
                        await currentUser.fetch({ useMasterKey: false });
                        console.log('📡 Re-fetched user data for ACL fix');

                        // ✅ 使用明确的 user.id（字符串）而非 user 对象
                        const acl = new AV.ACL();
                        acl.setPublicReadAccess(true);
                        acl.setWriteAccess(currentUser.id, true); // 使用 ID 字符串
                        currentUser.setACL(acl);

                        console.log('🔧 ACL set, retrying avatar save...');

                        // Retry save with fixed ACL
                        currentUser.set('avatarUrl', base64String);
                        await currentUser.save();

                        console.log('✅ ACL auto-fixed and avatar updated successfully');

                        // Trigger UI update
                        if (typeof updateLeanCloudUserUI === 'function') {
                            await updateLeanCloudUserUI(currentUser);
                        } else if (typeof updateUserUI === 'function') {
                            updateUserUI({
                                objectId: currentUser.id,
                                username: currentUser.get('username'),
                                email: currentUser.get('email'),
                                nickname: currentUser.get('nickname') || currentUser.get('username'),
                                avatarUrl: base64String
                            });
                        }

                        alert("✅ 头像更新成功！\n(已自动修复账号权限)");
                        return;

                    } catch (retryError) {
                        console.error("❌ ACL auto-fix failed:", retryError);

                        // ✅ 友好的恢复指引
                        const confirmReRegister = confirm(
                            "❌ 头像更新失败\n\n" +
                            "原因：账号权限已损坏且无法自动修复\n\n" +
                            "💡 解决方案：\n" +
                            "1. 注销当前账号\n" +
                            "2. 使用「后台删除旧账号」或「邮箱别名」注册新账号\n" +
                            "   （例如：your+new@gmail.com）\n\n" +
                            "是否立即注销？"
                        );

                        if (confirmReRegister) {
                            if (typeof handleLogout === 'function') {
                                handleLogout();
                            } else {
                                AV.User.logOut();
                                location.reload();
                            }
                        }
                        return;
                    }
                }

                alert("❌ 头像上传失败: " + error.message);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}



// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 App initialized');

    // Check for existing session
    const currentUser = AV.User.current();
    if (currentUser) {
        console.log('👤 Found existing session:', currentUser.get('username'));
        // 延迟一点执行 UI 更新，确保 DOM 准备好
        setTimeout(() => {
            if (typeof updateLeanCloudUserUI === 'function') {
                updateLeanCloudUserUI(currentUser);
            }
        }, 100);
    }
});




// Close dropdown when clicking outside
document.addEventListener('click', (event) => {
    const topNav = document.querySelector('.top-right-nav');
    const dropdown = document.getElementById('userDropdown');

    if (topNav && dropdown && !topNav.contains(event.target)) {
        dropdown.classList.remove('active');
    }
});




// Close dropdown when clicking outside
document.addEventListener('click', (event) => {
    const topNav = document.querySelector('.top-right-nav');
    const dropdown = document.getElementById('userDropdown');

    if (topNav && dropdown && !topNav.contains(event.target)) {
        dropdown.classList.remove('active');
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
