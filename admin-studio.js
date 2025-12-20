/* ========================================
   ADMIN STUDIO - JavaScript
   AI-Powered Prompt Upload System
   ======================================== */

// ========================================
// CONFIGURATION
// ========================================
const GEMINI_API_KEY = ''; // Will be set from environment or user input
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// State
let uploadedFiles = [];
let analysisResult = null;

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    initUploadZone();
    initForm();
    initCustomDropdown();
    checkApiKey();
    // Load manage view if switching to it
    const manageTab = document.querySelector('[data-view="manage"]');
    if (manageTab) {
        manageTab.addEventListener('click', () => loadAdminPrompts());
    }
});

// ========================================
// ADMIN STATE
// ========================================
let currentMode = 'create'; // 'create' or 'edit'
let editingId = null;

// ========================================
// VIEW SWITCHING
// ========================================
function switchView(viewName) {
    // Update tabs
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === viewName);
    });

    // Update views
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(`view-${viewName}`).classList.add('active');

    // Load data if switching to manage
    if (viewName === 'manage') {
        loadAdminPrompts();
    }
}

// ========================================
// LOAD ADMIN PROMPTS
// ========================================
let allPrompts = []; // Cache all prompts for local search

async function loadAdminPrompts() {
    const grid = document.getElementById('adminGrid');
    const countEl = document.getElementById('promptCount');

    try {
        const { data, error } = await supabaseClient
            .from('prompts')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Cache prompts for local search
        allPrompts = data || [];

        if (data && data.length > 0) {
            countEl.textContent = data.length;
            grid.innerHTML = data.map(prompt => renderAdminCard(prompt)).join('');
        } else {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-dim);">No prompts yet. Create your first one!</p>';
            countEl.textContent = '0';
        }

        // Setup search after data is loaded
        setupAdminSearch();
    } catch (err) {
        console.error('Error loading prompts:', err);
        showToast('Failed to load prompts', 'error');
    }
}

// ========================================
// RENDER ADMIN CARD
// ========================================
function renderAdminCard(prompt) {
    const imageUrl = prompt.images && prompt.images.length > 0 ? prompt.images[0] : '';
    const tags = Array.isArray(prompt.tags) ? prompt.tags.join(', ') : 'No tags';

    return `
        <div class="admin-card" data-id="${prompt.id}">
            <img src="${imageUrl}" class="admin-card-image" alt="${prompt.title}">
            <div class="admin-card-content">
                <div class="admin-card-title">${prompt.title}</div>
                <div class="admin-card-meta">${tags}</div>
            </div>
            <div class="admin-card-actions">
                <button class="admin-action-btn" onclick="editPrompt(${prompt.id})">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="admin-action-btn delete" onclick="deletePrompt(${prompt.id})">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        </div>
    `;
}

// ========================================
// EDIT PROMPT
// ========================================
async function editPrompt(id) {
    try {
        const { data, error } = await supabaseClient
            .from('prompts')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        // Switch to create view
        switchView('create');

        // Set mode to edit
        currentMode = 'edit';
        editingId = id;

        // Show the form (it's hidden by default)
        const promptForm = document.getElementById('promptForm');
        promptForm.style.display = 'flex';

        // Populate form fields
        document.getElementById('promptTitle').value = data.title || '';
        setCustomDropdownValue('categoryDropdown', data.tags?.[0] || '');
        document.getElementById('promptText').value = data.prompt_text || '';

        // Show last edited time (compact version)
        const lastEditedInfo = document.getElementById('lastEditedInfo');
        const lastEditedTime = document.getElementById('lastEditedTime');
        if (data.updated_at) {
            const date = new Date(data.updated_at);
            const formatted = date.toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            lastEditedTime.textContent = formatted;
            lastEditedInfo.style.display = 'inline-flex';
        } else if (data.created_at) {
            // Fallback to created_at if no updated_at
            const date = new Date(data.created_at);
            const formatted = date.toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            lastEditedTime.textContent = formatted + ' (创建)';
            lastEditedInfo.style.display = 'inline-flex';
        } else {
            lastEditedInfo.style.display = 'none';
        }

        // Update button
        const saveBtn = document.getElementById('saveBtn');
        const btnText = saveBtn.querySelector('.btn-text');
        btnText.innerHTML = '<i class="fas fa-save"></i> Update Prompt';

        // Show cancel button if not exists
        let cancelBtn = document.getElementById('cancelEditBtn');
        if (!cancelBtn) {
            cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancelEditBtn';
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn-secondary';
            cancelBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
            cancelBtn.onclick = cancelEdit;
            saveBtn.parentElement.insertBefore(cancelBtn, saveBtn);
        }

        // Load images into preview AND into uploadedFiles for analysis
        if (data.images && data.images.length > 0) {
            const previewGrid = document.getElementById('previewGrid');
            previewGrid.innerHTML = data.images.map((url, idx) => `
                <div class="preview-item">
                    <img src="${url}" alt="Preview ${idx + 1}">
                </div>
            `).join('');
            previewGrid.style.display = 'grid';

            // Clear and load images into uploadedFiles for analysis capability
            uploadedFiles = [];

            // Fetch and convert images to base64 for AI analysis
            for (const imageUrl of data.images) {
                try {
                    const response = await fetch(imageUrl);
                    const blob = await response.blob();
                    const reader = new FileReader();

                    await new Promise((resolve, reject) => {
                        reader.onload = () => {
                            uploadedFiles.push({
                                file: null,
                                dataUrl: reader.result,
                                base64: reader.result.split(',')[1]
                            });
                            resolve();
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                } catch (err) {
                    console.warn('Failed to load image for analysis:', imageUrl, err);
                }
            }

            // Enable analyze button since we have images
            const analyzeBtn = document.getElementById('analyzeBtn');
            if (analyzeBtn) {
                analyzeBtn.disabled = uploadedFiles.length === 0 || !window.GEMINI_API_KEY;
            }
        }

        // Scroll to form
        setTimeout(() => {
            promptForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

    } catch (err) {
        console.error('Error loading prompt for edit:', err);
        showToast('Failed to load prompt', 'error');
    }
}

// ========================================
// CANCEL EDIT
// ========================================
function cancelEdit() {
    currentMode = 'create';
    editingId = null;

    // Reset form
    resetForm();

    // Update button
    const saveBtn = document.getElementById('saveBtn');
    const btnText = saveBtn.querySelector('.btn-text');
    btnText.innerHTML = '<i class="fas fa-save"></i> Save to Gallery';

    // Remove cancel button
    const cancelBtn = document.getElementById('cancelEditBtn');
    if (cancelBtn) cancelBtn.remove();
}

// ========================================
// DELETE PROMPT
// ========================================
async function deletePrompt(id) {
    if (!confirm('Delete this prompt? This action cannot be undone.')) {
        return;
    }

    console.log('Attempting to delete prompt with ID:', id);

    try {
        const { error } = await supabaseClient
            .from('prompts')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Supabase delete error:', error);
            throw error;
        }

        console.log('Successfully deleted from database');

        // Remove from UI with animation
        const card = document.querySelector(`[data-id="${id}"]`);
        if (card) {
            card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            setTimeout(() => {
                card.remove();
                // Update count after removal
                const countEl = document.getElementById('promptCount');
                const currentCount = parseInt(countEl.textContent);
                const newCount = Math.max(0, currentCount - 1);
                countEl.textContent = newCount;

                // If no prompts left, show empty message
                if (newCount === 0) {
                    const grid = document.getElementById('adminGrid');
                    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-dim);">No prompts yet. Create your first one!</p>';
                }
            }, 300);
        }

        showToast('Prompt deleted successfully!', 'success');
    } catch (err) {
        console.error('Delete operation failed:', err);
        showToast(`Delete failed: ${err.message || 'Unknown error'}`, 'error');
    }
}

// ========================================

function checkApiKey() {
    // Load API keys from localStorage
    const storedKeys = JSON.parse(localStorage.getItem('gemini_api_keys') || '[]');
    const activeIndex = parseInt(localStorage.getItem('gemini_active_key_index') || '0');

    if (storedKeys.length > 0 && storedKeys[activeIndex]) {
        window.GEMINI_API_KEY = storedKeys[activeIndex].key;
        updateStatus('Ready', 'ready');
        renderApiKeySelector();
    } else {
        promptForApiKey();
    }
}

function getApiKeys() {
    return JSON.parse(localStorage.getItem('gemini_api_keys') || '[]');
}

function getActiveKeyIndex() {
    return parseInt(localStorage.getItem('gemini_active_key_index') || '0');
}

function saveApiKeys(keys, activeIndex = 0) {
    localStorage.setItem('gemini_api_keys', JSON.stringify(keys));
    localStorage.setItem('gemini_active_key_index', activeIndex.toString());
    if (keys[activeIndex]) {
        window.GEMINI_API_KEY = keys[activeIndex].key;
    }
}

function promptForApiKey() {
    const key = prompt('请输入您的 Gemini API Key:\n(可从 https://aistudio.google.com 获取)');
    if (key && key.trim()) {
        const keys = getApiKeys();
        const name = `Key ${keys.length + 1}`;
        keys.push({ name, key: key.trim() });
        saveApiKeys(keys, keys.length - 1);
        updateStatus('Ready', 'ready');
        showToast('API Key 已保存', 'success');
        renderApiKeySelector();
    } else if (getApiKeys().length === 0) {
        updateStatus('No API Key', 'error');
        showToast('需要 API Key 才能使用 AI 分析功能', 'error');
    }
}

function switchApiKey(index) {
    const keys = getApiKeys();
    if (keys[index]) {
        saveApiKeys(keys, index);
        updateStatus('Ready', 'ready');
        showToast(`已切换到 ${keys[index].name}`, 'success');
        renderApiKeySelector();
    }
}

function addNewApiKey() {
    const key = prompt('请输入新的 Gemini API Key:');
    if (key && key.trim()) {
        const keys = getApiKeys();
        const name = prompt('为这个 Key 起个名字:', `Key ${keys.length + 1}`) || `Key ${keys.length + 1}`;
        keys.push({ name, key: key.trim() });
        saveApiKeys(keys, keys.length - 1);
        showToast(`已添加 ${name}`, 'success');
        renderApiKeySelector();
    }
}

function deleteApiKey(index) {
    const keys = getApiKeys();
    if (keys.length <= 1) {
        showToast('至少需要保留一个 API Key', 'error');
        return;
    }
    if (confirm(`确定删除 ${keys[index].name}?`)) {
        keys.splice(index, 1);
        const activeIndex = Math.min(getActiveKeyIndex(), keys.length - 1);
        saveApiKeys(keys, activeIndex);
        showToast('已删除', 'success');
        renderApiKeySelector();
    }
}

function renderApiKeySelector() {
    const container = document.getElementById('apiKeySelector');
    if (!container) return;

    const keys = getApiKeys();
    const activeIndex = getActiveKeyIndex();

    if (keys.length === 0) {
        container.innerHTML = `
            <button class="api-key-btn add" onclick="promptForApiKey()">
                <i class="fas fa-plus"></i> 添加 API Key
            </button>
        `;
        return;
    }

    container.innerHTML = `
        <div class="api-key-dropdown">
            <button class="api-key-current" onclick="toggleApiKeyDropdown()">
                <i class="fas fa-key"></i>
                <span>${keys[activeIndex]?.name || 'Select Key'}</span>
                <i class="fas fa-chevron-down"></i>
            </button>
            <div class="api-key-menu" id="apiKeyMenu">
                ${keys.map((k, i) => `
                    <div class="api-key-item ${i === activeIndex ? 'active' : ''}" onclick="switchApiKey(${i})">
                        <span class="key-name">${k.name}</span>
                        <span class="key-preview">...${k.key.slice(-6)}</span>
                        ${keys.length > 1 ? `<button class="key-delete" onclick="event.stopPropagation(); deleteApiKey(${i})"><i class="fas fa-times"></i></button>` : ''}
                    </div>
                `).join('')}
                <div class="api-key-item add" onclick="addNewApiKey()">
                    <i class="fas fa-plus"></i> 添加新 Key
                </div>
            </div>
        </div>
    `;
}

function toggleApiKeyDropdown() {
    const menu = document.getElementById('apiKeyMenu');
    if (menu) {
        menu.classList.toggle('show');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.api-key-dropdown')) {
        const menu = document.getElementById('apiKeyMenu');
        if (menu) menu.classList.remove('show');
    }
    // Also close custom dropdowns
    if (!e.target.closest('.custom-select')) {
        document.querySelectorAll('.custom-select.open').forEach(d => d.classList.remove('open'));
    }
});

// ========================================
// CUSTOM DROPDOWN
// ========================================
function initCustomDropdown() {
    // Initialize all custom dropdowns on the page
    document.querySelectorAll('.custom-select').forEach(dropdown => {
        setupCustomDropdown(dropdown);
    });
}

function setupCustomDropdown(dropdown, onChange) {
    const display = dropdown.querySelector('.select-display');
    const options = dropdown.querySelectorAll('.select-option');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    const displayText = dropdown.querySelector('.select-text');

    if (!display || !hiddenInput) return;

    // Toggle dropdown
    display.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other dropdowns
        document.querySelectorAll('.custom-select.open').forEach(d => {
            if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
    });

    // Handle option selection
    options.forEach(option => {
        option.addEventListener('click', () => {
            const value = option.dataset.value;
            const text = option.textContent;
            const oldValue = hiddenInput.value;

            // Update hidden input
            hiddenInput.value = value;

            // Update display text
            displayText.textContent = text;

            // Update selected state
            options.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');

            // Close dropdown
            dropdown.classList.remove('open');

            // Trigger change event for filters
            if (oldValue !== value) {
                hiddenInput.dispatchEvent(new Event('change'));
            }
        });
    });

    // Keyboard navigation
    display.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            dropdown.classList.toggle('open');
        } else if (e.key === 'Escape') {
            dropdown.classList.remove('open');
        }
    });

    display.setAttribute('tabindex', '0');
}

// Set custom dropdown value programmatically
function setCustomDropdownValue(dropdownId, value) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    const displayText = dropdown.querySelector('.select-text');
    const options = dropdown.querySelectorAll('.select-option');

    hiddenInput.value = value;

    options.forEach(option => {
        option.classList.remove('selected');
        if (option.dataset.value === value) {
            displayText.textContent = option.textContent;
            if (value) {
                option.classList.add('selected');
            }
        }
    });
}

// ========================================
// WEBP CONVERSION
// ========================================

// Convert image to WebP format for smaller file sizes
async function convertToWebP(dataUrl, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            // Convert to WebP
            const webpDataUrl = canvas.toDataURL('image/webp', quality);
            resolve({
                dataUrl: webpDataUrl,
                base64: webpDataUrl.split(',')[1]
            });
        };
        img.onerror = () => reject(new Error('Failed to load image for WebP conversion'));
        img.src = dataUrl;
    });
}

// ========================================
// IMAGE GRID COMPOSITION (for multi-image analysis)
// ========================================

/**
 * Creates a grid image from multiple images for unified AI analysis.
 * Supports up to 6 images with adaptive layouts.
 * @param {Array} images - Array of image objects with dataUrl property
 * @returns {Promise<{dataUrl: string, base64: string}>} - Grid image as WebP
 */
async function createImageGrid(images) {
    if (images.length === 0) return null;
    if (images.length === 1) {
        // Single image - return as-is
        return { dataUrl: images[0].dataUrl, base64: images[0].base64 };
    }

    return new Promise((resolve, reject) => {
        // Max 6 images for 2x3 grid
        const gridImages = images.slice(0, 6);

        // Determine grid layout based on image count
        // 2 images: 1x2, 3-4 images: 2x2, 5-6 images: 2x3
        let cols, rows;
        if (gridImages.length <= 2) {
            cols = gridImages.length;
            rows = 1;
        } else if (gridImages.length <= 4) {
            cols = 2;
            rows = 2;
        } else {
            cols = 2;
            rows = 3;
        }

        // Target size for each cell (maintaining reasonable resolution)
        const cellSize = 512;
        const canvasWidth = cellSize * cols;
        const canvasHeight = cellSize * rows;

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');

        // Fill with neutral gray background
        ctx.fillStyle = '#404040';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        let loadedCount = 0;
        const imageElements = [];

        gridImages.forEach((imgData, index) => {
            const img = new Image();
            img.onload = () => {
                imageElements[index] = img;
                loadedCount++;

                if (loadedCount === gridImages.length) {
                    // All images loaded, draw grid
                    imageElements.forEach((imgEl, i) => {
                        // Calculate position based on cols
                        const x = (i % cols) * cellSize;
                        const y = Math.floor(i / cols) * cellSize;

                        // Draw image centered in cell with cover behavior
                        const scale = Math.max(cellSize / imgEl.width, cellSize / imgEl.height);
                        const scaledWidth = imgEl.width * scale;
                        const scaledHeight = imgEl.height * scale;
                        const offsetX = (cellSize - scaledWidth) / 2;
                        const offsetY = (cellSize - scaledHeight) / 2;

                        ctx.drawImage(imgEl, x + offsetX, y + offsetY, scaledWidth, scaledHeight);
                    });

                    // Convert to WebP
                    const webpDataUrl = canvas.toDataURL('image/webp', 0.85);
                    resolve({
                        dataUrl: webpDataUrl,
                        base64: webpDataUrl.split(',')[1]
                    });
                }
            };
            img.onerror = () => reject(new Error('Failed to load image for grid'));
            img.src = imgData.dataUrl;
        });
    });
}

// ========================================
// UPLOAD ZONE
// ========================================
function initUploadZone() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');

    // Click to upload
    uploadZone.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    // Drag and drop
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

async function handleFiles(files) {
    const validFiles = Array.from(files).filter(file =>
        file.type.startsWith('image/')
    );

    if (validFiles.length === 0) {
        showToast('请上传图片文件', 'error');
        return;
    }

    for (const file of validFiles) {
        const reader = new FileReader();

        await new Promise((resolve) => {
            reader.onload = async (e) => {
                try {
                    // Convert to WebP automatically
                    const webp = await convertToWebP(e.target.result);

                    uploadedFiles.push({
                        file: file,               // Keep original file reference
                        dataUrl: webp.dataUrl,    // Use WebP for display
                        base64: webp.base64,      // Use WebP for upload
                        originalDataUrl: e.target.result  // Preserve original
                    });

                    console.log(`✅ Converted ${file.name} to WebP`);
                } catch (err) {
                    console.warn('WebP conversion failed, using original:', err);
                    // Fallback to original if WebP conversion fails
                    uploadedFiles.push({
                        file: file,
                        dataUrl: e.target.result,
                        base64: e.target.result.split(',')[1]
                    });
                }

                renderPreviews();
                updateAnalyzeButton();
                resolve();
            };
            reader.readAsDataURL(file);
        });
    }
}

function renderPreviews() {
    const grid = document.getElementById('previewGrid');
    grid.innerHTML = uploadedFiles.map((item, index) => `
        <div class="preview-item" data-index="${index}">
            <img src="${item.dataUrl}" alt="Preview ${index + 1}">
            <button class="remove-btn" onclick="removeFile(${index})">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    renderPreviews();
    updateAnalyzeButton();
}

function updateAnalyzeButton() {
    const btn = document.getElementById('analyzeBtn');
    btn.disabled = uploadedFiles.length === 0 || !window.GEMINI_API_KEY;
}

// ========================================
// GEMINI AI ANALYSIS
// ========================================
document.getElementById('analyzeBtn').addEventListener('click', analyzeImages);

async function analyzeImages() {
    if (uploadedFiles.length === 0) return;

    const loadingEl = document.getElementById('analysisLoading');
    const formEl = document.getElementById('promptForm');
    const btn = document.getElementById('analyzeBtn');

    // Show loading
    loadingEl.style.display = 'flex';
    formEl.style.display = 'none';
    btn.disabled = true;
    updateStatus('Analyzing...', 'processing');

    try {
        // Create grid image from all uploaded images (max 6)
        const gridImage = await createImageGrid(uploadedFiles);

        if (!gridImage) {
            throw new Error('无法处理图片');
        }

        // Log grid info
        const imageCount = Math.min(uploadedFiles.length, 6);
        console.log(`🖼️ Analyzing ${imageCount} image(s) as ${imageCount > 1 ? 'grid' : 'single'}`);

        const result = await callGeminiVision(gridImage.base64);

        analysisResult = result;
        populateForm(result);

        loadingEl.style.display = 'none';
        formEl.style.display = 'flex';
        updateStatus('Analysis Complete', 'ready');
        showToast(`AI 分析完成！(${imageCount} 张图片)`, 'success');

    } catch (error) {
        console.error('Analysis error:', error);
        loadingEl.style.display = 'none';
        updateStatus('Error', 'error');
        showToast(`分析失败: ${error.message}`, 'error');
    }

    btn.disabled = false;
}

async function callGeminiVision(imageBase64) {
    const analysisPrompt = `Analyze this AI-generated art image and return a JSON object with the following structure. Be creative and descriptive.

{
    "title": "A creative, descriptive title in English (2-5 words)",
    "title_zh": "创意标题的中文版本",
    "category": "One of: Photography, Illustration, 3D Art, Miniature, Creative, Animation",
    "description": "A brief 1-2 sentence description of the image",
    "description_zh": "描述的中文版本",
    "objects": {
        "en": ["5-8 objects or subjects visible in the image"],
        "zh": ["对应的中文翻译"]
    },
    "scenes": {
        "en": ["3-5 scene or environment descriptors"],
        "zh": ["对应的中文翻译"]
    },
    "styles": {
        "en": ["5-7 art style descriptors"],
        "zh": ["对应的中文翻译"]
    },
    "mood": {
        "en": ["5-7 mood or atmosphere words"],
        "zh": ["对应的中文翻译"]
    },
    "dominantColors": ["3-5 color names in English, e.g., 'blue', 'golden', 'dark gray'"],
    "useCase": {
        "platform": ["Best 2-3 platforms: 小红书封面, 抖音头图, 公众号配图, Instagram帖子, 淘宝主图, 手机壁纸, 头像, 海报"],
        "purpose": ["Best 1-2 purposes: 电商卖货, 品牌营销, 个人IP, 知识付费, 虚拟产品, 自媒体配图, 表情包"],
        "format": ["Recommended 1-2 formats: 9:16竖版, 1:1方图, 16:9横版, 3:4小红书, 手机壁纸尺寸"]
    },
    "commercial": {
        "niche": ["Best 1-3 niches: 母婴, 美妆, 健身, 美食, 旅游, 教育, 宠物, 家居, 时尚, 科技, 游戏, 情感"],
        "targetAudience": ["Target 1-2 audiences: Z世代, 职场女性, 新手妈妈, 中产家庭, 学生党, 二次元, 文艺青年"]
    },
    "difficulty": "One of: 新手友好, 进阶, 专业级"
}

IMPORTANT: Return ONLY valid JSON, no markdown formatting, no code blocks, no explanation.`;

    const response = await fetch(`${GEMINI_API_URL}?key=${window.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: analysisPrompt },
                    {
                        inline_data: {
                            mime_type: 'image/jpeg',
                            data: imageBase64
                        }
                    }
                ]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048
            }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'API request failed');
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        throw new Error('No response from Gemini');
    }

    // Parse JSON from response (handle potential markdown wrapping)
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('JSON parse error:', jsonStr);
        throw new Error('Failed to parse AI response');
    }
}

// ========================================
// FORM HANDLING
// ========================================
function initForm() {
    document.getElementById('promptForm').addEventListener('submit', savePrompt);
}

function populateForm(data) {
    // Title
    document.getElementById('promptTitle').value = data.title || '';

    // Category
    if (data.category) {
        setCustomDropdownValue('categoryDropdown', data.category);
    }

    // Description
    document.getElementById('promptDescription').value = data.description || '';

    // Tags
    renderTags('tagObjects', data.objects);
    renderTags('tagScenes', data.scenes);
    renderTags('tagStyles', data.styles);
    renderTags('tagMood', data.mood);

    // Colors
    renderColors(data.dominantColors || []);
}

function renderTags(containerId, tagData) {
    const container = document.getElementById(containerId);
    if (!tagData || !tagData.en) {
        container.innerHTML = '<span style="color: var(--text-dim)">No tags</span>';
        return;
    }

    container.innerHTML = tagData.en.map((tag, i) => {
        const zhTag = tagData.zh?.[i] || '';
        return `
            <span class="tag-item">
                ${tag}
                ${zhTag ? `<span class="tag-zh">(${zhTag})</span>` : ''}
            </span>
        `;
    }).join('');
}

function renderColors(colors) {
    const container = document.getElementById('colorSwatches');

    // Color name to hex mapping
    const colorMap = {
        'white': '#ffffff', 'black': '#000000', 'gray': '#808080', 'grey': '#808080',
        'red': '#e74c3c', 'blue': '#3498db', 'green': '#2ecc71', 'yellow': '#f1c40f',
        'orange': '#e67e22', 'purple': '#9b59b6', 'pink': '#e91e63', 'brown': '#8b4513',
        'gold': '#ffd700', 'golden': '#ffd700', 'silver': '#c0c0c0', 'bronze': '#cd7f32',
        'cyan': '#00bcd4', 'teal': '#008080', 'navy': '#001f3f', 'maroon': '#800000',
        'beige': '#f5f5dc', 'cream': '#fffdd0', 'ivory': '#fffff0', 'tan': '#d2b48c',
        'coral': '#ff7f50', 'salmon': '#fa8072', 'turquoise': '#40e0d0', 'lavender': '#e6e6fa',
        'dark blue': '#00008b', 'dark green': '#006400', 'dark gray': '#404040', 'dark grey': '#404040',
        'light blue': '#add8e6', 'light green': '#90ee90', 'light gray': '#d3d3d3', 'light grey': '#d3d3d3'
    };

    container.innerHTML = colors.map(color => {
        const hex = colorMap[color.toLowerCase()] || '#888888';
        return `<div class="color-swatch" style="background: ${hex}" data-color="${color}"></div>`;
    }).join('');
}

async function savePrompt(e) {
    e.preventDefault();

    // For new prompts, require AI analysis. For editing, just need images.
    if (currentMode === 'create') {
        if (!analysisResult || uploadedFiles.length === 0) {
            showToast('请先上传图片并进行 AI 分析', 'error');
            return;
        }
    } else if (currentMode === 'edit') {
        // When editing, we don't need new analysis - just images
        if (uploadedFiles.length === 0) {
            showToast('请确保有图片', 'error');
            return;
        }
    }

    const saveBtn = document.getElementById('saveBtn');
    const dotMatrix = document.getElementById('dotMatrix');

    // Initialize dot matrix
    initDotMatrix();

    // Start saving animation
    saveBtn.classList.add('saving');
    saveBtn.disabled = true;
    updateStatus('Saving...', 'processing');

    // Start progress animation
    let progress = 0;
    const progressInterval = setInterval(() => {
        if (progress < 24) { // Leave last 6 dots for completion
            progress++;
            updateDotProgress(progress);
        }
    }, 80);

    try {
        // Get form values
        const title = document.getElementById('promptTitle').value.trim();
        const category = document.getElementById('promptCategory').value;
        const promptText = document.getElementById('promptText').value.trim();
        const description = document.getElementById('promptDescription').value.trim();

        if (!title || !category) {
            throw new Error('请填写标题和分类');
        }

        // Try to upload images to Supabase Storage
        let imageUrls = [];
        let storageAvailable = true;

        try {
            imageUrls = await uploadImages();
            progress = Math.min(progress + 3, 27);
            updateDotProgress(progress);
        } catch (storageError) {
            console.warn('Storage upload failed:', storageError);
            storageAvailable = false;
            // Keep existing images when storage fails in edit mode
            imageUrls = [];
        }

        // Create prompt object
        // In edit mode without new analysis, preserve existing values by not including them
        const promptData = {
            title: title,
            tags: [category],
            description: description,
            prompt: promptText,
            images: imageUrls,
        };

        // Only include AI analysis data if we have it (new analysis was run)
        if (analysisResult) {
            promptData.dominantColors = analysisResult.dominantColors || [];
            promptData.aiTags = {
                objects: analysisResult.objects,
                scenes: analysisResult.scenes,
                styles: analysisResult.styles,
                mood: analysisResult.mood
            };
        }

        // Always save to Supabase database (storage availability doesn't matter for DB save)
        try {
            let data, error;

            if (currentMode === 'edit' && editingId) {
                // UPDATE existing prompt - build update object
                const updateData = {
                    title: promptData.title,
                    tags: promptData.tags,
                    description: promptData.description,
                    prompt_text: promptData.prompt,
                };
                // Only update images if storage upload was successful
                if (storageAvailable) {
                    updateData.images = promptData.images;
                }
                // Only update AI-related fields if new analysis was done
                if (promptData.dominantColors) {
                    updateData.dominant_colors = promptData.dominantColors;
                }
                if (promptData.aiTags) {
                    updateData.ai_tags = promptData.aiTags;
                }

                ({ data, error } = await supabaseClient
                    .from('prompts')
                    .update(updateData)
                    .eq('id', editingId)
                    .select());
            } else {
                // INSERT new prompt
                ({ data, error } = await supabaseClient
                    .from('prompts')
                    .insert([{
                        title: promptData.title,
                        tags: promptData.tags,
                        description: promptData.description,
                        prompt_text: promptData.prompt,
                        images: promptData.images,
                        dominant_colors: promptData.dominantColors,
                        ai_tags: promptData.aiTags
                    }])
                    .select());
            }

            if (error) throw error;

            const successMsg = currentMode === 'edit' ? 'Prompt updated!' : 'Prompt saved!';
            showToast(successMsg, 'success');

            // Reset edit mode
            if (currentMode === 'edit') {
                cancelEdit();
            }
        } catch (dbError) {
            console.warn('Database save failed:', dbError);
            showToast('数据库保存失败，已生成代码片段', 'info');
        }

        // Complete the progress
        clearInterval(progressInterval);
        completeDotProgress();

        // Success state
        setTimeout(() => {
            saveBtn.classList.remove('saving');
            saveBtn.classList.add('saved');
            saveBtn.querySelector('.btn-text').innerHTML = '<i class="fas fa-check"></i> Saved!';
            updateStatus('Saved', 'ready');
            showToast('Prompt 已保存到数据库！', 'success');

            // Reset button after delay
            setTimeout(() => {
                saveBtn.classList.remove('saved');
                saveBtn.querySelector('.btn-text').innerHTML = '<i class="fas fa-save"></i> Save to Gallery';
                saveBtn.disabled = false;
            }, 2000);
        }, 400);

        // Always generate code for prompts-data.js
        generateCodeSnippet(promptData);

    } catch (error) {
        clearInterval(progressInterval);
        console.error('Save error:', error);
        showToast(`保存失败: ${error.message}`, 'error');
        updateStatus('Error', 'error');

        // Reset button
        saveBtn.classList.remove('saving');
        saveBtn.disabled = false;
    }
}

// ========================================
// DOT MATRIX ANIMATION
// ========================================
function initDotMatrix() {
    const dotMatrix = document.getElementById('dotMatrix');
    dotMatrix.innerHTML = '';

    // Create 30 dots (10 columns x 3 rows)
    for (let i = 0; i < 30; i++) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        dot.dataset.index = i;
        dotMatrix.appendChild(dot);
    }
}

function updateDotProgress(count) {
    const dots = document.querySelectorAll('.dot-matrix .dot');
    dots.forEach((dot, index) => {
        if (index < count) {
            dot.classList.add('active');
            dot.classList.remove('complete');
        }
    });
}

function completeDotProgress() {
    const dots = document.querySelectorAll('.dot-matrix .dot');
    dots.forEach((dot, index) => {
        setTimeout(() => {
            dot.classList.remove('active');
            dot.classList.add('complete');
        }, index * 15);
    });
}

async function uploadImages() {
    const urls = [];

    for (let i = 0; i < uploadedFiles.length; i++) {
        const item = uploadedFiles[i];

        // Create WebP blob from base64
        const base64 = item.base64;
        const isWebP = item.dataUrl?.startsWith('data:image/webp');
        const mimeType = isWebP ? 'image/webp' : 'image/jpeg';
        const extension = isWebP ? '.webp' : '.jpg';

        // Convert base64 to blob
        const blob = await fetch(`data:${mimeType};base64,${base64}`).then(r => r.blob());

        // Generate filename with WebP extension
        const baseName = item.file?.name?.replace(/\.[^.]+$/, '') || 'image';
        const fileName = `${Date.now()}_${i}_${baseName.replace(/[^a-zA-Z0-9]/g, '_')}${extension}`;

        const { data, error } = await supabaseClient.storage
            .from('prompt-images')
            .upload(fileName, blob, { contentType: mimeType });

        if (error) throw error;

        // Get public URL
        const { data: urlData } = supabaseClient.storage
            .from('prompt-images')
            .getPublicUrl(fileName);

        urls.push(urlData.publicUrl);
        console.log(`📤 Uploaded ${fileName} (${isWebP ? 'WebP' : 'Original'})`);
    }

    return urls;
}

function generateCodeSnippet(promptData) {
    const snippet = `
    {
        "id": "prompt-NEW",
        "title": "${promptData.title}",
        "tags": ${JSON.stringify(promptData.tags)},
        "description": "${promptData.description.replace(/"/g, '\\"')}",
        "prompt": "${promptData.prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}",
        "images": ${JSON.stringify(promptData.images)},
        "dominantColors": ${JSON.stringify(promptData.dominantColors)},
        "aiTags": ${JSON.stringify(promptData.aiTags, null, 8)}
    }`;

    console.log('=== 复制以下代码到 prompts-data.js ===');
    console.log(snippet);

    // Copy to clipboard
    navigator.clipboard.writeText(snippet).then(() => {
        showToast('代码已复制到剪贴板！可粘贴到 prompts-data.js', 'success');
    });
}

// ========================================
// UTILITIES
// ========================================
function updateStatus(text, state) {
    const statusEl = document.getElementById('studioStatus');
    const dot = statusEl.querySelector('.status-dot');
    const textEl = statusEl.querySelector('.status-text');

    textEl.textContent = text;
    dot.className = 'status-dot';
    if (state === 'processing') dot.classList.add('processing');
    if (state === 'error') dot.classList.add('error');

    // Make status clickable when no API key
    if (text === 'No API Key') {
        statusEl.classList.add('clickable');
        statusEl.title = '点击添加 API Key';
        statusEl.onclick = () => promptForApiKey();
    } else {
        statusEl.classList.remove('clickable');
        statusEl.title = '';
        statusEl.onclick = null;
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function resetForm() {
    uploadedFiles = [];
    analysisResult = null;
    document.getElementById('previewGrid').innerHTML = '';
    document.getElementById('promptForm').style.display = 'none';
    document.getElementById('promptForm').reset();
    document.getElementById('tagObjects').innerHTML = '';
    document.getElementById('tagScenes').innerHTML = '';
    document.getElementById('tagStyles').innerHTML = '';
    document.getElementById('tagMood').innerHTML = '';
    document.getElementById('colorSwatches').innerHTML = '';

    // Hide last edited info
    const lastEditedInfo = document.getElementById('lastEditedInfo');
    if (lastEditedInfo) lastEditedInfo.style.display = 'none';

    updateAnalyzeButton();
    updateStatus('Ready', 'ready');
}

// ========================================
// HYBRID SEARCH: Local first, AI fallback
// ========================================
let searchDebounce = null;
let searchInitialized = false;

function setupAdminSearch() {
    if (searchInitialized) return;

    const searchInput = document.getElementById('adminSearchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const dateFilter = document.getElementById('dateFilter');

    if (!searchInput) return;

    // Search input with debounce
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            performSearch(e.target.value.trim());
        }, 300);
    });

    // Category filter
    categoryFilter.addEventListener('change', () => applyFilters());

    // Date filter  
    dateFilter.addEventListener('change', () => applyFilters());

    // ESC to clear
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            performSearch('');
        }
    });

    searchInitialized = true;
    console.log('🔍 Admin search initialized');
}

// Hybrid search: local first, then AI
async function performSearch(query) {
    const statusEl = document.getElementById('searchStatus');

    if (!query) {
        statusEl.textContent = '';
        applyFilters();
        return;
    }

    // Step 1: Local search (instant)
    const localResults = localSearch(query);

    if (localResults.length > 0) {
        statusEl.textContent = '';
        applyFiltersToResults(localResults);
        return;
    }

    // Step 2: No local results → AI semantic search
    statusEl.textContent = '🔍 AI...';

    try {
        const aiResults = await aiSemanticSearch(query);
        statusEl.textContent = aiResults.length ? '✨ AI' : '';

        if (aiResults.length > 0) {
            applyFiltersToResults(aiResults);
        } else {
            renderFilteredCards([]);
        }
    } catch (err) {
        statusEl.textContent = '';
        console.error('AI search failed:', err);
        renderFilteredCards([]);
    }
}

// Local search (title + tags + colors + ai_tags)
function localSearch(query) {
    const q = query.toLowerCase();

    // Color name mapping (English ↔ Chinese)
    const colorMap = {
        'red': '红', '红': 'red', '红色': 'red',
        'blue': '蓝', '蓝': 'blue', '蓝色': 'blue',
        'green': '绿', '绿': 'green', '绿色': 'green',
        'yellow': '黄', '黄': 'yellow', '黄色': 'yellow',
        'orange': '橙', '橙': 'orange', '橙色': 'orange',
        'purple': '紫', '紫': 'purple', '紫色': 'purple',
        'pink': '粉', '粉': 'pink', '粉色': 'pink',
        'black': '黑', '黑': 'black', '黑色': 'black',
        'white': '白', '白': 'white', '白色': 'white',
        'gold': '金', '金': 'gold', '金色': 'gold',
        'golden': '金', 'silver': '银', '银': 'silver', '银色': 'silver',
        'brown': '棕', '棕': 'brown', '棕色': 'brown',
        'gray': '灰', 'grey': '灰', '灰': 'gray', '灰色': 'gray',
        'cyan': '青', '青': 'cyan', '青色': 'cyan',
        'teal': '蓝绿', 'coral': '珊瑚'
    };

    // Get possible color translations
    const colorSearch = colorMap[q] || q;

    return allPrompts.filter(p => {
        // Search title, tags, description
        if (p.title?.toLowerCase().includes(q)) return true;
        if (p.tags?.some(t => t.toLowerCase().includes(q))) return true;
        if (p.description?.toLowerCase().includes(q)) return true;

        // Search dominant colors
        if (p.dominant_colors?.some(c =>
            c.toLowerCase().includes(q) ||
            c.toLowerCase().includes(colorSearch)
        )) return true;

        // Search ai_tags (objects, scenes, styles, mood)
        const aiTags = p.ai_tags;
        if (aiTags) {
            // Search English and Chinese arrays
            for (const category of ['objects', 'scenes', 'styles', 'mood']) {
                const tagData = aiTags[category];
                if (tagData?.en?.some(t => t.toLowerCase().includes(q))) return true;
                if (tagData?.zh?.some(t => t.includes(q))) return true;
            }
        }

        return false;
    });
}

// AI semantic search via Supabase FTS
async function aiSemanticSearch(query) {
    try {
        // First try PostgreSQL Full-Text Search if available
        const { data, error } = await supabaseClient
            .from('prompts')
            .select('*')
            .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('AI search error:', err);
        return [];
    }
}

// Apply category + date filters
function applyFilters() {
    const searchQuery = document.getElementById('adminSearchInput')?.value.trim() || '';

    if (searchQuery) {
        performSearch(searchQuery);
    } else {
        applyFiltersToResults(allPrompts);
    }
}

// Apply filters to a set of results
function applyFiltersToResults(results) {
    const category = document.getElementById('categoryFilter')?.value || '';
    const dateRange = document.getElementById('dateFilter')?.value || '';

    let filtered = [...results];

    // Category filter
    if (category) {
        filtered = filtered.filter(p => p.tags?.includes(category));
    }

    // Date filter
    if (dateRange) {
        const now = new Date();
        let cutoff;

        if (dateRange === 'today') {
            cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (dateRange === 'week') {
            cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (dateRange === 'month') {
            cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        }

        if (cutoff) {
            filtered = filtered.filter(p => new Date(p.created_at) >= cutoff);
        }
    }

    renderFilteredCards(filtered);
}

// Render filtered cards
function renderFilteredCards(prompts) {
    const grid = document.getElementById('adminGrid');
    const countEl = document.getElementById('promptCount');

    countEl.textContent = prompts.length;

    if (prompts.length > 0) {
        grid.innerHTML = prompts.map(p => renderAdminCard(p)).join('');
    } else {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 2rem;">No matching prompts found</p>';
    }
}
