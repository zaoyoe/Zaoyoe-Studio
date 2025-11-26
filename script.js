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
    modal.classList.add('active');
    switchAuthView(view);
}

function toggleLoginModal() {
    const modal = document.getElementById('loginModal');
    modal.classList.remove('active');
}

function handleLoginOverlayClick(event) {
    if (event.target.classList.contains('login-overlay')) {
        toggleLoginModal();
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
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function closeModal(event) {
    // Close if clicked on overlay or close button (support both old and new button classes)
    // Use closest to handle clicks on icons inside buttons
    if (event.target.classList.contains('modal-overlay') ||
        event.target.closest('.close-btn') ||
        event.target.closest('.close-pill-btn') ||
        event.target.closest('.mac-dot.red') ||
        event.target.closest('.modal-close-icon')) {

        const modals = document.querySelectorAll('.modal-overlay');
        modals.forEach(modal => modal.classList.remove('active'));
    }
}

/* =========================================
   Guestbook Logic with Image Upload
   ========================================= */
/* =========================================
   Guestbook Logic with Image Upload
   ========================================= */
// ❌ Firebase 版本的留言板代码 - 已废弃，使用 LeanCloud 版本（leancloud-guestbook-functions.js）
/*
document.addEventListener('DOMContentLoaded', () => {
    const guestbookForm = document.getElementById('guestbookForm');
    const imageUpload = document.getElementById('imageUpload');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');
    const removeImageBtn = document.getElementById('removeImageBtn');

    let currentImageData = null; // Store base64 image data

    // Image Upload Handler
    if (imageUpload) {
        imageUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Validate file type
            if (!file.type.startsWith('image/')) {
                alert('请选择有效的图片文件!');
                return;
            }

            // Validate file size (max 5MB before compression)
            if (file.size > 5 * 1024 * 1024) {
                alert('图片文件过大! 请选择小于5MB的图片。');
                return;
            }

            try {
                // Compress and convert to base64
                currentImageData = await compressImage(file);

                // Show preview
                if (previewImg && imagePreview) {
                    previewImg.src = currentImageData;
                    imagePreview.style.display = 'block';
                }
            } catch (error) {
                console.error('图片处理失败:', error);
                alert('图片处理失败,请重试!');
            }
        });
    }

    // Remove Image Handler
    if (removeImageBtn) {
        removeImageBtn.addEventListener('click', () => {
            clearImage();
        });
    }

    function clearImage() {
        if (imageUpload) imageUpload.value = '';
        if (imagePreview) imagePreview.style.display = 'none';
        if (previewImg) previewImg.src = '';
        currentImageData = null; // Clear the data!
    }

    // Form Submission
    if (guestbookForm) {
        guestbookForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Check if user is logged in
            const auth = window.firebaseAuth;
            if (!auth || !auth.currentUser) {
                alert("请先登录后再留言");
                if (window.openAuthModal) window.openAuthModal('login');
                return;
            }

            const user = auth.currentUser;
            const messageInput = document.getElementById('guestMessage');

            // Use logged in user's display name
            // Use logged in user's display name
            const name = user.displayName || user.email.split('@')[0];
            const message = messageInput.value.trim();

            console.log('🚀 Submitting message:', { name, messageLength: message.length, hasImage: !!currentImageData });

            // Allow submission if there is text OR an image
            // Explicitly check for non-null currentImageData
            if (message.length > 0 || (currentImageData && currentImageData.length > 0)) {
                console.log('✅ Submission criteria met');
                const success = await addMessage(name, message, currentImageData);

                if (success) {
                    // Clear inputs
                    messageInput.value = '';
                    clearImage();

                    // Close the modal with animation
                    const modal = document.getElementById('guestbookModal');
                    if (modal) {
                        modal.classList.add('closing'); // Trigger exit animation

                        // Wait for animation to finish BEFORE redirecting/closing
                        setTimeout(() => {
                            modal.classList.remove('active');
                            modal.classList.remove('closing');

                            // Optimize redirect: 
                            // If we are already on guestbook.html, just reload or let the listener handle it.
                            // If on index.html, redirect fast.
                            if (window.location.pathname.includes('guestbook.html')) {
                                // Already on guestbook, listener will update UI automatically via Firestore
                                console.log('Already on guestbook, UI will update automatically');
                            } else {
                                // Redirect immediately after animation
                                window.location.href = 'guestbook.html';
                            }
                        }, 300); // Wait for animation (300ms matches CSS)
                    } else {
                        // Fallback if modal not found
                        window.location.href = 'guestbook.html';
                    }
                }
            } else {
                alert("请输入留言内容或上传图片");
            }
        });
    }

    async function addMessage(name, content, image = null) {
        console.log('📝 Adding message, name:', name);

        let messages = [];
        try {
            const stored = localStorage.getItem('guestbook_messages');
            messages = stored ? JSON.parse(stored) : [];
            if (!Array.isArray(messages)) messages = [];
        } catch (e) {
            console.error('Error parsing messages:', e);
            messages = [];
        }

        // Get user avatar from LocalStorage (Primary - Cached Profile) or Auth
        const auth = window.firebaseAuth;
        let avatarUrl = null;

        // 1. Try Cached Profile (Best source for Firestore avatar)
        try {
            const cachedProfile = localStorage.getItem('cached_user_profile');
            if (cachedProfile) {
                const profile = JSON.parse(cachedProfile);
                if (profile.avatarUrl) {
                    avatarUrl = profile.avatarUrl;
                }
            }
        } catch (e) {
            console.error('Error reading cached profile:', e);
        }

        // 2. Fallback to Auth profile
        if (!avatarUrl && auth && auth.currentUser && auth.currentUser.photoURL) {
            avatarUrl = auth.currentUser.photoURL;
        }

        // 3. Fallback to Firestore (Direct Fetch) if critical
        if (!avatarUrl && auth && auth.currentUser) {
            // Try to get from Firestore directly if not in cache
            try {
                const db = window.firebaseDB;
                const getDoc = window.firestoreGetDoc;
                const doc = window.firestoreDoc;
                if (db && getDoc && doc) {
                    const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
                    if (userDoc.exists() && userDoc.data().avatarUrl) {
                        avatarUrl = userDoc.data().avatarUrl;
                    }
                }
            } catch (e) {
                console.error("Error fetching avatar for message:", e);
            }
        }

        // Fallback if no avatar found
        if (!avatarUrl) {
            avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
        }

        const newMessage = {
            name: name,
            avatarUrl: avatarUrl,
            content: content,
            image: image,
            timestamp: new Date().toISOString(), // Use ISO string for sorting
            displayTime: new Date().toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }),
            comments: []
        };

        try {
            const db = window.firebaseDB;
            const addDoc = window.firestoreAddDoc;
            const collection = window.firestoreCollection;

            if (db && addDoc && collection) {
                console.log('☁️ Uploading message to Firestore...');
                await addDoc(collection(db, "messages"), newMessage);
                console.log('✅ Message uploaded successfully');
                return true;
            } else {
                console.error("Firestore not initialized");
                alert("连接云端数据库失败，请刷新页面重试");
                return false;
            }
        } catch (e) {
            console.error("❌ Error uploading message:", e);
            alert("留言发布失败: " + e.message);
            return false;
        }
    }

    // Helper: Compress Image to Base64
    async function compressImage(file, maxWidth = 800, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // Create canvas for compression
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Resize if too large
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convert to base64 with compression
                    const compressedData = canvas.toDataURL('image/jpeg', quality);

                    // Check size (warn if > 500KB)
                    const sizeInKB = Math.round((compressedData.length * 3 / 4) / 1024);
                    console.log(`压缩后图片大小: ${sizeInKB}KB`);

                    if (sizeInKB > 500) {
                        console.warn('图片较大,可能影响性能');
                    }

                    resolve(compressedData);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };

            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Helper to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});
*/

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

// ❌ Firebase 版本 - 已废弃，使用 LeanCloud 版本（leancloud-auth-functions.js）
/*
async function handleRegister(event) {
    event.preventDefault();

    const inputCode = document.getElementById('reg-code').value;
    const password = document.getElementById('reg-password').value;
    const email = document.getElementById('reg-email').value;
    const username = document.getElementById('reg-username').value;

    // Verification code check
    if (inputCode !== generatedCode) {
        alert("验证码错误！请检查邮件重新输入。");
        return;
    }

    const auth = window.firebaseAuth;
    const db = window.firebaseDB;
    const createUser = window.createUserWithEmailAndPassword;
    const updateProfile = window.updateProfile; // New import
    const setDoc = window.firestoreSetDoc;
    const doc = window.firestoreDoc;

    if (!auth || !createUser || !db) {
        alert("Firebase 未初始化，请刷新页面重试。");
        return;
    }

    try {
        // A. Create user in Firebase Auth
        const userCredential = await createUser(auth, email, password);
        const user = userCredential.user;

        // B. Update Auth Profile immediately (Crucial for immediate display)
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;
        if (updateProfile) {
            await updateProfile(user, {
                displayName: username,
                photoURL: avatarUrl
            });
        }

        // C. Store user profile in Firestore
        await setDoc(doc(db, "users", user.uid), {
            nickname: username || "New User",
            email: email,
            avatarUrl: avatarUrl,
            createdAt: new Date().toISOString()
        });

        alert(`注册成功！\\n欢迎，${username}！`);

        // Close modal and reset form
        toggleLoginModal();
        document.getElementById('registerForm').reset();
        generatedCode = null;

        // Force UI update
        updateUserUI(user);

    } catch (error) {
        const errorCode = error.code;
        const errorMessage = error.message;

        if (errorCode === 'auth/email-already-in-use') {
            alert("该邮箱已被注册，请直接登录或使用其他邮箱。");
        } else if (errorCode === 'auth/weak-password') {
            alert("密码强度不足，请使用至少 6 位字符的密码。");
        } else {
            alert(`注册失败: ${errorMessage}`);
        }
    }
}
*/


// Function 3.5: Handle Google Login
// ❌ Firebase 版本 - 已废弃，使用 LeanCloud + OAuth 版本（google-oauth.js）
/*
function handleGoogleLogin() {
    const auth = window.firebaseAuth;
    const db = window.firebaseDB;
    const provider = new window.firebase.auth.GoogleAuthProvider();

    if (!auth) {
        alert("Firebase 未初始化，请刷新页面重试。");
        return;
    }

    // Use signInWithPopup from the modular SDK
    window.signInWithPopup(auth, provider)
        .then(async (result) => {
            console.log("Google Login successful", result.user);

            // Create/update user profile in Firestore with Google data
            const user = result.user;
            const userRef = window.doc(db, 'users', user.uid);

            try {
                await window.setDoc(userRef, {
                    email: user.email,
                    nickname: user.displayName || user.email.split('@')[0],
                    avatarUrl: user.photoURL || '',
                    createdAt: new Date().toISOString()
                }, { merge: true }); // merge to avoid overwriting existing data

                console.log("User profile created/updated in Firestore");
            } catch (error) {
                console.error("Error creating user profile:", error);
            }

            toggleLoginModal();
            // User UI will auto-update via onAuthStateChanged
        })
        .catch((error) => {
            console.error("Google Login Error:", error);
            if (error.code === 'auth/popup-closed-by-user') {
                // User closed popup, silent fail
                console.log("User closed the login popup");
            } else {
                alert(`Google 登录失败: ${error.message}`);
            }
        });
}
*/

// Function 3.6: Handle Password Reset (Using Resend via Cloud Function)
// ❌ Firebase 版本 - 已废弃，使用 LeanCloud 版本（leancloud-auth-functions.js）
/*
let resetCooldownTimer = null;
let resetCooldownSeconds = 0;

function handlePasswordReset(event) {
    if (event) event.preventDefault();

    console.log("=== Password Reset Started (Resend) ===");

    const emailInput = document.getElementById('reset-email');
    const submitBtn = document.querySelector('#resetForm button[type="submit"]');

    if (!emailInput || !submitBtn) {
        console.error("Form elements not found!");
        alert("❌ 系统错误：找不到表单元素，请刷新页面重试。");
        return;
    }

    const email = emailInput.value.trim();

    if (!email) {
        alert("❌ 请输入邮箱地址");
        return;
    }

    // Check if in cooldown
    if (resetCooldownSeconds > 0) {
        alert(`⏱️ 请等待 ${resetCooldownSeconds} 秒后再试`);
        return;
    }

    // Show loading state
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '发送中...';
    submitBtn.disabled = true;

    // Add timeout protection (15 seconds for Cloud Function)
    const timeoutId = setTimeout(() => {
        console.error("Cloud Function timeout!");
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
        alert("❌ 请求超时\n\n网络连接可能存在问题，请检查网络后重试。");
    }, 15000);

    // Call Cloud Function via Firebase
    const functions = window.firebaseFunctions;
    const sendReset = window.httpsCallable(functions, 'sendPasswordResetEmail');

    console.log("Calling Cloud Function with email:", email);

    sendReset({ email: email })
        .then((result) => {
            clearTimeout(timeoutId);
            console.log("✅ Cloud Function success:", result.data);
            alert(`✅ 重置密码邮件已发送到 ${email}\n\n请检查您的收件箱，点击邮件中的链接重置密码。`);
            emailInput.value = '';

            // Start 30-second countdown
            resetCooldownSeconds = 30;
            updateResetButtonCountdown(submitBtn, originalText);

            // Auto switch back to login after a delay
            setTimeout(() => {
                switchAuthView('login');
            }, 2000);
        })
        .catch((error) => {
            clearTimeout(timeoutId);
            console.error("❌ Cloud Function Error:", error);

            // Restore button state
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;

            // Handle different error codes
            if (error.code === 'not-found') {
                alert("❌ 该邮箱未注册\n\n请检查邮箱地址或点击下方\"立即注册\"创建新账号。");
            } else if (error.code === 'invalid-argument') {
                alert("❌ 邮箱格式不正确\n\n请检查后重试。");
            } else if (error.code === 'unauthenticated') {
                alert("❌ 未授权访问\n\n请刷新页面后重试。");
            } else {
                alert(`❌ 发送失败\n\n${error.message || '未知错误'}\n\n如果问题持续，请联系管理员。`);
            }
        });
}
*/ // End of commented out Firebase handlePasswordReset

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

// Function 4: Handle Login Submission
// ❌ Firebase 版本 - 已废弃，使用 LeanCloud 版本（leancloud-auth-functions.js）
/*
function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const auth = window.firebaseAuth;
    const signIn = window.signInWithEmailAndPassword;

    if (!auth || !signIn) {
        alert("Firebase 未初始化，请刷新页面重试。");
        return;
    }

    // Simplified login logic to ensure reliability
    signIn(auth, email, password)
        .then((userCredential) => {
            // Login successful - No Alert as requested
            console.log("Login successful");
            toggleLoginModal();
            document.getElementById('loginForm').reset();

            // Handle Remember Me manually
            const rememberMe = document.getElementById('rememberMe').checked;
            const persistenceType = rememberMe ? 'local' : 'session';

            // Use string constants directly to avoid "undefined" errors with enums
            auth.setPersistence(persistenceType).catch((err) => {
                console.warn("Persistence setting failed:", err);
            });
        })
        .catch((error) => {
            const errorCode = error.code;

            if (errorCode === 'auth/user-not-found') {
                alert("该邮箱未注册，请先注册账号。");
            } else if (errorCode === 'auth/wrong-password') {
                alert("密码错误，请重新输入。");
            } else if (errorCode === 'auth/invalid-credential') {
                alert("邮箱或密码错误，请检查后重试。");
            } else {
                alert(`登录失败: ${error.message}`);
            }
        });
}
*/


// Function 5: Handle Logout
// ❌ Firebase 版本 - 已废弃，使用 LeanCloud 版本（leancloud-auth-functions.js）
/*
async function handleLogout() {
    if (!confirm("确定要退出登录吗？")) return;

    const auth = window.firebaseAuth;
    const signOutFunc = window.signOut;

    if (!auth || !signOutFunc) {
        alert("Firebase 未初始化，请刷新页面重试。");
        return;
    }

    try {
        await signOutFunc(auth);
        // Close dropdown
        document.getElementById('userDropdown').classList.remove('active');
    } catch (error) {
        alert(`登出失败: ${error.message}`);
    }
}
*/


// Function 6: Handle Auth Button Click
function handleAuthClick(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    console.log('🔘 handleAuthClick triggered');

    // 检查 LeanCloud 登录状态
    const currentUser = AV.User.current();
    console.log('👤 Current User:', currentUser ? currentUser.id : 'null');

    if (currentUser) {
        // User is logged in - toggle dropdown
        const dropdown = document.getElementById('userDropdown');
        if (dropdown) {
            const isActive = dropdown.classList.contains('active');
            if (isActive) {
                dropdown.classList.remove('active');
                console.log('🔽 Dropdown closed');
            } else {
                dropdown.classList.add('active');
                console.log('🔽 Dropdown opened');
            }
        } else {
            console.error('❌ userDropdown element not found!');
        }
    } else {
        // User is not logged in - open login modal
        openAuthModal('login');
    }
}

// Function 7: Update UI based on auth state (with Firestore)
async function updateUserUI(user) {
    console.log('🎨 updateUserUI called, user:', user ? user.email : 'null');

    const authBtn = document.getElementById('authBtn');
    const btnSpan = document.getElementById('authBtnText');
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');

    const profileEmail = document.getElementById('profileEmail');
    const dropdownAvatar = document.getElementById('dropdownAvatar');

    if (user) {
        // Always fetch from Firestore to get latest data
        const db = window.firebaseDB;
        const getDoc = window.firestoreGetDoc;
        const doc = window.firestoreDoc;

        // Helper to safely get user properties (handles both AV.User and plain objects)
        const getProp = (obj, key) => {
            if (!obj) return null;
            return typeof obj.get === 'function' ? obj.get(key) : obj[key];
        };

        // ✅ 优先显示 nickname (昵称)，其次是 username (可能是邮箱)，最后是邮箱前缀
        // 注意：LeanCloud 中 username 默认为邮箱，所以我们应该优先用 nickname
        let displayName = getProp(user, 'nickname') || getProp(user, 'username');

        // 如果显示名包含 @ (说明是邮箱)，则尝试截取前缀
        if (displayName && displayName.includes('@')) {
            displayName = displayName.split('@')[0];
        }

        // 最后的兜底
        if (!displayName) {
            displayName = getProp(user, 'email').split('@')[0];
        }

        let avatarUrl = getProp(user, 'avatarUrl') || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random`;
        let email = getProp(user, 'email');

        console.log('👤 Updating UI for user:', { displayName, email, avatarUrl });

        // Cache profile for anti-flicker
        localStorage.setItem('cached_user_profile', JSON.stringify({
            displayName: displayName,
            avatarUrl: avatarUrl,
            email: email
        }));

        // Update UI
        if (btnSpan) btnSpan.textContent = displayName;
        if (defaultIcon) defaultIcon.style.display = 'none';

        // ✅ 确保主页导航栏头像同步更新并强制样式
        if (navAvatar) {
            navAvatar.src = avatarUrl;
            navAvatar.style.display = 'block'; // 必须是 block 或 inline-block
            navAvatar.style.width = '24px';
            navAvatar.style.height = '24px';
            navAvatar.style.borderRadius = '50%';
            navAvatar.style.objectFit = 'cover';
            console.log('🖼️ Nav avatar updated with styles');
        } else {
            console.warn('⚠️ Nav avatar element not found');
        }

        if (profileEmail) profileEmail.textContent = email; // 显示完整邮箱
        if (dropdownAvatar) dropdownAvatar.src = avatarUrl;

        // ✅ 确保事件处理器正确绑定（修复首次登录点击无反应）
        console.log('🔧 Re-binding event handlers...');

        // 1. Re-attach click handler to authBtn to ensure it works
        if (authBtn) {
            // 清除旧的 handler 防止重复
            authBtn.onclick = null;
            authBtn.onclick = (e) => {
                console.log('🖱️ authBtn clicked (inline handler)');
                handleAuthClick(e);
            };
            console.log('✅ Auth button click handler attached');
        }

        // 2. Bind logout button
        const logoutBtn = document.querySelector('.menu-item.logout');
        if (logoutBtn) {
            logoutBtn.onclick = handleLogout;
            console.log('✅ Logout button click handler attached');
        }

        // 3. Ensure global click listener is active (close dropdown when clicking outside)
        // This should only be set up once
        if (!window._dropdownClickListenerAttached) {
            document.addEventListener('click', (e) => {
                const dropdown = document.getElementById('userDropdown');
                const authButton = document.getElementById('authBtn');

                if (dropdown && dropdown.classList.contains('active')) {
                    // Close dropdown if click is outside both dropdown and auth button
                    if (!dropdown.contains(e.target) && !authButton.contains(e.target)) {
                        dropdown.classList.remove('active');
                        console.log('🔽 Dropdown closed (clicked outside)');
                    }
                }
            });
            window._dropdownClickListenerAttached = true;
            console.log('✅ Global dropdown click listener attached');
        }

    } else {
        // Clear cache on logout
        localStorage.removeItem('cached_user_profile');

        console.log('👤 User logged out');
        if (btnSpan) btnSpan.textContent = "Sign In";
        if (defaultIcon) defaultIcon.style.display = 'block';
        if (navAvatar) navAvatar.style.display = 'none';

        // Re-attach click handler even when logged out
        if (authBtn) {
            authBtn.onclick = handleAuthClick;
            console.log('✅ Auth button click handler attached (logged out state)');
        }
    }
}

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

// ✅ 全局事件委托：确保 Auth Button 永远可点击
document.addEventListener('click', (e) => {
    // 检查点击的是否是 authBtn 或其子元素
    const authBtn = e.target.closest('#authBtn');
    if (authBtn) {
        console.log('🔘 Global delegated click handler for authBtn');
        handleAuthClick(e);
    }
});

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

// Monitor Authentication State
// ❌ Firebase 版本 - 已废弃，使用 LeanCloud 版本（leancloud-auth-functions.js）
/*
window.addEventListener('DOMContentLoaded', () => {
    // Define initialize function that reads GLOBAL window variables dynamically
    const initializeAuth = () => {
        const auth = window.firebaseAuth;
        const authStateChanged = window.onAuthStateChanged;

        if (auth && authStateChanged) {
            console.log('✅ Firebase Auth initialized in script.js');
            authStateChanged(auth, async (user) => {
                await updateUserUI(user);
            });
        } else {
            console.log('⏳ Waiting for Firebase Auth...');
            // Retry if not ready yet
            setTimeout(initializeAuth, 500);
        }
    };

    // Start initialization check
    initializeAuth();
});
*/


// Close dropdown when clicking outside
document.addEventListener('click', (event) => {
    const topNav = document.querySelector('.top-right-nav');
    const dropdown = document.getElementById('userDropdown');

    if (topNav && dropdown && !topNav.contains(event.target)) {
        dropdown.classList.remove('active');
    }
});
