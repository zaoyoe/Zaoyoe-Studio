// Interactive security card expansion with staggered rise animation
function expandSecurityCard(event, cardType) {
    // On mobile (<= 768px), do nothing - all panels are always visible in a single scroll
    if (window.innerWidth <= 768) {
        console.log('📱 Mobile view - panels always visible, no switching needed');
        return;
    }

    // Stop event propagation (desktop only)
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    console.log('🔓 Expanding security card:', cardType);

    // Remove show class from all panels immediately
    const allDetails = document.querySelectorAll('.security-detail-content');
    allDetails.forEach(detail => {
        detail.classList.remove('show');
        // Hide after a brief moment to allow fade out
        setTimeout(() => {
            if (!detail.classList.contains('show')) {
                detail.style.display = 'none';
            }
        }, 100);
    });

    // Show selected panel with staggered rise animation
    const selectedPanel = document.getElementById(`detail-${cardType}`);
    if (selectedPanel) {
        // Set display first
        selectedPanel.style.display = 'block';
        // Force reflow
        void selectedPanel.offsetWidth;
        // Add show class to trigger animation
        requestAnimationFrame(() => {
            selectedPanel.classList.add('show');
        });
    }

    // Update active states
    document.querySelectorAll('.security-card').forEach(card => {
        card.classList.remove('active');
    });

    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
}

// Reset security cards to default state
function resetSecurityCards() {
    console.log('🔄 Resetting security cards');

    // Hide all detail panels first
    const allDetails = document.querySelectorAll('.security-detail-content');
    allDetails.forEach(detail => {
        detail.style.display = 'none';
    });

    // Show Security Overview panel by default
    const overviewPanel = document.getElementById('detail-security-overview');
    if (overviewPanel) {
        overviewPanel.style.display = 'block';
        // Add show class for animation if needed, or just let it be static
        requestAnimationFrame(() => {
            overviewPanel.classList.add('show');
        });
    }

    // Remove active class from all cards
    document.querySelectorAll('.security-card').forEach(card => {
        card.classList.remove('active');
    });

    // No card active by default

}

// Phone Binding Functions
let phoneCooldownTimer = null;
let phoneCooldownSeconds = 0;

function sendPhoneVerificationCode(source = 'desktop') {
    // Determine which input to use based on source
    const prefix = source === 'mobile' ? 'mobile_' : '';
    const phoneInput = document.getElementById(`${prefix}phoneNumberInput`);
    const sendBtn = document.getElementById(`${prefix}sendPhoneCodeBtn`);

    if (!phoneInput || !sendBtn) return;

    const phoneNumber = phoneInput.value.trim();
    if (!phoneNumber) {
        alert('请输入手机号');
        return;
    }

    if (phoneCooldownSeconds > 0) {
        return;
    }

    // Call backend function
    if (typeof window.requestPhoneBindCode === 'function') {
        // Disable button temporarily
        sendBtn.disabled = true;
        const originalText = sendBtn.textContent;
        sendBtn.textContent = '发送中...';

        window.requestPhoneBindCode(phoneNumber).then(success => {
            if (success) {
                // Start cooldown
                phoneCooldownSeconds = 60;
                updatePhoneButtonCountdown(sendBtn, '获取验证码');

                // Sync cooldown to other button if it exists
                const otherPrefix = source === 'mobile' ? '' : 'mobile_';
                const otherBtn = document.getElementById(`${otherPrefix}sendPhoneCodeBtn`);
                if (otherBtn) updatePhoneButtonCountdown(otherBtn, '获取验证码');
            } else {
                // Reset button
                sendBtn.disabled = false;
                sendBtn.textContent = '获取验证码';
            }
        });
    } else {
        alert('后端功能未加载，请刷新页面重试');
    }
}

function updatePhoneButtonCountdown(button, originalText) {
    if (phoneCooldownSeconds > 0) {
        button.textContent = `${phoneCooldownSeconds}s`;
        button.disabled = true;
        // Recursive call handled by the timer, but we need to be careful with multiple buttons
        // Simplified: Just update text, the timer is global
    } else {
        button.textContent = originalText;
        button.disabled = false;
    }
}

// Global timer loop for cooldown
setInterval(() => {
    if (phoneCooldownSeconds > 0) {
        phoneCooldownSeconds--;
        ['sendPhoneCodeBtn', 'mobile_sendPhoneCodeBtn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.textContent = `${phoneCooldownSeconds}s`;
                btn.disabled = true;
            }
        });
    } else {
        ['sendPhoneCodeBtn', 'mobile_sendPhoneCodeBtn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn && btn.disabled && btn.textContent.includes('s')) {
                btn.textContent = '获取验证码';
                btn.disabled = false;
            }
        });
    }
}, 1000);

function bindPhone(source = 'desktop') {
    const prefix = source === 'mobile' ? 'mobile_' : '';
    const phoneInput = document.getElementById(`${prefix}phoneNumberInput`);
    const codeInput = document.getElementById(`${prefix}phoneCodeInput`);

    if (!phoneInput || !codeInput) return;

    const phoneNumber = phoneInput.value.trim();
    const code = codeInput.value.trim();

    if (!phoneNumber || !code) {
        alert('请输入手机号和验证码');
        return;
    }

    // Call backend function
    if (typeof window.bindPhoneNumber === 'function') {
        window.bindPhoneNumber(phoneNumber, code).then(success => {
            if (success) {
                // Clear inputs
                phoneInput.value = '';
                codeInput.value = '';
                // Reset cooldown
                phoneCooldownSeconds = 0;
            }
        });
    } else {
        alert('后端功能未加载，请刷新页面重试');
    }
}

// Change Password Function
async function changePassword(source = 'desktop') {
    // Determine correct input IDs based on source
    let oldPassInput, newPassInput;

    if (source === 'mobile') {
        oldPassInput = document.getElementById('mobile_oldPassword');
        newPassInput = document.getElementById('mobile_newPassword');
    } else {
        // Desktop uses different IDs
        oldPassInput = document.getElementById('oldPasswordInput');
        newPassInput = document.getElementById('newPasswordInput');
    }

    if (!oldPassInput || !newPassInput) {
        console.error('❌ Password inputs not found for source:', source);
        alert('系统错误：找不到密码输入框');
        return;
    }

    const oldPassword = oldPassInput.value;
    const newPassword = newPassInput.value;

    if (!oldPassword || !newPassword) {
        alert('请输入当前密码和新密码');
        return;
    }

    if (newPassword.length < 6) {
        alert('新密码至少需要6位');
        return;
    }

    const currentUser = AV.User.current();
    if (!currentUser) {
        alert('请先登录');
        return;
    }

    try {
        // LeanCloud requires updating password via updatePassword(old, new)
        await currentUser.updatePassword(oldPassword, newPassword);
        alert('密码修改成功！请重新登录。');

        // Clear inputs
        oldPassInput.value = '';
        newPassInput.value = '';

        // Logout and redirect to login
        if (typeof handleLogout === 'function') {
            handleLogout();
        }
    } catch (error) {
        console.error('❌ Password change failed:', error);

        let errorMsg = '密码修改失败';

        // Handle specific LeanCloud errors
        if (error.code === 210 || (error.message && error.message.includes('mismatch'))) {
            errorMsg = '当前密码不正确，请检查后重试。';
        } else if (error.code === 1) {
            errorMsg = '操作过于频繁，请稍后再试。';
        } else if (error.message) {
            errorMsg = '密码修改失败: ' + error.message;
        }

        // Ensure alert is called
        setTimeout(() => {
            alert(errorMsg);
        }, 100);
    }
}

// Expose to window
window.expandSecurityCard = expandSecurityCard;
window.resetSecurityCards = resetSecurityCards;
window.sendPhoneVerificationCode = sendPhoneVerificationCode;
window.bindPhone = bindPhone;
window.changePassword = changePassword;



