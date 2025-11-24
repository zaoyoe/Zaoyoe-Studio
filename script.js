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

// Modal Logic
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
document.addEventListener('DOMContentLoaded', () => {
    const guestbookForm = document.getElementById('guestbookForm');
    const imageUpload = document.getElementById('imageUpload');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');

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
                previewImg.src = currentImageData;
                imagePreview.style.display = 'block';
            } catch (error) {
                console.error('图片处理失败:', error);
                alert('图片处理失败,请重试!');
            }
        });
    }

    // Form Submission
    if (guestbookForm) {
        guestbookForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const nameInput = document.getElementById('guestName');
            const messageInput = document.getElementById('guestMessage');

            const name = nameInput.value.trim();
            const message = messageInput.value.trim();

            if (name && message) {
                addMessage(name, message, currentImageData);

                // Clear inputs
                nameInput.value = '';
                messageInput.value = '';
                removeImage();

                // Show success feedback
                alert('留言发布成功!');

                // Redirect to guestbook page to see the message
                window.location.href = 'guestbook.html';
            }
        });
    }

    function addMessage(name, content, image = null) {
        const messages = JSON.parse(localStorage.getItem('guestbook_messages') || '[]');

        const newMessage = {
            id: Date.now(),
            name: name,
            content: content,
            image: image, // Base64 encoded image or null
            timestamp: new Date().toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }),
            comments: [] // Array for nested comments
        };

        // Add to beginning of array
        messages.unshift(newMessage);

        // Save to LocalStorage
        try {
            localStorage.setItem('guestbook_messages', JSON.stringify(messages));
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                alert('存储空间已满! 请清理旧留言或减小图片大小。');
            } else {
                console.error('保存失败:', error);
            }
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

// Remove Image Function (global scope for onclick)
function removeImage() {
    const imageUpload = document.getElementById('imageUpload');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');

    if (imageUpload) imageUpload.value = '';
    if (imagePreview) imagePreview.style.display = 'none';
    if (previewImg) previewImg.src = '';

    // Reset in module scope would require event system
    // For now, image will be cleared on next upload
}

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
