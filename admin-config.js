/**
 * System Config Management
 * 系统配置管理 - 定价配置
 */

// Config cache
let systemConfigCache = {};

// ============================================
// INIT & LOAD
// ============================================

async function initSystemConfig() {
    console.log('[Config] Initializing system config...');
    try {
        await loadAllSystemConfig();
        setupConfigEventListeners();
        console.log('[Config] Initialized successfully');
    } catch (err) {
        console.error('[Config] Init error:', err);
    }
}

async function loadAllSystemConfig() {
    try {
        const { data, error } = await supabaseClient.rpc('get_all_system_config');

        if (error) throw error;

        // Cache configs
        (data || []).forEach(item => {
            systemConfigCache[item.config_key] = item.config_value;
        });

        // Render UI
        renderUnlockPricingConfig();
        renderPackagesConfig();
        renderChannelsConfig();
        renderRewardsConfig();
        renderSecurityConfig();
        renderNotificationsConfig();
        renderModerationConfig();

    } catch (err) {
        console.warn('[Config] Load error:', err.message);
        // Use defaults on error
    }
}

// ============================================
// RENDER FUNCTIONS
// ============================================

function renderUnlockPricingConfig() {
    const config = systemConfigCache['unlock_pricing'] || { default_points: 10, vip_discount: 0.9 };

    const pointsInput = document.getElementById('cfgUnlockPoints');
    const discountInput = document.getElementById('cfgVipDiscount');

    if (pointsInput) pointsInput.value = config.default_points || 10;
    if (discountInput) discountInput.value = (config.vip_discount || 0.9) * 100;
}

function renderPackagesConfig() {
    const packages = systemConfigCache['packages'] || [];
    const tbody = document.getElementById('packagesTableBody');
    if (!tbody) return;

    tbody.innerHTML = packages.map((pkg, index) => `
        <tr data-index="${index}">
            <td><input type="text" value="${pkg.name}" onchange="updatePackage(${index}, 'name', this.value)"></td>
            <td><input type="number" value="${pkg.points}" onchange="updatePackage(${index}, 'points', parseInt(this.value))"></td>
            <td><input type="number" value="${pkg.bonus || 0}" placeholder="0" onchange="updatePackage(${index}, 'bonus', parseInt(this.value) || 0)"></td>
            <td><input type="number" value="${pkg.price || ''}" step="0.1" onchange="updatePackage(${index}, 'price', parseFloat(this.value))"></td>
            <td>
                <div class="status-toggle ${pkg.enabled ? 'active' : ''}" onclick="togglePackageStatus(${index})"></div>
            </td>
            <td><button class="btn-delete" onclick="deletePackage(${index})"><i class="fas fa-trash"></i></button></td>
        </tr>
    `).join('');
}

function renderChannelsConfig() {
    const channels = systemConfigCache['channels'] || [];
    const container = document.getElementById('channelTags');
    if (!container) return;

    container.innerHTML = channels.map((ch, index) => `
        <div class="channel-tag ${ch.is_default ? 'default' : ''}" data-index="${index}">
            <span>${ch.name}</span>
            <button class="remove-tag" onclick="deleteChannel(${index})">✕</button>
        </div>
    `).join('');
}

function renderRewardsConfig() {
    const config = systemConfigCache['rewards'] || {};

    const fields = {
        'cfgSignupBonus': config.signup_bonus || 50,
        'cfgDailyCheckin': config.daily_checkin || 5,
        'cfgCommentReward': config.comment_reward || 2,
        'cfgInviteReward': config.invite_reward || 100
    };

    Object.entries(fields).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });
}

// ============================================
// UPDATE FUNCTIONS
// ============================================

async function saveConfig(key, value) {
    try {
        const { error } = await supabaseClient.rpc('update_system_config', {
            p_key: key,
            p_value: value
        });

        if (error) throw error;

        systemConfigCache[key] = value;

        // Sync packages to points_packages table
        if (key === 'packages') {
            await syncPackagesToDatabase(value);
        }

        return true;
    } catch (err) {
        console.error('[Config] Save error:', err);
        if (typeof showToast === 'function') {
            showToast('保存失败: ' + err.message, 'error');
        }
        return false;
    }
}

// Sync packages config to points_packages table
async function syncPackagesToDatabase(packages) {
    try {
        if (!packages || !Array.isArray(packages)) return;

        console.log('[Config] Syncing packages to database...');

        // Get existing packages from database
        const { data: existingPackages } = await supabaseClient
            .from('points_packages')
            .select('id, name');

        const existingMap = {};
        (existingPackages || []).forEach(p => {
            existingMap[p.name] = p.id;
        });

        // Track which names are in the config
        const configNames = new Set(packages.map(p => p.name));

        // Update or insert packages
        for (const pkg of packages) {
            const existingId = existingMap[pkg.name];

            const packageData = {
                name: pkg.name,
                points_amount: pkg.points || 0,
                bonus_points: pkg.bonus || 0,
                price_cny: pkg.price || 0,
                is_active: pkg.enabled !== false,
                sort_order: pkg.sort || 0
            };

            let error;

            if (existingId) {
                // Update existing
                const result = await supabaseClient
                    .from('points_packages')
                    .update(packageData)
                    .eq('id', existingId);
                error = result.error;
            } else {
                // Insert new
                const result = await supabaseClient
                    .from('points_packages')
                    .insert(packageData);
                error = result.error;
            }

            if (error) {
                console.warn('[Config] Sync package error:', error.message);
            }
        }

        // Delete packages that are not in config anymore
        for (const existing of (existingPackages || [])) {
            if (!configNames.has(existing.name)) {
                console.log('[Config] Deleting removed package:', existing.name);
                await supabaseClient
                    .from('points_packages')
                    .delete()
                    .eq('id', existing.id);
            }
        }

        console.log('[Config] Packages synced successfully');
        if (typeof showToast === 'function') {
            showToast('礼包已同步到数据库', 'success');
        }
    } catch (err) {
        console.error('[Config] Sync packages error:', err);
    }
}

// Show save indicator animation
function showSaveIndicator(element) {
    const indicator = element.closest('.config-input-wrapper')?.querySelector('.config-save-indicator');
    if (indicator) {
        indicator.classList.add('visible');
        setTimeout(() => indicator.classList.remove('visible'), 1500);
    }
}

// Debounce helper
let saveTimeouts = {};
function debouncedSave(key, fn, delay = 500) {
    clearTimeout(saveTimeouts[key]);
    saveTimeouts[key] = setTimeout(fn, delay);
}

// ============================================
// EVENT HANDLERS
// ============================================

function setupConfigEventListeners() {
    // Unlock pricing
    const unlockPointsInput = document.getElementById('cfgUnlockPoints');
    const vipDiscountInput = document.getElementById('cfgVipDiscount');

    if (unlockPointsInput) {
        unlockPointsInput.addEventListener('change', async (e) => {
            const config = systemConfigCache['unlock_pricing'] || {};
            config.default_points = parseInt(e.target.value) || 10;
            if (await saveConfig('unlock_pricing', config)) {
                showSaveIndicator(e.target);
            }
        });
    }

    if (vipDiscountInput) {
        vipDiscountInput.addEventListener('change', async (e) => {
            const config = systemConfigCache['unlock_pricing'] || {};
            config.vip_discount = (parseInt(e.target.value) || 90) / 100;
            if (await saveConfig('unlock_pricing', config)) {
                showSaveIndicator(e.target);
            }
        });
    }

    // Rewards config
    ['cfgSignupBonus', 'cfgDailyCheckin', 'cfgCommentReward', 'cfgInviteReward'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', async (e) => {
                const config = systemConfigCache['rewards'] || {};
                const fieldMap = {
                    'cfgSignupBonus': 'signup_bonus',
                    'cfgDailyCheckin': 'daily_checkin',
                    'cfgCommentReward': 'comment_reward',
                    'cfgInviteReward': 'invite_reward'
                };
                config[fieldMap[id]] = parseInt(e.target.value) || 0;
                if (await saveConfig('rewards', config)) {
                    showSaveIndicator(e.target);
                }
            });
        }
    });

    // Setup security event listeners
    setupSecurityEventListeners();

    // Setup notifications event listeners
    setupNotificationsEventListeners();

    // Setup moderation event listeners
    setupModerationEventListeners();
}

// Toggle card collapse
function toggleConfigCard(headerEl) {
    const card = headerEl.closest('.config-card');
    if (card) {
        card.classList.toggle('collapsed');
    }
}

// ============================================
// PACKAGES CRUD
// ============================================

async function updatePackage(index, field, value) {
    const packages = systemConfigCache['packages'] || [];
    if (packages[index]) {
        packages[index][field] = value;
        await saveConfig('packages', packages);
    }
}

async function togglePackageStatus(index) {
    const packages = systemConfigCache['packages'] || [];
    if (!packages[index]) return;

    // Immediately toggle and update UI (optimistic update)
    packages[index].enabled = !packages[index].enabled;

    // Instantly update the toggle visual
    const toggleEl = document.querySelector(`#packagesTableBody tr[data-index="${index}"] .status-toggle`);
    if (toggleEl) {
        toggleEl.classList.toggle('active', packages[index].enabled);
        // Add brief pulse animation
        toggleEl.style.transform = 'scale(1.1)';
        setTimeout(() => toggleEl.style.transform = '', 150);
    }

    // Save in background (don't wait)
    saveConfig('packages', packages).catch(err => {
        // Revert on error
        console.error('[Config] Toggle save failed:', err);
        packages[index].enabled = !packages[index].enabled;
        if (toggleEl) toggleEl.classList.toggle('active', packages[index].enabled);
    });
}

async function deletePackage(index) {
    if (!confirm('确定删除这个礼包吗？')) return;

    const packages = systemConfigCache['packages'] || [];
    packages.splice(index, 1);

    // Optimistic update - render immediately
    renderPackagesConfig();

    // Save in background
    saveConfig('packages', packages);
}

async function addPackageRow() {
    const packages = systemConfigCache['packages'] || [];
    const newId = Math.max(...packages.map(p => p.id || 0), 0) + 1;

    packages.push({
        id: newId,
        name: '新礼包',
        points: 100,
        bonus: 0,
        price: 9.9,
        enabled: true,
        sort: packages.length + 1
    });

    // Optimistic update - render immediately
    renderPackagesConfig();

    // Save in background
    saveConfig('packages', packages);
}

// ============================================
// CHANNELS CRUD
// ============================================

async function deleteChannel(index) {
    const channels = systemConfigCache['channels'] || [];
    channels.splice(index, 1);
    await saveConfig('channels', channels);
    renderChannelsConfig();
}

async function addChannel() {
    const input = document.getElementById('newChannelName');
    const name = input?.value.trim();
    if (!name) return;

    const channels = systemConfigCache['channels'] || [];
    const newId = Math.max(...channels.map(c => c.id || 0), 0) + 1;

    channels.push({
        id: newId,
        name: name,
        icon: 'tag',
        is_default: false
    });

    await saveConfig('channels', channels);
    renderChannelsConfig();

    if (input) input.value = '';
}

// ============================================
// SECURITY SETTINGS
// ============================================

function renderSecurityConfig() {
    const config = systemConfigCache['security'] || {
        login_lockout_attempts: 5,
        lockout_duration: 900000,
        session_timeout: 3600000,
        ip_blacklist: []
    };

    // Login lockout attempts
    const lockoutInput = document.getElementById('cfgLoginLockoutAttempts');
    if (lockoutInput) lockoutInput.value = config.login_lockout_attempts || 5;

    // Lockout duration dropdown
    const lockoutDurationValue = document.getElementById('lockoutDurationValue');
    if (lockoutDurationValue) {
        const duration = config.lockout_duration || 900000;
        const labels = { 300000: '5 分钟', 900000: '15 分钟', 3600000: '1 小时' };
        lockoutDurationValue.textContent = labels[duration] || '15 分钟';
    }

    // Session timeout dropdown
    const sessionTimeoutValue = document.getElementById('sessionTimeoutValue');
    if (sessionTimeoutValue) {
        const timeout = config.session_timeout || 3600000;
        const labels = { 1800000: '30 分钟', 3600000: '1 小时', 86400000: '1 天' };
        sessionTimeoutValue.textContent = labels[timeout] || '1 小时';
    }

    // IP blacklist
    const blacklistTextarea = document.getElementById('cfgIpBlacklist');
    if (blacklistTextarea) {
        const ips = config.ip_blacklist || [];
        blacklistTextarea.value = ips.join('\n');
    }
}

async function saveIpBlacklist() {
    const textarea = document.getElementById('cfgIpBlacklist');
    if (!textarea) return;

    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
    const config = systemConfigCache['security'] || {};
    config.ip_blacklist = lines;

    const success = await saveConfig('security', config);

    const indicator = document.getElementById('ipBlacklistSaveIndicator');
    if (indicator && success) {
        indicator.style.opacity = '1';
        setTimeout(() => indicator.style.opacity = '0', 2000);
    }
}

function setupSecurityEventListeners() {
    // Login lockout attempts
    const lockoutInput = document.getElementById('cfgLoginLockoutAttempts');
    if (lockoutInput) {
        lockoutInput.addEventListener('change', async (e) => {
            const config = systemConfigCache['security'] || {};
            config.login_lockout_attempts = parseInt(e.target.value) || 5;
            if (await saveConfig('security', config)) {
                showSaveIndicator(e.target);
            }
        });
    }
}

// ============================================
// NOTIFICATIONS SETTINGS
// ============================================

function renderNotificationsConfig() {
    const config = systemConfigCache['notifications'] || {
        new_user_notify: false,
        announcement_enabled: false,
        announcement_content: '',
        announcement_type: 'banner',
        announcement_color: 'purple',
        announcement_size: 'medium'
    };

    // New user notification toggle
    const newUserNotify = document.getElementById('cfgNewUserNotify');
    if (newUserNotify) newUserNotify.checked = config.new_user_notify || false;

    // Announcement enabled toggle
    const announcementEnabled = document.getElementById('cfgAnnouncementEnabled');
    if (announcementEnabled) announcementEnabled.checked = config.announcement_enabled || false;

    // Announcement content (for contenteditable div, use innerHTML)
    const announcementContent = document.getElementById('cfgAnnouncementContent');
    if (announcementContent) {
        announcementContent.innerHTML = config.announcement_content || '';
    }

    // Announcement type (radio buttons)
    const typeRadios = document.querySelectorAll('input[name="announcementType"]');
    typeRadios.forEach(radio => {
        if (radio.value === (config.announcement_type || 'banner')) {
            radio.checked = true;
        }
    });

    // Announcement color (radio buttons)
    const colorRadios = document.querySelectorAll('input[name="announcementColor"]');
    colorRadios.forEach(radio => {
        if (radio.value === (config.announcement_color || 'purple')) {
            radio.checked = true;
        }
    });

    // Update preview
    updateAnnouncementPreview();
}

function updateAnnouncementPreview() {
    const preview = document.getElementById('announcementPreview');
    if (!preview) return;

    const contentEl = document.getElementById('cfgAnnouncementContent');
    const typeRadio = document.querySelector('input[name="announcementType"]:checked');
    const colorRadio = document.querySelector('input[name="announcementColor"]:checked');

    // For contenteditable div, use innerHTML; for textarea, use value
    const content = contentEl?.innerHTML || contentEl?.value || '在此预览公告效果...';
    const type = typeRadio?.value || 'banner';
    const color = colorRadio?.value || 'purple';

    // Update preview content - target the span inside preview-body
    const bodySpan = preview.querySelector('.preview-body span');
    if (bodySpan) {
        bodySpan.innerHTML = content || '在此预览公告效果...';
    }

    // Update type style
    preview.classList.remove('modal-style', 'toast-style');
    if (type === 'modal') {
        preview.classList.add('modal-style');
    } else if (type === 'toast') {
        preview.classList.add('toast-style');
    }

    // Update color
    preview.classList.remove('color-purple', 'color-blue', 'color-green', 'color-orange', 'color-red', 'color-dark');
    preview.classList.add('color-' + color);
}

async function saveAnnouncement() {
    const contentEl = document.getElementById('cfgAnnouncementContent');
    const enabledEl = document.getElementById('cfgAnnouncementEnabled');
    const typeRadio = document.querySelector('input[name="announcementType"]:checked');
    const colorRadio = document.querySelector('input[name="announcementColor"]:checked');

    if (!contentEl) return;

    const config = systemConfigCache['notifications'] || {};
    // For contenteditable div, use innerHTML
    config.announcement_content = contentEl.innerHTML || contentEl.value || '';
    config.announcement_enabled = enabledEl?.checked || false;
    config.announcement_type = typeRadio?.value || 'banner';
    config.announcement_color = colorRadio?.value || 'purple';

    const success = await saveConfig('notifications', config);

    // Get the save button
    const saveBtn = document.querySelector('.editor-actions .btn-primary');

    if (success && saveBtn) {
        // Save original content
        const originalHTML = saveBtn.innerHTML;

        // Show success state
        saveBtn.classList.add('success');
        saveBtn.innerHTML = '<i class="fas fa-check"></i> 已发布';

        // Restore after 2 seconds
        setTimeout(() => {
            saveBtn.classList.remove('success');
            saveBtn.innerHTML = originalHTML;
        }, 2000);
    }
}

function setupNotificationsEventListeners() {
    // New user notification toggle
    const newUserNotify = document.getElementById('cfgNewUserNotify');
    if (newUserNotify) {
        newUserNotify.addEventListener('change', async (e) => {
            const config = systemConfigCache['notifications'] || {};
            config.new_user_notify = e.target.checked;
            await saveConfig('notifications', config);
        });
    }

    // Announcement enabled toggle
    const announcementEnabled = document.getElementById('cfgAnnouncementEnabled');
    if (announcementEnabled) {
        announcementEnabled.addEventListener('change', async (e) => {
            const config = systemConfigCache['notifications'] || {};
            config.announcement_enabled = e.target.checked;
            await saveConfig('notifications', config);
        });
    }

    // Type radio buttons - update preview
    const typeRadios = document.querySelectorAll('input[name="announcementType"]');
    typeRadios.forEach(radio => {
        radio.addEventListener('change', updateAnnouncementPreview);
    });

    // Color radio buttons - update preview
    const colorRadios = document.querySelectorAll('input[name="announcementColor"]');
    colorRadios.forEach(radio => {
        radio.addEventListener('change', updateAnnouncementPreview);
    });

    // Content editor - update preview on input
    const contentEl = document.getElementById('cfgAnnouncementContent');
    if (contentEl) {
        contentEl.addEventListener('input', updateAnnouncementPreview);
    }
}


// ============================================
// WYSIWYG TOOLBAR FUNCTIONS
// ============================================

function applyFormat(command, value = null) {
    const editor = document.getElementById('cfgAnnouncementContent');
    if (!editor) return;

    editor.focus();
    document.execCommand(command, false, value);
    updateAnnouncementPreview();
}

function insertFormat(tag) {
    applyFormat(tag === 'b' ? 'bold' : tag === 'i' ? 'italic' : 'underline');
}

function applyTextColor(color) {
    if (!color) return;
    applyFormat('foreColor', color);
    document.getElementById('textColorSelect').value = '';
}

function applyTextSize(size) {
    if (!size) return;
    applyFormat('fontSize', size);
    document.getElementById('textSizeSelect').value = '';
}

function insertLink() {
    const url = prompt('请输入链接地址:', 'https://');
    if (!url) return;
    applyFormat('createLink', url);
}

function selectEmoji(emoji) {
    const editor = document.getElementById('cfgAnnouncementContent');
    if (!editor) return;

    editor.focus();
    document.execCommand('insertText', false, emoji);
    updateAnnouncementPreview();

    // Close picker
    const picker = document.getElementById('emojiPicker');
    if (picker) picker.classList.remove('active');
}

function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (picker) {
        picker.classList.toggle('active');
    }
}

// Close emoji picker when clicking outside
document.addEventListener('click', (e) => {
    const picker = document.getElementById('emojiPicker');
    const btn = document.getElementById('emojiPickerBtn');
    if (picker && btn && !picker.contains(e.target) && !btn.contains(e.target)) {
        picker.classList.remove('active');
    }
});

// ============================================
// MODERATION SETTINGS
// ============================================

function renderModerationConfig() {
    const config = systemConfigCache['moderation'] || {
        auto_filter: false,
        sensitive_words: [],
        ai_content_detection: false
    };

    // Auto filter toggle
    const autoFilter = document.getElementById('cfgAutoFilter');
    if (autoFilter) autoFilter.checked = config.auto_filter || false;

    // Sensitive words
    const sensitiveWords = document.getElementById('cfgSensitiveWords');
    if (sensitiveWords) {
        const words = config.sensitive_words || [];
        sensitiveWords.value = words.join('\n');
    }

    // AI content detection toggle
    const aiDetection = document.getElementById('cfgAiContentDetection');
    if (aiDetection) aiDetection.checked = config.ai_content_detection || false;
}

async function saveSensitiveWords() {
    const textarea = document.getElementById('cfgSensitiveWords');
    if (!textarea) return;

    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
    const config = systemConfigCache['moderation'] || {};
    config.sensitive_words = lines;

    const success = await saveConfig('moderation', config);

    const indicator = document.getElementById('sensitiveWordsSaveIndicator');
    if (indicator && success) {
        indicator.style.opacity = '1';
        setTimeout(() => indicator.style.opacity = '0', 2000);
    }
}

function setupModerationEventListeners() {
    // Auto filter toggle
    const autoFilter = document.getElementById('cfgAutoFilter');
    if (autoFilter) {
        autoFilter.addEventListener('change', async (e) => {
            const config = systemConfigCache['moderation'] || {};
            config.auto_filter = e.target.checked;
            await saveConfig('moderation', config);
        });
    }

    // AI content detection toggle
    const aiDetection = document.getElementById('cfgAiContentDetection');
    if (aiDetection) {
        aiDetection.addEventListener('change', async (e) => {
            const config = systemConfigCache['moderation'] || {};
            config.ai_content_detection = e.target.checked;
            await saveConfig('moderation', config);
        });
    }
}

// ============================================
// EXPORTS
// ============================================

window.initSystemConfig = initSystemConfig;
window.toggleConfigCard = toggleConfigCard;
window.updatePackage = updatePackage;
window.togglePackageStatus = togglePackageStatus;
window.deletePackage = deletePackage;
window.addPackageRow = addPackageRow;
window.deleteChannel = deleteChannel;
window.addChannel = addChannel;
window.saveIpBlacklist = saveIpBlacklist;
window.saveAnnouncement = saveAnnouncement;
window.saveSensitiveWords = saveSensitiveWords;
