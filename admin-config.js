/**
 * System Config Management
 * 系统配置管理 - 定价配置
 */

// Config cache
let systemConfigCache = {};

function getDefaultCheckinConfig() {
    return {
        base_points: 5,
        consecutive_7_points: 50,
        perfect_month_points: 200,
        makeup_cost_points: 10
    };
}

function getDefaultRechargeOptionsConfig() {
    return {
        custom_amount_enabled: false
    };
}

function getDefaultAffiliateProgramConfig() {
    return {
        commission_rate_shop: 0.10,
        commission_rate_agent: 0.10,
        registration_reward_points: 0,
        registration_reward_requires_purchase: true,
        reward_notice: '拉新固定奖励与持续返佣可叠加发放；异常流量、作弊注册、退款订单与刷单行为不计入奖励统计。',
        legal_disclaimer: '活动最终解释权归平台所有'
    };
}

function getAffiliatePosterPresetDefinitions() {
    return [
        {
            id: 'midnight',
            name: '星幕邀请函',
            description: '深色高级感，适合作为默认分享海报。',
            preview_background: 'linear-gradient(160deg, #020617 0%, #0f172a 42%, #134e4a 100%)'
        },
        {
            id: 'sunset',
            name: '暖金品牌卡',
            description: '暖色氛围更强，适合活动档期与节庆传播。',
            preview_background: 'linear-gradient(160deg, #431407 0%, #9a3412 38%, #f59e0b 100%)'
        },
        {
            id: 'crystal',
            name: '清透极简版',
            description: '浅色留白更多，适合搭配自定义品牌底图。',
            preview_background: 'linear-gradient(160deg, #e2e8f0 0%, #cbd5e1 45%, #f8fafc 100%)'
        }
    ];
}

function getDefaultAffiliatePosterConfig() {
    return {
        chip_label: '推广',
        title: '专属邀请函',
        subtitle: '扫码注册 · 即享专属奖励',
        reward_badge_text: '',
        invite_code_label: '邀请码',
        qr_label: '扫码注册领取新人福利',
        footer: '邀请好友注册，享受固定奖励与持续返佣',
        active_template_id: 'midnight',
        templates: getAffiliatePosterPresetDefinitions().map(template => ({
            id: template.id,
            name: template.name,
            description: template.description,
            custom_background_url: ''
        }))
    };
}

function toWholeNumber(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toPointNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : fallback;
}

function toDecimal(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function escapeConfigHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeCheckinConfig(raw) {
    const defaults = getDefaultCheckinConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        base_points: Math.max(0, toPointNumber(source.base_points, defaults.base_points)),
        consecutive_7_points: Math.max(0, toPointNumber(source.consecutive_7_points, defaults.consecutive_7_points)),
        perfect_month_points: Math.max(0, toPointNumber(source.perfect_month_points, defaults.perfect_month_points)),
        makeup_cost_points: Math.max(0, toPointNumber(source.makeup_cost_points, defaults.makeup_cost_points))
    };
}

function normalizeRechargeOptionsConfig(raw) {
    const defaults = getDefaultRechargeOptionsConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    return {
        custom_amount_enabled: source.custom_amount_enabled === true || String(source.custom_amount_enabled) === 'true'
    };
}

function normalizeAffiliateProgramConfig(raw) {
    const defaults = getDefaultAffiliateProgramConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const rewardNotice = typeof source.reward_notice === 'string' ? source.reward_notice : defaults.reward_notice;
    const legalDisclaimer = typeof source.legal_disclaimer === 'string' ? source.legal_disclaimer : defaults.legal_disclaimer;

    return {
        commission_rate_shop: clamp(toDecimal(source.commission_rate_shop, defaults.commission_rate_shop), 0, 1),
        commission_rate_agent: clamp(toDecimal(source.commission_rate_agent, defaults.commission_rate_agent), 0, 1),
        registration_reward_points: Math.max(0, toPointNumber(source.registration_reward_points, defaults.registration_reward_points)),
        registration_reward_requires_purchase: source.registration_reward_requires_purchase !== undefined
            ? String(source.registration_reward_requires_purchase) !== 'false'
            : defaults.registration_reward_requires_purchase,
        reward_notice: rewardNotice.trim() || defaults.reward_notice,
        legal_disclaimer: legalDisclaimer.trim() || defaults.legal_disclaimer
    };
}

function normalizeAffiliatePosterConfig(raw) {
    const defaults = getDefaultAffiliatePosterConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sourceTemplates = Array.isArray(source.templates) ? source.templates : [];

    const templates = defaults.templates.map(defaultTemplate => {
        const match = sourceTemplates.find(template => template && template.id === defaultTemplate.id) || {};
        return {
            ...defaultTemplate,
            name: typeof match.name === 'string' && match.name.trim() ? match.name.trim() : defaultTemplate.name,
            description: typeof match.description === 'string' && match.description.trim() ? match.description.trim() : defaultTemplate.description,
            custom_background_url: typeof match.custom_background_url === 'string' ? match.custom_background_url.trim() : ''
        };
    });

    const activeTemplateId = templates.some(template => template.id === source.active_template_id)
        ? source.active_template_id
        : defaults.active_template_id;

    return {
        chip_label: typeof source.chip_label === 'string' && source.chip_label.trim() ? source.chip_label.trim() : defaults.chip_label,
        title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : defaults.title,
        subtitle: typeof source.subtitle === 'string' && source.subtitle.trim() ? source.subtitle.trim() : defaults.subtitle,
        reward_badge_text: typeof source.reward_badge_text === 'string' ? source.reward_badge_text.trim() : defaults.reward_badge_text,
        invite_code_label: typeof source.invite_code_label === 'string' && source.invite_code_label.trim() ? source.invite_code_label.trim() : defaults.invite_code_label,
        qr_label: typeof source.qr_label === 'string' && source.qr_label.trim() ? source.qr_label.trim() : defaults.qr_label,
        footer: typeof source.footer === 'string' && source.footer.trim() ? source.footer.trim() : defaults.footer,
        active_template_id: activeTemplateId,
        templates
    };
}

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
        renderGalleryConfig();
        renderCommentRulesConfig();
        renderVerifyConfig();
        loadAffiliateSettings();

    } catch (err) {
        console.warn('[Config] Load error:', err.message);
        // Use defaults on error
    }
}

// ============================================
// RENDER FUNCTIONS
// ============================================

function renderUnlockPricingConfig() {
    const config = systemConfigCache['unlock_pricing'] || { default_points: 1, vip_discount: 0.9 };

    const pointsInput = document.getElementById('cfgUnlockPoints');
    const discountInput = document.getElementById('cfgVipDiscount');

    if (pointsInput) pointsInput.value = config.default_points || 1;
    if (discountInput) discountInput.value = (config.vip_discount || 0.9) * 100;
}

function renderPackagesConfig() {
    const packages = systemConfigCache['packages'] || [];
    const rechargeOptions = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
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

    const customRechargeToggle = document.getElementById('customRechargeStatusToggle');
    if (customRechargeToggle) {
        customRechargeToggle.classList.toggle('active', rechargeOptions.custom_amount_enabled);
    }
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
    const rewardsConfig = systemConfigCache['rewards'] || {};
    const checkinConfig = normalizeCheckinConfig(systemConfigCache['checkin_system']);

    const fields = {
        'cfgSignupBonus': Math.max(0, toPointNumber(rewardsConfig.signup_bonus, 50)),
        'cfgDailyCheckin': checkinConfig.base_points,
        'cfgCheckinStreakBonus': checkinConfig.consecutive_7_points,
        'cfgCheckinPerfectBonus': checkinConfig.perfect_month_points,
        'cfgCheckinMakeupCost': checkinConfig.makeup_cost_points,
        'cfgCommentReward': Math.max(0, toPointNumber(rewardsConfig.comment_reward, 2))
    };

    Object.entries(fields).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });
}

function loadAffiliateSettings() {
    const affiliateConfig = normalizeAffiliateProgramConfig(systemConfigCache['affiliate_program']);
    const posterConfig = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);

    const affiliateFieldMap = {
        affiliate_setting_commission_rate_shop: affiliateConfig.commission_rate_shop,
        affiliate_setting_commission_rate_agent: affiliateConfig.commission_rate_agent,
        affiliate_setting_registration_reward_points: affiliateConfig.registration_reward_points,
        affiliate_setting_reward_notice: affiliateConfig.reward_notice,
        affiliate_setting_legal_disclaimer: affiliateConfig.legal_disclaimer
    };

    Object.entries(affiliateFieldMap).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });

    const requiresPurchaseInput = document.getElementById('affiliate_setting_registration_reward_requires_purchase');
    if (requiresPurchaseInput) requiresPurchaseInput.checked = !!affiliateConfig.registration_reward_requires_purchase;

    const posterFieldMap = {
        affiliate_poster_chip_label: posterConfig.chip_label,
        affiliate_poster_title: posterConfig.title,
        affiliate_poster_subtitle: posterConfig.subtitle,
        affiliate_poster_reward_badge_text: posterConfig.reward_badge_text,
        affiliate_poster_invite_code_label: posterConfig.invite_code_label,
        affiliate_poster_qr_label: posterConfig.qr_label,
        affiliate_poster_footer: posterConfig.footer
    };

    Object.entries(posterFieldMap).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });

    renderAffiliatePosterTemplates(posterConfig);
}

function renderAffiliatePosterTemplates(config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster'])) {
    const container = document.getElementById('affiliatePosterTemplateGrid');
    if (!container) return;

    const presets = getAffiliatePosterPresetDefinitions();

    container.innerHTML = config.templates.map(template => {
        const preset = presets.find(item => item.id === template.id) || presets[0];
        const isActive = config.active_template_id === template.id;
                const previewBackground = template.custom_background_url
                    ? `linear-gradient(180deg, rgba(3, 7, 18, 0.08) 0%, rgba(3, 7, 18, 0.44) 100%), url('${escapeConfigHtml(template.custom_background_url)}') center/cover`
                    : preset.preview_background;

        return `
            <div class="affiliate-poster-card ${isActive ? 'active' : ''}">
                <div class="affiliate-poster-preview" style="background:${previewBackground};">
                    <div class="affiliate-poster-chip">${escapeConfigHtml(config.chip_label || '推广')}</div>
                    <div class="affiliate-poster-preview-content">
                        <div class="affiliate-poster-preview-title">${escapeConfigHtml(config.title)}</div>
                        <div class="affiliate-poster-preview-subtitle">${escapeConfigHtml(config.subtitle)}</div>
                        <div class="affiliate-poster-preview-footer">${escapeConfigHtml(config.footer)}</div>
                    </div>
                </div>
                <div class="affiliate-poster-card-body">
                    <div class="affiliate-poster-card-header-row">
                        <div>
                            <div class="affiliate-poster-card-title">${escapeConfigHtml(template.name)}</div>
                            <div class="affiliate-poster-card-desc">${escapeConfigHtml(template.description)}</div>
                        </div>
                        <span class="affiliate-poster-status ${isActive ? 'active' : ''}">${isActive ? '已启用' : '未启用'}</span>
                    </div>
                    <div class="affiliate-poster-asset-state">
                        ${template.custom_background_url ? '已上传自定义底图' : '使用内置背景'}
                    </div>
                    <div class="affiliate-poster-actions">
                        <button type="button" class="poster-action-btn primary" onclick="window.selectAffiliatePosterTemplate('${template.id}')">
                            ${isActive ? '当前模板' : '设为默认'}
                        </button>
                        <label class="poster-action-btn upload">
                            上传底图
                            <input type="file" accept="image/*" onchange="window.handleAffiliatePosterUpload('${template.id}', this)">
                        </label>
                        <button type="button" class="poster-action-btn" ${template.custom_background_url ? '' : 'disabled'} onclick="window.resetAffiliatePosterBackground('${template.id}')">
                            恢复默认
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
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

function showConfigSavedToast(message) {
    if (typeof showToast === 'function') {
        showToast(message, 'success');
    }
}

async function saveAffiliateSetting(field, rawValue) {
    const config = normalizeAffiliateProgramConfig(systemConfigCache['affiliate_program']);

    switch (field) {
        case 'commission_rate_shop':
        case 'commission_rate_agent':
            config[field] = clamp(toDecimal(rawValue, config[field]), 0, 1);
            break;
        case 'registration_reward_points':
            config[field] = Math.max(0, toPointNumber(rawValue, config[field]));
            break;
        case 'registration_reward_requires_purchase':
            config[field] = String(rawValue) !== 'false';
            break;
        case 'reward_notice':
        case 'legal_disclaimer':
            config[field] = String(rawValue || '').trim() || getDefaultAffiliateProgramConfig()[field];
            break;
        default:
            return false;
    }

    if (await saveConfig('affiliate_program', config)) {
        loadAffiliateSettings();
        showConfigSavedToast('推广返现设置已保存');
        return true;
    }

    return false;
}

async function saveAffiliatePosterField(field, rawValue) {
    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    const allowedFields = new Set(['chip_label', 'title', 'subtitle', 'reward_badge_text', 'invite_code_label', 'qr_label', 'footer']);
    if (!allowedFields.has(field)) return false;

    if (field === 'reward_badge_text') {
        config[field] = String(rawValue || '').trim();
    } else {
        config[field] = String(rawValue || '').trim() || getDefaultAffiliatePosterConfig()[field];
    }

    if (await saveConfig('affiliate_poster', config)) {
        renderAffiliatePosterTemplates(config);
        showConfigSavedToast('海报文案已保存');
        return true;
    }

    return false;
}

async function selectAffiliatePosterTemplate(templateId) {
    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    if (!config.templates.some(template => template.id === templateId)) return false;

    config.active_template_id = templateId;

    if (await saveConfig('affiliate_poster', config)) {
        renderAffiliatePosterTemplates(config);
        showConfigSavedToast('默认海报模板已更新');
        return true;
    }

    return false;
}

function compressConfigImage(file, options = {}) {
    const maxWidth = options.maxWidth || 1600;
    const maxHeight = options.maxHeight || 2400;
    const quality = options.quality || 0.9;

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;

                if (width > height && width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                } else if (height >= width && height > maxHeight) {
                    width = Math.round(width * (maxHeight / height));
                    height = maxHeight;
                }

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = width;
                canvas.height = height;

                if (!ctx) {
                    reject(new Error('无法初始化图片画布'));
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('图片解析失败'));
            img.src = reader.result;
        };
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
    });
}

async function uploadAffiliatePosterBackgroundToR2(templateId, file) {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        throw new Error('请先登录');
    }

    const imageData = await compressConfigImage(file, {
        maxWidth: 1800,
        maxHeight: 2600,
        quality: 0.92
    });

    const response = await fetch(
        'https://mmkugdibsaeoevliebzk.supabase.co/functions/v1/upload-avatar',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: session.user.id,
                type: 'poster',
                posterId: `affiliate_${templateId}`,
                imageData
            })
        }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.imageUrl) {
        throw new Error(result?.error || '海报底图上传失败');
    }

    return result.imageUrl;
}

async function handleAffiliatePosterUpload(templateId, inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return false;

    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    const template = config.templates.find(item => item.id === templateId);
    if (!template) return false;

    const labelEl = inputEl.closest('.poster-action-btn.upload');
    if (labelEl) labelEl.classList.add('uploading');

    try {
        const imageUrl = await uploadAffiliatePosterBackgroundToR2(templateId, file);
        template.custom_background_url = imageUrl;

        if (await saveConfig('affiliate_poster', config)) {
            renderAffiliatePosterTemplates(config);
            showConfigSavedToast('海报底图已上传');
            return true;
        }
    } catch (err) {
        console.error('[Config] Affiliate poster upload failed:', err);
        if (typeof showToast === 'function') {
            showToast('上传失败: ' + err.message, 'error');
        }
    } finally {
        if (labelEl) labelEl.classList.remove('uploading');
        if (inputEl) inputEl.value = '';
    }

    return false;
}

async function resetAffiliatePosterBackground(templateId) {
    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    const template = config.templates.find(item => item.id === templateId);
    if (!template) return false;

    template.custom_background_url = '';

    if (await saveConfig('affiliate_poster', config)) {
        renderAffiliatePosterTemplates(config);
        showConfigSavedToast('已恢复内置海报背景');
        return true;
    }

    return false;
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
            config.default_points = parseInt(e.target.value) || 1;
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
    ['cfgSignupBonus', 'cfgCommentReward'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', async (e) => {
                const config = systemConfigCache['rewards'] || {};
                const fieldMap = {
                    'cfgSignupBonus': 'signup_bonus',
                    'cfgCommentReward': 'comment_reward'
                };
                const normalizedValue = Math.max(0, toPointNumber(e.target.value, 0));
                e.target.value = normalizedValue;
                config[fieldMap[id]] = normalizedValue;
                if (await saveConfig('rewards', config)) {
                    showSaveIndicator(e.target);
                }
            });
        }
    });

    ['cfgDailyCheckin', 'cfgCheckinStreakBonus', 'cfgCheckinPerfectBonus', 'cfgCheckinMakeupCost'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', async (e) => {
                const config = normalizeCheckinConfig(systemConfigCache['checkin_system']);
                const fieldMap = {
                    'cfgDailyCheckin': 'base_points',
                    'cfgCheckinStreakBonus': 'consecutive_7_points',
                    'cfgCheckinPerfectBonus': 'perfect_month_points',
                    'cfgCheckinMakeupCost': 'makeup_cost_points'
                };
                const normalizedValue = Math.max(0, toPointNumber(e.target.value, config[fieldMap[id]]));
                e.target.value = normalizedValue;
                config[fieldMap[id]] = normalizedValue;
                if (await saveConfig('checkin_system', config)) {
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

async function toggleCustomRechargeEntryStatus() {
    const config = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
    const toggleEl = document.getElementById('customRechargeStatusToggle');
    const nextValue = !config.custom_amount_enabled;

    config.custom_amount_enabled = nextValue;

    if (toggleEl) {
        toggleEl.classList.toggle('active', nextValue);
        toggleEl.style.transform = 'scale(1.1)';
        setTimeout(() => {
            toggleEl.style.transform = '';
        }, 150);
    }

    const success = await saveConfig('recharge_options', config);
    if (!success) {
        config.custom_amount_enabled = !nextValue;
        if (toggleEl) {
            toggleEl.classList.toggle('active', config.custom_amount_enabled);
        }
        return false;
    }

    showConfigSavedToast(nextValue ? '已开启自定义充值入口' : '已关闭自定义充值入口');
    return true;
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

    // Lockout duration dropdown (now shows minutes only)
    const lockoutDurationValue = document.getElementById('lockoutDurationValue');
    if (lockoutDurationValue) {
        const duration = config.lockout_duration || 900000;
        const minutes = Math.round(duration / 60000);
        lockoutDurationValue.textContent = minutes;
    }

    // Session timeout dropdown (now shows minutes only)
    const sessionTimeoutValue = document.getElementById('sessionTimeoutValue');
    if (sessionTimeoutValue) {
        const timeout = config.session_timeout || 3600000;
        const minutes = Math.round(timeout / 60000);
        sessionTimeoutValue.textContent = minutes;
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
    // Login lockout attempts - no auto-save, user will click save button
    // We removed the auto-save to require explicit save button click

    // Load locked accounts when security settings view is shown
    document.querySelectorAll('[data-settings-view="security"]').forEach(btn => {
        btn.addEventListener('click', () => {
            setTimeout(refreshLockedAccounts, 300);
        });
    });
}

// ============================================
// LOGIN SECURITY FUNCTIONS
// ============================================

// Save all login security settings at once
async function saveLoginSecuritySettings() {
    try {
        const lockoutInput = document.getElementById('cfgLoginLockoutAttempts');
        const lockoutDurationValue = document.getElementById('lockoutDurationValue');
        const sessionTimeoutValue = document.getElementById('sessionTimeoutValue');

        // Map display values (minutes) to milliseconds
        const durationMinutes = parseInt(lockoutDurationValue?.textContent) || 15;
        const timeoutMinutes = parseInt(sessionTimeoutValue?.textContent) || 60;

        const config = systemConfigCache['security'] || {};
        config.login_lockout_attempts = parseInt(lockoutInput?.value) || 5;
        config.lockout_duration = durationMinutes * 60 * 1000; // minutes to ms
        config.session_timeout = timeoutMinutes * 60 * 1000; // minutes to ms

        const success = await saveConfig('security', config);

        if (success) {
            const indicator = document.getElementById('loginSecuritySaveIndicator');
            if (indicator) {
                indicator.style.opacity = '1';
                setTimeout(() => indicator.style.opacity = '0', 2000);
            }
            if (typeof showToast === 'function') {
                showToast('登录安全设置已保存', 'success');
            }
        }
    } catch (err) {
        console.error('保存登录安全设置失败:', err);
        if (typeof showToast === 'function') {
            showToast('保存失败: ' + err.message, 'error');
        }
    }
}

// Refresh locked accounts list
async function refreshLockedAccounts() {
    const listEl = document.getElementById('lockedAccountsList');
    const badgeEl = document.getElementById('lockedCountBadge');
    const unlockAllBtn = document.getElementById('unlockAllBtn');
    const emptyMsg = document.getElementById('noLockedAccountsMsg');

    if (!listEl) return;

    try {
        // Query profiles with locked_until > now
        const { data: lockedAccounts, error } = await supabaseClient
            .from('profiles')
            .select('id, username, failed_login_attempts, locked_until')
            .gt('locked_until', new Date().toISOString())
            .order('locked_until', { ascending: false });

        if (error) throw error;

        // Get emails from auth.users via admin view
        let accountsWithEmail = lockedAccounts || [];

        // Try to get emails if admin view exists
        try {
            const { data: usersData } = await supabaseClient
                .from('admin_users_view')
                .select('id, email')
                .in('id', accountsWithEmail.map(a => a.id));

            if (usersData) {
                const emailMap = {};
                usersData.forEach(u => emailMap[u.id] = u.email);
                accountsWithEmail = accountsWithEmail.map(a => ({
                    ...a,
                    email: emailMap[a.id] || a.username || a.id.substring(0, 8) + '...'
                }));
            }
        } catch (e) {
            // Fallback to username if admin view not available
            accountsWithEmail = accountsWithEmail.map(a => ({
                ...a,
                email: a.username || a.id.substring(0, 8) + '...'
            }));
        }

        // Update badge
        if (badgeEl) {
            badgeEl.textContent = accountsWithEmail.length;
            badgeEl.style.display = accountsWithEmail.length > 0 ? 'inline-flex' : 'none';
        }

        // Update unlock all button
        if (unlockAllBtn) {
            unlockAllBtn.style.display = accountsWithEmail.length > 0 ? 'flex' : 'none';
        }

        // Render list
        if (accountsWithEmail.length === 0) {
            if (emptyMsg) emptyMsg.style.display = 'flex';
            // Remove any account items
            listEl.querySelectorAll('.locked-account-item').forEach(el => el.remove());
        } else {
            if (emptyMsg) emptyMsg.style.display = 'none';

            // Clear existing items
            listEl.querySelectorAll('.locked-account-item').forEach(el => el.remove());

            // Render locked accounts
            accountsWithEmail.forEach(account => {
                const expiresAt = new Date(account.locked_until);
                const now = new Date();
                const remainingMs = expiresAt - now;
                const remainingMins = Math.ceil(remainingMs / 60000);

                const itemHtml = `
                    <div class="locked-account-item" data-user-id="${account.id}">
                        <div class="locked-account-info">
                            <div class="locked-account-email">${escapeHtml(account.email)}</div>
                            <div class="locked-account-meta">
                                <span class="attempts">${account.failed_login_attempts} 次失败</span>
                                <span class="expires"><i class="fas fa-clock"></i> ${remainingMins} 分钟后解锁</span>
                            </div>
                        </div>
                        <button class="btn-unlock" onclick="unlockAccount('${account.id}')">
                            <i class="fas fa-unlock"></i> 解锁
                        </button>
                    </div>
                `;
                listEl.insertAdjacentHTML('beforeend', itemHtml);
            });
        }

    } catch (err) {
        console.error('加载锁定账户失败:', err);
        if (typeof showToast === 'function') {
            showToast('加载失败: ' + err.message, 'error');
        }
    }
}

// Unlock a single account
async function unlockAccount(userId) {
    try {
        // Use RPC to bypass RLS
        const { data, error } = await supabaseClient
            .rpc('admin_unlock_account', { target_user_id: userId });

        if (error) throw error;

        if (typeof showToast === 'function') {
            showToast('账户已解锁', 'success');
        }

        // Refresh list
        await refreshLockedAccounts();

    } catch (err) {
        console.error('解锁账户失败:', err);
        if (typeof showToast === 'function') {
            showToast('解锁失败: ' + err.message, 'error');
        }
    }
}

// Unlock all accounts
async function unlockAllAccounts() {
    if (!confirm('确定要解锁所有账户吗？')) return;

    try {
        // Use RPC to bypass RLS
        const { data, error } = await supabaseClient
            .rpc('admin_unlock_all_accounts');

        if (error) throw error;

        if (typeof showToast === 'function') {
            showToast(`已解锁 ${data || 0} 个账户`, 'success');
        }

        // Refresh list
        await refreshLockedAccounts();

    } catch (err) {
        console.error('批量解锁失败:', err);
        if (typeof showToast === 'function') {
            showToast('解锁失败: ' + err.message, 'error');
        }
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Expose to window
window.saveLoginSecuritySettings = saveLoginSecuritySettings;
window.refreshLockedAccounts = refreshLockedAccounts;
window.unlockAccount = unlockAccount;
window.unlockAllAccounts = unlockAllAccounts;

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
        announcement_size: 'medium',
        announcement_decoration: 'none',
        announcement_pages: ['all']
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

    // Decoration theme
    const savedDecoration = config.announcement_decoration || 'none';
    const decorationEnabled = document.getElementById('decorationEnabled');
    const decorationSelector = document.getElementById('decorationSelector');

    if (savedDecoration !== 'none' && decorationEnabled && decorationSelector) {
        decorationEnabled.checked = true;
        decorationSelector.classList.add('active');
        selectDecoration(savedDecoration);
    }

    // Page target selector - restore saved pages
    const savedPages = config.announcement_pages || ['all'];
    restorePageSelector(savedPages);

    // Update preview
    updateAnnouncementPreview();
}

function updateAnnouncementPreview() {
    const preview = document.getElementById('announcementPreview');
    if (!preview) return;

    const contentEl = document.getElementById('cfgAnnouncementContent');
    const typeRadio = document.querySelector('input[name="announcementType"]:checked');

    // For contenteditable div, use innerHTML; for textarea, use value
    const content = contentEl?.innerHTML || contentEl?.value || '在此预览公告效果...';
    const type = typeRadio?.value || 'banner';

    // Update preview content - target the new announcement-text element
    const textContent = document.getElementById('previewTextContent');
    if (textContent) {
        textContent.innerHTML = content || '在此预览公告效果...';
    }

    // Update type style (currently only modal style is truly supported in preview)
    preview.classList.remove('modal-style', 'toast-style');
    if (type === 'modal') {
        preview.classList.add('modal-style');
    } else if (type === 'toast') {
        preview.classList.add('toast-style');
    }
}

async function saveAnnouncement() {
    const contentEl = document.getElementById('cfgAnnouncementContent');
    const enabledEl = document.getElementById('cfgAnnouncementEnabled');
    const typeRadio = document.querySelector('input[name="announcementType"]:checked');

    if (!contentEl) return;

    const config = systemConfigCache['notifications'] || {};
    // For contenteditable div, use innerHTML
    config.announcement_content = contentEl.innerHTML || contentEl.value || '';
    config.announcement_enabled = enabledEl?.checked || false;
    config.announcement_type = typeRadio?.value || 'banner';
    // Save decoration theme
    config.announcement_decoration = getCurrentDecoration();
    // Save target pages
    config.announcement_pages = getSelectedPages();
    // Add timestamp so each publish generates a new ackKey
    config.announcement_updated_at = new Date().toISOString();

    const success = await saveConfig('notifications', config);

    // Get the save button
    const saveBtn = document.querySelector('.editor-actions .btn-primary');

    if (success && saveBtn) {
        if (typeof showToast === 'function') {
            showToast('公告已发布', 'success');
        } else {
            console.warn('showToast function not found');
        }
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

const AdminRichTextEditor = (() => {
    const instances = new Map();
    const richTextTagPattern = /<\/?(?:a|b|strong|i|em|u|div|p|br|font|span|ul|ol|li)\b/i;
    const defaultEmojis = ['🎉', '📢', '⚠️', '✨', '🔥', '💡', '🎁', '❤️', '👍', '🚀', '🌟', '💯'];
    const defaultColors = [
        { value: '#ffffff', label: '白色' },
        { value: '#ffeb3b', label: '黄色' },
        { value: '#ff9800', label: '橙色' },
        { value: '#4caf50', label: '绿色' },
        { value: '#e57373', label: '红色' },
        { value: '#6b9ece', label: '蓝色' }
    ];
    const defaultSizes = [
        { value: '2', label: '小', className: 'small' },
        { value: '3', label: '中', className: 'medium' },
        { value: '5', label: '大', className: 'large' }
    ];

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function getInstance(key = 'announcement') {
        return instances.get(key) || null;
    }

    function isEditorEmpty(editor) {
        if (!editor) return true;
        const text = (editor.textContent || '').replace(/\u00a0/g, ' ').trim();
        return !text && !editor.querySelector('img, video, iframe, a, font, b, i, u, strong, em');
    }

    function serializeEditorHtml(editor) {
        return isEditorEmpty(editor) ? '' : editor.innerHTML;
    }

    function normalizeStoredContent(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        if (richTextTagPattern.test(value)) return value;
        return escapeHtml(value).replace(/\n/g, '<br>');
    }

    function placeCursorAtEnd(editor) {
        if (!editor) return;
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function saveSelection(instance) {
        if (!instance?.editor) return;
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (instance.editor.contains(range.commonAncestorContainer)) {
            instance.selection = range.cloneRange();
        }
    }

    function restoreSelection(instance) {
        if (!instance?.editor) return;
        const selection = window.getSelection();
        if (!selection) return;

        selection.removeAllRanges();
        if (instance.selection) {
            selection.addRange(instance.selection);
            return;
        }

        placeCursorAtEnd(instance.editor);
    }

    function syncHiddenInput(instance, invokeCallback = true) {
        if (!instance) return;
        if (instance.hiddenInput) {
            instance.hiddenInput.value = serializeEditorHtml(instance.editor);
        }
        if (invokeCallback && typeof instance.onInput === 'function') {
            instance.onInput(instance);
        }
    }

    function closeDropdownElement(dropdown) {
        if (!dropdown) return;
        dropdown.querySelector('.dropdown-trigger, .toolbar-btn')?.classList.remove('active');
        dropdown.querySelector('.dropdown-menu')?.classList.remove('show');
    }

    function closeFloatingPanels(exceptKey = null, exceptDropdownId = null) {
        instances.forEach(instance => {
            if (instance.key !== exceptKey) {
                instance.emojiPicker?.classList.remove('active');
                instance.alignPicker?.classList.remove('active');
            }

            Object.values(instance.dropdowns || {}).forEach(dropdown => {
                if (!dropdown) return;
                if (dropdown.id === exceptDropdownId) return;
                closeDropdownElement(dropdown);
            });
        });
    }

    function bindToolbarMouseDown(instance) {
        if (!instance?.toolbarRoot) return;
        instance.toolbarRoot.querySelectorAll('button').forEach(button => {
            if (button.dataset.rteMouseBound === '1') return;
            button.dataset.rteMouseBound = '1';
            button.addEventListener('mousedown', (event) => {
                event.preventDefault();
            });
        });
    }

    function updateColorUI(instance, color) {
        if (!instance) return;
        if (instance.colorPreview) {
            instance.colorPreview.style.background = color;
        }
        const colorDropdown = instance.dropdowns?.color;
        colorDropdown?.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.colorOption === color);
        });
    }

    function updateSizeUI(instance, size, sizeClass) {
        if (!instance) return;
        if (instance.sizePreview) {
            instance.sizePreview.className = `size-indicator ${sizeClass}`;
        }
        const sizeDropdown = instance.dropdowns?.size;
        sizeDropdown?.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.sizeOption === size);
        });
    }

    function focusAndRestore(instance) {
        if (!instance?.editor) return false;
        instance.editor.focus();
        restoreSelection(instance);
        return true;
    }

    function execCommand(key, command, value = null) {
        const instance = getInstance(key);
        if (!focusAndRestore(instance)) return;

        document.execCommand(command, false, value);
        saveSelection(instance);
        syncHiddenInput(instance);
    }

    function createMarkup(config) {
        const colorItems = defaultColors.map(({ value, label }) => `
            <button type="button" class="dropdown-item${value === '#6b9ece' ? ' selected' : ''}"
                data-color-option="${value}"
                onclick="AdminRichTextEditor.selectColor('${config.key}', '${value}')">
                <span class="color-swatch" style="background:${value}"></span> ${label}
            </button>
        `).join('');

        const sizeItems = defaultSizes.map(({ value, label, className }) => `
            <button type="button" class="dropdown-item${value === '3' ? ' selected' : ''}"
                data-size-option="${value}"
                onclick="AdminRichTextEditor.selectFontSize('${config.key}', '${value}', '${className}')">
                <span class="size-indicator ${className}">A</span> ${label}
            </button>
        `).join('');

        const emojiItems = defaultEmojis.map(emoji => `
            <button type="button" class="emoji-item"
                onclick="AdminRichTextEditor.selectEmoji('${config.key}', '${emoji}')">${emoji}</button>
        `).join('');

        return `
            <div class="announcement-toolbar" id="${config.toolbarRootId}">
                <button type="button" class="toolbar-btn"
                    onclick="AdminRichTextEditor.insertFormat('${config.key}', 'b')" title="加粗">
                    <i class="fas fa-bold"></i>
                </button>
                <button type="button" class="toolbar-btn"
                    onclick="AdminRichTextEditor.insertFormat('${config.key}', 'i')" title="斜体">
                    <i class="fas fa-italic"></i>
                </button>
                <button type="button" class="toolbar-btn"
                    onclick="AdminRichTextEditor.insertFormat('${config.key}', 'u')" title="下划线">
                    <i class="fas fa-underline"></i>
                </button>
                <div class="align-picker-container">
                    <button type="button" class="toolbar-btn" id="${config.alignButtonId}"
                        onclick="AdminRichTextEditor.toggleAlignPicker('${config.key}')" title="对齐">
                        <i class="fas fa-align-center"></i>
                    </button>
                    <div class="align-picker" id="${config.alignPickerId}">
                        <button type="button" class="align-item"
                            onclick="AdminRichTextEditor.applyTextAlign('${config.key}', 'left')" title="左对齐">
                            <i class="fas fa-align-left"></i>
                        </button>
                        <button type="button" class="align-item"
                            onclick="AdminRichTextEditor.applyTextAlign('${config.key}', 'center')" title="居中">
                            <i class="fas fa-align-center"></i>
                        </button>
                        <button type="button" class="align-item"
                            onclick="AdminRichTextEditor.applyTextAlign('${config.key}', 'right')" title="右对齐">
                            <i class="fas fa-align-right"></i>
                        </button>
                    </div>
                </div>
                <div class="toolbar-divider"></div>
                <button type="button" class="toolbar-btn"
                    onclick="AdminRichTextEditor.insertLink('${config.key}')" title="链接">
                    <i class="fas fa-link"></i>
                </button>
                <div class="emoji-picker-container">
                    <button type="button" class="toolbar-btn" id="${config.emojiButtonId}"
                        onclick="AdminRichTextEditor.toggleEmojiPicker('${config.key}')" title="表情">
                        <i class="fas fa-smile"></i>
                    </button>
                    <div class="emoji-picker" id="${config.emojiPickerId}">
                        <div class="emoji-picker-header">表情</div>
                        <div class="emoji-grid">
                            ${emojiItems}
                        </div>
                    </div>
                </div>
                <div class="toolbar-dropdown" id="${config.colorDropdownId}">
                    <button type="button" class="toolbar-btn"
                        onclick="AdminRichTextEditor.toggleDropdown('${config.key}', 'color')" title="文字颜色">
                        <span class="color-swatch preview" id="${config.colorPreviewId}"
                            style="background:#6b9ece"></span>
                    </button>
                    <div class="dropdown-menu">
                        ${colorItems}
                    </div>
                </div>
                <div class="toolbar-dropdown" id="${config.sizeDropdownId}">
                    <button type="button" class="toolbar-btn"
                        onclick="AdminRichTextEditor.toggleDropdown('${config.key}', 'size')" title="字号">
                        <span class="size-indicator medium" id="${config.sizePreviewId}">A</span>
                    </button>
                    <div class="dropdown-menu">
                        ${sizeItems}
                    </div>
                </div>
            </div>
            <div class="wysiwyg-editor" id="${config.editorId}" contenteditable="true"
                data-placeholder="${escapeHtml(config.placeholder || '请输入内容...')}"></div>
        `;
    }

    function register(config) {
        if (!config?.key || !config.editorId) return null;

        const existing = getInstance(config.key);
        if (existing) {
            Object.assign(existing, config);
            return existing;
        }

        const instance = {
            ...config,
            editor: document.getElementById(config.editorId),
            hiddenInput: config.hiddenInputId ? document.getElementById(config.hiddenInputId) : null,
            toolbarRoot: config.toolbarRootId ? document.getElementById(config.toolbarRootId) : null,
            emojiPicker: config.emojiPickerId ? document.getElementById(config.emojiPickerId) : null,
            emojiButton: config.emojiButtonId ? document.getElementById(config.emojiButtonId) : null,
            alignPicker: config.alignPickerId ? document.getElementById(config.alignPickerId) : null,
            alignButton: config.alignButtonId ? document.getElementById(config.alignButtonId) : null,
            colorPreview: config.colorPreviewId ? document.getElementById(config.colorPreviewId) : null,
            sizePreview: config.sizePreviewId ? document.getElementById(config.sizePreviewId) : null,
            dropdowns: {
                color: config.colorDropdownId ? document.getElementById(config.colorDropdownId) : null,
                size: config.sizeDropdownId ? document.getElementById(config.sizeDropdownId) : null
            },
            selection: null
        };

        if (!instance.editor) return null;

        if (instance.hiddenInput) {
            instance.hiddenInput.style.display = 'none';
        }

        bindToolbarMouseDown(instance);

        instance.editor.addEventListener('input', () => {
            saveSelection(instance);
            syncHiddenInput(instance);
        });

        ['mouseup', 'keyup', 'focus'].forEach(eventName => {
            instance.editor.addEventListener(eventName, () => saveSelection(instance));
        });

        instance.editor.addEventListener('blur', () => {
            setTimeout(() => saveSelection(instance), 0);
        });

        instances.set(instance.key, instance);

        if (instance.hiddenInput && !serializeEditorHtml(instance.editor) && instance.hiddenInput.value) {
            setContent(instance.key, instance.hiddenInput.value, { syncHiddenInput: false });
        }

        return instance;
    }

    function ensureInjectedEditor(config) {
        if (!config?.key || !config.hiddenInputId) return null;

        const hiddenInput = document.getElementById(config.hiddenInputId);
        if (!hiddenInput) return null;

        if (!document.getElementById(config.editorId)) {
            const shell = document.createElement('div');
            shell.className = 'rich-text-editor-shell';
            shell.innerHTML = createMarkup(config);
            hiddenInput.parentNode.insertBefore(shell, hiddenInput);
        }

        return register(config);
    }

    function setContent(key, value, options = {}) {
        const instance = getInstance(key);
        if (!instance?.editor) return;

        instance.editor.innerHTML = normalizeStoredContent(value || '');
        instance.selection = null;

        if (!options.syncHiddenInput && instance.hiddenInput && typeof value === 'string') {
            instance.hiddenInput.value = value;
        }

        if (options.syncHiddenInput) {
            syncHiddenInput(instance, options.invokeCallback !== false);
        } else if (typeof instance.onRender === 'function') {
            instance.onRender(instance);
        }
    }

    function togglePicker(key, pickerType) {
        const instance = getInstance(key);
        const picker = pickerType === 'emoji' ? instance?.emojiPicker : instance?.alignPicker;
        if (!picker) return;

        const shouldOpen = !picker.classList.contains('active');
        closeFloatingPanels(shouldOpen ? key : null);
        picker.classList.toggle('active', shouldOpen);
    }

    function toggleDropdown(key, dropdownType) {
        const instance = getInstance(key);
        const dropdown = instance?.dropdowns?.[dropdownType];
        if (!dropdown) return;

        const trigger = dropdown.querySelector('.dropdown-trigger, .toolbar-btn');
        const menu = dropdown.querySelector('.dropdown-menu');
        const shouldOpen = !menu?.classList.contains('show');

        closeFloatingPanels(shouldOpen ? key : null, shouldOpen ? dropdown.id : null);
        trigger?.classList.toggle('active', shouldOpen);
        menu?.classList.toggle('show', shouldOpen);
    }

    return {
        register,
        ensureInjectedEditor,
        setContent,
        getContent(key) {
            const instance = getInstance(key);
            return instance?.editor ? serializeEditorHtml(instance.editor) : '';
        },
        syncHiddenInput(key, invokeCallback = true) {
            syncHiddenInput(getInstance(key), invokeCallback);
        },
        insertFormat(key, tag) {
            execCommand(key, tag === 'b' ? 'bold' : tag === 'i' ? 'italic' : 'underline');
        },
        applyTextAlign(key, align) {
            const commands = {
                left: 'justifyLeft',
                center: 'justifyCenter',
                right: 'justifyRight'
            };
            execCommand(key, commands[align] || 'justifyCenter');
            getInstance(key)?.alignPicker?.classList.remove('active');
        },
        toggleAlignPicker(key) {
            togglePicker(key, 'align');
        },
        insertLink(key) {
            let url = prompt('请输入链接地址:', 'https://');
            if (!url) return;
            url = url.trim();
            if (!url || url === 'https://') return;
            if (!/^https?:\/\//i.test(url)) {
                url = `https://${url.replace(/^\/+/, '')}`;
            }
            execCommand(key, 'createLink', url);
        },
        selectEmoji(key, emoji) {
            execCommand(key, 'insertText', emoji);
            getInstance(key)?.emojiPicker?.classList.remove('active');
        },
        toggleEmojiPicker(key) {
            togglePicker(key, 'emoji');
        },
        toggleDropdown,
        selectColor(key, color) {
            execCommand(key, 'foreColor', color);
            const instance = getInstance(key);
            updateColorUI(instance, color);
            closeDropdownElement(instance?.dropdowns?.color);
        },
        selectFontSize(key, size, sizeClass) {
            execCommand(key, 'fontSize', size);
            const instance = getInstance(key);
            updateSizeUI(instance, size, sizeClass);
            closeDropdownElement(instance?.dropdowns?.size);
        }
    };
})();

window.AdminRichTextEditor = AdminRichTextEditor;

AdminRichTextEditor.register({
    key: 'announcement',
    editorId: 'cfgAnnouncementContent',
    toolbarRootId: 'announcementToolbar',
    emojiPickerId: 'emojiPicker',
    emojiButtonId: 'emojiPickerBtn',
    alignPickerId: 'alignPicker',
    alignButtonId: 'alignPickerBtn',
    colorDropdownId: 'colorDropdown',
    colorPreviewId: 'colorPreview',
    sizeDropdownId: 'sizeDropdown',
    sizePreviewId: 'sizePreview',
    onInput: () => updateAnnouncementPreview()
});

function insertFormat(tag) {
    AdminRichTextEditor.insertFormat('announcement', tag);
}

function applyTextColor(color) {
    if (!color) return;
    AdminRichTextEditor.selectColor('announcement', color);
}

function applyTextSize(size) {
    if (!size) return;
    const sizeClass = size === '2' ? 'small' : size === '5' ? 'large' : 'medium';
    AdminRichTextEditor.selectFontSize('announcement', size, sizeClass);
}

function applyTextAlign(align) {
    AdminRichTextEditor.applyTextAlign('announcement', align);
}

function toggleAlignPicker() {
    AdminRichTextEditor.toggleAlignPicker('announcement');
}

function insertLink() {
    AdminRichTextEditor.insertLink('announcement');
}

function selectEmoji(emoji) {
    AdminRichTextEditor.selectEmoji('announcement', emoji);
}

function toggleEmojiPicker() {
    AdminRichTextEditor.toggleEmojiPicker('announcement');
}

// ============================================
// CUSTOM DROPDOWN FUNCTIONS
// ============================================

function toggleDropdown(dropdownId) {
    if (dropdownId === 'colorDropdown') {
        AdminRichTextEditor.toggleDropdown('announcement', 'color');
        return;
    }
    if (dropdownId === 'sizeDropdown') {
        AdminRichTextEditor.toggleDropdown('announcement', 'size');
        return;
    }

    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const trigger = dropdown.querySelector('.dropdown-trigger, .toolbar-btn');
    const menu = dropdown.querySelector('.dropdown-menu');
    const shouldOpen = !menu?.classList.contains('show');

    document.querySelectorAll('.custom-dropdown, .toolbar-dropdown').forEach(dd => {
        if (dd.id !== dropdownId) {
            dd.querySelector('.dropdown-trigger, .toolbar-btn')?.classList.remove('active');
            dd.querySelector('.dropdown-menu')?.classList.remove('show');
        }
    });

    trigger?.classList.toggle('active', shouldOpen);
    menu?.classList.toggle('show', shouldOpen);
}

function selectColor(color) {
    AdminRichTextEditor.selectColor('announcement', color);
}

function selectFontSize(size, sizeClass) {
    AdminRichTextEditor.selectFontSize('announcement', size, sizeClass);
}

document.addEventListener('click', (e) => {
    document.querySelectorAll('.emoji-picker-container').forEach(container => {
        const picker = container.querySelector('.emoji-picker');
        const btn = container.querySelector('.toolbar-btn');
        if (picker && btn && !picker.contains(e.target) && !btn.contains(e.target)) {
            picker.classList.remove('active');
        }
    });

    document.querySelectorAll('.align-picker-container').forEach(container => {
        const picker = container.querySelector('.align-picker');
        const btn = container.querySelector('.toolbar-btn');
        if (picker && btn && !picker.contains(e.target) && !btn.contains(e.target)) {
            picker.classList.remove('active');
        }
    });

    document.querySelectorAll('.custom-dropdown, .toolbar-dropdown').forEach(dropdown => {
        if (!dropdown.contains(e.target)) {
            dropdown.querySelector('.dropdown-trigger, .toolbar-btn')?.classList.remove('active');
            dropdown.querySelector('.dropdown-menu')?.classList.remove('show');
        }
    });
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

function renderGalleryConfig() {
    const config = systemConfigCache['gallery'] || {
        items_per_page: 24,
        default_sort: 'newest'
    };

    // Per page dropdown
    const perPageValue = document.getElementById('perPageValue');
    if (perPageValue) perPageValue.textContent = config.items_per_page || 24;

    // Default sort dropdown
    const sortValue = document.getElementById('defaultSortValue');
    const sortLabels = { newest: '最新', popular: '最热', random: '随机' };
    if (sortValue) sortValue.textContent = sortLabels[config.default_sort] || '最新';
}

function renderCommentRulesConfig() {
    const config = systemConfigCache['comments'] || {
        allow_anonymous: false,
        max_comment_length: 500,
        max_nesting_level: 3
    };

    // Allow anonymous toggle
    const allowAnonymous = document.getElementById('cfgAllowAnonymous');
    if (allowAnonymous) allowAnonymous.checked = config.allow_anonymous || false;

    // Max comment length
    const maxLength = document.getElementById('cfgMaxCommentLength');
    if (maxLength) maxLength.value = config.max_comment_length || 500;

    // Max nesting level
    const maxNesting = document.getElementById('cfgMaxNestingLevel');
    if (maxNesting) maxNesting.value = config.max_nesting_level || 3;
}

// ============================================
// VERIFICATION SERVICE CONFIG
// ============================================

function renderVerifyConfig() {
    const config = systemConfigCache['verify_settings'] || {
        price_per_verify: 10,
        enabled: true,
        verify_api_key: ''
    };

    // Price input
    const priceInput = document.getElementById('cfgVerifyPrice');
    if (priceInput) priceInput.value = config.price_per_verify || 10;

    // Enabled toggle
    const enabledToggle = document.getElementById('cfgVerifyEnabled');
    if (enabledToggle) enabledToggle.checked = config.enabled !== false;

    // API Key (show masked for security)
    const apiKeyInput = document.getElementById('cfgVerifyApiKey');
    if (apiKeyInput && config.verify_api_key) {
        // Show first 8 chars + masked rest
        const key = config.verify_api_key;
        apiKeyInput.value = key.length > 8 ? key.slice(0, 8) + '...' : key;
        apiKeyInput.dataset.hasKey = 'true';
    }

    // Auto-load API quota
    checkVerifyQuota();
}

async function saveVerifyConfig() {
    const priceInput = document.getElementById('cfgVerifyPrice');
    const enabledToggle = document.getElementById('cfgVerifyEnabled');
    const apiKeyInput = document.getElementById('cfgVerifyApiKey');

    const config = systemConfigCache['verify_settings'] || {};

    // Update price
    if (priceInput) {
        config.price_per_verify = parseInt(priceInput.value) || 10;
    }

    // Update enabled
    if (enabledToggle) {
        config.enabled = enabledToggle.checked;
    }

    // Update API key only if it was changed (not masked)
    if (apiKeyInput && !apiKeyInput.value.includes('...')) {
        const newKey = apiKeyInput.value.trim();
        if (newKey) {
            config.verify_api_key = newKey;
        }
    }

    const success = await saveConfig('verify_settings', config);

    if (success && typeof showToast === 'function') {
        showToast('Google One API 配置已保存', 'success');
    }

    // Update cache
    systemConfigCache['verify_settings'] = config;
}

// Expose globally for HTML onclick handlers
window.saveVerifyConfig = saveVerifyConfig;

const VERIFY_SERVER_URL = window.VERIFY_SERVER_URL || 'https://zaoyoe-verify-server-production.up.railway.app';

async function checkVerifyQuota() {
    const quotaEl = document.getElementById('cfgVerifyQuota');
    if (!quotaEl) return;

    quotaEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 查询中...';

    try {
        const res = await fetch(`${VERIFY_SERVER_URL}/api/quota`);
        const data = await res.json();

        if (data.success) {
            const balance = Number(data.balance ?? data.credits ?? 0);
            const color = balance > 5 ? '#27ae60' : balance > 0 ? '#f39c12' : '#e74c3c';
            const display = Number.isInteger(balance) ? balance : balance.toFixed(1);
            quotaEl.innerHTML = `<i class="fas fa-gem" style="color: ${color};"></i> <strong style="color: ${color};">${display}</strong>`;
        } else {
            quotaEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="color: #e74c3c;"></i> ${data.message || '查询失败'}`;
        }
    } catch (e) {
        quotaEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #e74c3c;"></i> 网络错误';
    }
}

window.checkVerifyQuota = checkVerifyQuota;

async function saveSensitiveWords() {
    const textarea = document.getElementById('cfgSensitiveWords');
    if (!textarea) return;

    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
    const config = systemConfigCache['moderation'] || {};
    config.sensitive_words = lines;

    const success = await saveConfig('moderation', config);

    if (success && typeof showToast === 'function') {
        showToast('敏感词列表已保存', 'success');
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

    // Gallery settings
    setupGalleryEventListeners();

    // Comment rules
    setupCommentRulesEventListeners();
}

// ============================================
// GALLERY SETTINGS
// ============================================

function loadGallerySettings(config) {
    // Per page dropdown
    const perPageValue = document.getElementById('perPageValue');
    if (perPageValue && config.items_per_page) {
        perPageValue.textContent = config.items_per_page;
    }
}

function setupGalleryEventListeners() {
    // Gallery settings are saved via dropdown selection override
    // No additional event listeners needed for now
}

// Override dropdown selection to save gallery settings
const originalSelectDropdownOption = window.selectDropdownOption;
window.selectDropdownOption = function (dropdownId, value, displayText) {
    // Call original
    if (typeof originalSelectDropdownOption === 'function') {
        originalSelectDropdownOption(dropdownId, value, displayText);
    }

    // Handle gallery dropdowns
    if (dropdownId === 'perPageDropdown') {
        const config = systemConfigCache['gallery'] || {};
        config.items_per_page = parseInt(value);
        saveConfig('gallery', config);
    } else if (dropdownId === 'defaultSortDropdown') {
        const config = systemConfigCache['gallery'] || {};
        config.default_sort = value;
        saveConfig('gallery', config);
    }
};

// ============================================
// COMMENT RULES
// ============================================

function loadCommentRules(config) {
    // Allow anonymous toggle
    const allowAnonymous = document.getElementById('cfgAllowAnonymous');
    if (allowAnonymous) allowAnonymous.checked = config.allow_anonymous || false;

    // Max comment length
    const maxLength = document.getElementById('cfgMaxCommentLength');
    if (maxLength) maxLength.value = config.max_comment_length || 500;

    // Max nesting level
    const maxNesting = document.getElementById('cfgMaxNestingLevel');
    if (maxNesting) maxNesting.value = config.max_nesting_level || 3;
}

function setupCommentRulesEventListeners() {
    // Allow anonymous toggle
    const allowAnonymous = document.getElementById('cfgAllowAnonymous');
    if (allowAnonymous) {
        allowAnonymous.addEventListener('change', async (e) => {
            const config = systemConfigCache['comments'] || {};
            config.allow_anonymous = e.target.checked;
            await saveConfig('comments', config);
        });
    }

    // Max comment length
    const maxLength = document.getElementById('cfgMaxCommentLength');
    if (maxLength) {
        maxLength.addEventListener('change', async (e) => {
            const config = systemConfigCache['comments'] || {};
            config.max_comment_length = parseInt(e.target.value) || 500;
            await saveConfig('comments', config);
        });
    }

    // Max nesting level
    const maxNesting = document.getElementById('cfgMaxNestingLevel');
    if (maxNesting) {
        maxNesting.addEventListener('change', async (e) => {
            const config = systemConfigCache['comments'] || {};
            config.max_nesting_level = parseInt(e.target.value) || 3;
            await saveConfig('comments', config);
        });
    }
}

// ============================================
// DECORATION SYSTEM
// ============================================

let currentDecoration = 'none';

function toggleDecoration() {
    const checkbox = document.getElementById('decorationEnabled');
    const selector = document.getElementById('decorationSelector');

    if (checkbox && selector) {
        if (checkbox.checked) {
            selector.classList.add('active');
        } else {
            selector.classList.remove('active');
            // Clear decoration when disabled
            selectDecoration('none');
        }
    }
}

function selectDecoration(theme) {
    currentDecoration = theme;

    // Update button states
    document.querySelectorAll('.decoration-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.decoration === theme);
    });

    // Apply decoration to preview
    applyDecorationToPreview(theme);
}

// Apply decoration to preview stage
function applyDecorationToPreview(theme) {
    const preview = document.getElementById('announcementPreview');
    if (!preview) return;

    // Remove existing particles container
    const existingParticles = preview.querySelector('.decoration-particles');
    if (existingParticles) {
        existingParticles.remove();
    }

    // Remove existing heart container (specific to hearts theme)
    const existingHearts = preview.querySelectorAll('.heart-container');
    existingHearts.forEach(h => h.remove());

    // If no decoration selected, exit
    if (theme === 'none') {
        // Also ensure any running particle system is stopped
        if (window.stopContinuousParticles) {
            window.stopContinuousParticles();
        }
        return;
    }

    // Use the shared generator from prompts-poetry.js
    if (window.generateDecorationParticles) {
        // Insert HTML
        preview.insertAdjacentHTML('afterbegin', window.generateDecorationParticles(theme));

        // Start animation based on theme
        if (theme === 'hearts') {
            if (window.startHeartFloat) {
                // Ensure the hearts are positioned relative to the preview container
                window.startHeartFloat(preview);
            }
        } else {
            // Only use active JS ParticleSystem for complex physics themes
            // Sakura and Leaves use the CSS-based particles we generated
            const activePhysicsThemes = ['snow', 'rain', 'fireworks'];

            if (activePhysicsThemes.includes(theme)) {
                const particleContainer = preview.querySelector('.decoration-particles');
                if (particleContainer && window.startContinuousParticles) {
                    // Slight delay to ensure DOM is rendered and dimensions are available
                    setTimeout(() => {
                        window.startContinuousParticles(particleContainer, theme);
                    }, 50);
                }
            }
        }
    } else {
        console.warn('generateDecorationParticles not found. Ensure prompts-poetry.js is loaded.');
    }
}

// Get current decoration for saving
function getCurrentDecoration() {
    const checkbox = document.getElementById('decorationEnabled');
    if (!checkbox || !checkbox.checked) return 'none';
    return currentDecoration;
}

// ============================================
// PAGE TARGET SELECTOR FUNCTIONS
// ============================================

// Toggle page target selection
function togglePageTarget(page) {
    const selector = document.getElementById('pageTargetSelector');
    if (!selector) return;

    const allBtn = selector.querySelector('[data-page="all"]');
    const pageBtns = selector.querySelectorAll('[data-page]:not([data-page="all"])');
    const clickedBtn = selector.querySelector(`[data-page="${page}"]`);

    if (page === 'all') {
        // Toggle "all" - if clicking "all", select only "all" and deselect others
        if (allBtn.classList.contains('active')) {
            // Already selected, do nothing (must have at least one page)
            return;
        }
        // Select "all", deselect individual pages
        allBtn.classList.add('active');
        pageBtns.forEach(btn => btn.classList.remove('active'));
    } else {
        // Toggle individual page
        clickedBtn.classList.toggle('active');

        // If any individual page is selected, deselect "all"
        const anyPageSelected = Array.from(pageBtns).some(btn => btn.classList.contains('active'));
        if (anyPageSelected) {
            allBtn.classList.remove('active');
        } else {
            // No individual pages selected, auto-select "all"
            allBtn.classList.add('active');
        }

        // If all individual pages are selected, switch to "all"
        const allPagesSelected = Array.from(pageBtns).every(btn => btn.classList.contains('active'));
        if (allPagesSelected) {
            allBtn.classList.add('active');
            pageBtns.forEach(btn => btn.classList.remove('active'));
        }
    }
}

// Get selected pages from UI
function getSelectedPages() {
    const selector = document.getElementById('pageTargetSelector');
    if (!selector) return ['all'];

    const allBtn = selector.querySelector('[data-page="all"]');
    if (allBtn && allBtn.classList.contains('active')) {
        return ['all'];
    }

    const selectedPages = [];
    selector.querySelectorAll('[data-page]:not([data-page="all"])').forEach(btn => {
        if (btn.classList.contains('active')) {
            selectedPages.push(btn.dataset.page);
        }
    });

    return selectedPages.length > 0 ? selectedPages : ['all'];
}

// Restore page selector state from saved config
function restorePageSelector(pages) {
    const selector = document.getElementById('pageTargetSelector');
    if (!selector) return;

    // Clear all active states
    selector.querySelectorAll('.page-btn').forEach(btn => btn.classList.remove('active'));

    if (!pages || pages.length === 0 || pages.includes('all')) {
        // Select "all" button
        const allBtn = selector.querySelector('[data-page="all"]');
        if (allBtn) allBtn.classList.add('active');
    } else {
        // Select individual pages
        pages.forEach(page => {
            const btn = selector.querySelector(`[data-page="${page}"]`);
            if (btn) btn.classList.add('active');
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
window.toggleCustomRechargeEntryStatus = toggleCustomRechargeEntryStatus;
window.deleteChannel = deleteChannel;
window.addChannel = addChannel;
window.saveIpBlacklist = saveIpBlacklist;
window.saveAnnouncement = saveAnnouncement;
window.saveSensitiveWords = saveSensitiveWords;
window.toggleDecoration = toggleDecoration;
window.selectDecoration = selectDecoration;
window.togglePageTarget = togglePageTarget;
window.loadAffiliateSettings = loadAffiliateSettings;
window.saveAffiliateSetting = saveAffiliateSetting;
window.saveAffiliatePosterField = saveAffiliatePosterField;
window.selectAffiliatePosterTemplate = selectAffiliatePosterTemplate;
window.handleAffiliatePosterUpload = handleAffiliatePosterUpload;
window.resetAffiliatePosterBackground = resetAffiliatePosterBackground;
