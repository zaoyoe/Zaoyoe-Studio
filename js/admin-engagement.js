(function initAdminEngagement(globalScope) {
    'use strict';

    const PAGE_LABELS = {
        home: '首页',
        prompts: '提示词',
        gongyi: '公益站',
        shop: '商城',
        verify: '验证',
        guestbook: '留言板',
        all: '全站'
    };

    const EVENT_LABELS = {
        new_user_welcome: '新用户欢迎',
        points_low_balance: '积分偏低',
        points_insufficient: '积分不足',
        comment_replied: '评论被回复',
        message_replied: '留言被回复',
        coupon_available: '可领优惠券',
        product_discount: '商品折扣',
        product_restocked: '补货提醒',
        permission_changed: '权限变更',
        prompt_unlocked: '内容解锁',
        order_status: '订单状态',
        verify_failed: '验证失败',
        verify_queue: '验证排队',
        service_status: '服务状态',
        usage_rules: '使用规则',
        maintenance_notice: '维护公告',
        community_rule: '社区规则',
        content_featured: '内容精选'
    };

    const RULE_PAGE_OPTIONS = ['all', 'home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook'];
    const RULE_TONE_OPTIONS = [
        ['info', '信息'],
        ['success', '成功'],
        ['warning', '提醒'],
        ['alert', '警示'],
        ['welcome', '欢迎'],
        ['creative', '提示词'],
        ['calm', '公益站'],
        ['commerce', '商城'],
        ['assistive', '验证'],
        ['community', '社区']
    ];
    const RULE_STATUS_OPTIONS = [
        ['draft', '草稿'],
        ['published', '发布'],
        ['paused', '暂停'],
        ['archived', '归档']
    ];
    const ENGAGEMENT_RUNTIME_VERSION = '20260504_ENGAGEMENT_PUBLISH_STATUS_SYNC_1';
    const SAVE_LOCK_STALE_MS = 15000;

    const state = {
        initialized: false,
        loading: false,
        payload: null,
        focusedPageId: '',
        editingRuleId: ''
    };
    globalScope.__adminEngagementRuntimeVersion = ENGAGEMENT_RUNTIME_VERSION;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeToken(value, fallback = '') {
        return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || fallback;
    }

    function getOverviewContainer() {
        return document.getElementById('engagementOverview');
    }

    function isEngagementModuleVisible() {
        return document.getElementById('module-engagement')?.classList.contains('active') === true;
    }

    function getCurrentSite() {
        return String(globalScope.AdminSiteFilter?.getSiteFilter?.() || 'all').trim().toLowerCase() || 'all';
    }

    function getPageLabel(pageId) {
        const normalized = normalizeToken(pageId, 'all');
        return PAGE_LABELS[normalized] || pageId || '页面';
    }

    function getEventLabel(eventKey) {
        const normalized = String(eventKey || '').trim();
        return EVENT_LABELS[normalized] || normalized.replace(/_/g, ' ') || '事件';
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('zh-CN').format(Number(value || 0) || 0);
    }

    function buildAdminUrl(route, params = {}) {
        const url = new URL('/api/admin', globalScope.location.origin);
        url.searchParams.set('route', route);
        Object.entries(params).forEach(([key, value]) => {
            const normalized = String(value ?? '').trim();
            if (normalized) {
                url.searchParams.set(key, normalized);
            }
        });
        return `${url.pathname}${url.search}`;
    }

    async function getFallbackAccessToken() {
        try {
            const authClient = globalScope?.supabaseClient?.auth || globalScope?.supabase?.auth;
            const sessionResult = await authClient?.getSession?.();
            return String(sessionResult?.data?.session?.access_token || '').trim();
        } catch (_) {
            return '';
        }
    }

    async function engagementAdminFetch(input, init = {}) {
        const timeoutMs = Number(init?.timeoutMs || 12000) || 12000;
        const hasCustomSignal = Boolean(init?.signal);
        const controller = !hasCustomSignal && typeof AbortController !== 'undefined'
            ? new AbortController()
            : null;
        let timeoutId = 0;
        if (controller && typeof globalScope.setTimeout === 'function') {
            timeoutId = globalScope.setTimeout(() => controller.abort(), timeoutMs);
        }
        const requestInit = {
            credentials: 'include',
            ...(init || {}),
            authMode: 'bearer',
            forceBearerToken: true,
            ...(controller ? { signal: controller.signal } : {})
        };
        delete requestInit.timeoutMs;

        try {
            if (typeof globalScope.AdminApi?.fetch === 'function') {
                return await globalScope.AdminApi.fetch(input, requestInit);
            }

            const {
                authMode,
                forceBearerToken,
                ...fetchInit
            } = requestInit;
            const headers = new Headers(fetchInit.headers || {});
            if (!headers.has('Authorization')) {
                const token = await getFallbackAccessToken();
                if (token) {
                    headers.set('Authorization', `Bearer ${token}`);
                }
            }

            return await fetch(input, {
                ...fetchInit,
                headers
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error('客服系统请求超时，请稍后重试');
            }
            throw error;
        } finally {
            if (timeoutId && typeof globalScope.clearTimeout === 'function') {
                globalScope.clearTimeout(timeoutId);
            }
        }
    }

    function buildRequestErrorMessage(response, payload = {}, fallbackMessage = '客服系统接口异常') {
        if (Number(response?.status || 0) === 401) {
            return '登录状态已过期，请重新登录后再操作客服系统';
        }
        if (Number(response?.status || 0) === 403) {
            return '当前账号没有客服系统管理权限，请确认拥有「客服消息」或「设置」权限';
        }
        return payload?.message || `${fallbackMessage} (${response?.status || 'network'})`;
    }

    function setLoading(message = '客服系统加载中...') {
        const container = getOverviewContainer();
        if (!container) return;

        const dots = typeof globalScope.AdminShell?.buildLoadingDotsMarkup === 'function'
            ? globalScope.AdminShell.buildLoadingDotsMarkup(message, { variant: 'block', tagName: 'div' })
            : `<div class="engagement-loading"><span>${escapeHtml(message)}</span></div>`;
        container.innerHTML = dots;
    }

    function renderError(error) {
        const container = getOverviewContainer();
        if (!container) return;

        container.innerHTML = `
            <section class="engagement-state engagement-state--error">
                <div>
                    <strong>客服系统暂时不可用</strong>
                    <p>${escapeHtml(error?.message || '加载触达中心数据失败')}</p>
                </div>
                <button type="button" class="engagement-refresh-btn" data-engagement-action="refresh">
                    <i class="fas fa-rotate"></i>
                    <span>重试</span>
                </button>
            </section>
        `;
    }

    async function fetchOverview() {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/overview', {
            site: getCurrentSite()
        }), {
            method: 'GET'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(buildRequestErrorMessage(response, payload, '客服系统接口异常'));
        }
        return payload;
    }

    async function mutateRule(payload = {}) {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/rules'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
            throw new Error(buildRequestErrorMessage(response, result, '规则保存失败'));
        }
        return result;
    }

    function showFeedback(message = '', tone = 'info') {
        if (typeof globalScope.showAdminActionFeedback === 'function') {
            globalScope.showAdminActionFeedback(message, tone);
            return;
        }
        if (typeof globalScope.showToast === 'function') {
            globalScope.showToast(message, tone);
        }
    }

    function showActionError(error, fallbackMessage = '客服系统操作失败') {
        showFeedback(error?.message || fallbackMessage, 'error');
    }

    function renderMetrics(metrics = {}) {
        const items = [
            ['views', '气泡曝光', metrics.views],
            ['clicks', '用户点击', metrics.clicks],
            ['dismisses', '用户关闭', metrics.dismisses],
            ['conversions', '转化事件', metrics.conversions]
        ];

        return `
            <section class="engagement-metrics" aria-label="近 24 小时触达指标">
                ${items.map(([key, label, value]) => `
                    <article class="engagement-metric engagement-metric--${escapeHtml(key)}">
                        <span>${escapeHtml(label)}</span>
                        <strong>${formatNumber(value)}</strong>
                    </article>
                `).join('')}
            </section>
        `;
    }

    function renderSchemaNotice(payload = {}) {
        if (payload.schema_ready !== false) {
            return `
                <section class="engagement-state engagement-state--ready">
                    <i class="fas fa-circle-check"></i>
                    <div>
                        <strong>机器人气泡协议已接入</strong>
                        <p>公共页客服机器人会读取触达规则与用户通知，并回传曝光、点击、关闭和转化事件。</p>
                    </div>
                </section>
            `;
        }

        return `
            <section class="engagement-state engagement-state--warning">
                <i class="fas fa-triangle-exclamation"></i>
                <div>
                    <strong>等待数据库迁移生效</strong>
                    <p>触达中心表结构尚未在当前环境可见，迁移完成后会显示规则、模板和事件统计。</p>
                </div>
            </section>
        `;
    }

    function getEditableRule() {
        const rules = Array.isArray(state.payload?.rules) ? state.payload.rules : [];
        return rules.find((rule) => String(rule?.id || '') === state.editingRuleId) || null;
    }

    function getOptionLabel(options = [], value = '') {
        const normalizedValue = String(value || '').trim();
        const option = options.find(([optionValue]) => String(optionValue) === normalizedValue);
        return option?.[1] || normalizedValue || '请选择';
    }

    function renderCustomSelect({ name, value, options = [], label = '' } = {}) {
        const normalizedName = String(name || '').trim();
        const normalizedValue = String(value || '').trim();
        const labelId = `engagementSelectLabel_${normalizedName}`;
        const menuId = `engagementSelectMenu_${normalizedName}`;
        const selectedLabel = getOptionLabel(options, normalizedValue);

        return `
            <div class="engagement-select" data-engagement-select="${escapeHtml(normalizedName)}">
                <input type="hidden" name="${escapeHtml(normalizedName)}" value="${escapeHtml(normalizedValue)}" data-engagement-select-input>
                <button type="button"
                    class="engagement-select__trigger"
                    data-engagement-select-trigger
                    aria-haspopup="listbox"
                    aria-expanded="false"
                    aria-labelledby="${escapeHtml(labelId)}"
                    aria-controls="${escapeHtml(menuId)}">
                    <span id="${escapeHtml(labelId)}" class="engagement-select__value">${escapeHtml(selectedLabel || label || '请选择')}</span>
                    <i class="fas fa-chevron-down engagement-select__chevron" aria-hidden="true"></i>
                </button>
                <div id="${escapeHtml(menuId)}" class="engagement-select__menu" role="listbox" aria-hidden="true">
                    ${options.map(([optionValue, optionLabel]) => {
                        const isSelected = String(optionValue) === normalizedValue;
                        return `
                            <button type="button"
                                class="engagement-select__option ${isSelected ? 'is-selected' : ''}"
                                data-engagement-select-option
                                data-value="${escapeHtml(optionValue)}"
                                role="option"
                                aria-selected="${isSelected ? 'true' : 'false'}">
                                <span>${escapeHtml(optionLabel)}</span>
                                <i class="fas fa-check engagement-select__check" aria-hidden="true"></i>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderPagePicker(selectedPages = new Set(['all'])) {
        const selected = selectedPages instanceof Set && selectedPages.size ? selectedPages : new Set(['all']);
        const hiddenInputs = Array.from(selected).map((pageId) => `
            <input type="hidden" name="page_ids" value="${escapeHtml(pageId)}" data-engagement-page-value>
        `).join('');

        return `
            <div class="engagement-page-picker" data-engagement-page-picker>
                <div class="engagement-page-picker__values" data-engagement-page-values>${hiddenInputs}</div>
                ${RULE_PAGE_OPTIONS.map((pageId) => {
                    const isSelected = selected.has(pageId);
                    return `
                        <button type="button"
                            class="engagement-page-choice ${isSelected ? 'is-selected' : ''}"
                            data-engagement-page-toggle
                            data-value="${escapeHtml(pageId)}"
                            aria-pressed="${isSelected ? 'true' : 'false'}">
                            <i class="fas fa-check" aria-hidden="true"></i>
                            <span>${escapeHtml(getPageLabel(pageId))}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderCustomSwitch({ name, checked = false, label = '' } = {}) {
        const normalizedName = String(name || '').trim();
        return `
            <div class="engagement-switch-field">
                <input type="hidden" name="${escapeHtml(normalizedName)}" value="${checked ? 'true' : 'false'}" data-engagement-switch-input>
                <button type="button"
                    class="engagement-switch ${checked ? 'is-on' : ''}"
                    data-engagement-switch
                    aria-pressed="${checked ? 'true' : 'false'}">
                    <span class="engagement-switch__track" aria-hidden="true">
                        <span class="engagement-switch__thumb"></span>
                    </span>
                    <span class="engagement-switch__label">${escapeHtml(label)}</span>
                </button>
            </div>
        `;
    }

    function renderRuleComposer() {
        const rule = getEditableRule();
        const selectedPages = new Set(Array.isArray(rule?.page_ids) && rule.page_ids.length ? rule.page_ids : ['all']);
        const status = rule?.status || 'draft';
        const site = rule?.site || getCurrentSite();
        const normalizedSite = ['cn', 'intl'].includes(site) ? site : 'all';

        return `
            <section class="engagement-section engagement-rule-composer">
                <div class="engagement-section__head">
                    <div>
                        <h3>${rule ? '编辑触达规则' : '新建触达规则'}</h3>
                        <p>配置机器人在指定页面吐出的气泡。发布后公共页会通过客服机器人自动读取。</p>
                    </div>
                    ${rule ? `<button type="button" class="engagement-link-btn" data-engagement-action="reset-rule">新建规则</button>` : ''}
                </div>
                <form id="engagementRuleForm" class="engagement-rule-form" data-engagement-managed-form data-engagement-runtime="${escapeHtml(ENGAGEMENT_RUNTIME_VERSION)}" autocomplete="off" novalidate>
                    <input type="hidden" name="id" value="${escapeHtml(rule?.id || '')}">
                    <div class="engagement-form-grid">
                        <label class="engagement-field engagement-field--name">
                            <span>规则名称</span>
                            <input name="name" type="text" maxlength="160" value="${escapeHtml(rule?.name || '')}" placeholder="例如：商城可领券提醒" required>
                        </label>
                        <label class="engagement-field engagement-field--site">
                            <span>站点</span>
                            ${renderCustomSelect({
                                name: 'site',
                                value: normalizedSite,
                                options: [['all', '全站'], ['cn', 'CN'], ['intl', 'INTL']],
                                label: '站点'
                            })}
                        </label>
                        <label class="engagement-field engagement-field--status">
                            <span>状态</span>
                            ${renderCustomSelect({
                                name: 'status',
                                value: status,
                                options: RULE_STATUS_OPTIONS,
                                label: '状态'
                            })}
                        </label>
                        <label class="engagement-field engagement-field--priority">
                            <span>优先级</span>
                            <input name="priority" type="number" min="-1000" max="1000" value="${escapeHtml(rule?.priority ?? 0)}">
                        </label>
                    </div>
                    <div class="engagement-form-block">
                        <span>页面</span>
                        ${renderPagePicker(selectedPages)}
                    </div>
                    <div class="engagement-form-grid engagement-form-grid--wide">
                        <label class="engagement-field engagement-field--title">
                            <span>气泡标题</span>
                            <input name="title" type="text" maxlength="160" value="${escapeHtml(rule?.title || '')}" placeholder="例如：这件商品有优惠">
                        </label>
                        <label class="engagement-field engagement-field--tone">
                            <span>语气</span>
                            ${renderCustomSelect({
                                name: 'tone',
                                value: rule?.tone || 'info',
                                options: RULE_TONE_OPTIONS,
                                label: '语气'
                            })}
                        </label>
                        <label class="engagement-field engagement-form-field--full engagement-field--content">
                            <span>气泡内容</span>
                            <textarea name="content" rows="3" maxlength="1200" placeholder="写给用户看的提示文案" required>${escapeHtml(rule?.content || '')}</textarea>
                        </label>
                        <label class="engagement-field engagement-field--action-label">
                            <span>按钮文案</span>
                            <input name="action_label" type="text" maxlength="80" value="${escapeHtml(rule?.action_label || '')}" placeholder="例如：立即领取">
                        </label>
                        <label class="engagement-field engagement-field--action-url">
                            <span>按钮链接</span>
                            <input name="action_url" type="text" maxlength="1000" value="${escapeHtml(rule?.action_url || '')}" placeholder="/shop.html">
                        </label>
                        <label class="engagement-field engagement-field--ttl">
                            <span>关闭冷却（小时）</span>
                            <input name="dismiss_ttl_hours" type="number" min="1" max="720" value="${escapeHtml(rule?.dismiss_ttl_hours || 24)}">
                        </label>
                        <div class="engagement-form-block engagement-form-block--switch engagement-field--switch">
                            <span>启用状态</span>
                            ${renderCustomSwitch({
                                name: 'enabled',
                                checked: Boolean(rule?.enabled || status === 'published'),
                                label: '发布后立即启用'
                            })}
                        </div>
                    </div>
                    <div class="engagement-form-actions">
                        <div class="engagement-form-error" data-engagement-form-error role="alert" data-tone="error" hidden></div>
                        <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-rule" data-engagement-runtime="${escapeHtml(ENGAGEMENT_RUNTIME_VERSION)}">
                            <i class="fas fa-save"></i>
                            <span>${rule ? '保存规则' : '创建规则'}</span>
                        </button>
                    </div>
                </form>
            </section>
        `;
    }

    function renderPageScenes(pageScenes = []) {
        const scenes = Array.isArray(pageScenes) ? pageScenes : [];
        if (!scenes.length) {
            return '';
        }

        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>页面触达版图</h3>
                        <p>每个公共页使用相同机器人入口，但气泡语气、触发事件和行动按钮独立配置。</p>
                    </div>
                </div>
                <div class="engagement-page-grid">
                    ${scenes.map((scene) => {
                        const pageId = normalizeToken(scene.id, 'all');
                        const tone = normalizeToken(scene.tone, 'info');
                        const isFocused = pageId && pageId === state.focusedPageId;
                        const events = Array.isArray(scene.events) ? scene.events : [];
                        return `
                            <article class="engagement-page-card ${isFocused ? 'is-focused' : ''}" data-engagement-page="${escapeHtml(pageId)}">
                                <div class="engagement-page-card__top">
                                    <span class="engagement-page-icon engagement-page-icon--${escapeHtml(tone)}">
                                        <i class="fas fa-comment-dots"></i>
                                    </span>
                                    <div>
                                        <h4>${escapeHtml(scene.label || getPageLabel(pageId))}</h4>
                                        <p>${escapeHtml(scene.safe_zone || 'bottom-right')}</p>
                                    </div>
                                </div>
                                <div class="engagement-chip-row">
                                    ${events.map((eventKey) => `<span>${escapeHtml(getEventLabel(eventKey))}</span>`).join('')}
                                </div>
                            </article>
                        `;
                    }).join('')}
                </div>
            </section>
        `;
    }

    function renderTemplates(templates = []) {
        const rows = Array.isArray(templates) ? templates.slice(0, 8) : [];
        return `
            <section class="engagement-section engagement-section--split">
                <div class="engagement-section__head">
                    <div>
                        <h3>消息模板</h3>
                        <p>积分、回复、优惠券、权限变更等标准事件会沉淀为可复用气泡。</p>
                    </div>
                </div>
                <div class="engagement-list">
                    ${rows.length ? rows.map((template) => `
                        <article class="engagement-list-item">
                            <div>
                                <strong>${escapeHtml(template.name || template.key || '未命名模板')}</strong>
                                <p>${escapeHtml(template.title || '')}</p>
                            </div>
                            <span>${escapeHtml(getPageLabel((template.page_ids || [])[0] || 'all'))}</span>
                        </article>
                    `).join('') : `
                        <div class="engagement-empty">暂无模板，迁移完成后会写入默认商业事件模板。</div>
                    `}
                </div>
            </section>
        `;
    }

    function renderRules(rules = []) {
        const rows = Array.isArray(rules) ? rules.slice(0, 8) : [];
        return `
            <section class="engagement-section engagement-section--split">
                <div class="engagement-section__head">
                    <div>
                        <h3>近期规则</h3>
                        <p>规则决定谁在什么页面看到什么气泡，并控制优先级、冷却和行动入口。</p>
                    </div>
                </div>
                <div class="engagement-list">
                    ${rows.length ? rows.map((rule) => {
                        const status = rule.enabled && rule.status === 'published' ? '运行中' : (rule.status || '草稿');
                        const pages = Array.isArray(rule.page_ids) && rule.page_ids.length
                            ? rule.page_ids.map(getPageLabel).join(' / ')
                            : '全站';
                        return `
                            <article class="engagement-list-item">
                                <div>
                                    <strong>${escapeHtml(rule.name || '未命名规则')}</strong>
                                    <p>${escapeHtml(pages)} · ${escapeHtml(rule.trigger_type || 'page_view')} · 优先级 ${escapeHtml(rule.priority || 0)}</p>
                                </div>
                                <div class="engagement-rule-actions">
                                    <span class="${rule.enabled ? 'is-on' : ''}">${escapeHtml(status)}</span>
                                    <button type="button" title="编辑" data-engagement-action="edit-rule" data-rule-id="${escapeHtml(rule.id || '')}">
                                        <i class="fas fa-pen"></i>
                                    </button>
                                    <button type="button" title="${rule.enabled ? '暂停' : '发布'}" data-engagement-action="toggle-rule" data-rule-id="${escapeHtml(rule.id || '')}" data-rule-enabled="${rule.enabled ? 'false' : 'true'}">
                                        <i class="fas ${rule.enabled ? 'fa-pause' : 'fa-play'}"></i>
                                    </button>
                                    <button type="button" title="归档" data-engagement-action="archive-rule" data-rule-id="${escapeHtml(rule.id || '')}">
                                        <i class="fas fa-box-archive"></i>
                                    </button>
                                </div>
                            </article>
                        `;
                    }).join('') : `
                        <div class="engagement-empty">暂无规则。当前公共页已具备读取规则的能力，可以开始配置站长气泡、积分不足、回复提醒和优惠触达。</div>
                    `}
                </div>
            </section>
        `;
    }

    function renderCapabilityMap() {
        const capabilities = [
            ['积分与套餐', '积分不足、积分调整、兑换成功、套餐到期'],
            ['社区互动', '留言回复、评论回复、精选展示、内容处理结果'],
            ['商城经营', '可领优惠券、商品折扣、库存恢复、订单履约'],
            ['账号权限', '管理员提升、权限限制、封禁解封、安全提醒'],
            ['站点运营', '首页公告、公益站规则、验证排队、服务维护']
        ];

        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>商业触达能力</h3>
                        <p>把系统事件、运营规则和用户状态统一汇入机器人气泡，减少打断感，同时保留完整追踪。</p>
                    </div>
                </div>
                <div class="engagement-capability-grid">
                    ${capabilities.map(([title, desc]) => `
                        <article>
                            <strong>${escapeHtml(title)}</strong>
                            <p>${escapeHtml(desc)}</p>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderOverview(payload = {}) {
        const container = getOverviewContainer();
        if (!container) return;

        state.payload = payload;
        container.innerHTML = `
            <div class="engagement-hero-grid">
                ${renderSchemaNotice(payload)}
                ${renderMetrics(payload.metrics || {})}
            </div>
            ${renderRuleComposer()}
            ${renderPageScenes(payload.page_scenes || [])}
            <div class="engagement-two-column">
                ${renderTemplates(payload.templates || [])}
                ${renderRules(payload.rules || [])}
            </div>
            ${renderCapabilityMap()}
        `;
        bindEngagementDirectHandlers(container);

        if (state.focusedPageId) {
            const focused = container.querySelector(`[data-engagement-page="${state.focusedPageId}"]`);
            focused?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function collectRuleFormPayload(form) {
        const formData = new FormData(form);
        const pageIds = formData.getAll('page_ids').map((item) => String(item || '').trim()).filter(Boolean);
        const enabled = String(formData.get('enabled') || '').trim() === 'true';
        let status = String(formData.get('status') || 'draft').trim();
        if (enabled && status !== 'published') {
            status = 'published';
        } else if (!enabled && status === 'published') {
            status = 'paused';
        }
        return {
            action: 'save_rule',
            id: String(formData.get('id') || '').trim(),
            name: String(formData.get('name') || '').trim(),
            site: String(formData.get('site') || 'all').trim(),
            status,
            priority: Number.parseInt(formData.get('priority') || '0', 10) || 0,
            page_ids: pageIds.length ? pageIds : ['all'],
            title: String(formData.get('title') || '').trim(),
            content: String(formData.get('content') || '').trim(),
            tone: String(formData.get('tone') || 'info').trim(),
            action_label: String(formData.get('action_label') || '').trim(),
            action_url: String(formData.get('action_url') || '').trim(),
            dismiss_ttl_hours: Number.parseInt(formData.get('dismiss_ttl_hours') || '24', 10) || 24,
            enabled
        };
    }

    function getRuleFormValidationMessage(payload = {}) {
        const missing = [];
        if (!String(payload.name || '').trim()) {
            missing.push('规则名称');
        }
        if (!String(payload.content || '').trim()) {
            missing.push('气泡内容');
        }
        return missing.length ? `请填写${missing.join('和')}` : '';
    }

    function setRuleFormMessage(form, message = '', tone = 'error') {
        const errorEl = form?.querySelector?.('[data-engagement-form-error]');
        const normalizedMessage = String(message || '').trim();
        if (!errorEl) return;
        errorEl.textContent = normalizedMessage;
        errorEl.dataset.tone = ['info', 'success', 'error'].includes(String(tone || '').trim())
            ? String(tone || '').trim()
            : 'error';
        errorEl.hidden = !normalizedMessage;
    }

    function setRuleFormError(form, message = '') {
        setRuleFormMessage(form, message, 'error');
    }

    function focusFirstInvalidRuleField(form, payload = {}) {
        const targetName = !String(payload.name || '').trim()
            ? 'name'
            : (!String(payload.content || '').trim() ? 'content' : '');
        if (!targetName) return;
        const field = form?.elements?.[targetName];
        if (field instanceof HTMLElement) {
            field.focus?.({ preventScroll: true });
            field.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        }
    }

    function setRuleSubmitState(form, isSaving = false) {
        const submitButton = form?.querySelector?.('[data-engagement-action="submit-rule"]');
        if (!submitButton) return;
        submitButton.disabled = Boolean(isSaving);
        const icon = submitButton.querySelector('i');
        const label = submitButton.querySelector('span');
        if (icon) {
            icon.className = isSaving ? 'fas fa-spinner fa-spin' : 'fas fa-save';
        }
        if (label) {
            label.textContent = isSaving ? '保存中...' : (state.editingRuleId ? '保存规则' : '创建规则');
        }
    }

    function upsertRuleInPayload(rule = {}) {
        if (!rule || typeof rule !== 'object' || !String(rule.id || '').trim()) {
            return;
        }

        const currentPayload = state.payload && typeof state.payload === 'object'
            ? state.payload
            : {};
        const currentRules = Array.isArray(currentPayload.rules) ? currentPayload.rules : [];
        const ruleId = String(rule.id || '').trim();
        const nextRules = currentRules.filter((item) => String(item?.id || '').trim() !== ruleId);
        state.payload = {
            ...currentPayload,
            rules: [rule, ...nextRules].slice(0, 100)
        };
    }

    async function saveRuleFromForm(form) {
        if (!(form instanceof HTMLFormElement)) {
            return false;
        }
        if (form?.dataset?.engagementSaving === 'true') {
            const startedAt = Number(form.dataset.engagementSavingStartedAt || 0) || 0;
            const isStale = startedAt > 0 && (Date.now() - startedAt) > SAVE_LOCK_STALE_MS;
            if (!isStale) {
                setRuleSubmitState(form, true);
                setRuleFormMessage(form, '触达规则正在保存，请稍候...', 'info');
                return false;
            }
            delete form.dataset.engagementSaving;
            delete form.dataset.engagementSavingStartedAt;
        }
        const payload = collectRuleFormPayload(form);
        const validationMessage = getRuleFormValidationMessage(payload);
        if (validationMessage) {
            setRuleFormError(form, validationMessage);
            focusFirstInvalidRuleField(form, payload);
            return false;
        }

        setRuleFormMessage(form, '正在提交触达规则...', 'info');
        form.dataset.engagementSaving = 'true';
        form.dataset.engagementSavingStartedAt = String(Date.now());
        setRuleSubmitState(form, true);
        try {
            const result = await mutateRule(payload);
            upsertRuleInPayload(result?.rule);
            state.editingRuleId = '';
            setRuleFormMessage(form, '触达规则已保存', 'success');
            showFeedback('触达规则已保存', 'success');
            renderOverview(state.payload || {});
            return true;
        } catch (error) {
            setRuleFormError(form, error?.message || '触达规则保存失败');
            throw error;
        } finally {
            delete form.dataset.engagementSaving;
            delete form.dataset.engagementSavingStartedAt;
            setRuleSubmitState(form, false);
        }
    }

    function editRule(ruleId = '') {
        const normalizedId = String(ruleId || '').trim();
        if (!normalizedId) return false;
        state.editingRuleId = normalizedId;
        renderOverview(state.payload || {});
        const form = document.getElementById('engagementRuleForm');
        form?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    async function toggleRule(ruleId = '', enabled = false) {
        const normalizedId = String(ruleId || '').trim();
        if (!normalizedId) return false;
        const result = await mutateRule({
            action: 'set_enabled',
            id: normalizedId,
            enabled
        });
        upsertRuleInPayload(result?.rule);
        showFeedback(enabled ? '触达规则已发布' : '触达规则已暂停', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function archiveRule(ruleId = '') {
        const normalizedId = String(ruleId || '').trim();
        if (!normalizedId) return false;
        const result = await mutateRule({
            action: 'archive_rule',
            id: normalizedId
        });
        upsertRuleInPayload(result?.rule);
        if (state.editingRuleId === normalizedId) {
            state.editingRuleId = '';
        }
        showFeedback('触达规则已归档', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    function closeEngagementSelects(exceptSelect = null) {
        document.querySelectorAll('.engagement-select.is-open').forEach((selectEl) => {
            if (exceptSelect && selectEl === exceptSelect) return;
            selectEl.classList.remove('is-open');
            selectEl.querySelector('[data-engagement-select-trigger]')?.setAttribute('aria-expanded', 'false');
            selectEl.querySelector('.engagement-select__menu')?.setAttribute('aria-hidden', 'true');
        });
    }

    function toggleEngagementSelect(selectEl) {
        if (!(selectEl instanceof HTMLElement)) return;
        const isOpen = selectEl.classList.contains('is-open');
        closeEngagementSelects(selectEl);
        selectEl.classList.toggle('is-open', !isOpen);
        selectEl.querySelector('[data-engagement-select-trigger]')?.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        selectEl.querySelector('.engagement-select__menu')?.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
    }

    function chooseEngagementSelectOption(optionEl) {
        if (!(optionEl instanceof HTMLElement)) return;
        const selectEl = optionEl.closest('.engagement-select');
        if (!(selectEl instanceof HTMLElement)) return;

        const value = String(optionEl.dataset.value || '').trim();
        const label = optionEl.querySelector('span')?.textContent?.trim() || value;
        const input = selectEl.querySelector('[data-engagement-select-input]');
        const valueEl = selectEl.querySelector('.engagement-select__value');

        if (input) input.value = value;
        if (valueEl) valueEl.textContent = label;
        selectEl.querySelectorAll('[data-engagement-select-option]').forEach((item) => {
            const isSelected = item === optionEl;
            item.classList.toggle('is-selected', isSelected);
            item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
        closeEngagementSelects();
    }

    function getSelectedEngagementPages(pickerEl) {
        return Array.from(pickerEl.querySelectorAll('[data-engagement-page-toggle].is-selected'))
            .map((item) => String(item.dataset.value || '').trim())
            .filter(Boolean);
    }

    function syncEngagementPagePicker(pickerEl, selectedPages = []) {
        if (!(pickerEl instanceof HTMLElement)) return;
        const normalizedPages = selectedPages.length ? selectedPages : ['all'];
        const selected = new Set(normalizedPages);

        pickerEl.querySelectorAll('[data-engagement-page-toggle]').forEach((button) => {
            const isSelected = selected.has(String(button.dataset.value || '').trim());
            button.classList.toggle('is-selected', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });

        const valuesEl = pickerEl.querySelector('[data-engagement-page-values]');
        if (valuesEl) {
            valuesEl.innerHTML = Array.from(selected).map((pageId) => (
                `<input type="hidden" name="page_ids" value="${escapeHtml(pageId)}" data-engagement-page-value>`
            )).join('');
        }
    }

    function toggleEngagementPageChoice(buttonEl) {
        if (!(buttonEl instanceof HTMLElement)) return;
        const pickerEl = buttonEl.closest('[data-engagement-page-picker]');
        if (!(pickerEl instanceof HTMLElement)) return;

        const pageId = String(buttonEl.dataset.value || '').trim();
        let selectedPages = getSelectedEngagementPages(pickerEl);
        if (pageId === 'all') {
            selectedPages = ['all'];
        } else {
            selectedPages = selectedPages.filter((item) => item !== 'all');
            if (selectedPages.includes(pageId)) {
                selectedPages = selectedPages.filter((item) => item !== pageId);
            } else {
                selectedPages.push(pageId);
            }
            if (!selectedPages.length) {
                selectedPages = ['all'];
            }
        }

        syncEngagementPagePicker(pickerEl, selectedPages);
    }

    function toggleEngagementSwitch(buttonEl) {
        if (!(buttonEl instanceof HTMLElement)) return;
        const fieldEl = buttonEl.closest('.engagement-switch-field');
        const input = fieldEl?.querySelector('[data-engagement-switch-input]');
        const nextChecked = buttonEl.getAttribute('aria-pressed') !== 'true';
        buttonEl.classList.toggle('is-on', nextChecked);
        buttonEl.setAttribute('aria-pressed', nextChecked ? 'true' : 'false');
        if (input) input.value = nextChecked ? 'true' : 'false';
    }

    function submitRuleFromActionElement(actionEl, event = null) {
        if (!(actionEl instanceof HTMLElement)) {
            return false;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();
        closeEngagementSelects();
        return handleEngagementRuleFormSubmit(actionEl.closest('form'));
    }

    function handleEngagementRuleFormSubmit(form) {
        if (!(form instanceof HTMLFormElement) || form.getAttribute('id') !== 'engagementRuleForm') {
            return false;
        }

        void saveRuleFromForm(form).catch((error) => {
            showActionError(error, '触达规则保存失败');
        });
        return true;
    }

    function bindEngagementDirectHandlers(root = document) {
        const form = root.querySelector?.('#engagementRuleForm');
        if (form instanceof HTMLFormElement && form.dataset.engagementDirectBound !== '1') {
            form.dataset.engagementDirectBound = '1';
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                event.stopPropagation();
                submitRuleFromActionElement(form.querySelector('[data-engagement-action="submit-rule"]'), event);
            });
        }

        const submitButton = root.querySelector?.('[data-engagement-action="submit-rule"]');
        if (submitButton instanceof HTMLElement && submitButton.dataset.engagementDirectBound !== '1') {
            submitButton.dataset.engagementDirectBound = '1';
            submitButton.onclick = (event) => submitRuleFromActionElement(submitButton, event);
            submitButton.addEventListener('pointerup', (event) => {
                if (typeof event.button === 'number' && event.button !== 0) {
                    return;
                }
                submitRuleFromActionElement(submitButton, event);
            });
            submitButton.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    submitRuleFromActionElement(submitButton, event);
                }
            });
        }
    }

    function handleEngagementSubmitIntentEvent(event) {
        const actionEl = event.target?.closest?.('[data-engagement-action="submit-rule"]');
        if (!(actionEl instanceof HTMLElement)) {
            return;
        }
        const now = Date.now();
        const lastIntentAt = Number(actionEl.dataset.engagementSubmitIntentAt || 0) || 0;
        if (event.type === 'click' && lastIntentAt && (now - lastIntentAt) < 700) {
            event.preventDefault?.();
            event.stopPropagation?.();
            return;
        }
        actionEl.dataset.engagementSubmitIntentAt = String(now);
        submitRuleFromActionElement(actionEl, event);
    }

    async function initAdminEngagementModule(options = {}) {
        const container = getOverviewContainer();
        if (!container) {
            return false;
        }

        if (state.loading) {
            return true;
        }

        if (state.initialized && options.force !== true) {
            return true;
        }

        state.loading = true;
        setLoading(options.message || '客服系统加载中...');
        try {
            const payload = await fetchOverview();
            renderOverview(payload);
            state.initialized = true;
            return true;
        } catch (error) {
            renderError(error);
            return false;
        } finally {
            state.loading = false;
        }
    }

    function refreshAdminEngagementModule() {
        return initAdminEngagementModule({
            force: true,
            message: '正在刷新客服系统...'
        });
    }

    function handleAdminEngagementSiteChange() {
        state.initialized = false;
        return refreshAdminEngagementModule();
    }

    function openAdminEngagementShellContext(context = {}) {
        const pageId = normalizeToken(context.pageId || context.page_id || context.page || '', '');
        if (pageId) {
            state.focusedPageId = pageId;
        }
        return initAdminEngagementModule({
            force: true,
            message: pageId ? `正在定位${getPageLabel(pageId)}触达配置...` : '客服系统加载中...'
        });
    }

    document.addEventListener('click', (event) => {
        const selectOption = event.target?.closest?.('[data-engagement-select-option]');
        if (selectOption) {
            event.preventDefault();
            chooseEngagementSelectOption(selectOption);
            return;
        }

        const selectTrigger = event.target?.closest?.('[data-engagement-select-trigger]');
        if (selectTrigger) {
            event.preventDefault();
            toggleEngagementSelect(selectTrigger.closest('.engagement-select'));
            return;
        }

        const pageToggle = event.target?.closest?.('[data-engagement-page-toggle]');
        if (pageToggle) {
            event.preventDefault();
            closeEngagementSelects();
            toggleEngagementPageChoice(pageToggle);
            return;
        }

        const switchToggle = event.target?.closest?.('[data-engagement-switch]');
        if (switchToggle) {
            event.preventDefault();
            closeEngagementSelects();
            toggleEngagementSwitch(switchToggle);
            return;
        }

        if (!event.target?.closest?.('.engagement-select')) {
            closeEngagementSelects();
        }

        const actionEl = event.target?.closest?.('[data-engagement-action]');
        if (!actionEl) return;

        const action = actionEl.dataset.engagementAction;
        if (action === 'refresh') {
            event.preventDefault();
            void refreshAdminEngagementModule();
            return;
        }
        if (action === 'submit-rule') {
            submitRuleFromActionElement(actionEl, event);
            return;
        }
        if (action === 'reset-rule') {
            event.preventDefault();
            state.editingRuleId = '';
            renderOverview(state.payload || {});
            return;
        }
        if (action === 'edit-rule') {
            event.preventDefault();
            editRule(actionEl.dataset.ruleId);
            return;
        }
        if (action === 'toggle-rule') {
            event.preventDefault();
            void toggleRule(actionEl.dataset.ruleId, actionEl.dataset.ruleEnabled === 'true').catch((error) => {
                showActionError(error, '触达规则状态更新失败');
            });
            return;
        }
        if (action === 'archive-rule') {
            event.preventDefault();
            void archiveRule(actionEl.dataset.ruleId).catch((error) => {
                showActionError(error, '触达规则归档失败');
            });
        }
    });

    document.addEventListener('pointerup', (event) => {
        if (typeof event.button === 'number' && event.button !== 0) {
            return;
        }
        handleEngagementSubmitIntentEvent(event);
    }, true);

    document.addEventListener('click', handleEngagementSubmitIntentEvent, true);

    document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || form.getAttribute('id') !== 'engagementRuleForm') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        handleEngagementRuleFormSubmit(form);
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeEngagementSelects();
        }
    });

    globalScope.AdminEngagement = {
        init: initAdminEngagementModule,
        refresh: refreshAdminEngagementModule,
        render: renderOverview,
        submitCurrentRule: () => handleEngagementRuleFormSubmit(document.getElementById('engagementRuleForm')),
        handleContext: openAdminEngagementShellContext,
        handleSiteChange: handleAdminEngagementSiteChange
    };
    globalScope.handleAdminEngagementSiteChange = handleAdminEngagementSiteChange;
    globalScope.openAdminEngagementShellContext = openAdminEngagementShellContext;

    if (globalScope.AdminShell?.registerModule) {
        globalScope.AdminShell.registerModule('engagement', {
            activate: initAdminEngagementModule,
            handleContext: openAdminEngagementShellContext,
            onSiteChange: handleAdminEngagementSiteChange,
            reload: refreshAdminEngagementModule
        });
    }

    globalScope.addEventListener?.('admin-shell-module-activated', (event) => {
        if (event?.detail?.moduleId === 'engagement') {
            void initAdminEngagementModule();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        if (globalScope.adminStudioAccessGranted && isEngagementModuleVisible()) {
            void initAdminEngagementModule();
            return;
        }

        globalScope.addEventListener?.('adminStudioAccessGranted', () => {
            if (isEngagementModuleVisible()) {
                void initAdminEngagementModule();
            }
        }, { once: true });
    });
})(window);
