/**
 * Phone Authentication UI Helper Functions
 * Handles UI switching between email/phone modes and SMS countdown timers
 */

// ==================== Registration Mode Switching ====================
function switchRegisterMode(mode) {
    const emailFields = document.getElementById('emailRegFields');
    const phoneFields = document.getElementById('phoneRegFields');
    const emailBtn = document.getElementById('regEmailModeBtn');
    const phoneBtn = document.getElementById('regPhoneModeBtn');
    const emailInput = document.getElementById('reg-email');
    const phoneInput = document.getElementById('reg-phone');

    if (mode === 'email') {
        emailFields.style.display = 'block';
        phoneFields.style.display = 'none';
        emailBtn.classList.add('active');
        phoneBtn.classList.remove('active');

        // Update required fields
        emailInput.setAttribute('required', '');
        phoneInput.removeAttribute('required');
    } else {
        emailFields.style.display = 'none';
        phoneFields.style.display = 'block';
        emailBtn.classList.remove('active');
        phoneBtn.classList.add('active');

        // Update required fields
        emailInput.removeAttribute('required');
        phoneInput.setAttribute('required', '');
    }
}

// ==================== Login Mode Switching ====================
function switchLoginMode(mode) {
    const emailFields = document.getElementById('emailLoginFields');
    const phoneFields = document.getElementById('phoneLoginFields');
    const emailBtn = document.getElementById('loginEmailModeBtn');
    const phoneBtn = document.getElementById('loginPhoneModeBtn');
    const emailInput = document.getElementById('login-email');
    const phoneInput = document.getElementById('login-phone');

    if (mode === 'email') {
        emailFields.style.display = 'block';
        phoneFields.style.display = 'none';
        emailBtn.classList.add('active');
        phoneBtn.classList.remove('active');

        // Update required fields
        emailInput.setAttribute('required', '');
        document.getElementById('login-password').setAttribute('required', '');
        phoneInput.removeAttribute('required');
    } else {
        emailFields.style.display = 'none';
        phoneFields.style.display = 'block';
        emailBtn.classList.remove('active');
        phoneBtn.classList.add('active');

        // Update required fields
        emailInput.removeAttribute('required');
        phoneInput.setAttribute('required', '');
        // Password requirement depends on login method (password vs SMS)
        togglePhoneLoginMethod();
    }
}

// ==================== Phone Login Method Toggle ====================
function togglePhoneLoginMethod() {
    const method = document.querySelector('input[name=\"phoneLoginMethod\"]:checked')?.value;
    const passwordField = document.getElementById('phonePasswordField');
    const smsField = document.getElementById('phoneSmsField');
    const passwordInput = document.getElementById('login-phone-password');

    if (method === 'password') {
        passwordField.style.display = 'block';
        smsField.style.display = 'none';
        passwordInput.setAttribute('required', '');
    } else {
        passwordField.style.display = 'none';
        smsField.style.display = 'block';
        passwordInput.removeAttribute('required');
    }
}

// ==================== SMS Countdown Timer ====================
let smsTimers = {};

function startSmsCountdown(buttonId, duration = 60) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    let remaining = duration;
    button.disabled = true;
    button.textContent = `${remaining}秒后重发`;

    smsTimers[buttonId] = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(smsTimers[buttonId]);
            button.disabled = false;
            button.textContent = '获取验证码';
        } else {
            button.textContent = `${remaining}秒后重发`;
        }
    }, 1000);
}

// ==================== Send SMS Code ====================
async function sendSmsCode(context = 'register') {
    console.log('📱 Sending SMS code for:', context);

    // Get phone number based on context
    let phoneInput, countryCodeSelect, buttonId;

    if (context === 'register') {
        phoneInput = document.getElementById('reg-phone');
        countryCodeSelect = document.getElementById('reg-country-code');
        buttonId = 'sendSmsBtn';
    } else if (context === 'login') {
        phoneInput = document.getElementById('login-phone');
        countryCodeSelect = document.getElementById('login-country-code');
        buttonId = 'sendLoginSmsBtn';
    } else if (context === 'profile') {
        phoneInput = document.getElementById('profile-phone');
        countryCodeSelect = document.getElementById('profile-country-code');
        buttonId = 'profileSendSmsBtn';
    }

    const phone = phoneInput?.value.trim();
    const countryCode = countryCodeSelect?.value || '+86';

    if (!phone) {
        alert('请输入手机号');
        return;
    }

    // Validate phone number format (basic validation)
    if (!/^\\d{7,15}$/.test(phone)) {
        alert('请输入有效的手机号');
        return;
    }

    const fullPhone = countryCode + phone;

    try {
        // Use LeanCloud's SMS API
        if (context === 'register') {
            // Request SMS code for registration
            await AV.Cloud.requestSmsCode({
                mobilePhoneNumber: fullPhone,
                template: 'register', // Template name configured in LeanCloud
                sign: 'Your App Name' // SMS signature configured in LeanCloud
            });
        } else if (context === 'login') {
            // Request SMS code for login
            await AV.User.requestLoginSmsCode(fullPhone);
        } else if (context === 'profile') {
            // Request SMS code for phone binding
            await AV.Cloud.requestSmsCode({
                mobilePhoneNumber: fullPhone,
                template: 'bind_phone', // You'll need to create this template in LeanCloud
                sign: 'Your App Name'
            });
        }

        console.log('✅ SMS code sent');
        alert(`验证码已发送至 ${fullPhone}`);
        startSmsCountdown(buttonId);

    } catch (error) {
        console.error('❌ Failed to send SMS:', error);

        let errorMessage = '发送失败';
        if (error.code === 601) {
            errorMessage = '短信服务未开启或配置错误';
        } else if (error.code === 602) {
            errorMessage = '发送过于频繁，请稍后再试';
        } else if (error.message) {
            errorMessage = error.message;
        }

        alert(`发送验证码失败: ${errorMessage}`);
    }
}

// ==================== Phone Number Formatting ====================
function formatPhoneNumber(phone, countryCode = '+86') {
    // Remove all non-digit characters
    phone = phone.replace(/\\D/g, '');

    // Format based on country code
    if (countryCode === '+86' && phone.length === 11) {
        // China: 138 1234 5678
        return phone.replace(/(\\d{3})(\\d{4})(\\d{4})/, '$1 $2 $3');
    } else if (countryCode === '+1' && phone.length === 10) {
        // US: (123) 456-7890
        return phone.replace(/(\\d{3})(\\d{3})(\\d{4})/, '($1) $2-$3');
    }

    return phone;
}

// ==================== Validation Helpers ====================
function validatePhoneNumber(phone, countryCode = '+86') {
    if (countryCode === '+86') {
        // China mobile number: 11 digits starting with 1
        return /^1\\d{10}$/.test(phone);
    } else if (countryCode === '+1') {
        // US: 10 digits
        return /^\\d{10}$/.test(phone);
    }

    // Generic: 7-15 digits
    return /^\\d{7,15}$/.test(phone);
}

console.log('✅ Phone Auth UI functions loaded');
