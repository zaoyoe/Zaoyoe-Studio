/**
 * Homepage Content Management Module
 * 主页内容管理 - Admin Studio
 */

const HomepageAdmin = (() => {
    // ============================================
    // STATE
    // ============================================
    let configCache = {};  // { section: { id, content, is_visible, display_order, updated_at } }
    let currentSection = 'hero';
    let initialized = false;

    // ============================================
    // INIT
    // ============================================

    async function init() {
        if (initialized) {
            // Just re-render from cache
            renderCurrentSection();
            return;
        }

        console.log('[Homepage] Initializing homepage config module...');

        try {
            await loadAllConfig();
            setupEventListeners();
            initialized = true;

            // Hide loading, show content
            const loading = document.getElementById('hp-loading');
            const content = document.getElementById('hp-section-content');
            if (loading) loading.style.display = 'none';
            if (content) content.style.display = 'block';

            console.log('[Homepage] Initialized successfully');
        } catch (err) {
            console.error('[Homepage] Init error:', err);
            const loading = document.getElementById('hp-loading');
            if (loading) {
                loading.innerHTML = `
                    <i class="fas fa-exclamation-triangle" style="font-size: 24px; margin-bottom: 12px; color: #f59e0b;"></i>
                    <div>加载失败: ${err.message}</div>
                    <button class="btn-sm btn-primary" style="margin-top: 16px;" onclick="HomepageAdmin.init()">
                        <i class="fas fa-redo"></i> 重试
                    </button>
                `;
            }
        }
    }

    // ============================================
    // DATA LOADING
    // ============================================

    async function loadAllConfig() {
        const { data, error } = await supabaseClient
            .from('homepage_config')
            .select('*')
            .order('display_order', { ascending: true });

        if (error) throw error;

        configCache = {};
        (data || []).forEach(row => {
            configCache[row.section] = {
                id: row.id,
                content: row.content || {},
                is_visible: row.is_visible,
                display_order: row.display_order,
                updated_at: row.updated_at
            };
        });

        console.log('[Homepage] Loaded config for sections:', Object.keys(configCache));

        // Render all sections
        renderAllSections();
    }

    // ============================================
    // RENDER
    // ============================================

    function renderAllSections() {
        ['hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker'].forEach(section => {
            renderSection(section);
        });
    }

    function renderCurrentSection() {
        renderSection(currentSection);
    }

    function renderSection(section) {
        const cfg = configCache[section];
        if (!cfg) return;

        const content = cfg.content || {};

        // Common controls
        setToggle(`hp-${section}-visible`, cfg.is_visible);
        setInputValue(`hp-${section}-order`, cfg.display_order);

        // Auto aggregation toggle
        setToggle(`hp-${section}-auto`, content.enable_auto);

        // Updated timestamp
        const updatedEl = document.getElementById(`hp-${section}-updated`);
        if (updatedEl && cfg.updated_at) {
            const date = new Date(cfg.updated_at);
            updatedEl.textContent = `最后更新: ${date.toLocaleString('zh-CN')}`;
        }

        // Section-specific fields
        switch (section) {
            case 'hero':
                setInputValue('hp-hero-title', content.title);
                setInputValue('hp-hero-subtitle', content.subtitle);
                break;

            case 'prompts':
                setInputValue('hp-prompts-title', content.section_title);
                setInputValue('hp-prompts-subtitle', content.section_subtitle);
                setInputValue('hp-prompts-max', content.max_items);
                setSelectValue('hp-prompts-sort', content.sort);
                break;

            case 'shop':
                setInputValue('hp-shop-title', content.section_title);
                setInputValue('hp-shop-subtitle', content.section_subtitle);
                setInputValue('hp-shop-max', content.max_items);
                setSelectValue('hp-shop-category', content.category);
                setSelectValue('hp-shop-sort', content.sort);
                break;

            case 'verify':
                setInputValue('hp-verify-title', content.section_title);
                setInputValue('hp-verify-subtitle', content.section_subtitle);
                setInputValue('hp-verify-screenshot', content.screenshot_path);
                setInputValue('hp-verify-features', (content.features || []).join(', '));
                break;

            case 'guestbook':
                setInputValue('hp-guestbook-title', content.section_title);
                setInputValue('hp-guestbook-subtitle', content.section_subtitle);
                setInputValue('hp-guestbook-max', content.max_items);
                break;

            case 'ticker':
                setInputValue('hp-ticker-speed', content.speed);
                const speedLabel = document.getElementById('hp-ticker-speed-label');
                if (speedLabel) speedLabel.textContent = content.speed || 30;
                setInputValue('hp-ticker-shop-speed', content.shop_scroll_speed);
                const shopSpeedLabel = document.getElementById('hp-ticker-shop-speed-label');
                if (shopSpeedLabel) shopSpeedLabel.textContent = content.shop_scroll_speed || 30;
                setToggle('hp-ticker-prompts', content.enable_prompts);
                setToggle('hp-ticker-products', content.enable_products);
                break;
        }
    }

    // ============================================
    // SAVE
    // ============================================

    async function saveSection(section) {
        const cfg = configCache[section];
        if (!cfg) {
            console.warn('[Homepage] No config found for section:', section);
            return;
        }

        // Show translating status on save button
        const saveBtn = document.querySelector(`.hp-section-view[data-hp-view="${section}"] .btn-primary`);
        const originalBtnText = saveBtn ? saveBtn.innerHTML : '';
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-language"></i> 翻译中...';
        }

        // Collect updated values
        cfg.is_visible = getToggleState(`hp-${section}-visible`);
        cfg.display_order = parseInt(getInputValue(`hp-${section}-order`)) || 0;

        // Update content based on section
        const content = cfg.content || {};
        content.enable_auto = getToggleState(`hp-${section}-auto`);

        switch (section) {
            case 'hero':
                content.title = getInputValue('hp-hero-title');
                content.subtitle = getInputValue('hp-hero-subtitle');
                // Auto-translate bilingual fields
                await autoTranslatePair(content, 'title');
                await autoTranslatePair(content, 'subtitle');
                break;

            case 'prompts':
                content.section_title = getInputValue('hp-prompts-title');
                content.section_subtitle = getInputValue('hp-prompts-subtitle');
                content.max_items = parseInt(getInputValue('hp-prompts-max')) || 6;
                content.sort = getSelectValue('hp-prompts-sort');
                await autoTranslatePair(content, 'section_title');
                await autoTranslatePair(content, 'section_subtitle');
                break;

            case 'shop':
                content.section_title = getInputValue('hp-shop-title');
                content.section_subtitle = getInputValue('hp-shop-subtitle');
                content.max_items = parseInt(getInputValue('hp-shop-max')) || 8;
                content.category = getSelectValue('hp-shop-category');
                content.sort = getSelectValue('hp-shop-sort');
                await autoTranslatePair(content, 'section_title');
                await autoTranslatePair(content, 'section_subtitle');
                break;

            case 'verify':
                content.section_title = getInputValue('hp-verify-title');
                content.section_subtitle = getInputValue('hp-verify-subtitle');
                content.screenshot_path = getInputValue('hp-verify-screenshot');
                const featuresStr = getInputValue('hp-verify-features');
                content.features = featuresStr
                    ? featuresStr.split(',').map(s => s.trim()).filter(Boolean)
                    : [];
                await autoTranslatePair(content, 'section_title');
                await autoTranslatePair(content, 'section_subtitle');
                break;

            case 'guestbook':
                content.section_title = getInputValue('hp-guestbook-title');
                content.section_subtitle = getInputValue('hp-guestbook-subtitle');
                content.max_items = parseInt(getInputValue('hp-guestbook-max')) || 5;
                await autoTranslatePair(content, 'section_title');
                await autoTranslatePair(content, 'section_subtitle');
                break;

            case 'ticker':
                content.speed = parseInt(getInputValue('hp-ticker-speed')) || 30;
                content.shop_scroll_speed = parseInt(getInputValue('hp-ticker-shop-speed')) || 30;
                content.enable_prompts = getToggleState('hp-ticker-prompts');
                content.enable_products = getToggleState('hp-ticker-products');
                break;
        }

        cfg.content = content;

        // Save to database
        try {
            const { error } = await supabaseClient
                .from('homepage_config')
                .update({
                    content: content,
                    is_visible: cfg.is_visible,
                    display_order: cfg.display_order
                })
                .eq('section', section);

            if (error) throw error;

            // Update timestamp
            cfg.updated_at = new Date().toISOString();
            const updatedEl = document.getElementById(`hp-${section}-updated`);
            if (updatedEl) {
                updatedEl.textContent = `最后更新: ${new Date().toLocaleString('zh-CN')}`;
            }

            // Show save indicator
            const indicator = document.getElementById(`hp-${section}-save-indicator`);
            if (indicator) {
                indicator.style.opacity = '1';
                setTimeout(() => indicator.style.opacity = '0', 2000);
            }

            // Invalidate homepage_config cache so homepage reflects changes immediately
            // Note: cache.js is NOT loaded in admin-studio, so we directly remove the localStorage key
            // using the same key format as cache.js: zaoyoe_cache_{version}_{key}
            try {
                localStorage.removeItem('zaoyoe_cache_v1_homepage_config');
                console.log('[Homepage] Invalidated homepage_config cache (direct localStorage)');
            } catch (e) {
                console.warn('[Homepage] Failed to invalidate cache:', e);
            }

            if (typeof showToast === 'function') {
                showToast('保存成功', 'success');
            }

            console.log(`[Homepage] Section "${section}" saved successfully`);
        } catch (err) {
            console.error(`[Homepage] Save error for "${section}":`, err);
            if (typeof showToast === 'function') {
                showToast('保存失败: ' + err.message, 'error');
            }
        } finally {
            // Restore save button
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalBtnText;
            }
        }
    }

    // ============================================
    // TAB SWITCHING
    // ============================================

    function switchSection(section) {
        currentSection = section;

        // Update tab active state
        const tabNav = document.getElementById('homepageTabsNav');
        if (tabNav) {
            tabNav.querySelectorAll('.admin-tab').forEach(tab => {
                tab.classList.toggle('active', tab.getAttribute('data-hp-section') === section);
            });

            // Move tab indicator
            const activeTab = tabNav.querySelector(`.admin-tab[data-hp-section="${section}"]`);
            const indicator = tabNav.querySelector('.admin-tab-indicator');
            if (activeTab && indicator) {
                indicator.style.left = activeTab.offsetLeft + 'px';
                indicator.style.width = activeTab.offsetWidth + 'px';
            }
        }

        // Show/hide section views
        document.querySelectorAll('.hp-section-view').forEach(view => {
            const isActive = view.getAttribute('data-hp-view') === section;
            view.classList.toggle('active', isActive);
            view.style.display = isActive ? 'block' : 'none';
        });
    }

    // ============================================
    // AUTO-TRANSLATE HELPER
    // ============================================

    /**
     * Auto-translate a field to its bilingual counterpart.
     * If base field is Chinese → generates field_en
     * If base field is English → generates field_zh
     * Uses PromptTranslator (Gemini API). Fails silently if no API key.
     *
     * @param {Object} content - The content object to mutate
     * @param {String} fieldName - Base field name (e.g. 'title', 'section_title')
     */
    async function autoTranslatePair(content, fieldName) {
        const text = content[fieldName];
        if (!text || !window.PromptTranslator) return;

        try {
            const isChinese = /[\u4e00-\u9fff]/.test(text);
            if (isChinese) {
                // Chinese → English
                const en = await window.PromptTranslator.translateToEnglish(text);
                if (en) {
                    content[`${fieldName}_en`] = en;
                    console.log(`[Homepage] Translated ${fieldName}: "${text}" → EN: "${en}"`);
                }
            } else {
                // English → Chinese
                const zh = await window.PromptTranslator.translateToChinese(text);
                if (zh) {
                    content[`${fieldName}_zh`] = zh;
                    console.log(`[Homepage] Translated ${fieldName}: "${text}" → ZH: "${zh}"`);
                }
            }
        } catch (err) {
            console.warn(`[Homepage] Translation failed for ${fieldName}:`, err);
            // Non-blocking: save proceeds without translation
        }
    }

    // ============================================
    // TOGGLE HELPERS
    // ============================================

    function toggleVisible(section) {
        const toggleEl = document.getElementById(`hp-${section}-visible`);
        if (!toggleEl) return;
        const isActive = toggleEl.classList.toggle('active');
        // Visual feedback only — actual save happens when "保存修改" is clicked
    }

    function toggleField(section, field) {
        const mapping = {
            'enable_auto': `hp-${section}-auto`,
            'enable_prompts': `hp-${section}-prompts`,
            'enable_products': `hp-${section}-products`
        };
        const toggleEl = document.getElementById(mapping[field]);
        if (!toggleEl) return;
        toggleEl.classList.toggle('active');
    }

    // ============================================
    // DOM HELPERS
    // ============================================

    function setToggle(id, value) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', !!value);
    }

    function getToggleState(id) {
        const el = document.getElementById(id);
        return el ? el.classList.contains('active') : false;
    }

    function setInputValue(id, value) {
        const el = document.getElementById(id);
        if (el && value !== undefined && value !== null) {
            el.value = value;
        }
    }

    function getInputValue(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    function setSelectValue(id, value) {
        const el = document.getElementById(id);
        if (el && value) el.value = value;
    }

    function getSelectValue(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }

    // ============================================
    // EVENT LISTENERS
    // ============================================

    function setupEventListeners() {
        // Ticker speed range slider - update label in real time
        const speedSlider = document.getElementById('hp-ticker-speed');
        const speedLabel = document.getElementById('hp-ticker-speed-label');
        if (speedSlider && speedLabel) {
            speedSlider.addEventListener('input', () => {
                speedLabel.textContent = speedSlider.value;
            });
        }

        // Shop scroll speed slider
        const shopSpeedSlider = document.getElementById('hp-ticker-shop-speed');
        const shopSpeedLabel = document.getElementById('hp-ticker-shop-speed-label');
        if (shopSpeedSlider && shopSpeedLabel) {
            shopSpeedSlider.addEventListener('input', () => {
                shopSpeedLabel.textContent = shopSpeedSlider.value;
            });
        }

        // Initialize section view visibility
        document.querySelectorAll('.hp-section-view').forEach(view => {
            const isActive = view.classList.contains('active');
            view.style.display = isActive ? 'block' : 'none';
        });
    }

    // ============================================
    // PUBLIC API
    // ============================================

    return {
        init,
        switchSection,
        saveSection,
        toggleVisible,
        toggleField
    };
})();

// Expose globally
window.HomepageAdmin = HomepageAdmin;
