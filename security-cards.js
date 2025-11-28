// Interactive security card expansion with staggered rise animation
function expandSecurityCard(event, cardType) {
    // Stop event propagation
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

function sendPhoneVerificationCode() {
    const phoneInput = document.getElementById('phoneNumberInput');
    const sendBtn = document.getElementById('sendPhoneCodeBtn');

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
        phoneCooldownSeconds--;
        phoneCooldownTimer = setTimeout(() => updatePhoneButtonCountdown(button, originalText), 1000);
    } else {
        button.textContent = originalText;
        button.disabled = false;
        if (phoneCooldownTimer) {
            clearTimeout(phoneCooldownTimer);
            phoneCooldownTimer = null;
        }
    }
}

function bindPhone() {
    const phoneInput = document.getElementById('phoneNumberInput');
    const codeInput = document.getElementById('phoneCodeInput');

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

// Expose to window
window.expandSecurityCard = expandSecurityCard;
window.resetSecurityCards = resetSecurityCards;
window.sendPhoneVerificationCode = sendPhoneVerificationCode;
window.bindPhone = bindPhone;

