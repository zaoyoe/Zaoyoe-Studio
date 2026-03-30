function isMissingNotificationScopeColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42703'
        || error?.code === '42P01'
        || (message.includes('column') && message.includes('does not exist'))
        || (message.includes('schema cache') && message.includes('scope'))
        || (message.includes('schema cache') && message.includes('category'));
}

async function insertScopedSystemNotification(client, payload = {}) {
    const response = await client
        .from('system_notifications')
        .insert(payload);

    if (!response?.error || !isMissingNotificationScopeColumnError(response.error)) {
        return response;
    }

    const legacyPayload = { ...payload };
    delete legacyPayload.scope;
    delete legacyPayload.category;

    return client
        .from('system_notifications')
        .insert(legacyPayload);
}

class ChatWidget {
    constructor() {
        this.isOpen = false;
        this.isVerifyPage = /(^|\/)verify(?:\.html)?\/?$/i.test(window.location.pathname || '');
        this.sessionId = this.getSessionId();
        this.userSessionIds = [this.sessionId];
        this.currentUser = null;
        this.supabase = window.supabaseClient; // Assuming global supabase client
        this.unreadCount = 0; // Track unread messages
        this.lastMessageTime = null; // Track last seen message
        this.unreadSessions = new Set(); // Track sessions with unread messages (admin mode)
        this.sessionMessagesCache = new Map(); // Cache admin conversation payloads for faster switching
        this._sessionLoadRequestId = 0;
        this._sessionLoadingOverlayTimer = null;
        this.opsAlertSessionId = '__admin_ops_todo__';
        this.opsAlertMessages = [];
        this.opsAlertLoadError = '';
        this.adminMessageChannel = null;
        this.adminOpsAlertChannel = null;
        this.adminOpsAlertPollTimer = null;

        // Preload configuration - lock scroll until messages are loaded
        this.isPreloading = false;

        // Smart time display - only show time if 5+ minutes gap
        this.lastDisplayedTime = null;
        this.timeDisplayThreshold = 5 * 60 * 1000; // 5 minutes in ms

        // Define common emojis
        this.emojis = ['😀', '😂', '😍', '🤔', '😭', '😡', '👍', '👎', '🎉', '🔥', '❤️', '👀', '🚀', '💯', '👋', '✨', '🤖', '👻'];
        this._stableDockHeight = null;
        this._keyboardDocked = false;
        this._lastKeyboardInset = 0;
        this._viewportRafId = null;
        this._viewportThrottleTimer = null;
        this._lastViewportSyncAt = 0;
        this._keyboardSettleTimer = null;
        this._pendingStableKeyboardInset = 0;
        this._lastStableKeyboardInset = 0;
        this._transitionCleanupTimer = null;
        this._openingAnimationTimer = null;
        this._closingAnimationTimer = null;
        this._pendingFirstDockTimer = null;
        this._pendingFirstDockParams = null;
        this._keyboardDockAnimatingUntil = 0;
        this._keyboardBlurUndocking = false;
        this._keyboardPreLiftActive = false;
        this._motionVisualLockTimer = null;
        this._sessionVisualLocked = false;
        this._estimatedRefreshHz = 60;
        this._isHighRefreshDisplay = false;
        this._statusBarShield = null;
        this._themeColorMeta = null;
        this._themeColorRestoreContent = '';
        this._fabHovering = false;
        this._fabAmbientPeekTimer = null;
        this._fabAmbientReturnTimer = null;
        this._fabAmbientResumeTimer = null;
        this._onFabAmbientViewportChange = null;
        this.supportConfig = window.ZaoyoeSupportBotConfig || null;
        this.supportContextKey = this.getSupportContextKey();
        this.supportDisplayMode = 'support';
        this.supportView = { type: 'root', id: '' };
        this.supportPendingActionId = '';
        this.supportLastMenuId = '';
        this.supportInlineState = { actionId: '', value: '', result: '', error: '', loading: false };

        this._detectRefreshRate();
        this.init();
    }

    // i18n helper with fallback
    t(key, fallback) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            if (value === null || value === undefined) {
                return fallback || key;
            }
            if (typeof value === 'string') {
                const normalized = value.trim().toLowerCase();
                if (!normalized || normalized === 'null' || normalized === 'undefined') {
                    return fallback || key;
                }
            }
            return value;
        }
        return fallback || key;
    }

    getCurrentLanguage() {
        return window.i18n?.getCurrentLanguage?.() || 'zh';
    }

    resolveSupportText(value, fallback = '') {
        if (value === null || value === undefined) return fallback;
        if (typeof value === 'string') return value;
        if (typeof value === 'object') {
            const lang = this.getCurrentLanguage();
            return value[lang] || value.zh || value.en || fallback;
        }
        return fallback;
    }

    getSupportConfig() {
        return window.ZaoyoeSupportBotConfig || this.supportConfig || null;
    }

    getSupportContextKey() {
        const path = String(window.location.pathname || '').toLowerCase();
        if (/(^|\/)shop(?:\.html)?\/?$/.test(path)) return 'shop';
        if (/(^|\/)verify(?:\.html)?\/?$/.test(path)) return 'verify';
        return 'default';
    }

    getSupportContextConfig() {
        const config = this.getSupportConfig();
        if (!config) return null;
        return config.contexts?.[this.supportContextKey] || config.contexts?.default || null;
    }

    getSupportMenu(menuId) {
        return this.getSupportConfig()?.menus?.[menuId] || null;
    }

    getSupportAction(actionId) {
        return this.getSupportConfig()?.actions?.[actionId] || null;
    }

    getSupportEntryLabel() {
        return this.getCurrentLanguage() === 'zh' ? '常用入口' : 'Quick Help';
    }

    getSupportInlineState(actionId = '') {
        if (!actionId) {
            this.supportInlineState = { actionId: '', value: '', result: '', error: '', loading: false };
            return this.supportInlineState;
        }

        if (!this.supportInlineState || this.supportInlineState.actionId !== actionId) {
            this.supportInlineState = { actionId, value: '', result: '', error: '', loading: false };
        }

        return this.supportInlineState;
    }

    setSupportInlineState(actionId = '', nextState = {}) {
        const normalizedActionId = String(actionId || '').trim();
        const baseState = normalizedActionId
            ? this.getSupportInlineState(normalizedActionId)
            : { actionId: '', value: '', result: '', error: '', loading: false };

        this.supportInlineState = {
            ...baseState,
            ...nextState,
            actionId: normalizedActionId
        };

        return this.supportInlineState;
    }

    setSupportDisplayMode(mode = 'support') {
        this.supportDisplayMode = mode === 'chat' ? 'chat' : 'support';
        this.supportPendingActionId = '';
        this.syncSupportShellState();
    }

    syncSupportShellState() {
        const hasSupport = Boolean(this.getSupportConfig() && this.getSupportContextConfig() && this.supportPanel);
        const mode = hasSupport ? this.supportDisplayMode : 'chat';
        const showChat = !hasSupport || mode === 'chat';
        const showSupport = hasSupport && mode === 'support';
        const showHeaderActions = hasSupport && mode === 'chat';

        if (this.chatWindow) {
            this.chatWindow.classList.toggle('chat-window--support-mode', showSupport);
            this.chatWindow.classList.toggle('chat-window--chat-mode', showChat);
        }

        if (this.messagesContainer) {
            this.messagesContainer.hidden = !showChat;
            this.messagesContainer.style.display = showChat ? 'flex' : 'none';
        }

        if (this.inputArea) {
            this.inputArea.hidden = !showChat;
            this.inputArea.style.display = showChat ? 'flex' : 'none';
        }

        if (this.supportPanel) {
            this.supportPanel.hidden = !showSupport;
            this.supportPanel.style.display = showSupport ? 'flex' : 'none';
        }

        if (this.headerActions) {
            this.headerActions.hidden = !showHeaderActions;
            this.headerActions.style.display = showHeaderActions ? 'flex' : 'none';
            if (this.headerSupportToggle) {
                this.headerSupportToggle.textContent = this.getSupportEntryLabel();
            }
        }

        if (mode === 'chat') {
            this.updateSupportInputState('');
        }
    }

    buildSupportMenuButtons(actionIds = []) {
        return actionIds
            .map((actionId) => {
                const action = this.getSupportAction(actionId);
                if (!action) return '';
                return `
                    <button type="button" class="chat-support-btn" data-support-action-id="${this.escapeHtml(actionId)}">
                        ${this.escapeHtml(this.resolveSupportText(action.label, actionId))}
                    </button>
                `;
            })
            .join('');
    }

    buildSupportChecklist(items = []) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return '';
        return `
            <ul class="chat-support-list">
                ${list.map((item) => `<li>${this.escapeHtml(String(item || ''))}</li>`).join('')}
            </ul>
        `;
    }

    updateSupportInputState(actionId = '') {
        this.supportPendingActionId = '';
        if (!this.input) return;
        this.input.placeholder = this.t('chat.inputMessagePlaceholder', '输入消息...');
    }

    getSupportRefTypeLabel(refType) {
        const normalized = String(refType || '').trim().toLowerCase();
        const labels = {
            order_id: this.getCurrentLanguage() === 'zh' ? '商城订单号' : 'Shop Order ID',
            task_id: this.getCurrentLanguage() === 'zh' ? '验证任务号' : 'Verify Task ID',
            redeem_code: this.getCurrentLanguage() === 'zh' ? '兑换码' : 'Redeem Code',
            afdian_order_no: this.getCurrentLanguage() === 'zh' ? '爱发电订单号' : 'Afdian Order ID',
            email: this.getCurrentLanguage() === 'zh' ? '邮箱' : 'Email'
        };
        return labels[normalized] || (this.getCurrentLanguage() === 'zh' ? '问题标识' : 'Reference');
    }

    getSupportActionLabel(actionId) {
        const action = this.getSupportAction(actionId);
        return action ? this.resolveSupportText(action.label, actionId) : actionId;
    }

    getSupportCategoryLabel(category) {
        const normalized = String(category || '').trim().toLowerCase();
        const labels = {
            redeem_code_available: this.getCurrentLanguage() === 'zh' ? '兑换码可用' : 'Code Available',
            redeem_code_used: this.getCurrentLanguage() === 'zh' ? '兑换码已使用' : 'Code Used',
            redeem_code_unavailable: this.getCurrentLanguage() === 'zh' ? '兑换码不可用' : 'Code Unavailable',
            redeem_code_invalid: this.getCurrentLanguage() === 'zh' ? '兑换码无效' : 'Code Invalid',
            shop_delivered: this.getCurrentLanguage() === 'zh' ? '订单已发放' : 'Delivered',
            shop_delivery_in_progress: this.getCurrentLanguage() === 'zh' ? '订单处理中' : 'In Progress',
            shop_delivery_retrying: this.getCurrentLanguage() === 'zh' ? '订单自动重试中' : 'Retrying',
            shop_delivery_dead_letter: this.getCurrentLanguage() === 'zh' ? '订单需人工处理' : 'Manual Review',
            verify_success: this.getCurrentLanguage() === 'zh' ? '任务已完成' : 'Task Completed',
            verify_in_progress: this.getCurrentLanguage() === 'zh' ? '任务处理中' : 'Task In Progress',
            verify_region_unsupported: this.getCurrentLanguage() === 'zh' ? '地区限制' : 'Region Restricted',
            verify_sso_unsupported: this.getCurrentLanguage() === 'zh' ? '邮箱类型限制' : 'Email Restricted',
            verify_upstream_temporary: this.getCurrentLanguage() === 'zh' ? '上游临时异常' : 'Upstream Issue',
            verify_conflict_existing_state: this.getCurrentLanguage() === 'zh' ? '账号状态冲突' : 'Account Conflict',
            verify_failed_unknown: this.getCurrentLanguage() === 'zh' ? '未知失败' : 'Unknown Failure',
            afdian_lookup_required: this.getCurrentLanguage() === 'zh' ? '爱发电订单查询' : 'Afdian Lookup',
            verify_email_precheck: this.getCurrentLanguage() === 'zh' ? '邮箱前置检查' : 'Email Precheck'
        };
        return labels[normalized] || '';
    }

    getSuggestedActionLabels(actionIds = []) {
        return (Array.isArray(actionIds) ? actionIds : [])
            .map((actionId) => this.getSupportActionLabel(actionId))
            .filter(Boolean);
    }

    getAutoSupportAssistActionLabel(actionId, detected, explanation = null, options = {}) {
        const normalizedActionId = String(actionId || '').trim();
        const category = String(explanation?.category || '').trim().toLowerCase();
        const status = String(explanation?.status || '').trim().toLowerCase();
        const refType = String(detected?.ref_type || '').trim().toLowerCase();
        const isPrimary = options?.primary === true;
        const zh = this.getCurrentLanguage() === 'zh';

        switch (normalizedActionId) {
            case 'code_status':
                return zh ? '查看兑换码状态' : 'View Code Status';
            case 'redeem_code':
                return zh ? '立即兑换' : 'Redeem Now';
            case 'afdian_lookup':
                return zh ? '查爱发电订单' : 'Check Afdian Order';
            case 'shop_order_status':
                if (category === 'shop_delivery_in_progress' || category === 'shop_delivery_retrying') {
                    return zh ? '继续查订单状态' : 'Check Order Status Again';
                }
                if (category === 'shop_delivery_dead_letter') {
                    return zh ? '查看订单异常' : 'View Order Issue';
                }
                return zh ? '查看订单状态' : 'View Order Status';
            case 'shop_order_content':
                return zh ? '查看已发放内容' : 'View Delivered Content';
            case 'verify_task_status':
                if (status === 'success') {
                    return zh ? '查看任务详情' : 'View Task Details';
                }
                if (category === 'verify_in_progress') {
                    return zh ? '继续查任务进度' : 'Check Task Progress';
                }
                return zh ? '查看任务状态' : 'View Task Status';
            case 'verify_failure_help':
                return zh ? '查看失败原因' : 'View Failure Reason';
            case 'verify_precheck':
                return zh ? '做提交前检查' : 'Run Precheck';
            case 'create_ticket':
                if (refType === 'redeem_code') return zh ? '提交兑换码工单' : 'Submit Code Ticket';
                if (refType === 'task_id') return zh ? '提交任务工单' : 'Submit Task Ticket';
                if (refType === 'order_id') return zh ? '提交订单工单' : 'Submit Order Ticket';
                return zh ? '提交问题工单' : 'Submit Ticket';
            case 'tg_support':
                return zh ? '转 TG 人工客服' : 'Open Telegram Support';
            case 'live_chat':
                return zh ? '切到在线客服' : 'Open Live Chat';
            default:
                return isPrimary ? this.getSupportActionLabel(normalizedActionId) : this.getSupportActionLabel(normalizedActionId);
        }
    }

    getAutoSupportRootActionLabel() {
        return this.getCurrentLanguage() === 'zh' ? '更多自助入口' : 'More Help';
    }

    getAutoSupportPrimaryActionId(detected, explanation = null) {
        const candidateIds = [];
        const pushActionId = (actionId) => {
            const normalizedActionId = String(actionId || '').trim();
            if (!normalizedActionId || candidateIds.includes(normalizedActionId)) return;
            if (!this.getSupportAction(normalizedActionId)) return;
            candidateIds.push(normalizedActionId);
        };

        (Array.isArray(explanation?.suggested_actions) ? explanation.suggested_actions : []).forEach(pushActionId);
        pushActionId(explanation?.next_action);
        pushActionId(detected?.next_action);

        const refType = String(detected?.ref_type || '').trim().toLowerCase();
        if (!candidateIds.length) {
            if (refType === 'order_id') pushActionId('shop_order_status');
            if (refType === 'task_id') pushActionId('verify_task_status');
            if (refType === 'redeem_code') pushActionId('code_status');
            if (refType === 'afdian_order_no') pushActionId('afdian_lookup');
            if (refType === 'email') pushActionId('verify_precheck');
        }

        return candidateIds[0] || '';
    }

    buildAutoSupportPrefillValue(actionId, detected, explanation = null) {
        const normalizedActionId = String(actionId || '').trim();
        const refValue = String(detected?.normalized_value || '').trim();
        if (!normalizedActionId || !refValue) return '';

        if (normalizedActionId === 'create_ticket') {
            const refKeyMap = {
                order_id: 'order',
                task_id: 'task',
                redeem_code: 'code',
                afdian_order_no: 'afdian',
                email: 'email'
            };
            const refKey = refKeyMap[String(detected?.ref_type || '').trim().toLowerCase()] || 'ref';
            const lines = [`${refKey}:${refValue}`];
            if (String(explanation?.title || '').trim()) {
                lines.push(`${this.getCurrentLanguage() === 'zh' ? '自动判断' : 'Auto Check'}：${String(explanation.title).trim()}`);
            }
            if (String(explanation?.message || '').trim()) {
                lines.push(`${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${String(explanation.message).trim()}`);
            }
            return lines.join('\n');
        }

        if ([
            'code_status',
            'redeem_code',
            'afdian_lookup',
            'shop_order_status',
            'shop_order_content',
            'verify_task_status',
            'verify_failure_help'
        ].includes(normalizedActionId)) {
            return refValue;
        }

        return '';
    }

    formatAutoSupportPanelResult(detected, explanation = null, fallbackError = '') {
        if (!explanation && !fallbackError) return '';

        const lines = [];
        const title = String(explanation?.title || '').trim();
        const message = String(explanation?.message || '').trim();
        const category = this.getSupportCategoryLabel(explanation?.category);

        if (title) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '自动判断' : 'Automatic Check'}：${title}`);
        }

        if (message) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${message}`);
        } else if (fallbackError) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${fallbackError}`);
        }

        if (category) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '问题分类' : 'Category'}：${category}`);
        }

        if (explanation && typeof explanation.retryable === 'boolean') {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '是否建议重试' : 'Retry Recommended'}：${explanation.retryable
                ? (this.getCurrentLanguage() === 'zh' ? '可以稍后重试' : 'You can retry later')
                : (this.getCurrentLanguage() === 'zh' ? '不建议直接重试' : 'Retry is not recommended')}`);
        }

        return lines.filter(Boolean).join('\n');
    }

    getAutoSupportScenarioActionIds(detected, explanation = null, openedActionId = '') {
        const category = String(explanation?.category || '').trim().toLowerCase();
        const status = String(explanation?.status || '').trim().toLowerCase();
        const refType = String(detected?.ref_type || '').trim().toLowerCase();
        const actionIds = [];
        const pushActionId = (actionId) => {
            const normalizedActionId = String(actionId || '').trim();
            if (!normalizedActionId || actionIds.includes(normalizedActionId)) return;
            if (!this.getSupportAction(normalizedActionId)) return;
            actionIds.push(normalizedActionId);
        };

        switch (category) {
            case 'redeem_code_available':
                pushActionId('redeem_code');
                pushActionId('code_status');
                break;
            case 'redeem_code_used':
            case 'redeem_code_unavailable':
            case 'redeem_code_invalid':
                pushActionId('create_ticket');
                pushActionId('code_status');
                break;
            case 'shop_delivered':
                pushActionId('shop_order_content');
                pushActionId('shop_order_status');
                break;
            case 'shop_delivery_in_progress':
            case 'shop_delivery_retrying':
                pushActionId('shop_order_status');
                pushActionId('create_ticket');
                break;
            case 'shop_delivery_dead_letter':
                pushActionId('create_ticket');
                pushActionId('shop_order_status');
                break;
            case 'verify_success':
                pushActionId('verify_task_status');
                break;
            case 'verify_in_progress':
                pushActionId('verify_task_status');
                pushActionId('verify_failure_help');
                break;
            case 'verify_upstream_temporary':
                pushActionId('verify_task_status');
                pushActionId('create_ticket');
                break;
            case 'verify_region_unsupported':
            case 'verify_sso_unsupported':
            case 'verify_conflict_existing_state':
                pushActionId('verify_failure_help');
                pushActionId('create_ticket');
                break;
            case 'verify_failed_unknown':
            case 'verify_unknown':
                pushActionId('verify_failure_help');
                pushActionId('create_ticket');
                break;
            case 'afdian_lookup_required':
                pushActionId('afdian_lookup');
                pushActionId('create_ticket');
                break;
            case 'verify_email_precheck':
                pushActionId('verify_precheck');
                pushActionId('create_ticket');
                break;
            default:
                break;
        }

        if (!actionIds.length) {
            if (status === 'success') {
                if (refType === 'task_id') pushActionId('verify_task_status');
                if (refType === 'order_id') pushActionId('shop_order_content');
            } else if (['queued', 'pending', 'processing', 'requeued', 'retry_waiting'].includes(status)) {
                if (refType === 'task_id') pushActionId('verify_task_status');
                if (refType === 'order_id') pushActionId('shop_order_status');
            } else if (status === 'failed') {
                if (refType === 'task_id') {
                    pushActionId('verify_failure_help');
                    pushActionId('create_ticket');
                }
            }
        }

        pushActionId(openedActionId);
        (Array.isArray(explanation?.suggested_actions) ? explanation.suggested_actions : []).forEach(pushActionId);
        pushActionId(detected?.next_action);

        if (!actionIds.length) {
            pushActionId(this.getAutoSupportPrimaryActionId(detected, explanation));
        }

        return actionIds;
    }

    getAutoSupportAssistActions(detected, explanation = null, openedActionId = '') {
        const actions = this.getAutoSupportScenarioActionIds(detected, explanation, openedActionId)
            .slice(0, 2)
            .map((actionId, index) => ({
            kind: 'action',
            actionId,
            label: this.getAutoSupportAssistActionLabel(actionId, detected, explanation, {
                primary: index === 0,
                openedActionId
            }),
            primary: index === 0
        }));

        actions.push({
            kind: 'root',
            label: this.getAutoSupportRootActionLabel(),
            primary: false
        });

        return actions;
    }

    extractAutoSupportReference(text) {
        const rawText = String(text || '').trim();
        if (!rawText) return null;

        const emailMatch = rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (emailMatch) {
            return {
                value: emailMatch[0],
                ref_type: 'email'
            };
        }

        const uuidMatch = rawText.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
        if (uuidMatch) {
            return {
                value: uuidMatch[0]
            };
        }

        const codeMatch = rawText.match(/\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/i);
        if (codeMatch) {
            return {
                value: codeMatch[0],
                ref_type: 'redeem_code'
            };
        }

        const afdianMatch = rawText.match(/(?:爱发电|afdian|订单号|order)[:：#\s-]*([A-Za-z0-9_-]{10,40})/i);
        if (afdianMatch?.[1]) {
            return {
                value: afdianMatch[1]
            };
        }

        if (rawText.length <= 40 && /^[A-Za-z0-9_-]{10,40}$/.test(rawText) && /\d/.test(rawText)) {
            return {
                value: rawText
            };
        }

        return null;
    }

    formatAutoSupportAssistMessage(detected, explanation = null, openedActionId = '', fallbackError = '') {
        const lines = [];
        const refTypeLabel = this.getSupportRefTypeLabel(detected?.ref_type);
        const refValue = String(detected?.normalized_value || '').trim();
        const title = String(explanation?.title || '').trim();
        const message = String(explanation?.message || '').trim();
        const category = this.getSupportCategoryLabel(explanation?.category);
        const openedActionLabel = openedActionId ? this.getSupportActionLabel(openedActionId) : '';

        if (openedActionLabel) {
            lines.push(this.getCurrentLanguage() === 'zh'
                ? `我已经识别到这是“${refTypeLabel}”，并帮你打开了“${openedActionLabel}”。`
                : `I detected this as “${refTypeLabel}” and opened “${openedActionLabel}” for you.`);
        } else {
            lines.push(this.getCurrentLanguage() === 'zh'
                ? `我已经识别到这是“${refTypeLabel}”。`
                : `I detected this as “${refTypeLabel}”.`);
        }

        if (refValue) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '识别内容' : 'Reference'}：${refValue}`);
        }

        if (title) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '判断结果' : 'Result'}：${title}`);
        }

        if (message) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${message}`);
        } else if (fallbackError) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${fallbackError}`);
        }

        if (category) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '问题分类' : 'Category'}：${category}`);
        }

        if (openedActionLabel || explanation || fallbackError) {
            lines.push(this.getCurrentLanguage() === 'zh'
                ? '你也可以直接点下方按钮切换到其他入口。'
                : 'You can also use the buttons below to continue.');
        }

        return lines.filter(Boolean).join('\n');
    }

    buildAutoSupportAssistPayload(detected, explanation = null, openedActionId = '', fallbackError = '') {
        return {
            text: this.formatAutoSupportAssistMessage(detected, explanation, openedActionId, fallbackError),
            actions: this.getAutoSupportAssistActions(detected, explanation, openedActionId),
            detected,
            explanation,
            fallbackError
        };
    }

    async openAutoSupportAssistPanel(detected, explanation = null, fallbackError = '') {
        const actionId = this.getAutoSupportPrimaryActionId(detected, explanation);
        if (!actionId) return '';

        const action = this.getSupportAction(actionId);
        if (!action) return '';

        const panelState = {
            value: this.buildAutoSupportPrefillValue(actionId, detected, explanation),
            result: this.formatAutoSupportPanelResult(detected, explanation, fallbackError),
            error: '',
            loading: false
        };

        await this.openSupportAction(actionId, panelState);
        return actionId;
    }

    async maybeRunAutoSupportAssist(text) {
        const candidate = this.extractAutoSupportReference(text);
        if (!candidate) return false;

        let sessionContext = null;
        try {
            sessionContext = await this.refreshUserSessionContext();
        } catch (error) {
            console.error('[ChatWidget] Failed to refresh auth before auto support assist:', error);
            return false;
        }

        if (!sessionContext?.user) return false;

        try {
            const detected = await this.callSupportApi('detect_reference', candidate);
            const confidence = Number(detected?.confidence || 0);
            if (!detected || detected.ref_type === 'unknown' || confidence < 0.6) {
                return false;
            }

            try {
                const explanation = await this.callSupportApi('explain_failure', {
                    ref_type: detected.ref_type,
                    ref_id: detected.normalized_value,
                    site: detected.site || window.SiteConfig?.site || 'cn'
                });
                const openedActionId = await this.openAutoSupportAssistPanel(detected, explanation);
                this.appendMessage(
                    this.buildAutoSupportAssistPayload(detected, explanation, openedActionId),
                    this.getMessageRenderType(true),
                    'support-assist',
                    null,
                    true
                );
                return true;
            } catch (explainError) {
                const openedActionId = await this.openAutoSupportAssistPanel(detected, null, explainError?.message || '');
                this.appendMessage(
                    this.buildAutoSupportAssistPayload(detected, null, openedActionId, explainError?.message || ''),
                    this.getMessageRenderType(true),
                    'support-assist',
                    null,
                    true
                );
                return true;
            }
        } catch (error) {
            console.warn('[ChatWidget] Auto support detection skipped:', error?.message || error);
            return false;
        }
    }

    getSupportSubmitLabel(actionId, action) {
        if (actionId === 'redeem_code') {
            return this.getCurrentLanguage() === 'zh' ? '立即兑换' : 'Redeem Now';
        }

        if (action?.mode === 'ticket') {
            return this.getCurrentLanguage() === 'zh' ? '提交工单' : 'Submit Ticket';
        }

        return this.getCurrentLanguage() === 'zh' ? '立即查询' : 'Run Check';
    }

    getSupportSubmittingLabel(action) {
        if (action?.mode === 'ticket') {
            return this.getCurrentLanguage() === 'zh' ? '提交中...' : 'Submitting...';
        }

        if (action?.mode === 'rpc') {
            return this.getCurrentLanguage() === 'zh' ? '兑换中...' : 'Redeeming...';
        }

        return this.getCurrentLanguage() === 'zh' ? '查询中...' : 'Checking...';
    }

    buildSupportResultBlock(state) {
        if (!state?.result && !state?.error) return '';
        const resultClass = state.error ? 'chat-support-result chat-support-result--error' : 'chat-support-result';
        const text = state.error || state.result || '';
        return `
            <div class="${resultClass}">
                <div class="chat-support-result-label">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '处理结果' : 'Result')}</div>
                <div class="chat-support-result-body">${this.escapeHtml(text)}</div>
            </div>
        `;
    }

    buildSupportInlineField(actionId, action, state) {
        const isTextarea = action?.mode === 'ticket';
        const controlClass = isTextarea
            ? 'chat-support-inline-input chat-support-inline-input--textarea'
            : 'chat-support-inline-input';

        return `
            <form class="chat-support-form" data-support-inline-form="${this.escapeHtml(actionId)}">
                ${isTextarea
                    ? `<textarea class="${controlClass}" data-support-inline-input rows="3"></textarea>`
                    : `<input type="text" class="${controlClass}" data-support-inline-input>`}
                <div class="chat-support-form-actions">
                    <button type="submit" class="chat-support-btn" ${state.loading ? 'disabled' : ''}>
                        ${this.escapeHtml(state.loading ? this.getSupportSubmittingLabel(action) : this.getSupportSubmitLabel(actionId, action))}
                    </button>
                    <button type="button" class="chat-support-link-btn" data-support-root="1">
                        ${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '返回主菜单' : 'Back')}
                    </button>
                </div>
            </form>
        `;
    }

    hydrateSupportInlineField(actionId, action) {
        if (!this.supportPanel) return;
        const state = this.getSupportInlineState(actionId);
        const inputEl = this.supportPanel.querySelector('[data-support-inline-input]');
        if (!inputEl) return;

        inputEl.value = state.value || '';
        inputEl.placeholder = this.resolveSupportText(
            action?.placeholder,
            this.t('chat.inputMessagePlaceholder', '输入消息...')
        );

        if (!state.loading) {
            requestAnimationFrame(() => this._focusInputWithoutScroll?.(inputEl));
        }
    }

    renderSupportRootPanel() {
        if (!this.supportPanel) return;

        const config = this.getSupportConfig();
        const context = this.getSupportContextConfig();
        if (!config || !context) {
            this.setSupportDisplayMode('chat');
            this.updateSupportInputState('');
            return;
        }

        this.getSupportInlineState('');
        this.supportView = { type: 'root', id: '' };
        this.supportLastMenuId = '';
        this.setSupportDisplayMode('support');
        this.updateSupportInputState('');

        const shortcutButtons = this.buildSupportMenuButtons(context.shortcuts || []);
        const menuButtons = (config.rootMenus || [])
            .map((menuId) => {
                const menu = this.getSupportMenu(menuId);
                if (!menu) return '';
                return `
                    <button type="button" class="chat-support-btn chat-support-btn--secondary" data-support-menu-id="${this.escapeHtml(menuId)}">
                        ${this.escapeHtml(this.resolveSupportText(menu.title, menuId))}
                    </button>
                `;
            })
            .join('');

        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '自助排查' : 'Self-serve')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.getSupportEntryLabel())}</div>
                <p class="chat-support-body">${this.escapeHtml(this.resolveSupportText(context.intro, '优先帮你处理兑换、发放和任务状态问题。'))}</p>
                <div class="chat-support-section">
                    <div class="chat-support-section-title">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '推荐快捷入口' : 'Recommended')}</div>
                    <div class="chat-support-grid">${shortcutButtons}</div>
                </div>
                <div class="chat-support-section">
                    <div class="chat-support-section-title">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '全部问题分类' : 'Categories')}</div>
                    <div class="chat-support-grid">${menuButtons}</div>
                </div>
            </div>
        `;
    }

    renderSupportMenuPanel(menuId) {
        if (!this.supportPanel) return;
        const menu = this.getSupportMenu(menuId);
        if (!menu) {
            this.renderSupportRootPanel();
            return;
        }

        this.supportView = { type: 'menu', id: menuId };
        this.supportLastMenuId = menuId;
        this.getSupportInlineState('');
        this.setSupportDisplayMode('support');
        this.updateSupportInputState('');

        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '问题分类' : 'Category')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.resolveSupportText(menu.title, menuId))}</div>
                <p class="chat-support-body">${this.escapeHtml(this.resolveSupportText(menu.description, ''))}</p>
                <div class="chat-support-grid">${this.buildSupportMenuButtons(menu.items || [])}</div>
                <div class="chat-support-footer">
                    <button type="button" class="chat-support-link-btn" data-support-root="1">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '返回主菜单' : 'Back')}</button>
                </div>
            </div>
        `;
    }

    renderSupportStaticPanel(actionId) {
        if (!this.supportPanel) return;
        const action = this.getSupportAction(actionId);
        if (!action) {
            this.renderSupportRootPanel();
            return;
        }

        this.supportView = { type: 'action', id: actionId };
        this.supportLastMenuId = this.supportLastMenuId || 'human';
        this.getSupportInlineState('');
        this.setSupportDisplayMode('support');
        this.updateSupportInputState('');

        const checklist = this.buildSupportChecklist(this.resolveSupportText(action.checklist, []));
        const bodyText = this.resolveSupportText(action.body, '');
        const maybeLink = action.mode === 'link'
            ? `
                <div class="chat-support-footer">
                    <button type="button" class="chat-support-btn" data-support-open-link="${this.escapeHtml(action.url || '')}">
                        ${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '打开 Telegram' : 'Open Telegram')}
                    </button>
                </div>
            `
            : '';

        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '操作指引' : 'Guide')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.resolveSupportText(action.label, actionId))}</div>
                ${bodyText ? `<p class="chat-support-body">${this.escapeHtml(bodyText)}</p>` : ''}
                ${checklist}
                ${maybeLink}
                <div class="chat-support-footer">
                    <button type="button" class="chat-support-link-btn" data-support-root="1">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '返回主菜单' : 'Back')}</button>
                </div>
            </div>
        `;
    }

    renderSupportActionPanel(actionId) {
        if (!this.supportPanel) return;
        const action = this.getSupportAction(actionId);
        if (!action) {
            this.renderSupportRootPanel();
            return;
        }

        const state = this.getSupportInlineState(actionId);
        this.supportView = { type: 'action', id: actionId };
        this.setSupportDisplayMode('support');
        this.updateSupportInputState('');

        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '自助处理' : 'Self-serve')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.resolveSupportText(action.label, actionId))}</div>
                <p class="chat-support-body">${this.escapeHtml(this.resolveSupportText(action.prompt, ''))}</p>
                ${this.resolveSupportText(action.inputHint, '') ? `<div class="chat-support-hint">${this.escapeHtml(this.resolveSupportText(action.inputHint, ''))}</div>` : ''}
                ${this.buildSupportInlineField(actionId, action, state)}
                ${this.buildSupportResultBlock(state)}
            </div>
        `;

        this.hydrateSupportInlineField(actionId, action);
    }

    renderSupportLoginRequiredPanel(actionId) {
        if (!this.supportPanel) return;
        const action = this.getSupportAction(actionId);
        this.supportView = { type: 'action', id: actionId };
        this.getSupportInlineState('');
        this.setSupportDisplayMode('support');
        this.updateSupportInputState('');

        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '需要登录' : 'Login Required')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.resolveSupportText(action?.label, actionId || ''))}</div>
                <p class="chat-support-body">${this.escapeHtml(this.getCurrentLanguage() === 'zh'
                    ? '这个操作会读取你的订单、兑换码或任务状态，所以需要先登录当前账号。'
                    : 'This action reads your orders, codes, or tasks, so you need to sign in first.')}</p>
                <div class="chat-support-footer">
                    <button type="button" class="chat-support-link-btn" data-support-root="1">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '返回主菜单' : 'Back')}</button>
                </div>
            </div>
        `;
    }

    async openSupportAction(actionId, nextPanelState = null) {
        const action = this.getSupportAction(actionId);
        if (!action) return;

        if (action.mode === 'live_chat') {
            this.supportView = { type: 'chat', id: actionId };
            this.setSupportDisplayMode('chat');
            requestAnimationFrame(() => {
                this.scrollToBottom();
                this._focusInputWithoutScroll?.(this.input);
            });
            return;
        }

        try {
            await this.refreshUserSessionContext();
        } catch (error) {
            console.error('[ChatWidget] Failed to refresh support auth state:', error);
        }

        if (action.requiresAuth && !this.currentUser) {
            this.renderSupportLoginRequiredPanel(actionId);
            return;
        }

        if (action.mode === 'static' || action.mode === 'link') {
            this.renderSupportStaticPanel(actionId);
            return;
        }

        if (nextPanelState && typeof nextPanelState === 'object') {
            this.setSupportInlineState(actionId, {
                value: typeof nextPanelState.value === 'string' ? nextPanelState.value : '',
                result: typeof nextPanelState.result === 'string' ? nextPanelState.result : '',
                error: typeof nextPanelState.error === 'string' ? nextPanelState.error : '',
                loading: nextPanelState.loading === true
            });
        } else {
            this.getSupportInlineState(actionId);
        }

        this.renderSupportActionPanel(actionId);
    }

    async getSupportAuthHeaders() {
        const { data: { session } } = await this.supabase.auth.getSession();
        const accessToken = session?.access_token || '';
        const headers = {
            'Content-Type': 'application/json'
        };

        if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
        }

        return headers;
    }

    async callSupportApi(action, input) {
        const headers = await this.getSupportAuthHeaders();
        const response = await fetch('/api/support', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action,
                input
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || '支持请求失败');
        }
        return payload.payload || null;
    }

    async callVerifyStatus(taskId) {
        const headers = await this.getSupportAuthHeaders();
        const site = window.SiteConfig?.site || 'cn';
        const response = await fetch(`/api/verify/status/${encodeURIComponent(taskId)}?site=${encodeURIComponent(site)}`, {
            method: 'GET',
            headers
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || '任务状态查询失败');
        }
        return payload;
    }

    getSupportStatusLabel(status) {
        const normalized = String(status || '').trim().toLowerCase();
        const labels = {
            pending: this.getCurrentLanguage() === 'zh' ? '待处理' : 'Pending',
            used: this.getCurrentLanguage() === 'zh' ? '已使用' : 'Used',
            revoked: this.getCurrentLanguage() === 'zh' ? '已撤销' : 'Revoked',
            locked: this.getCurrentLanguage() === 'zh' ? '已锁定' : 'Locked',
            disabled: this.getCurrentLanguage() === 'zh' ? '已禁用' : 'Disabled',
            delivered: this.getCurrentLanguage() === 'zh' ? '已发放' : 'Delivered',
            processing: this.getCurrentLanguage() === 'zh' ? '处理中' : 'Processing',
            queued: this.getCurrentLanguage() === 'zh' ? '排队中' : 'Queued',
            success: this.getCurrentLanguage() === 'zh' ? '已完成' : 'Completed',
            failed: this.getCurrentLanguage() === 'zh' ? '失败' : 'Failed',
            dead_letter: this.getCurrentLanguage() === 'zh' ? '死信' : 'Dead Letter',
            retry_waiting: this.getCurrentLanguage() === 'zh' ? '重试等待中' : 'Retry Waiting',
            requeued: this.getCurrentLanguage() === 'zh' ? '已重排队' : 'Requeued',
            paid: this.getCurrentLanguage() === 'zh' ? '已支付' : 'Paid'
        };
        return labels[normalized] || (normalized || (this.getCurrentLanguage() === 'zh' ? '未知' : 'Unknown'));
    }

    formatSupportResult(actionId, payload) {
        const newline = '\n';
        if (!payload) {
            return this.getCurrentLanguage() === 'zh' ? '没有查到可用结果。' : 'No result found.';
        }

        if (actionId === 'code_status') {
            const valid = payload.valid === true;
            const status = this.getSupportStatusLabel(payload.status);
            const lines = [
                this.getCurrentLanguage() === 'zh' ? '兑换码状态结果' : 'Code Status',
                `${this.getCurrentLanguage() === 'zh' ? '状态' : 'Status'}：${valid ? status : (payload.message || status)}`,
                payload.code ? `${this.getCurrentLanguage() === 'zh' ? '兑换码' : 'Code'}：${payload.code}` : '',
                payload.package_name ? `${this.getCurrentLanguage() === 'zh' ? '套餐' : 'Package'}：${payload.package_name}` : '',
                payload.points ? `${this.getCurrentLanguage() === 'zh' ? '积分' : 'Points'}：${payload.points}` : '',
                payload.used_by ? `${this.getCurrentLanguage() === 'zh' ? '使用者' : 'Used By'}：${payload.used_by}` : '',
                payload.used_at ? `${this.getCurrentLanguage() === 'zh' ? '使用时间' : 'Used At'}：${payload.used_at}` : '',
                payload.expires_at ? `${this.getCurrentLanguage() === 'zh' ? '过期时间' : 'Expires At'}：${payload.expires_at}` : '',
                payload.message && !valid ? `${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${payload.message}` : ''
            ].filter(Boolean);
            return lines.join(newline);
        }

        if (actionId === 'redeem_code') {
            const lines = [
                payload.message || (this.getCurrentLanguage() === 'zh' ? '兑换已处理。' : 'Redeem request completed.'),
                payload.package_name ? `${this.getCurrentLanguage() === 'zh' ? '套餐' : 'Package'}：${payload.package_name}` : '',
                payload.points ? `${this.getCurrentLanguage() === 'zh' ? '到账积分' : 'Points Added'}：${payload.points}` : ''
            ].filter(Boolean);
            return lines.join(newline);
        }

        if (actionId === 'afdian_lookup') {
            const lines = [
                this.getCurrentLanguage() === 'zh' ? '爱发电订单结果' : 'Afdian Order',
                `${this.getCurrentLanguage() === 'zh' ? '支付状态' : 'Payment'}：${this.getSupportStatusLabel(payload.payment_status)}`,
                payload.code ? `${this.getCurrentLanguage() === 'zh' ? '兑换码' : 'Code'}：${payload.code}` : '',
                payload.points ? `${this.getCurrentLanguage() === 'zh' ? '积分' : 'Points'}：${payload.points}` : '',
                `${this.getCurrentLanguage() === 'zh' ? '领取状态' : 'Claim Status'}：${payload.is_redeemed ? (this.getCurrentLanguage() === 'zh' ? '已领取' : 'Claimed') : (this.getCurrentLanguage() === 'zh' ? '未领取' : 'Not Claimed')}`,
                payload.sign_verified !== undefined ? `${this.getCurrentLanguage() === 'zh' ? '签名校验' : 'Signature'}：${payload.sign_verified ? (this.getCurrentLanguage() === 'zh' ? '通过' : 'Passed') : (this.getCurrentLanguage() === 'zh' ? '未通过' : 'Not Passed')}` : '',
                payload.amount_verified !== undefined ? `${this.getCurrentLanguage() === 'zh' ? '金额校验' : 'Amount'}：${payload.amount_verified ? (this.getCurrentLanguage() === 'zh' ? '通过' : 'Passed') : (this.getCurrentLanguage() === 'zh' ? '未通过' : 'Not Passed')}` : '',
                payload.last_error ? `${this.getCurrentLanguage() === 'zh' ? '最近错误' : 'Last Error'}：${payload.last_error}` : ''
            ].filter(Boolean);
            return lines.join(newline);
        }

        if (actionId === 'shop_order_status') {
            const lines = [
                this.getCurrentLanguage() === 'zh' ? '商城订单状态' : 'Shop Order Status',
                `${this.getCurrentLanguage() === 'zh' ? '订单号' : 'Order ID'}：${payload.id}`,
                payload.snapshot_product_name ? `${this.getCurrentLanguage() === 'zh' ? '商品' : 'Product'}：${payload.snapshot_product_name}` : '',
                `${this.getCurrentLanguage() === 'zh' ? '发放状态' : 'Delivery'}：${this.getSupportStatusLabel(payload.delivery_status)}`,
                payload.delivery_task_id ? `${this.getCurrentLanguage() === 'zh' ? '任务号' : 'Task ID'}：${payload.delivery_task_id}` : '',
                payload.delivery_last_error ? `${this.getCurrentLanguage() === 'zh' ? '最近错误' : 'Last Error'}：${payload.delivery_last_error}` : '',
                payload.delivery_completed_at ? `${this.getCurrentLanguage() === 'zh' ? '完成时间' : 'Completed At'}：${payload.delivery_completed_at}` : '',
                payload.created_at ? `${this.getCurrentLanguage() === 'zh' ? '下单时间' : 'Created At'}：${payload.created_at}` : ''
            ].filter(Boolean);
            return lines.join(newline);
        }

        if (actionId === 'shop_order_content') {
            const items = Array.isArray(payload.items) ? payload.items : [];
            const lines = [
                this.getCurrentLanguage() === 'zh' ? '订单内容摘要' : 'Order Content Summary',
                payload.order_id ? `${this.getCurrentLanguage() === 'zh' ? '订单号' : 'Order ID'}：${payload.order_id}` : '',
                payload.product_name ? `${this.getCurrentLanguage() === 'zh' ? '商品' : 'Product'}：${payload.product_name}` : ''
            ];
            items.slice(0, 3).forEach((item, index) => {
                const content = String(item?.content || '').trim();
                const summary = content.length > 90 ? `${content.slice(0, 90)}...` : content;
                lines.push(`${this.getCurrentLanguage() === 'zh' ? '内容' : 'Item'} ${index + 1}：${summary || (this.getCurrentLanguage() === 'zh' ? '暂无内容' : 'No content')}`);
            });
            if (items.length > 3) {
                lines.push(this.getCurrentLanguage() === 'zh' ? '内容较多，建议去钱包订单详情页复制完整结果。' : 'There are more items. Open the wallet order detail to copy the full result.');
            }
            return lines.filter(Boolean).join(newline);
        }

        if (actionId === 'verify_task_status' || actionId === 'verify_failure_help') {
            const lines = [
                this.getCurrentLanguage() === 'zh' ? '验证任务状态' : 'Verify Task Status',
                payload.job_id ? `${this.getCurrentLanguage() === 'zh' ? '任务号' : 'Task ID'}：${payload.job_id}` : '',
                `${this.getCurrentLanguage() === 'zh' ? '当前状态' : 'Status'}：${this.getSupportStatusLabel(payload.status)}`,
                payload.stage_label ? `${this.getCurrentLanguage() === 'zh' ? '阶段' : 'Stage'}：${payload.stage_label}` : '',
                payload.queue_position !== undefined && payload.queue_position !== null ? `${this.getCurrentLanguage() === 'zh' ? '队列位置' : 'Queue Position'}：${payload.queue_position}` : '',
                payload.estimated_wait_seconds ? `${this.getCurrentLanguage() === 'zh' ? '预计等待秒数' : 'Estimated Wait (s)'}：${payload.estimated_wait_seconds}` : '',
                payload.message ? `${this.getCurrentLanguage() === 'zh' ? '说明' : 'Message'}：${payload.message}` : '',
                payload.url ? `${this.getCurrentLanguage() === 'zh' ? '结果链接' : 'Result URL'}：${payload.url}` : '',
                payload.error ? `${this.getCurrentLanguage() === 'zh' ? '错误原因' : 'Error'}：${payload.error}` : ''
            ].filter(Boolean);

            if (actionId === 'verify_failure_help' && String(payload.status || '').toLowerCase() !== 'failed') {
                lines.push(this.getCurrentLanguage() === 'zh'
                    ? '这个任务当前不处于失败状态。如果你是要查进度，建议用“查询任务进度”。'
                    : 'This task is not currently failed. If you only want progress, use “Check Task Status”.');
            }

            return lines.join(newline);
        }

        if (actionId === 'create_ticket') {
            return [
                this.getCurrentLanguage() === 'zh' ? '工单已提交。' : 'Ticket submitted.',
                payload.ticket_id ? `${this.getCurrentLanguage() === 'zh' ? '工单号' : 'Ticket ID'}：${payload.ticket_id}` : '',
                this.getCurrentLanguage() === 'zh' ? '客服会在后台看到你的描述并继续处理。' : 'Support will see your description and continue from there.'
            ].filter(Boolean).join(newline);
        }

        return JSON.stringify(payload, null, 2);
    }

    async handleSupportActionSubmission(actionId, input) {
        const action = this.getSupportAction(actionId);
        if (!action) {
            return {
                success: false,
                message: this.getCurrentLanguage() === 'zh' ? '没有找到对应操作。' : 'Action not found.'
            };
        }

        try {
            let payload = null;

            if (action.mode === 'support_api') {
                payload = await this.callSupportApi(action.apiAction, input);
            } else if (action.mode === 'rpc') {
                const site = window.SiteConfig?.site || 'cn';
                const { data, error } = await this.supabase.rpc(action.rpcName, {
                    p_code: String(input || '').trim(),
                    p_site: site
                });
                if (error) throw error;
                if (data?.success === false) {
                    throw new Error(data.message || '操作失败');
                }
                payload = data;
            } else if (action.mode === 'verify_status') {
                payload = await this.callVerifyStatus(String(input || '').trim());
            } else if (action.mode === 'ticket') {
                payload = await this.callSupportApi('create_ticket', input);
            }

            return {
                success: true,
                message: this.formatSupportResult(actionId, payload)
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || (this.getCurrentLanguage() === 'zh' ? '处理失败，请稍后重试。' : 'Request failed. Please try again later.')
            };
        }
    }

    async handleSupportPanelSubmit(event) {
        const form = event.target instanceof Element ? event.target.closest('[data-support-inline-form]') : null;
        if (!form) return;

        event.preventDefault();

        const actionId = form.getAttribute('data-support-inline-form') || '';
        const action = this.getSupportAction(actionId);
        const inputEl = form.querySelector('[data-support-inline-input]');
        const rawValue = typeof inputEl?.value === 'string' ? inputEl.value : '';
        const trimmedValue = rawValue.trim();

        if (!action) return;

        if (!trimmedValue) {
            this.supportInlineState = {
                actionId,
                value: rawValue,
                result: '',
                error: this.getCurrentLanguage() === 'zh' ? '先输入内容再提交。' : 'Enter something before submitting.',
                loading: false
            };
            this.renderSupportActionPanel(actionId);
            return;
        }

        this.supportInlineState = {
            actionId,
            value: rawValue,
            result: '',
            error: '',
            loading: true
        };
        this.renderSupportActionPanel(actionId);

        const outcome = await this.handleSupportActionSubmission(actionId, trimmedValue);
        this.supportInlineState = {
            actionId,
            value: rawValue,
            result: outcome?.success ? (outcome.message || '') : '',
            error: outcome?.success ? '' : (outcome?.message || ''),
            loading: false
        };
        this.renderSupportActionPanel(actionId);
    }

    handleSupportPanelClick(event) {
        const button = event.target instanceof Element ? event.target.closest('[data-support-action-id], [data-support-menu-id], [data-support-root], [data-support-open-link]') : null;
        if (!button) return;

        if (button.hasAttribute('data-support-root')) {
            this.renderSupportRootPanel();
            return;
        }

        const menuId = button.getAttribute('data-support-menu-id');
        if (menuId) {
            this.renderSupportMenuPanel(menuId);
            return;
        }

        const actionId = button.getAttribute('data-support-action-id');
        if (actionId) {
            this.openSupportAction(actionId);
            return;
        }

        const url = button.getAttribute('data-support-open-link');
        if (url) {
            window.open(url, '_blank', 'noopener');
        }
    }

    handleSupportAssistMessageClick(event) {
        const button = event.target instanceof Element
            ? event.target.closest('[data-support-chat-action-id], [data-support-chat-root]')
            : null;
        if (!button) return;

        event.preventDefault();

        if (button.hasAttribute('data-support-chat-root')) {
            this.renderSupportRootPanel();
            return;
        }

        const actionId = String(button.getAttribute('data-support-chat-action-id') || '').trim();
        if (!actionId) return;

        const assistState = button._supportAssistState || null;
        const panelState = assistState
            ? {
                value: this.buildAutoSupportPrefillValue(actionId, assistState.detected, assistState.explanation),
                result: this.formatAutoSupportPanelResult(assistState.detected, assistState.explanation, assistState.fallbackError),
                error: '',
                loading: false
            }
            : null;

        this.openSupportAction(actionId, panelState);
    }

    _detectRefreshRate() {
        if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
        const samples = [];
        let lastTs = 0;
        let remaining = 8;

        const step = (ts) => {
            if (lastTs) {
                samples.push(ts - lastTs);
                remaining -= 1;
            }
            lastTs = ts;
            if (remaining > 0) {
                requestAnimationFrame(step);
                return;
            }
            const sorted = samples.filter((v) => v > 0).sort((a, b) => a - b);
            if (!sorted.length) return;
            const median = sorted[Math.floor(sorted.length / 2)];
            const hz = Math.round(1000 / median);
            if (Number.isFinite(hz) && hz >= 50) {
                this._estimatedRefreshHz = hz;
                this._isHighRefreshDisplay = hz >= 90;
            }
        };

        requestAnimationFrame(step);
    }

    _closeEmojiPicker() {
        if (this.emojiPicker) {
            this.emojiPicker.classList.remove('active');
        }
    }

    _bindEmojiPicker(emojiBtn) {
        if (!emojiBtn || !this.emojiPicker) return;

        if (this._onEmojiDismissClick) {
            document.removeEventListener('click', this._onEmojiDismissClick);
        }

        emojiBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.emojiPicker.classList.toggle('active');
        });

        this.emojiPicker.addEventListener('click', (e) => {
            e.stopPropagation();
            const emojiItem = e.target instanceof Element ? e.target.closest('.emoji-item') : null;
            if (!emojiItem) return;
            if (this.input) {
                this.input.value += emojiItem.textContent;
                this._focusInputWithoutScroll(this.input);
            }
            this._closeEmojiPicker();
        });

        this._onEmojiDismissClick = (e) => {
            if (!this.emojiPicker?.classList.contains('active')) return;
            if (this.emojiPicker.contains(e.target) || emojiBtn.contains(e.target)) return;
            this._closeEmojiPicker();
        };
        document.addEventListener('click', this._onEmojiDismissClick);
    }

    _getAdaptiveKeyboardDuration(frames, minMs, maxMs) {
        const hz = Math.max(50, this._estimatedRefreshHz || 60);
        const ms = Math.round((frames * 1000) / hz);
        return Math.max(minMs, Math.min(maxMs, ms));
    }

    _setChatTranslateVars(baseTranslateY = '-50%', shiftY = 0) {
        if (!this.chatWindow) return;
        const normalizedBase = typeof baseTranslateY === 'number' ? `${Math.round(baseTranslateY)}px` : String(baseTranslateY);
        const normalizedShift = typeof shiftY === 'number' ? `${Math.round(shiftY)}px` : String(shiftY);
        this._setRuntimeStyle(this.chatWindow, '--chat-base-translate-y', normalizedBase);
        this._setRuntimeStyle(this.chatWindow, '--chat-shift-y', normalizedShift);
    }

    _setRuntimeStyle(target, prop, value, priority = '') {
        const style = target?.style;
        if (!style) return;
        const removeProperty = style['removeProperty'].bind(style);
        const setProperty = style['setProperty'].bind(style);
        if (value === null || value === undefined || value === '') {
            removeProperty(prop);
            return;
        }
        setProperty(prop, String(value), priority);
    }

    _toggleElementClass(target, className, enabled) {
        if (!target) return;
        target.classList.toggle(className, enabled);
    }

    _setChatWindowKeyboardAnimating(enabled, durationMs = 120) {
        if (!this.chatWindow) return;
        this._toggleElementClass(this.chatWindow, 'chat-window--keyboard-animating', enabled);
        this._setRuntimeStyle(
            this.chatWindow,
            '--chat-keyboard-motion-duration',
            enabled ? `${Math.max(0, Math.round(durationMs))}ms` : null
        );
    }

    _setChatWindowDockHeight(heightPx) {
        if (!this.chatWindow) return;
        const hasHeight = Number.isFinite(heightPx) && heightPx > 0;
        this._toggleElementClass(this.chatWindow, 'chat-window--keyboard-height-locked', hasHeight);
        this._setRuntimeStyle(
            this.chatWindow,
            '--chat-keyboard-dock-height',
            hasHeight ? `${Math.round(heightPx)}px` : null,
            'important'
        );
    }

    _setChatWindowDockBottom(bottomPx) {
        if (!this.chatWindow) return;
        const hasBottom = Number.isFinite(bottomPx);
        this._toggleElementClass(this.chatWindow, 'chat-window--keyboard-bottom-docked', hasBottom);
        this._setRuntimeStyle(
            this.chatWindow,
            '--chat-keyboard-bottom',
            hasBottom ? `${Math.max(0, Math.round(bottomPx))}px` : null,
            'important'
        );
    }

    _setMessagesContainerMinHeight(heightPx) {
        if (!this.messagesContainer) return;
        const hasHeight = Number.isFinite(heightPx) && heightPx > 0;
        this._toggleElementClass(this.messagesContainer, 'chat-messages--height-locked', hasHeight);
        this._setRuntimeStyle(
            this.messagesContainer,
            '--chat-messages-runtime-min-height',
            hasHeight ? `${Math.round(heightPx)}px` : null
        );
    }

    _ensureThemeColorMeta() {
        if (this._themeColorMeta?.isConnected) return this._themeColorMeta;
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
            meta.setAttribute('data-chat-theme-created', 'true');
            document.head.appendChild(meta);
        }
        this._themeColorMeta = meta;
        return meta;
    }

    _lockThemeColor() {
        if (!(this._isIOSMobile() && this._isNarrowViewport())) return;
        const meta = this._ensureThemeColorMeta();
        if (!meta) return;
        if (!meta.hasAttribute('data-chat-theme-restore')) {
            meta.setAttribute('data-chat-theme-restore', meta.getAttribute('content') || '');
        }
        this._themeColorRestoreContent = meta.getAttribute('data-chat-theme-restore') || '';
        meta.setAttribute('content', '#000000');
    }

    _unlockThemeColor() {
        const meta = this._themeColorMeta || document.querySelector('meta[name="theme-color"]');
        if (!meta) return;

        // Clean up totally if the chat widget created the tag
        if (meta.hasAttribute('data-chat-theme-created')) {
            if (meta.parentNode) meta.parentNode.removeChild(meta);
            this._themeColorMeta = null;
            this._themeColorRestoreContent = '';
            return;
        }

        const restoreContent = meta.getAttribute('data-chat-theme-restore');
        if (restoreContent === null) return;

        // Force Safari iOS 15+ Repaint Hack
        meta.removeAttribute('content');

        setTimeout(() => {
            if (!meta.isConnected) return;
            if (restoreContent === '') {
                meta.removeAttribute('content');
            } else {
                meta.setAttribute('content', restoreContent);
            }
            meta.removeAttribute('data-chat-theme-restore');
            this._themeColorRestoreContent = '';
        }, 50);
    }

    _ensureStatusBarShield() {
        if (this._statusBarShield) return;
        const shield = document.createElement('div');
        shield.className = 'chat-status-bar-shield';
        document.body.appendChild(shield);
        this._statusBarShield = shield;
    }

    _showStatusBarShield() {
        if (!(this._isIOSMobile() && this._isNarrowViewport())) return;
        this._ensureStatusBarShield();
        if (!this._statusBarShield) return;
        this._statusBarShield.classList.add('is-visible');
        this._lockThemeColor();
    }

    _hideStatusBarShield() {
        if (!this._statusBarShield) return;
        this._statusBarShield.classList.remove('is-visible');
        setTimeout(() => {
            if (!this._statusBarShield || this.isOpen) return;
            this._statusBarShield.classList.remove('is-visible');
        }, 90);
        this._unlockThemeColor();
    }

    _setFabHidden(hidden) {
        if (!this.fab) return;
        this.fab.classList.toggle('chat-widget-fab--hidden', hidden);
    }

    _setFabDisabled(disabled) {
        if (!this.fab) return;
        this.fab.classList.toggle('chat-widget-fab--disabled', disabled);
    }

    _setFabTransitionless(enabled) {
        if (!this.fab) return;
        this.fab.classList.toggle('chat-widget-fab--transitionless', enabled);
    }

    _setChatWindowForceHidden(hidden) {
        if (!this.chatWindow) return;
        this.chatWindow.classList.toggle('chat-window--force-hidden', hidden);
    }

    _setChatWindowTransitionless(enabled) {
        if (!this.chatWindow) return;
        this.chatWindow.classList.toggle('chat-window--transitionless', enabled);
    }

    _setSessionItemHidden(item, hidden) {
        if (!item) return;
        item.classList.toggle('session-item--hidden', hidden);
    }

    _scheduleStableKeyboardInset(bottomInset) {
        if (!Number.isFinite(bottomInset) || bottomInset < 40) return;
        this._pendingStableKeyboardInset = bottomInset;
        this._clearKeyboardSettleTimer();
        this._keyboardSettleTimer = setTimeout(() => {
            this._keyboardSettleTimer = null;
            this._lastStableKeyboardInset = this._pendingStableKeyboardInset;
        }, this._isHighRefreshDisplay ? 110 : 80);
    }

    getSessionId() {
        let sid = localStorage.getItem('chat_session_id');
        if (!sid) {
            sid = 'guest_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('chat_session_id', sid);
        }
        return sid;
    }

    getAuthenticatedSessionId(user) {
        if (!user?.id) return '';
        return `user_${user.id}`;
    }

    getLegacyAuthenticatedSessionIds(user) {
        const rawEmail = typeof user?.email === 'string' ? user.email.trim() : '';
        const normalizedEmail = rawEmail.toLowerCase();
        return [rawEmail, normalizedEmail].filter(Boolean);
    }

    getActiveUserSessionIds() {
        if (Array.isArray(this.userSessionIds) && this.userSessionIds.length > 0) {
            return [...new Set(this.userSessionIds.filter(Boolean))];
        }
        return this.sessionId ? [this.sessionId] : [];
    }

    async refreshUserSessionContext() {
        const { data: { user } } = await this.supabase.auth.getUser();
        this.currentUser = user || null;

        if (user) {
            const primarySessionId = this.getAuthenticatedSessionId(user);
            this.userSessionIds = [primarySessionId, ...this.getLegacyAuthenticatedSessionIds(user)].filter(Boolean);
            this.sessionId = primarySessionId;
            return { user, sessionId: primarySessionId, sessionIds: this.getActiveUserSessionIds() };
        }

        const guestSessionId = this.getSessionId();
        this.userSessionIds = [guestSessionId];
        this.sessionId = guestSessionId;
        return { user: null, sessionId: guestSessionId, sessionIds: this.getActiveUserSessionIds() };
    }

    async resolveAdminModeAccess() {
        try {
            const access = await window.AdminAccess?.getCurrentAdminAccess?.({ forceRefresh: true });
            if (access?.user && typeof access.isAdmin === 'boolean') {
                return Boolean(access.isAdmin);
            }
        } catch (error) {
            console.warn('[ChatWidget] AdminAccess lookup failed:', error);
        }

        try {
            const { data: { user } = {} } = await this.supabase.auth.getUser();
            if (!user) return false;

            const { data: adminFlag, error: adminError } = await this.supabase.rpc('is_admin');
            if (adminError) {
                console.warn('[ChatWidget] Failed to verify admin status:', adminError);
                return false;
            }

            return Boolean(adminFlag);
        } catch (error) {
            console.error('[ChatWidget] Admin status fallback failed:', error);
            return false;
        }
    }

    async init() {
        this.renderFAB();
        this.bindFabEvents();
        this._scheduleFabAmbientMotion();

        const isAdmin = await this.resolveAdminModeAccess();
        window.isAdmin = isAdmin;

        if (isAdmin) {
            this.renderAdminMode();

            // Listen for language changes and update text
            window.addEventListener('languageChanged', () => {
                if (this.isAdmin && this.chatWindow) {
                    this.updateAdminModeText();
                }
            });
        } else {
            try {
                await this.refreshUserSessionContext();
            } catch (e) { console.error('Failed to get user for session:', e); }

            this.renderUserMode();
            window.addEventListener('languageChanged', () => {
                if (!this.isAdmin && this.chatWindow) {
                    const titleEl = this.chatWindow.querySelector('.chat-title h3');
                    if (titleEl) {
                        titleEl.textContent = this.t('chat.onlineSupport', '在线客服');
                    }
                    const currentView = this.supportView?.type || 'root';
                    if (currentView === 'menu' && this.supportView?.id) {
                        this.renderSupportMenuPanel(this.supportView.id);
                    } else if (currentView === 'chat') {
                        this.syncSupportShellState();
                    } else if (currentView === 'action' && this.supportView?.id) {
                        const action = this.getSupportAction(this.supportView.id);
                        if (action?.mode === 'static' || action?.mode === 'link') {
                            this.renderSupportStaticPanel(this.supportView.id);
                        } else {
                            this.renderSupportActionPanel(this.supportView.id);
                        }
                    } else {
                        this.renderSupportRootPanel();
                    }
                }
            });
            // User mode specific logic
            this.bindUserEvents(); // Split bindEvents
            this.subscribeToMessages();
            this.loadHistory();
            this.checkAdminStatus();
            setInterval(() => this.checkAdminStatus(), 60000);
        }
    }

    async checkAdminStatus() {
        try {
            const sessionIds = this.getActiveUserSessionIds();
            if (!sessionIds.length) {
                this.unlockScroll();
                return;
            }

            // Find the latest message from an admin
            let query = this.supabase
                .from('chat_messages')
                .select('created_at')
                .eq('is_admin', true)
                .order('created_at', { ascending: false })
                .limit(1);

            query = sessionIds.length === 1
                ? query.eq('session_id', sessionIds[0])
                : query.in('session_id', sessionIds);

            const { data, error } = await query.single();

            const statusText = this.chatWindow.querySelector('.target-admin-status');
            const statusDot = this.chatWindow.querySelector('.status-dot');

            if (!statusText || !statusDot) return;

            if (error || !data) {
                // No admin history, default to just "Active" or similar, or keep "Online" for positivity
                // But honestly, if no data, maybe "admin offline"
                statusText.innerText = this.t('chat.adminOffline', '管理员离线');
                statusDot.className = "status-dot offline";
                return;
            }

            const lastActive = new Date(data.created_at);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastActive) / (1000 * 60));

            if (diffMinutes < 15) {
                statusText.innerText = this.t('chat.adminOnline', '管理员在线');
                statusDot.className = "status-dot online";
            } else if (diffMinutes < 60) {
                statusText.innerText = this.t('chat.minutesAgo', '{minutes}分钟前在线').replace('{minutes}', diffMinutes);
                statusDot.className = "status-dot away";
            } else if (diffMinutes < 1440) {
                const hours = Math.floor(diffMinutes / 60);
                statusText.innerText = this.t('chat.hoursAgo', '{hours}小时前在线').replace('{hours}', hours);
                statusDot.className = "status-dot away";
            } else {
                statusText.innerText = this.t('chat.adminOffline', '管理员离线');
                statusDot.className = "status-dot offline";
            }

        } catch (err) {
            console.error('Error checking admin status:', err);
        }
    }

    renderFAB() {
        // Create FAB with Custom Mascot (CSS Art)
        this.fab = document.createElement('div');
        this.fab.className = 'chat-widget-fab chat-widget-fab--peek';
        this.fab.innerHTML = `
            <div class="chat-widget-fab__robot" aria-hidden="true">
                <span class="chat-widget-fab__glow"></span>
                <div class="mascot-wrapper">
                    <div class="mascot-head">
                        <div class="mascot-face">
                            <div class="mascot-eyes">
                                <span class="eye left"></span>
                                <span class="eye right"></span>
                            </div>
                            <div class="mascot-mouth"></div>
                        </div>
                    </div>
                </div>
            </div>
            <span class="chat-widget-fab__shadow" aria-hidden="true"></span>
        `;
        document.body.appendChild(this.fab);
    }

    bindFabEvents() {
        this.fab.addEventListener('mouseenter', () => {
            this._fabHovering = true;
            this._pauseFabAmbientMotion();
        });

        this.fab.addEventListener('mouseleave', () => {
            this._fabHovering = false;
            this._scheduleFabAmbientMotion();
        });

        if (!this._onFabAmbientViewportChange) {
            this._onFabAmbientViewportChange = () => {
                if (this._fabHovering) {
                    this._pauseFabAmbientMotion();
                } else {
                    this._scheduleFabAmbientMotion(9000);
                }
            };
            window.addEventListener('resize', this._onFabAmbientViewportChange);
        }

        this.fab.addEventListener('click', () => {
            this.toggleChat();
            // Clear unread count when opening chat
            if (this.isOpen) {
                this.clearUnread();
            }
        });
    }

    _clearFabAmbientMotionTimers() {
        if (this._fabAmbientPeekTimer) {
            clearTimeout(this._fabAmbientPeekTimer);
            this._fabAmbientPeekTimer = null;
        }
        if (this._fabAmbientReturnTimer) {
            clearTimeout(this._fabAmbientReturnTimer);
            this._fabAmbientReturnTimer = null;
        }
        if (this._fabAmbientResumeTimer) {
            clearTimeout(this._fabAmbientResumeTimer);
            this._fabAmbientResumeTimer = null;
        }
    }

    _setFabAmbientRetracted(retracted) {
        if (!this.fab) return;
        this.fab.classList.toggle('chat-widget-fab--ambient-retracted', Boolean(retracted));
    }

    _shouldRunFabAmbientMotion() {
        if (!this.fab || this.isOpen) return false;
        if (this._fabHovering) return false;
        if (this.fab.classList.contains('chat-widget-fab--hidden')) return false;
        if (this.fab.classList.contains('chat-widget-fab--disabled')) return false;
        if (this.fab.classList.contains('has-new-message')) return false;
        if (this.fab.classList.contains('wiggle')) return false;
        if (this.fab.querySelector('.message-preview')) return false;
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false;
        if (this._isNarrowViewport()) return false;
        return true;
    }

    _scheduleFabAmbientMotion(delayMs = null) {
        this._clearFabAmbientMotionTimers();
        this._setFabAmbientRetracted(true);

        if (!this._shouldRunFabAmbientMotion()) return;

        const delay = Number.isFinite(delayMs) ? delayMs : 4000 + Math.round(Math.random() * 4000);
        this._fabAmbientPeekTimer = setTimeout(() => {
            this._fabAmbientPeekTimer = null;

            if (!this._shouldRunFabAmbientMotion()) {
                this._setFabAmbientRetracted(true);
                return;
            }

            this._setFabAmbientRetracted(false);
            this._fabAmbientReturnTimer = setTimeout(() => {
                this._fabAmbientReturnTimer = null;
                this._setFabAmbientRetracted(true);
                this._scheduleFabAmbientMotion();
            }, 4200 + Math.round(Math.random() * 1600));
        }, delay);
    }

    _pauseFabAmbientMotion(resumeDelayMs = null, keepExposed = false) {
        this._clearFabAmbientMotionTimers();
        this._setFabAmbientRetracted(!keepExposed);

        if (!Number.isFinite(resumeDelayMs) || resumeDelayMs < 0) return;

        this._fabAmbientResumeTimer = setTimeout(() => {
            this._fabAmbientResumeTimer = null;
            this._scheduleFabAmbientMotion();
        }, resumeDelayMs);
    }

    // ===== Notification System =====

    showNotification(message, senderName = null, forceShow = false) {
        senderName = senderName || this.t('chat.newMessage', '新消息');
        // Don't show notification if chat is open (unless forceShow is true)
        if (this.isOpen && !forceShow) return;

        // Increment unread count
        this.unreadCount++;
        this.updateBadge();
        this._pauseFabAmbientMotion(6200, true);

        // Add animation classes
        this.fab.classList.add('has-unread');
        this.fab.classList.add('has-new-message');

        // Remove bounce animation after it completes
        setTimeout(() => {
            this.fab.classList.remove('has-new-message');
        }, 600);

        // Add wiggle animation
        setTimeout(() => {
            this.fab.classList.add('wiggle');
            setTimeout(() => this.fab.classList.remove('wiggle'), 500);
        }, 700);

        // Show message preview tooltip
        this.showMessagePreview(message, senderName);

        // Play notification sound (optional - subtle)
        this.playNotificationSound();
    }

    updateBadge() {
        // Remove existing badge
        const existingBadge = this.fab.querySelector('.notification-badge');
        if (existingBadge) existingBadge.remove();

        if (this.unreadCount > 0) {
            const badge = document.createElement('div');
            badge.className = 'notification-badge';
            badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
            this.fab.appendChild(badge);
        }
    }

    clearUnread() {
        this.unreadCount = 0;
        this.fab.classList.remove('has-unread');
        const badge = this.fab.querySelector('.notification-badge');
        if (badge) badge.remove();
        const preview = this.fab.querySelector('.message-preview');
        if (preview) preview.remove();
    }

    showMessagePreview(message, senderName) {
        // Remove existing preview
        const existingPreview = this.fab.querySelector('.message-preview');
        if (existingPreview) existingPreview.remove();

        // Create preview tooltip
        const preview = document.createElement('div');
        preview.className = 'message-preview';
        preview.innerHTML = `
            <div class="preview-sender">${senderName}</div>
            <div class="preview-text">${this.escapeHtml(message.substring(0, 100))}${message.length > 100 ? '...' : ''}</div>
        `;
        this.fab.appendChild(preview);

        // Auto-hide after 5 seconds with cute retract animation
        setTimeout(() => {
            if (preview.parentNode) {
                preview.classList.add('hiding');
                setTimeout(() => {
                    preview.remove();
                    this._scheduleFabAmbientMotion();
                }, 400);
            }
        }, 5000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    sanitizeMediaUrl(url) {
        if (typeof url !== 'string' || !url.trim()) return '';

        const trimmed = url.trim();
        if (trimmed.startsWith('data:image/')) return trimmed;

        try {
            const parsed = new URL(trimmed, window.location.origin);
            if (['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
                return parsed.href;
            }
        } catch (err) {
            console.warn('[ChatWidget] Blocked unsafe media URL:', trimmed, err);
        }

        return '';
    }

    playNotificationSound() {
        // Create a subtle notification sound using Web Audio API
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.1);

            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.15);
        } catch (e) {
            // Audio not supported, ignore
        }
    }

    // ===== End Notification System =====

    renderAdminMode() {
        // Two-column layout: Left = Session List, Right = Chat Area
        this.isAdmin = true;
        this.currentSessionId = null;
        this.currentSessionKey = null;
        this.currentSessionIds = [];
        this.sessions = [];

        this.chatWindow = document.createElement('div');
        this.chatWindow.className = 'chat-window admin-mode-layout';

        // Create overlay for clicking outside to close
        this.overlay = document.createElement('div');
        this.overlay.className = 'chat-overlay';
        document.body.appendChild(this.overlay);

        this.chatWindow.innerHTML = `
            <!-- Left Sidebar: Session List -->
            <div class="admin-sidebar">
                <div class="admin-sidebar-header">
                    <h3>${this.t('chat.sidebarTitle', '客服消息')}</h3>
                    <button class="chat-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="admin-search">
                    <input type="text" id="sessionSearch" placeholder="🔍 ${this.t('chat.searchPlaceholderFull', '搜索会话或聊天记录...')}">
                </div>
                <div class="session-list" id="sessionList">
                    <div class="session-loading">${this.t('chat.loading', '加载中...')}</div>
                </div>
            </div>
            
            <!-- Right Panel: Chat Area -->
            <div class="admin-chat-area">
                <div class="admin-chat-header" id="adminChatHeader">
                    <button class="back-to-list-btn" id="backToListBtn">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                    <div class="chat-user-info">
                        <span class="chat-user-name">${this.t('chat.selectConversation', '选择一个会话')}</span>
                        <span class="chat-user-id"></span>
                    </div>
                </div>
                <div class="chat-messages" id="chatMessages">
                    <div class="empty-state">
                        <i class="fas fa-comments"></i>
                        <p>${this.t('chat.emptyState', '请从左侧选择一个会话开始回复')}</p>
                    </div>
                </div>
                <div class="chat-input-area">
                    <input type="file" id="chatImageInput" class="chat-file-input" accept="image/*">
                    <button class="chat-action-btn" id="chatUploadBtn"><i class="fas fa-plus"></i></button>
                    <input type="text" class="chat-input" id="chatInput" placeholder="${this.t('chat.inputPlaceholder', '输入回复...')}">
                    <button class="chat-action-btn" id="chatEmojiBtn"><i class="far fa-smile"></i></button>
                    <button class="chat-send-btn" id="chatSendBtn"><i class="fas fa-paper-plane"></i></button>
                </div>
                <div class="emoji-picker-popover" id="emojiPicker">
                    ${this.emojis.map(e => `<div class="emoji-item">${e}</div>`).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(this.chatWindow);

        this.messagesContainer = this.chatWindow.querySelector('#chatMessages');
        this.input = this.chatWindow.querySelector('#chatInput');
        this.emojiPicker = this.chatWindow.querySelector('#emojiPicker');
        this.sessionList = this.chatWindow.querySelector('#sessionList');
        this.chatHeader = this.chatWindow.querySelector('#adminChatHeader');

        // Inject admin layout styles
        this.injectAdminLayoutStyles();

        // Bind events
        this.bindAdminEvents();

        // Load sessions
        this.loadAdminSessions();

        // Subscribe to all messages for admin
        this.subscribeToAdminMessages();
        this.startAdminOpsAlertPolling();
    }

    // Update admin mode text when language changes
    updateAdminModeText() {
        if (!this.chatWindow || !this.isAdmin) return;

        // Update sidebar header title
        const sidebarTitle = this.chatWindow.querySelector('.admin-sidebar-header h3');
        if (sidebarTitle) {
            sidebarTitle.textContent = this.t('chat.sidebarTitle', '客服消息');
        }

        // Update search placeholder
        const searchInput = this.chatWindow.querySelector('#sessionSearch');
        if (searchInput) {
            searchInput.placeholder = `🔍 ${this.t('chat.searchPlaceholderFull', '搜索会话或聊天记录...')}`;
        }

        // Update chat header (if no session selected)
        const chatUserName = this.chatWindow.querySelector('.chat-user-name');
        if (chatUserName && !this.currentSessionKey) {
            chatUserName.textContent = this.t('chat.selectConversation', '选择一个会话');
        }

        // Update empty state message
        const emptyState = this.chatWindow.querySelector('.empty-state p');
        if (emptyState) {
            emptyState.textContent = this.t('chat.emptyState', '请从左侧选择一个会话开始回复');
        }

        // Update input placeholder
        const chatInput = this.chatWindow.querySelector('#chatInput');
        if (chatInput) {
            chatInput.placeholder = this.t('chat.inputPlaceholder', '输入回复...');
        }

        // Update loading text if visible
        const loadingText = this.chatWindow.querySelector('.session-loading');
        if (loadingText) {
            loadingText.textContent = this.t('chat.loading', '加载中...');
        }
    }

    injectAdminLayoutStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Admin Mode Layout - Two Column with Glassmorphism */
            .chat-window.admin-mode-layout {
                width: 700px !important;
                max-width: 95vw;
                height: 600px;
                max-height: 85vh;
                display: flex;
                flex-direction: row;
                border-radius: 20px;
                overflow: hidden;
                /* Keep the visual weight, but avoid backdrop-filter on the scrolling shell.
                   WebKit can desync native scrollbar paint inside blurred, clipped containers. */
                background: linear-gradient(180deg, rgba(24, 24, 34, 0.96), rgba(18, 18, 28, 0.94)) !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                box-shadow: 
                    0 25px 50px -12px rgba(0, 0, 0, 0.6) !important;
            }
            
            /* Left Sidebar */
            .admin-sidebar {
                width: 240px;
                min-width: 200px;
                display: flex;
                flex-direction: column;
                background: rgba(0, 0, 0, 0.15);
                border-right: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .admin-sidebar-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 15px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .admin-sidebar-header h3 {
                margin: 0;
                font-size: 16px;
                color: white;
                font-weight: 600;
            }
            
            .admin-search {
                padding: 10px 12px;
            }
            .chat-window.admin-mode-layout .admin-search:focus-within {
                border-color: transparent !important;
                box-shadow: none !important;
            }
            .admin-search input {
                width: 100%;
                padding: 8px 12px;
                border-radius: 10px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                background: rgba(255, 255, 255, 0.08);
                color: white;
                font-size: 13px;
                box-sizing: border-box;
            }
            .chat-window.admin-mode-layout .admin-search input:focus,
            .chat-window.admin-mode-layout .admin-search input:focus-visible,
            .chat-window.admin-mode-layout .admin-search input:-webkit-autofill:focus,
            .chat-window.admin-mode-layout .admin-search input:-webkit-autofill:focus-visible {
                outline: none;
                border-color: #9fcaff !important;
                background: rgba(255, 255, 255, 0.042) !important;
                box-shadow: 0 0 0 3px rgba(159, 202, 255, 0.14) !important;
                caret-color: #9fcaff !important;
            }
            .admin-mode-layout .chat-input:focus,
            .admin-mode-layout .chat-input:focus-visible,
            .admin-mode-layout .chat-input:-webkit-autofill:focus,
            .admin-mode-layout .chat-input:-webkit-autofill:focus-visible {
                border-color: #9fcaff !important;
                background: rgba(255, 255, 255, 0.042) !important;
                box-shadow: 0 0 0 3px rgba(159, 202, 255, 0.14) !important;
                outline: none !important;
                caret-color: #9fcaff !important;
            }
            .admin-search input::placeholder {
                color: rgba(255, 255, 255, 0.4);
            }
            
            /* Session List */
            .session-list {
                flex: 1;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                scrollbar-gutter: stable both-edges;
                scrollbar-width: thin;
                scrollbar-color: rgba(148, 148, 148, 0.72) transparent;
            }
            
            .session-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 15px;
                cursor: pointer;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                transition: background 0.2s;
            }
            .session-item:hover {
                background: rgba(255, 255, 255, 0.08);
            }
            .session-item.active {
                background: rgba(159, 202, 255, 0.16);
                border-left: 3px solid #9fcaff;
            }
            .session-item--ops {
                background: linear-gradient(180deg, rgba(82, 120, 172, 0.16), rgba(82, 120, 172, 0.08));
            }
            .session-item--ops:hover {
                background: linear-gradient(180deg, rgba(108, 150, 207, 0.2), rgba(82, 120, 172, 0.14));
            }
            .session-item--ops .session-name {
                color: #d9ecff;
                font-weight: 600;
            }
            .session-item--ops .session-email {
                color: rgba(217, 236, 255, 0.72);
            }
            .session-item--ops .session-preview {
                color: rgba(225, 239, 255, 0.82);
            }
            
            /* Unread session - attention-grabbing style */
            .session-item.unread {
                background: rgba(255, 107, 107, 0.1);
                border-left: 3px solid #ff6b6b;
                animation: unread-pulse 2s ease-in-out infinite;
            }
            .session-item.unread .session-name {
                font-weight: 700;
                color: #fff;
            }
            .session-item.unread .session-preview {
                color: rgba(255, 255, 255, 0.9);
            }
            .session-item.unread .session-time {
                color: #ff6b6b;
                font-weight: 600;
            }
            
            @keyframes unread-pulse {
                0%, 100% {
                    background: rgba(255, 107, 107, 0.1);
                }
                50% {
                    background: rgba(255, 107, 107, 0.2);
                }
            }
            
            /* Unread badge on session item */
            .session-item .unread-dot {
                width: 8px;
                height: 8px;
                background: #ff6b6b;
                border-radius: 50%;
                flex-shrink: 0;
                animation: dot-pulse 1.5s ease-in-out infinite;
            }
            
            @keyframes dot-pulse {
                0%, 100% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.3); opacity: 0.7; }
            }
            
            .session-avatar {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: linear-gradient(135deg, rgba(159, 202, 255, 0.95) 0%, rgba(107, 158, 206, 0.92) 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 600;
                font-size: 14px;
                flex-shrink: 0;
            }
            .session-avatar.has-image {
                background: rgba(255, 255, 255, 0.08);
                overflow: hidden;
            }
            .session-avatar img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .session-avatar--ops {
                background: linear-gradient(135deg, rgba(107, 158, 206, 0.98) 0%, rgba(63, 112, 164, 0.98) 100%);
                box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 14px 24px rgba(39, 68, 109, 0.32);
            }
            .session-avatar--ops i {
                font-size: 14px;
            }
            
            .session-info {
                flex: 1;
                min-width: 0;
            }
            .session-name {
                color: white;
                font-weight: 500;
                font-size: 13px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .session-preview {
                color: rgba(255, 255, 255, 0.5);
                font-size: 12px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 2px;
            }
            .session-time {
                color: rgba(255, 255, 255, 0.4);
                font-size: 11px;
                flex-shrink: 0;
            }
            .session-email {
                color: rgba(255, 255, 255, 0.4);
                font-size: 11px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            /* Search match count badge */
            .search-match-count {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                font-size: 10px;
                font-weight: 600;
                padding: 3px 8px;
                border-radius: 10px;
                white-space: nowrap;
                margin-left: auto;
                flex-shrink: 0;
                animation: badge-pop 0.3s ease;
            }
            
            /* User online status in chat header */
            .user-status-indicator {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-top: 4px;
            }
            .user-status-indicator .status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
            }
            .user-status-indicator .status-dot.online {
                background: #4cd964;
                box-shadow: 0 0 8px rgba(76, 217, 100, 0.5);
            }
            .user-status-indicator .status-dot.away {
                background: #ffcc00;
            }
            .user-status-indicator .status-dot.offline {
                background: #8e8e93;
            }
            .user-status-indicator .status-text {
                font-size: 11px;
                color: rgba(255, 255, 255, 0.5);
            }
            
            .session-loading {
                padding: 20px;
                text-align: center;
                color: rgba(255, 255, 255, 0.5);
            }
            
            /* Right Chat Area */
            .admin-chat-area {
                flex: 1;
                display: flex;
                flex-direction: column;
                min-width: 0;
            }
            
            .admin-chat-header {
                padding: 15px 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.03);
            }
            .chat-user-name {
                color: white;
                font-weight: 600;
                font-size: 15px;
            }
            .chat-user-id {
                color: rgba(255, 255, 255, 0.5);
                font-size: 12px;
                margin-left: 8px;
            }
            .chat-admin-readonly-notice {
                margin: 12px 20px 0;
                padding: 10px 12px;
                border-radius: 12px;
                background: rgba(107, 158, 206, 0.12);
                border: 1px solid rgba(107, 158, 206, 0.2);
                color: rgba(224, 238, 255, 0.92);
                font-size: 12px;
                line-height: 1.5;
            }
            
            .admin-mode-layout .chat-messages {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
                scroll-behavior: auto !important; /* Force instant scrolling */
                overscroll-behavior-y: contain; /* Prevent scroll chaining */
            }
            
            .empty-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: rgba(255, 255, 255, 0.4);
            }
            .empty-state i {
                font-size: 48px;
                margin-bottom: 15px;
                opacity: 0.5;
            }
            .empty-state p {
                margin: 0;
                font-size: 14px;
            }
            
            /* Limit image size in chat */
            .message-image {
                max-width: 200px;
                max-height: 200px;
                border-radius: 12px;
                cursor: pointer;
                object-fit: cover;
            }
            
            /* Overlay for clicking outside to close */
            .chat-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: var(--chat-overlay-bg, rgba(7, 9, 12, 0.28));
                z-index: 9998;
                backdrop-filter: var(--chat-overlay-filter, blur(14px) saturate(108%));
                -webkit-backdrop-filter: var(--chat-overlay-filter, blur(14px) saturate(108%));
                transform: translateZ(0);
                -webkit-transform: translateZ(0);
                will-change: opacity, backdrop-filter;
            }
            .chat-overlay.visible {
                display: block;
            }
            
            /* Shake hint animation for input */
            .shake-hint {
                animation: shake-input 0.4s ease;
                border-color: #ff6b6b !important;
                background: rgba(255, 107, 107, 0.1) !important;
            }
            
            @keyframes shake-input {
                0%, 100% { transform: translateX(0); }
                20% { transform: translateX(-8px); }
                40% { transform: translateX(8px); }
                60% { transform: translateX(-4px); }
                80% { transform: translateX(4px); }
            }
            
            /* Message time stamp */
            .message-time {
                display: block;
                font-size: 10px;
                color: rgba(255, 255, 255, 0.4);
                margin-top: 4px;
                text-align: right;
            }
            .message.user .message-time {
                color: rgba(255, 255, 255, 0.6);
            }
            .message-text {
                display: block;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .message--ops-alert {
                max-width: min(540px, 92%);
                width: min(540px, 92%);
                padding: 14px 16px;
                border-radius: 18px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                background: rgba(255, 255, 255, 0.08);
                box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
            }
            .message--ops-alert-warning {
                border-color: rgba(244, 195, 99, 0.28);
                background: linear-gradient(180deg, rgba(244, 195, 99, 0.12), rgba(255, 255, 255, 0.06));
            }
            .message--ops-alert-critical {
                border-color: rgba(255, 107, 107, 0.3);
                background: linear-gradient(180deg, rgba(255, 107, 107, 0.12), rgba(255, 255, 255, 0.06));
            }
            .message--ops-alert-info {
                border-color: rgba(107, 158, 206, 0.3);
                background: linear-gradient(180deg, rgba(107, 158, 206, 0.14), rgba(255, 255, 255, 0.06));
            }
            .ops-alert-card-header {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .ops-alert-card-title-wrap {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
            }
            .ops-alert-card-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 44px;
                padding: 4px 8px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.02em;
            }
            .ops-alert-card-badge--info {
                color: #d6ebff;
                background: rgba(107, 158, 206, 0.22);
            }
            .ops-alert-card-badge--warning {
                color: #fff1cc;
                background: rgba(244, 195, 99, 0.24);
            }
            .ops-alert-card-badge--critical {
                color: #ffd9d9;
                background: rgba(255, 107, 107, 0.22);
            }
            .ops-alert-card-title {
                color: #fff;
                font-size: 14px;
                font-weight: 600;
                line-height: 1.5;
            }
            .ops-alert-card-meta {
                color: rgba(255, 255, 255, 0.56);
                font-size: 11px;
                line-height: 1.5;
            }
            .ops-alert-card-content {
                margin-top: 12px;
                color: rgba(255, 255, 255, 0.88);
                font-size: 13px;
                line-height: 1.65;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .ops-alert-card-error {
                margin-top: 12px;
                padding: 10px 12px;
                border-radius: 12px;
                background: rgba(255, 107, 107, 0.12);
                color: #ffd6d6;
                font-size: 12px;
                line-height: 1.5;
            }
            .ops-alert-card-footer {
                margin-top: 14px;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }
            .ops-alert-card-entry {
                flex: 1;
                min-width: 180px;
                color: rgba(255, 255, 255, 0.62);
                font-size: 12px;
                line-height: 1.5;
            }
            .ops-alert-card-action {
                border: 1px solid rgba(107, 158, 206, 0.32);
                background: rgba(107, 158, 206, 0.18);
                color: #e5f2ff;
                font-size: 12px;
                font-weight: 600;
                border-radius: 999px;
                padding: 8px 14px;
                cursor: pointer;
                transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease;
            }
            .ops-alert-card-action:hover:not(:disabled) {
                transform: translateY(-1px);
                background: rgba(107, 158, 206, 0.24);
                border-color: rgba(159, 202, 255, 0.4);
            }
            .ops-alert-card-action:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }
            
            /* Back button - hidden on desktop, visible on mobile */
            .back-to-list-btn {
                display: none;
                background: none;
                border: none;
                color: white;
                font-size: 18px;
                padding: 8px 12px;
                cursor: pointer;
                margin-right: 8px;
                border-radius: 8px;
                transition: background 0.2s;
            }
            .back-to-list-btn:hover {
                background: rgba(255, 255, 255, 0.1);
            }
            
            /* Mobile/Narrow: Slide Navigation Pattern */
            @media (max-width: 700px) {
                .chat-window.admin-mode-layout {
                    width: 380px !important;
                    max-width: 95vw;
                    height: 550px !important;
                    max-height: 80vh;
                    border-radius: 20px !important;
                    overflow: hidden;
                    /* Center the modal on mobile */
                    position: fixed !important;
                    top: 50% !important;
                    left: 50% !important;
                    right: auto !important;
                    bottom: auto !important;
                    /* scale(0.9) gives a visible animation instead of relying on opacity alone */
                    transform: translate(-50%, -50%) scale(0.9) !important;
                    /* Force opaque — rely on visibility:hidden + scale for animation, not opacity.
                       opacity transition + backdrop-filter = Chromium compositor flash bug */
                    opacity: 1 !important;
                    /* Disable backdrop-filter during animation to avoid Chromium flash bug */
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }
                .chat-window.admin-mode-layout.active {
                    transform: translate(-50%, -50%) scale(1) !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }
                
                /* Mobile: Side by side sliding panels */
                .admin-sidebar {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: transparent;
                    z-index: 2;
                    transition: transform 0.3s ease-out;
                    display: flex;
                    flex-direction: column;
                }
                
                /* Chat area also full size, positioned to the right */
                .admin-chat-area {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    transform: translateX(100%);
                    transition: transform 0.3s ease-out;
                    display: flex;
                    flex-direction: column;
                    z-index: 1;
                }
                
                /* When chat is active: slide sidebar out, slide chat in */
                .admin-mode-layout.chat-active .admin-sidebar {
                    transform: translateX(-100%);
                }
                .admin-mode-layout.chat-active .admin-chat-area {
                    transform: translateX(0);
                }
                
                /* Show back button on mobile */
                .back-to-list-btn {
                    display: block;
                }
                
                /* Session list takes full available space */
                .session-list {
                    flex: 1;
                    overflow-y: auto;
                }
                
                /* Chat header layout */
                .admin-chat-header {
                    display: flex;
                    align-items: center;
                }
                
                /* Messages area */
                .admin-mode-layout .chat-messages {
                    flex: 1;
                    overflow-y: auto;
                }
                
                /* Input always at bottom */
                .admin-mode-layout .chat-input-area {
                    flex: 0 0 auto;
                    padding: 10px 12px;
                }
            }
            
            /* Very narrow screens */
            @media (max-width: 480px) {
                .chat-window.admin-mode-layout {
                    width: 95vw;
                    height: 75vh;
                    border-radius: 16px;
                }
            }
            
            /* Loading Spinner for message loading */
            .loading-overlay .loading-spinner {
                width: 32px;
                height: 32px;
                border: 3px solid rgba(255, 255, 255, 0.2);
                border-top-color: rgba(102, 126, 234, 0.8);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    isOpsAlertSessionId(sessionId) {
        return String(sessionId || '').trim() === this.opsAlertSessionId;
    }

    isOpsAlertSession(session) {
        return Boolean(session) && (
            session.kind === 'ops_alerts'
            || this.isOpsAlertSessionId(session.id)
            || this.isOpsAlertSessionId(session.sessionId)
        );
    }

    parseChatOpsPayload(value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value;
        }
        if (typeof value !== 'string' || !value.trim()) {
            return {};
        }
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    extractOpsAlertEntryPath(content = '') {
        return String(content || '')
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.startsWith('处理入口：'))
            ?.replace(/^处理入口：/, '')
            .trim() || '';
    }

    stripOpsAlertEntryPath(content = '') {
        return String(content || '')
            .split('\n')
            .filter((line) => !String(line || '').trim().startsWith('处理入口：'))
            .join('\n')
            .trim();
    }

    getOpsAlertSeverityLabel(severity = 'warning') {
        const normalized = String(severity || 'warning').trim().toLowerCase();
        const labelMap = {
            info: '提示',
            warning: '告警',
            critical: '紧急'
        };
        return labelMap[normalized] || '告警';
    }

    getOpsAlertStatusLabel(alert = {}) {
        const normalized = String(alert.status || 'pending').trim().toLowerCase();
        if (normalized === 'delivered') return '站外已发送';
        if (normalized === 'dead_letter') return '站外发送失败';
        if (normalized === 'retry') return '站外重试中';
        if (normalized === 'processing') return '站外发送中';
        return '等待站外发送';
    }

    getOpsAlertActionLabel(alert = {}) {
        const kind = String(alert.workspace?.kind || '').trim().toLowerCase();
        if (kind === 'chat-session') {
            return String(alert.workspace?.context?.sessionId || alert.workspace?.context?.session_id || '').trim()
                ? '查看会话'
                : '打开消息';
        }
        if (kind === 'shop-orders') {
            return '查看订单';
        }
        if (kind === 'ops-workspace') {
            const workspaceKey = String(alert.workspace?.workspaceKey || '').trim().toLowerCase();
            const labelMap = {
                'payments-overview': '查看最近订单',
                'payments-ops': '处理异常',
                'verify-monitor': '查看验证面板',
                'admin-audit-monitor': '查看审计',
                'tickets-pending': '处理工单',
                'tickets-resolved': '查看工单',
                'shop-inventory': '处理库存',
                'shop-fulfillment': '处理履约',
                'shop-risk-orders': '查看订单',
                'shop-risk-discounts': '查看优惠码',
                'shop-risk-users': '查看用户'
            };
            return labelMap[workspaceKey] || '前往处理';
        }
        return '暂无处理页';
    }

    buildOpsAlertPreview(alert = {}) {
        const title = String(alert.title || '').trim();
        if (title) {
            return `${this.getOpsAlertSeverityLabel(alert.severity)} · ${title}`;
        }

        const firstLine = this.stripOpsAlertEntryPath(alert.content || '')
            .split('\n')
            .map((line) => line.trim())
            .find(Boolean);
        if (firstLine) {
            return `${this.getOpsAlertSeverityLabel(alert.severity)} · ${firstLine}`;
        }

        return '站外告警同步';
    }

    getOpsAlertReferenceLabel(payload = {}) {
        if (payload.ticket_id) return '工单号';
        if (payload.order_id) return '订单号';
        if (payload.payment_order_id) return '充值单号';
        if (payload.provider_order_no) return '支付单号';
        if (payload.message_id) return '消息ID';
        if (payload.session_id) return '会话ID';
        if (payload.user_id) return '用户ID';
        if (payload.target_id) return '目标';
        return '';
    }

    getOpsAlertReferenceValue(payload = {}) {
        return String(
            payload.ticket_id
            || payload.order_id
            || payload.payment_order_id
            || payload.provider_order_no
            || payload.message_id
            || payload.session_id
            || payload.user_id
            || payload.target_id
            || ''
        ).trim();
    }

    buildOpsAlertContext(alertType = '', payload = {}, title = '') {
        const targetId = String(
            payload.target_id
            || payload.order_id
            || payload.payment_order_id
            || payload.ticket_id
            || payload.message_id
            || ''
        ).trim();

        return {
            title: String(title || '').trim(),
            alertType,
            alert_type: alertType,
            category: alertType,
            referenceLabel: this.getOpsAlertReferenceLabel(payload),
            referenceValue: this.getOpsAlertReferenceValue(payload),
            targetId,
            target_id: targetId,
            userId: String(payload.user_id || '').trim(),
            user_id: String(payload.user_id || '').trim(),
            clientIp: String(payload.client_ip || '').trim(),
            client_ip: String(payload.client_ip || '').trim(),
            discountCode: String(payload.discount_code || '').trim(),
            discount_code: String(payload.discount_code || '').trim(),
            sessionId: String(payload.session_id || '').trim(),
            session_id: String(payload.session_id || '').trim(),
            messageId: String(payload.message_id || '').trim(),
            message_id: String(payload.message_id || '').trim()
        };
    }

    resolveOpsAlertEntryWorkspace(entryPath = '', baseContext = {}) {
        const normalized = String(entryPath || '').trim();
        if (!normalized) {
            return { kind: 'none' };
        }

        if (normalized.includes('客服消息')) {
            return {
                kind: 'chat-session',
                context: baseContext
            };
        }
        if (normalized.includes('订单列表 / 优惠券码')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-risk-discounts',
                context: baseContext
            };
        }
        if (normalized.includes('订单列表 / 用户详情') || normalized.includes('用户详情')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-risk-users',
                context: baseContext
            };
        }
        if (normalized.includes('履约任务') || normalized.includes('异常订单')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-fulfillment',
                context: baseContext
            };
        }
        if (normalized.includes('库存 / 补货') || normalized.includes('库存')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-inventory',
                context: baseContext
            };
        }
        if (normalized.includes('支付配置审计') || normalized.includes('异常登录信号')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'admin-audit-monitor',
                context: baseContext
            };
        }
        if (normalized.includes('验证服务配置')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'verify-monitor',
                context: baseContext
            };
        }
        if (normalized.includes('售后工单')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: normalized.includes('已处理') ? 'tickets-resolved' : 'tickets-pending',
                context: baseContext
            };
        }
        if (normalized.includes('支付总览') || normalized.includes('异常运维')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'payments-ops',
                context: baseContext
            };
        }
        if (normalized.includes('最近订单')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'payments-overview',
                context: baseContext
            };
        }
        if (normalized.includes('订单列表')) {
            return {
                kind: 'shop-orders',
                context: baseContext
            };
        }

        return { kind: 'none' };
    }

    resolveShopRiskWorkspaceForChat(baseContext = {}, payload = {}) {
        const signalType = String(payload.signal_type || '').trim().toLowerCase();
        if (String(payload.discount_code || '').trim()) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-risk-discounts',
                context: baseContext
            };
        }
        if (String(payload.user_id || '').trim() && signalType === 'user_velocity') {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-risk-users',
                context: baseContext
            };
        }
        return {
            kind: 'ops-workspace',
            workspaceKey: 'shop-risk-orders',
            context: baseContext
        };
    }

    resolveOpsAlertWorkspace(alertType = '', payload = {}, title = '', entryPath = '') {
        const baseContext = this.buildOpsAlertContext(alertType, payload, title);

        switch (String(alertType || '').trim().toLowerCase()) {
            case 'customer_chat_message_received':
            case 'customer_chat_message_summary':
                return {
                    kind: 'chat-session',
                    context: baseContext
                };
            case 'shop_purchase_succeeded':
            case 'shop_purchase_summary':
                return {
                    kind: 'shop-orders',
                    context: baseContext
                };
            case 'wallet_recharge_succeeded':
            case 'wallet_recharge_summary':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'payments-overview',
                    context: baseContext
                };
            case 'shop_inventory_summary':
            case 'shop_inventory_low':
            case 'shop_inventory_empty':
            case 'shop_inventory_recovered':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'shop-inventory',
                    context: baseContext
                };
            case 'ticket_new':
            case 'ticket_sla_summary':
            case 'ticket_sla_overdue':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'tickets-pending',
                    context: baseContext
                };
            case 'ticket_sla_recovered':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'tickets-resolved',
                    context: baseContext
                };
            case 'shop_order_delivery_summary':
            case 'shop_order_delivery_failed':
            case 'shop_order_delivery_recovered':
            case 'shop_order_delivery_incident':
            case 'shop_order_delivery_incident_recovered':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'shop-fulfillment',
                    context: baseContext
                };
            case 'payment_gateway_summary':
            case 'payment_gateway_degraded':
            case 'payment_gateway_recovered':
            case 'payment_refund_ops':
            case 'payment_refund_alert':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'payments-ops',
                    context: baseContext
                };
            case 'payment_config_changed':
            case 'payment_config_recovered':
            case 'payment_config_incident':
            case 'payment_config_incident_recovered':
            case 'security_admin_login_anomaly':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'admin-audit-monitor',
                    context: baseContext
                };
            case 'verify_quota_summary':
            case 'verify_quota_low':
            case 'verify_service_disabled':
            case 'verify_queue_summary':
            case 'verify_queue_backlog':
            case 'verify_failure_summary':
            case 'verify_failure_rate_spike':
            case 'verify_incident_escalated':
            case 'verify_incident_recovered':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'verify-monitor',
                    context: baseContext
                };
            case 'shop_order_risk_anomaly':
            case 'shop_order_risk_recovered':
                return this.resolveShopRiskWorkspaceForChat(baseContext, payload);
            default:
                return this.resolveOpsAlertEntryWorkspace(entryPath, baseContext);
        }
    }

    normalizeOpsAlertJob(row = {}) {
        const payload = this.parseChatOpsPayload(row.payload);
        const alertType = String(row.alert_type || '').trim().toLowerCase();
        const content = String(row.content || '').trim();
        const entryPath = String(payload.entry_path || '').trim() || this.extractOpsAlertEntryPath(content);
        const createdAt = row.created_at || row.updated_at || new Date().toISOString();
        const updatedAt = row.updated_at || createdAt;
        const alert = {
            id: String(row.id || `ops-alert-${createdAt}`),
            alertType,
            severity: String(row.severity || 'warning').trim().toLowerCase() || 'warning',
            title: String(row.title || '系统告警').trim() || '系统告警',
            content,
            displayContent: this.stripOpsAlertEntryPath(content),
            entryPath,
            status: String(row.status || 'pending').trim().toLowerCase() || 'pending',
            lastError: String(row.last_error || '').trim(),
            payload,
            workspace: null,
            created_at: createdAt,
            updated_at: updatedAt,
            delivered_at: row.delivered_at || '',
            timestamp: new Date(createdAt),
            sortTimestamp: new Date(updatedAt),
            preview: ''
        };

        alert.workspace = this.resolveOpsAlertWorkspace(alertType, payload, alert.title, entryPath);
        alert.preview = this.buildOpsAlertPreview(alert);
        return alert;
    }

    buildOpsAlertSessionSearchText() {
        return this.opsAlertMessages
            .slice(0, 24)
            .map((alert) => [alert.title, alert.displayContent, alert.entryPath, alert.preview].filter(Boolean).join('\n'))
            .join('\n');
    }

    buildOpsAlertSession() {
        const latest = this.opsAlertMessages[0] || null;
        const preview = this.opsAlertLoadError
            ? `同步失败：${this.opsAlertLoadError}`
            : (latest?.preview || '站外告警会同步到这里');

        const subtext = this.opsAlertLoadError
            ? '站外告警同步异常'
            : `固定系统联系人${this.opsAlertMessages.length ? ` · ${Math.min(this.opsAlertMessages.length, 99)}${this.opsAlertMessages.length > 99 ? '+' : ''} 条同步` : ''}`;

        return {
            id: this.opsAlertSessionId,
            sessionIds: [this.opsAlertSessionId],
            nickname: '站内代办',
            email: subtext,
            lastLogin: latest?.created_at || '',
            lastMessage: preview,
            lastTime: latest?.updated_at || latest?.created_at || '',
            isAdmin: false,
            userId: '',
            avatarUrl: '',
            kind: 'ops_alerts',
            subtext,
            searchText: this.buildOpsAlertSessionSearchText()
        };
    }

    async fetchOpsAlertJobs() {
        const { data, error } = await this.supabase
            .from('ops_alert_jobs')
            .select('id, alert_type, severity, title, content, payload, status, last_error, created_at, updated_at, delivered_at')
            .order('created_at', { ascending: false })
            .limit(160);

        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    async refreshOpsAlerts(options = {}) {
        const announceNew = options.announceNew === true;
        const isViewingOpsSession = this.isOpen && this.currentSessionKey === this.opsAlertSessionId;
        const knownIds = new Set((Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : []).map((alert) => alert.id));

        try {
            const rows = await this.fetchOpsAlertJobs();
            this.processOpsAlertData(rows);

            const newAlerts = this.opsAlertMessages.filter((alert) => !knownIds.has(alert.id));
            if (newAlerts.length && announceNew && !isViewingOpsSession) {
                this.unreadSessions.add(this.opsAlertSessionId);
                const newestAlert = newAlerts[0];
                try {
                    this.showNotification(newestAlert.title || newestAlert.preview || '收到新的站外告警', '📌 站内代办', true);
                } catch (notificationError) {
                    console.warn('[ChatWidget] Failed to show ops alert notification:', notificationError);
                }
            } else if (isViewingOpsSession) {
                this.clearSessionUnreadState(this.opsAlertSessionId, [this.opsAlertSessionId]);
            }

            this.refreshOpsAlertSessionEntry();
            if (isViewingOpsSession) {
                this.renderOpsAlertMessages();
            }
            return this.opsAlertMessages;
        } catch (error) {
            this.opsAlertMessages = [];
            this.opsAlertLoadError = error?.message || '站外告警读取失败';
            this.refreshOpsAlertSessionEntry();
            if (isViewingOpsSession) {
                this.renderOpsAlertMessages();
            }
            throw error;
        }
    }

    startAdminOpsAlertPolling() {
        if (this.adminOpsAlertPollTimer) return;

        this.adminOpsAlertPollTimer = setInterval(() => {
            this.refreshOpsAlerts({ announceNew: true }).catch((error) => {
                console.warn('[ChatWidget] Admin ops alert polling failed:', error?.message || error);
            });
        }, 15000);
    }

    processOpsAlertData(rows) {
        this.opsAlertLoadError = '';
        this.opsAlertMessages = (Array.isArray(rows) ? rows : [])
            .map((row) => this.normalizeOpsAlertJob(row))
            .sort((left, right) => {
                const leftTime = left.sortTimestamp instanceof Date ? left.sortTimestamp.getTime() : 0;
                const rightTime = right.sortTimestamp instanceof Date ? right.sortTimestamp.getTime() : 0;
                return rightTime - leftTime;
            });
    }

    refreshOpsAlertSessionEntry() {
        const nonOpsSessions = (Array.isArray(this.sessions) ? this.sessions : [])
            .filter((session) => !this.isOpsAlertSession(session));
        this.sessions = [this.buildOpsAlertSession(), ...nonOpsSessions];
        this.renderAdminSessionList();
    }

    renderAdminSessionList() {
        if (!this.sessionList) return;

        this.sessionList.innerHTML = '';
        if (!Array.isArray(this.sessions) || this.sessions.length === 0) {
            this.sessionList.innerHTML = `<div class="session-loading">${this.t('chat.noSessions', '暂无会话')}</div>`;
            return;
        }

        this.sessions.forEach((session) => {
            const item = document.createElement('div');
            const isOpsSession = this.isOpsAlertSession(session);
            item.className = `session-item${isOpsSession ? ' session-item--ops' : ''}`;
            item.dataset.sessionId = session.id;
            item.classList.toggle('active', this.currentSessionKey === session.id);

            const sessionIds = session.sessionIds || [session.id];
            const hasUnread = sessionIds.some((sid) => this.unreadSessions.has(sid));
            if (hasUnread) {
                item.classList.add('unread');
            }

            const previewText = String(session.lastMessage || '').trim();
            const preview = previewText.length > 20 ? `${previewText.slice(0, 20)}...` : previewText;
            const time = this.formatTime(isOpsSession ? (session.lastTime || session.lastLogin) : session.lastTime);
            const displayName = isOpsSession
                ? '站内代办'
                : (session.nickname.length > 12 ? `${session.nickname.slice(0, 12)}...` : session.nickname);
            const detailLine = isOpsSession
                ? (session.subtext || session.email || '固定系统联系人')
                : (session.id.startsWith('guest_')
                    ? ''
                    : ((session.email || '').length > 20 ? `${session.email.slice(0, 20)}...` : (session.email || '')));

            item.dataset.searchText = [
                displayName,
                detailLine,
                previewText,
                session.searchText || ''
            ].filter(Boolean).join('\n').toLowerCase();

            const avatarEl = this.createSessionAvatarElement(session);

            const infoEl = document.createElement('div');
            infoEl.className = 'session-info';

            const nameEl = document.createElement('div');
            nameEl.className = 'session-name';
            nameEl.textContent = displayName;

            const emailEl = document.createElement('div');
            emailEl.className = 'session-email';
            emailEl.textContent = detailLine;

            const previewEl = document.createElement('div');
            previewEl.className = 'session-preview';
            previewEl.textContent = preview;

            infoEl.appendChild(nameEl);
            infoEl.appendChild(emailEl);
            infoEl.appendChild(previewEl);

            const timeEl = document.createElement('div');
            timeEl.className = 'session-time';
            timeEl.textContent = time;

            item.appendChild(avatarEl);
            item.appendChild(infoEl);
            item.appendChild(timeEl);

            if (hasUnread) {
                const unreadDot = document.createElement('div');
                unreadDot.className = 'unread-dot';
                item.appendChild(unreadDot);
            }

            item.addEventListener('click', () => this.selectSession(session.id, session));
            this.sessionList.appendChild(item);
        });
    }

    formatOpsAlertDetailTime(value) {
        if (!value) return '未知时间';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    createOpsAlertMessageElement(alert = {}) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message admin message--ops-alert message--ops-alert-${this.escapeHtml(alert.severity || 'warning')}`;
        msgDiv.dataset.alertId = alert.id || '';

        const header = document.createElement('div');
        header.className = 'ops-alert-card-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'ops-alert-card-title-wrap';

        const badge = document.createElement('span');
        badge.className = `ops-alert-card-badge ops-alert-card-badge--${this.escapeHtml(alert.severity || 'warning')}`;
        badge.textContent = this.getOpsAlertSeverityLabel(alert.severity);

        const title = document.createElement('div');
        title.className = 'ops-alert-card-title';
        title.textContent = alert.title || '系统告警';

        titleWrap.appendChild(badge);
        titleWrap.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'ops-alert-card-meta';
        const metaParts = [
            `创建于 ${this.formatOpsAlertDetailTime(alert.created_at)}`,
            this.getOpsAlertStatusLabel(alert)
        ];
        if (alert.updated_at && alert.updated_at !== alert.created_at) {
            metaParts.push(`更新于 ${this.formatOpsAlertDetailTime(alert.updated_at)}`);
        }
        meta.textContent = metaParts.join(' · ');

        header.appendChild(titleWrap);
        header.appendChild(meta);

        const body = document.createElement('div');
        body.className = 'ops-alert-card-content';
        body.textContent = alert.displayContent || alert.content || alert.title || '系统告警';

        msgDiv.appendChild(header);
        msgDiv.appendChild(body);

        if (alert.lastError) {
            const errorEl = document.createElement('div');
            errorEl.className = 'ops-alert-card-error';
            errorEl.textContent = `最近错误：${alert.lastError}`;
            msgDiv.appendChild(errorEl);
        }

        const footer = document.createElement('div');
        footer.className = 'ops-alert-card-footer';

        const entry = document.createElement('div');
        entry.className = 'ops-alert-card-entry';
        entry.textContent = alert.entryPath || '暂无处理入口';

        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'ops-alert-card-action';
        actionButton.textContent = this.getOpsAlertActionLabel(alert);
        if (!alert.workspace || alert.workspace.kind === 'none') {
            actionButton.disabled = true;
        } else {
            actionButton.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.handleOpsAlertNavigation(alert);
            });
        }

        footer.appendChild(entry);
        footer.appendChild(actionButton);
        msgDiv.appendChild(footer);

        return msgDiv;
    }

    renderOpsAlertMessages() {
        if (!this.messagesContainer) return;

        this.messagesContainer.innerHTML = '';
        this.lastDisplayedTime = null;

        if (this.opsAlertLoadError) {
            this.messagesContainer.innerHTML = `<div class="message admin">${this.escapeHtml(`站外告警读取失败：${this.opsAlertLoadError}`)}</div>`;
            return;
        }

        const alerts = [...this.opsAlertMessages].sort((left, right) => {
            const leftTime = left.timestamp instanceof Date ? left.timestamp.getTime() : 0;
            const rightTime = right.timestamp instanceof Date ? right.timestamp.getTime() : 0;
            return leftTime - rightTime;
        });

        if (!alerts.length) {
            this.messagesContainer.innerHTML = `<div class="message admin">${this.t('chat.noOpsAlerts', '当前还没有同步过来的站外告警')}</div>`;
            return;
        }

        alerts.forEach((alert) => {
            const currentTime = alert.timestamp instanceof Date ? alert.timestamp : new Date(alert.created_at || Date.now());
            let showTime = false;

            if (!this.lastDisplayedTime) {
                showTime = true;
            } else {
                const timeDiff = Math.abs(currentTime.getTime() - this.lastDisplayedTime.getTime());
                if (timeDiff >= this.timeDisplayThreshold) {
                    showTime = true;
                }
            }

            if (showTime) {
                this.lastDisplayedTime = currentTime;
                const timeSeparator = document.createElement('div');
                timeSeparator.className = 'message-time-separator';
                timeSeparator.textContent = currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                this.messagesContainer.appendChild(timeSeparator);
            }

            this.messagesContainer.appendChild(this.createOpsAlertMessageElement(alert));
        });

        this.scrollToBottom();
    }

    setAdminReplyReadonly(readonly) {
        const inputArea = this.chatWindow?.querySelector('.chat-input-area');
        const uploadBtn = this.chatWindow?.querySelector('#chatUploadBtn');
        const emojiBtn = this.chatWindow?.querySelector('#chatEmojiBtn');
        const sendBtn = this.chatWindow?.querySelector('#chatSendBtn');
        const imageInput = this.chatWindow?.querySelector('#chatImageInput');

        if (inputArea) {
            inputArea.hidden = readonly;
            inputArea.style.display = readonly ? 'none' : 'flex';
        }
        if (this.input) {
            this.input.disabled = readonly;
            this.input.placeholder = readonly ? '站内代办为只读告警流' : this.t('chat.inputPlaceholder', '输入回复...');
        }
        if (uploadBtn) uploadBtn.disabled = readonly;
        if (emojiBtn) emojiBtn.disabled = readonly;
        if (sendBtn) sendBtn.disabled = readonly;
        if (imageInput) imageInput.disabled = readonly;
    }

    normalizeOpsAlertWorkspaceForAdminStudio(workspace = {}) {
        if (workspace.kind === 'ops-workspace') {
            return {
                workspaceKey: String(workspace.workspaceKey || '').trim(),
                context: workspace.context || {},
                module: this.getAdminStudioModuleForOpsWorkspaceKey(workspace.workspaceKey)
            };
        }
        if (workspace.kind === 'shop-orders') {
            return {
                workspaceKey: 'shop-risk-orders',
                context: workspace.context || {},
                module: 'shop'
            };
        }
        if (workspace.kind === 'chat-session') {
            return {
                workspaceKey: '',
                context: workspace.context || {},
                module: 'chat'
            };
        }
        return {
            workspaceKey: '',
            context: workspace.context || {},
            module: ''
        };
    }

    getAdminStudioModuleForOpsWorkspaceKey(workspaceKey = '') {
        const normalized = String(workspaceKey || '').trim().toLowerCase();
        const moduleMap = {
            'payments-overview': 'payments',
            'payments-ops': 'payments',
            'verify-monitor': 'settings',
            'admin-audit-monitor': 'settings',
            'tickets-pending': 'tickets',
            'tickets-resolved': 'tickets',
            'shop-inventory': 'shop',
            'shop-fulfillment': 'shop',
            'shop-risk-orders': 'shop',
            'shop-risk-discounts': 'discounts',
            'shop-risk-users': 'users'
        };
        return moduleMap[normalized] || '';
    }

    persistPendingOpsAlertWorkspace(workspaceKey = '', context = {}) {
        if (!workspaceKey || typeof window.localStorage === 'undefined') return;
        const payload = {
            workspaceKey: String(workspaceKey || '').trim(),
            context: context && typeof context === 'object' ? context : {},
            createdAt: new Date().toISOString()
        };
        window.localStorage.setItem('zaoyoe_pending_ops_alert_workspace', JSON.stringify(payload));
    }

    openAdminStudioForOpsAlertWorkspace(workspace = {}) {
        const normalized = this.normalizeOpsAlertWorkspaceForAdminStudio(workspace);
        const moduleName = normalized.module || this.getAdminStudioModuleForOpsWorkspaceKey(normalized.workspaceKey);
        if (!moduleName && !normalized.workspaceKey) {
            this.showNotification('这条告警暂时没有可跳转的处理页', '📌 站内代办', true);
            return false;
        }

        if (normalized.workspaceKey) {
            this.persistPendingOpsAlertWorkspace(normalized.workspaceKey, normalized.context || {});
        }

        const targetUrl = new URL('admin-studio.html', window.location.origin);
        if (moduleName) {
            targetUrl.searchParams.set('module', moduleName);
        }

        const openedWindow = window.open(targetUrl.toString(), '_blank', 'noopener');
        if (!openedWindow) {
            window.location.assign(targetUrl.toString());
        }
        return true;
    }

    async handleOpsAlertNavigation(alert = {}) {
        const workspace = alert.workspace || { kind: 'none' };

        try {
            if (workspace.kind === 'chat-session') {
                const sessionId = String(
                    workspace.context?.sessionId
                    || workspace.context?.session_id
                    || workspace.context?.referenceValue
                    || ''
                ).trim();
                const matchingSession = this.sessions.find((session) => (
                    !this.isOpsAlertSession(session)
                    && (session.sessionIds || [session.id]).includes(sessionId)
                ));

                if (matchingSession) {
                    this.selectSession(matchingSession.id, matchingSession);
                    return true;
                }
            }

            if (workspace.kind === 'ops-workspace' && typeof window.openOpsAlertWorkspace === 'function') {
                return await window.openOpsAlertWorkspace(workspace.workspaceKey, workspace.context || {});
            }

            return this.openAdminStudioForOpsAlertWorkspace(workspace);
        } catch (error) {
            console.error('[ChatWidget] Failed to open ops alert workspace:', error);
            this.showNotification(`打开处理页失败：${error.message || '未知错误'}`, '📌 站内代办', true);
            return false;
        }
    }

    async upsertOpsAlertMessage(row, options = {}) {
        const normalized = this.normalizeOpsAlertJob(row);
        const existingIndex = this.opsAlertMessages.findIndex((item) => item.id === normalized.id);

        if (existingIndex > -1) {
            this.opsAlertMessages.splice(existingIndex, 1, normalized);
        } else {
            this.opsAlertMessages.push(normalized);
        }

        this.opsAlertMessages.sort((left, right) => {
            const leftTime = left.sortTimestamp instanceof Date ? left.sortTimestamp.getTime() : 0;
            const rightTime = right.sortTimestamp instanceof Date ? right.sortTimestamp.getTime() : 0;
            return rightTime - leftTime;
        });

        const isViewingOpsSession = this.isOpen && this.currentSessionKey === this.opsAlertSessionId;
        if (!isViewingOpsSession && options.announce !== false) {
            this.unreadSessions.add(this.opsAlertSessionId);
            try {
                this.showNotification(normalized.title || normalized.preview || '收到新的站外告警', '📌 站内代办', true);
            } catch (notificationError) {
                console.warn('[ChatWidget] Failed to show realtime ops alert notification:', notificationError);
            }
        } else if (isViewingOpsSession) {
            this.clearSessionUnreadState(this.opsAlertSessionId, [this.opsAlertSessionId]);
        }

        this.refreshOpsAlertSessionEntry();

        if (isViewingOpsSession) {
            this.renderOpsAlertMessages();
        }
    }

    async loadAdminSessions() {
        try {
            // Get current admin user to exclude from list
            const { data: { user: currentUser } } = await this.supabase.auth.getUser();
            const adminUserId = currentUser?.id;

            // Get all messages grouped by session, including user_id for lookup
            const { data: messages, error } = await this.supabase
                .from('chat_messages')
                .select('session_id, created_at, content, is_admin, user_id, message_type')
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Only use USER messages (not admin replies) for grouping sessions
            const userMessages = messages.filter(m => !m.is_admin);

            // Collect all user IDs from USER messages (for looking up guest sessions with logged-in users)
            const userIds = [...new Set(userMessages.filter(m => m.user_id).map(m => m.user_id))];
            const emailSessionIds = [...new Set(
                userMessages
                    .filter(m => !m.user_id && typeof m.session_id === 'string' && m.session_id.includes('@'))
                    .map(m => m.session_id.trim().toLowerCase())
                    .filter(Boolean)
            )];

            // Fetch user info from profiles table using user IDs
            let userMapById = new Map();
            let userMapByEmail = new Map();

            if (userIds.length > 0) {
                const profiles = await this.fetchChatProfiles('id', userIds);

                if (profiles) {
                    profiles.forEach(u => {
                        userMapById.set(u.id, u);
                    });
                }
            }

            if (emailSessionIds.length > 0) {
                const profilesByEmail = await this.fetchChatProfiles('email', emailSessionIds);

                if (profilesByEmail) {
                    profilesByEmail.forEach(u => {
                        if (u.email) {
                            userMapByEmail.set(u.email.toLowerCase(), u);
                        }
                    });
                }
            }

            // Group USER messages by user_id (for logged-in users) or session_id (for pure guests)
            // This merges all sessions from the same user into one
            const userSessionMap = new Map(); // key: user_id or session_id, value: { lastMsg, sessionIds[] }

            userMessages.forEach(msg => {
                // Determine the grouping key: prefer user_id for registered users
                const groupKey = msg.user_id || msg.session_id;

                // Skip admin's own messages (don't show admin as a chat session)
                if (groupKey === adminUserId) return;

                if (!userSessionMap.has(groupKey)) {
                    userSessionMap.set(groupKey, {
                        lastMsg: msg,
                        sessionIds: new Set([msg.session_id]),
                        userId: msg.user_id
                    });
                } else {
                    // Add this session_id to the set (for loading all messages later)
                    userSessionMap.get(groupKey).sessionIds.add(msg.session_id);
                }
            });

            // Build sessions with user info
            this.sessions = Array.from(userSessionMap.entries()).map(([groupKey, data]) => {
                const msg = data.lastMsg;
                const normalizedGroupKey = typeof groupKey === 'string' ? groupKey.trim() : String(groupKey || '');
                const userInfo = data.userId
                    ? userMapById.get(data.userId)
                    : userMapByEmail.get(normalizedGroupKey.toLowerCase()) || null;
                const sessionIds = Array.from(data.sessionIds);
                const resolvedEmail = this.resolveSessionEmail(userInfo, normalizedGroupKey, sessionIds);

                // Determine display name: use username if available, else email username, else "访客" for guests
                const displayNickname = this.resolveSessionNickname(userInfo, normalizedGroupKey, resolvedEmail);

                return {
                    id: normalizedGroupKey, // Use user_id or session_id as the identifier
                    sessionIds, // All session_ids for this user (for message loading)
                    nickname: displayNickname,
                    email: resolvedEmail,
                    lastLogin: msg.created_at,
                    lastMessage: msg.message_type === 'image' ? this.t('chat.image', '[图片]') : msg.content,
                    lastTime: msg.created_at,
                    isAdmin: msg.is_admin,
                    userId: data.userId,
                    avatarUrl: userInfo?.avatar_url || null
                };
            });

            try {
                await this.refreshOpsAlerts({ announceNew: false });
            } catch (opsError) {
                console.error('Failed to load ops alert sessions:', opsError);
            }

            if (!this.isOpsAlertSession(this.sessions[0])) {
                this.sessions = [
                    this.buildOpsAlertSession(),
                    ...this.sessions
                ];
            }
            this.renderAdminSessionList();

        } catch (err) {
            console.error('Failed to load sessions:', err);
            this.sessionList.innerHTML = `<div class="session-loading">${this.t('chat.loadFailed', '加载失败')}</div>`;
        }
    }

    formatTime(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) return '';
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return this.t('chat.justNow', '刚刚');
        if (diffMins < 60) return this.t('chat.minutesAgo', '{minutes}分钟前').replace('{minutes}', diffMins);

        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return this.t('chat.hoursAgo', '{hours}小时前').replace('{hours}', diffHours);

        const isEnglish = window.i18n && window.i18n.isEnglish && window.i18n.isEnglish();
        return date.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' });
    }

    async fetchChatProfiles(filterType, values = []) {
        const uniqueValues = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
        if (!uniqueValues.length) return [];

        const selectVariants = [
            'id, email, display_name, username, avatar_url',
            'id, email, username, avatar_url',
            'id, username, avatar_url'
        ];

        let lastError = null;

        for (const selectClause of selectVariants) {
            try {
                const query = this.supabase
                    .from('profiles')
                    .select(selectClause)
                    .in(filterType, uniqueValues);

                const { data, error } = await query;
                if (error) {
                    lastError = error;
                    continue;
                }

                return Array.isArray(data) ? data : [];
            } catch (error) {
                lastError = error;
            }
        }

        if (lastError) {
            console.warn(`[ChatWidget] Failed to fetch profiles by ${filterType}:`, lastError);
        }
        return [];
    }

    getMessageRenderType(isAdminMessage) {
        return Boolean(isAdminMessage) === Boolean(this.isAdmin) ? 'user' : 'admin';
    }

    resolveSessionEmail(profile, fallbackKey = '', sessionIds = []) {
        const email = typeof profile?.email === 'string' ? profile.email.trim() : '';
        if (email) return email;

        const normalizedFallback = typeof fallbackKey === 'string' ? fallbackKey.trim() : String(fallbackKey || '');
        if (normalizedFallback.includes('@')) return normalizedFallback;

        const emailSessionId = (Array.isArray(sessionIds) ? sessionIds : [])
            .find(id => typeof id === 'string' && id.includes('@'));
        return emailSessionId ? emailSessionId.trim() : '';
    }

    resolveSessionNickname(profile, fallbackKey = '', preferredEmail = '') {
        const displayName = typeof profile?.display_name === 'string' ? profile.display_name.trim() : '';
        const username = typeof profile?.username === 'string' ? profile.username.trim() : '';
        const normalizedFallback = typeof fallbackKey === 'string' ? fallbackKey.trim() : String(fallbackKey || '');

        if (displayName) return displayName;
        if (username) return username;
        if (preferredEmail && preferredEmail.includes('@')) return preferredEmail.split('@')[0];
        if (normalizedFallback.includes('@')) return normalizedFallback.split('@')[0];
        return this.t('chat.guest', '访客');
    }

    getSessionAvatarInitial(session) {
        if (!session) return 'U';
        if (session.id && session.id.startsWith('guest_')) return 'G';
        const seed = session.nickname || session.email || session.id || 'U';
        return String(seed).trim().charAt(0).toUpperCase() || 'U';
    }

    createSessionAvatarElement(session) {
        const avatarEl = document.createElement('div');
        avatarEl.className = 'session-avatar';

        if (this.isOpsAlertSession(session)) {
            avatarEl.classList.add('session-avatar--ops');
            avatarEl.innerHTML = '<i class="fas fa-thumbtack"></i>';
            return avatarEl;
        }

        const fallbackInitial = this.getSessionAvatarInitial(session);
        if (!session?.avatarUrl) {
            avatarEl.textContent = fallbackInitial;
            return avatarEl;
        }

        avatarEl.classList.add('has-image');
        const img = document.createElement('img');
        img.src = session.avatarUrl;
        img.alt = `${session.nickname || session.email || session.id || 'user'} avatar`;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => {
            avatarEl.classList.remove('has-image');
            avatarEl.textContent = fallbackInitial;
            img.remove();
        });
        avatarEl.appendChild(img);
        return avatarEl;
    }

    selectSession(sessionId, sessionInfo = null) {
        this.currentSessionKey = sessionId;
        this.currentSessionId = sessionId;

        // Update active state
        this.sessionList.querySelectorAll('.session-item').forEach(item => {
            item.classList.toggle('active', item.dataset.sessionId === sessionId);
        });

        // Find session info if not passed
        if (!sessionInfo) {
            sessionInfo = this.sessions.find(s => s.id === sessionId) || {
                nickname: sessionId.startsWith('guest_') ? this.t('chat.guest', '访客') : sessionId.split('@')[0],
                email: sessionId,
                lastLogin: null
            };
        }

        if (this.isOpsAlertSession(sessionInfo)) {
            this.chatHeader.querySelector('.chat-user-name').textContent = '站内代办';
            this.chatHeader.querySelector('.chat-user-id').textContent = '站外告警同步 / 可直接跳转处理页';

            let statusContainer = this.chatHeader.querySelector('.user-status-indicator');
            if (!statusContainer) {
                statusContainer = document.createElement('div');
                statusContainer.className = 'user-status-indicator';
                this.chatHeader.querySelector('.chat-user-info').appendChild(statusContainer);
            }
            statusContainer.innerHTML = '<span class="status-dot online"></span><span class="status-text">固定系统联系人</span>';

            this.chatWindow.classList.add('chat-active');
            this.setAdminReplyReadonly(true);
            this.clearSessionUnreadState(this.opsAlertSessionId, [this.opsAlertSessionId]);
            this.renderOpsAlertMessages();
            return;
        }

        this.setAdminReplyReadonly(false);

        // Update header with user info
        this.chatHeader.querySelector('.chat-user-name').textContent = sessionInfo.nickname;
        // Prefer email in the header; only fall back when the session truly has no email.
        const headerEmail = this.resolveSessionEmail(null, sessionInfo.email || sessionInfo.id, sessionInfo.sessionIds || []);
        const displayId = headerEmail || sessionInfo.id;
        this.chatHeader.querySelector('.chat-user-id').textContent = displayId;

        // Update or add online status indicator
        let statusContainer = this.chatHeader.querySelector('.user-status-indicator');
        if (!statusContainer) {
            statusContainer = document.createElement('div');
            statusContainer.className = 'user-status-indicator';
            this.chatHeader.querySelector('.chat-user-info').appendChild(statusContainer);
        }

        // Calculate online status based on last activity
        const lastActivity = new Date(sessionInfo.lastLogin || sessionInfo.lastTime);
        const now = new Date();
        const diffMins = Math.floor((now - lastActivity) / 60000);

        let statusClass, statusText;
        if (diffMins < 5) {
            statusClass = 'online';
            statusText = this.t('chat.online', '在线');
        } else if (diffMins < 30) {
            statusClass = 'away';
            statusText = this.t('chat.activeMinutesAgo', '{minutes}分钟前活跃').replace('{minutes}', diffMins);
        } else if (diffMins < 60) {
            statusClass = 'away';
            statusText = this.t('chat.minutesAgo', '{minutes}分钟前').replace('{minutes}', diffMins);
        } else if (diffMins < 1440) {
            statusClass = 'offline';
            statusText = this.t('chat.hoursAgo', '{hours}小时前').replace('{hours}', Math.floor(diffMins / 60));
        } else {
            statusClass = 'offline';
            statusText = this.t('chat.daysAgo', '{days}天前').replace('{days}', Math.floor(diffMins / 1440));
        }

        statusContainer.innerHTML = `<span class="status-dot ${statusClass}"></span><span class="status-text">${statusText}</span>`;

        // Slide to chat view on mobile
        this.chatWindow.classList.add('chat-active');

        // Clear unread status for this session
        const sessionIdsToMark = sessionInfo.sessionIds || [sessionId];
        this.clearSessionUnreadState(sessionId, sessionIdsToMark);

        // Load messages (pass all session IDs for merged sessions)
        this.loadSessionMessages(sessionInfo.sessionIds || [sessionId]);
    }

    // Lock scroll during preloading
    lockScroll() {
        if (this.messagesContainer) {
            this.isPreloading = true;
            this.messagesContainer.classList.add('scroll-locked');
        }
    }

    // Unlock scroll after preloading complete
    unlockScroll() {
        if (this.messagesContainer) {
            this.isPreloading = false;
            this.messagesContainer.classList.remove('scroll-locked');
        }
    }

    getSessionCacheKey(sessionIds) {
        const normalized = [...new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(Boolean))];
        return normalized.sort().join('|');
    }

    clearSessionLoadingOverlayTimer() {
        if (this._sessionLoadingOverlayTimer) {
            clearTimeout(this._sessionLoadingOverlayTimer);
            this._sessionLoadingOverlayTimer = null;
        }
    }

    ensureSessionLoadingOverlay() {
        if (!this.messagesContainer) return null;

        let loadingOverlay = this.messagesContainer.querySelector('.loading-overlay');
        if (loadingOverlay) return loadingOverlay;

        loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'loading-overlay';
        loadingOverlay.innerHTML = '<div class="loading-spinner"></div><span>预加载消息中...</span>';
        this.messagesContainer.appendChild(loadingOverlay);
        return loadingOverlay;
    }

    removeSessionLoadingOverlay() {
        this.clearSessionLoadingOverlayTimer();
        if (!this.messagesContainer) return;
        const loadingOverlay = this.messagesContainer.querySelector('.loading-overlay');
        if (loadingOverlay) loadingOverlay.remove();
    }

    clearSessionUnreadState(sessionKey, sessionIds = []) {
        const idsToClear = [...new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(Boolean))];
        idsToClear.forEach(sid => this.unreadSessions.delete(sid));

        this.sessionList?.querySelectorAll('.session-item').forEach(item => {
            if (item.dataset.sessionId !== sessionKey) return;
            item.classList.remove('unread');
            const unreadDot = item.querySelector('.unread-dot');
            if (unreadDot) unreadDot.remove();
        });
    }

    renderSessionMessages(messages = []) {
        if (!this.messagesContainer) return;

        this.removeSessionLoadingOverlay();
        this.messagesContainer.innerHTML = '';
        this.lastDisplayedTime = null;

        if (!messages.length) {
            this.messagesContainer.innerHTML = `<div class="message admin">${this.t('chat.noMessages', '暂无消息')}</div>`;
            return;
        }

        messages.forEach(msg => {
            this.appendMessage(
                msg.content,
                this.getMessageRenderType(msg.is_admin),
                msg.message_type === 'image' ? 'image' : 'text',
                msg.created_at
            );
        });
    }

    // HIGH REFRESH RATE OPTIMIZATION: Disable expensive effects during scroll
    // 240Hz and above monitors need frame times < 4.16ms, backdrop-filter can't keep up
    setupScrollOptimization() {
        // Disabled: toggling extra classes during scroll caused style recalculation
        // without any matching CSS benefit, which could desync native scrollbar paint.
    }

    async loadSessionMessages(sessionIds) {
        // sessionIds can be an array (merged user) or will be converted to array
        const sessionIdArray = [...new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(Boolean))];
        const cacheKey = this.getSessionCacheKey(sessionIdArray);
        const requestId = ++this._sessionLoadRequestId;
        this.currentSessionIds = sessionIdArray;
        // Set currentSessionId for sending messages (use first one as the reply session)
        this.currentSessionId = sessionIdArray[0];

        const cachedMessages = this.sessionMessagesCache.get(cacheKey);
        if (Array.isArray(cachedMessages) && cachedMessages.length) {
            this.renderSessionMessages(cachedMessages);
            this._setMessagesContainerMinHeight(null);
            this.unlockScroll();
        } else {
            // PRELOAD STRATEGY: Lock scroll during message loading
            this.lockScroll();

            // Preserve current scroll state and container height to prevent scroll jump
            const currentHeight = this.messagesContainer.offsetHeight;

            // Set min-height to preserve layout during content swap
            this._setMessagesContainerMinHeight(currentHeight);

            // Only show the blocking overlay when the request is actually slow.
            this.clearSessionLoadingOverlayTimer();
            this._sessionLoadingOverlayTimer = setTimeout(() => {
                if (this._sessionLoadRequestId !== requestId) return;
                this.ensureSessionLoadingOverlay();
            }, 180);
        }

        try {
            const { data, error } = await this.supabase
                .from('chat_messages')
                .select('session_id, content, is_admin, message_type, created_at')
                .in('session_id', sessionIdArray)
                .order('created_at', { ascending: true });

            if (error) throw error;
            if (requestId !== this._sessionLoadRequestId) return;

            const normalizedData = Array.isArray(data) ? data : [];
            this.sessionMessagesCache.set(cacheKey, normalizedData);
            this.renderSessionMessages(normalizedData);

            // Remove min-height constraint after content is loaded
            this._setMessagesContainerMinHeight(null);

            // Scroll to bottom (new conversation loaded)
            this.scrollToBottom();

            // PRELOAD COMPLETE: Unlock scroll after all messages are rendered
            this.unlockScroll();

        } catch (err) {
            console.error('Failed to load messages:', err);
            if (requestId !== this._sessionLoadRequestId) return;
            this.removeSessionLoadingOverlay();
            this._setMessagesContainerMinHeight(null);
            this.messagesContainer.innerHTML = '<div class="message admin">加载失败</div>';
            // Unlock scroll even on error
            this.unlockScroll();
        }
    }

    async searchSessions(query) {
        // First, search in session list (name, email, preview)
        this.sessionList.querySelectorAll('.session-item').forEach(item => {
            this._setSessionItemHidden(item, false);
            // Remove previous match count
            const existingCount = item.querySelector('.search-match-count');
            if (existingCount) existingCount.remove();
        });

        // Then search in chat messages database
        try {
            const { data: messages, error } = await this.supabase
                .from('chat_messages')
                .select('session_id, content')
                .ilike('content', `%${query}%`);

            if (error) throw error;

            // Count matches per session
            const matchCounts = {};
            if (messages) {
                messages.forEach(msg => {
                    matchCounts[msg.session_id] = (matchCounts[msg.session_id] || 0) + 1;
                });
            }

            // Get all session IDs that have matched messages
            const matchedSessionIds = new Set(Object.keys(matchCounts));

            // Update UI
            this.sessionList.querySelectorAll('.session-item').forEach(item => {
                const sessionId = item.dataset.sessionId;
                const name = item.querySelector('.session-name')?.textContent.toLowerCase() || '';
                const email = item.querySelector('.session-email')?.textContent.toLowerCase() || '';
                const preview = item.querySelector('.session-preview')?.textContent.toLowerCase() || '';
                const extra = item.dataset.searchText || '';

                // Check if session info matches OR if there are message matches
                const session = this.sessions?.find(s => s.id === sessionId);
                const sessionIds = session?.sessionIds || [sessionId];
                const hasMessageMatch = sessionIds.some(sid => matchedSessionIds.has(sid));
                const hasInfoMatch = name.includes(query) || email.includes(query) || preview.includes(query) || extra.includes(query);

                if (hasInfoMatch || hasMessageMatch) {
                    this._setSessionItemHidden(item, false);

                    // Show match count if there are message matches
                    const totalMatches = sessionIds.reduce((sum, sid) => sum + (matchCounts[sid] || 0), 0);
                    if (totalMatches > 0) {
                        const countBadge = document.createElement('div');
                        countBadge.className = 'search-match-count';
                        countBadge.textContent = `${totalMatches} 条匹配`;
                        item.appendChild(countBadge);
                    }
                } else {
                    this._setSessionItemHidden(item, true);
                }
            });
        } catch (err) {
            console.error('Search failed:', err);
            // Fallback to basic search
            this.sessionList.querySelectorAll('.session-item').forEach(item => {
                const name = item.querySelector('.session-name')?.textContent.toLowerCase() || '';
                const preview = item.querySelector('.session-preview')?.textContent.toLowerCase() || '';
                const extra = item.dataset.searchText || '';
                const matches = name.includes(query) || preview.includes(query) || extra.includes(query);
                this._setSessionItemHidden(item, !matches);
            });
        }
    }

    bindAdminEvents() {
        // Close button
        this.chatWindow.querySelector('.chat-close').addEventListener('click', () => this.toggleChat());

        // Overlay click to close
        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.toggleChat());
        }

        // Back to list button (mobile slide navigation)
        const backBtn = this.chatWindow.querySelector('#backToListBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.chatWindow.classList.remove('chat-active');
            });
        }

        // Session search filter - enhanced with chat message search
        const searchInput = this.chatWindow.querySelector('#sessionSearch');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', async (e) => {
                const query = e.target.value.toLowerCase().trim();

                // Clear previous search timeout
                if (searchTimeout) clearTimeout(searchTimeout);

                if (!query) {
                    // Show all sessions when empty
                    this.sessionList.querySelectorAll('.session-item').forEach(item => {
                        this._setSessionItemHidden(item, false);
                        // Remove search highlights
                        const highlight = item.querySelector('.search-match-count');
                        if (highlight) highlight.remove();
                    });
                    return;
                }

                // Debounce search
                searchTimeout = setTimeout(async () => {
                    await this.searchSessions(query);
                }, 300);
            });
        }

        // Send Message (as admin)
        this.chatWindow.querySelector('#chatSendBtn').addEventListener('click', () => this.sendAdminMessage());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendAdminMessage();
        });
        this._bindInputFocusStabilizer(this.input);

        // Emoji Picker
        const emojiBtn = this.chatWindow.querySelector('#chatEmojiBtn');
        this._bindEmojiPicker(emojiBtn);

        // Image Upload
        const uploadBtn = this.chatWindow.querySelector('#chatUploadBtn');
        const imageInput = this.chatWindow.querySelector('#chatImageInput');
        uploadBtn.addEventListener('click', () => imageInput.click());
        imageInput.addEventListener('change', (e) => this.handleAdminImageUpload(e));

        // HIGH REFRESH RATE: Setup scroll optimization
        this.setupScrollOptimization();
    }

    async sendAdminMessage() {
        if (!this.currentSessionId) {
            // Show friendly inline hint instead of alert
            this.input.classList.add('shake-hint');
            this.input.placeholder = '⚠️ 请先选择一个会话';
            setTimeout(() => {
                this.input.classList.remove('shake-hint');
                this.input.placeholder = '输入回复...';
            }, 2000);
            return;
        }

        if (this.isOpsAlertSessionId(this.currentSessionId)) {
            this.input.classList.add('shake-hint');
            this.input.placeholder = '⚠️ 站内代办为只读告警流';
            setTimeout(() => {
                this.input.classList.remove('shake-hint');
                this.input.placeholder = '站内代办为只读告警流';
            }, 2000);
            return;
        }

        const text = this.input.value.trim();
        if (!text) return;

        // Optimistic UI update
        this.appendMessage(text, this.getMessageRenderType(true), 'text');
        this.input.value = '';
        this.scrollToBottom();

        try {
            await this.supabase
                .from('chat_messages')
                .insert({
                    session_id: this.currentSessionId,
                    content: text,
                    message_type: 'text',
                    is_admin: true
                });

            // 🔔 Create system notification for the user's bell
            await this.createNotificationForUser(this.currentSessionId, text);
        } catch (err) {
            console.error('Failed to send:', err);
        }
    }

    // 🔔 Create a system notification for user when admin replies
    async createNotificationForUser(sessionId, messageContent) {
        try {
            if (sessionId.startsWith('guest_')) {
                console.log('⏭️ Skipping notification for guest user');
                return;
            }

            let targetUserId = null;

            if (sessionId.startsWith('user_')) {
                targetUserId = sessionId.slice('user_'.length) || null;
            } else {
                const { data: profile, error: profileError } = await this.supabase
                    .from('profiles')
                    .select('id')
                    .eq('email', sessionId)
                    .single();

                if (!profileError && profile?.id) {
                    targetUserId = profile.id;
                }
            }

            if (!targetUserId) {
                const { data: messageRow, error: messageRowError } = await this.supabase
                    .from('chat_messages')
                    .select('user_id')
                    .eq('session_id', sessionId)
                    .not('user_id', 'is', null)
                    .limit(1)
                    .single();

                if (!messageRowError && messageRow?.user_id) {
                    targetUserId = messageRow.user_id;
                }
            }

            if (!targetUserId) {
                console.warn('Could not find user for notification:', sessionId);
                return;
            }

            // Create system notification
            const { error } = await insertScopedSystemNotification(this.supabase, {
                user_id: targetUserId,
                title: '客服回复',
                content: messageContent.substring(0, 100) + (messageContent.length > 100 ? '...' : ''),
                type: 'info',
                is_read: false,
                scope: 'user_personal',
                category: 'chat_reply'
            });

            if (error) {
                throw error;
            }

            console.log('🔔 Notification created for user:', targetUserId);
        } catch (err) {
            console.error('Failed to create notification:', err);
        }
    }

    async handleAdminImageUpload(event) {
        if (!this.currentSessionId) {
            // Show friendly inline hint instead of alert
            this.input.classList.add('shake-hint');
            this.input.placeholder = '⚠️ 请先选择一个会话';
            setTimeout(() => {
                this.input.classList.remove('shake-hint');
                this.input.placeholder = '输入回复...';
            }, 2000);
            event.target.value = ''; // Clear file input
            return;
        }

        if (this.isOpsAlertSessionId(this.currentSessionId)) {
            this.input.classList.add('shake-hint');
            this.input.placeholder = '⚠️ 站内代办为只读告警流';
            setTimeout(() => {
                this.input.classList.remove('shake-hint');
                this.input.placeholder = '站内代办为只读告警流';
            }, 2000);
            event.target.value = '';
            return;
        }

        const file = event.target.files[0];
        if (!file) return;

        try {
            // Compress image
            const compressedFile = await this.compressImage(file);

            const fileName = `admin_${Date.now()}_${Math.random().toString(36).substring(7)}.webp`;
            const { error: uploadError } = await this.supabase.storage
                .from('chat-images')
                .upload(fileName, compressedFile);

            if (uploadError) throw uploadError;

            const { data: urlData } = this.supabase.storage
                .from('chat-images')
                .getPublicUrl(fileName);

            const imageUrl = urlData.publicUrl;

            // Send as image message
            await this.supabase
                .from('chat_messages')
                .insert({
                    session_id: this.currentSessionId,
                    content: imageUrl,
                    message_type: 'image',
                    is_admin: true
                });

            this.appendMessage(imageUrl, this.getMessageRenderType(true), 'image');
            this.scrollToBottom();

        } catch (err) {
            console.error('Failed to upload:', err);
            alert('上传失败: ' + err.message);
        }

        event.target.value = '';
    }

    subscribeToAdminMessages() {
        if (this.adminMessageChannel) {
            this.supabase.removeChannel(this.adminMessageChannel);
        }
        if (this.adminOpsAlertChannel) {
            this.supabase.removeChannel(this.adminOpsAlertChannel);
        }

        this.adminMessageChannel = this.supabase
            .channel(`admin-chat-global-${Date.now()}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
                const msg = payload.new;

                // Skip admin's own messages
                if (msg.is_admin) return;

                // Check if we're currently ACTIVELY viewing this session's chat
                // Must be: window open + selected this session + on mobile: must be in chat view (not list view)
                const isMobile = window.innerWidth <= 700;
                const isInChatView = !isMobile || (this.chatWindow && this.chatWindow.classList.contains('chat-active'));
                const activeSessionIds = this.currentSessionIds || (this.currentSessionId ? [this.currentSessionId] : []);
                const isViewingThisSession = this.isOpen &&
                    activeSessionIds.length > 0 &&
                    activeSessionIds.includes(msg.session_id) &&
                    isInChatView;

                if (isViewingThisSession) {
                    // Append message to current chat - with animation (isNewMessage=true)
                    this.appendMessage(
                        msg.content,
                        this.getMessageRenderType(msg.is_admin),
                        msg.message_type === 'image' ? 'image' : 'text',
                        msg.created_at,
                        true
                    );
                    this.scrollToBottom();
                }

                // Always show notification if not actively viewing the chat
                if (!isViewingThisSession) {
                    const messageContent = msg.message_type === 'image' ? '📷 发送了一张图片' : msg.content;
                    const senderName = msg.user_id ? '已登录用户' : '访客';
                    this.showNotification(messageContent, `💬 ${senderName}`, true); // forceShow for admin

                    // Mark session as unread
                    this.unreadSessions.add(msg.session_id);
                }

                // Refresh session list to show new messages (will apply unread styling)
                this.loadAdminSessions();
            })
            .subscribe();

        this.adminOpsAlertChannel = this.supabase
            .channel(`admin-ops-alerts-${Date.now()}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ops_alert_jobs' }, (payload) => {
                this.upsertOpsAlertMessage(payload.new, { announce: true });
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ops_alert_jobs' }, (payload) => {
                this.upsertOpsAlertMessage(payload.new, { announce: false });
            })
            .subscribe();
    }

    injectUserLayoutStyles() {
        // Avoid duplicate injection
        if (document.getElementById('user-chat-styles')) return;

        const style = document.createElement('style');
        style.id = 'user-chat-styles';
        style.textContent = `
            /* User Mode Glassmorphism Enhancement */
            .chat-window:not(.admin-mode-layout) {
                background: var(--chat-shell-bg, rgba(11, 14, 20, 0.94)) !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                border: 1px solid var(--chat-shell-border, rgba(255, 255, 255, 0.08)) !important;
                box-shadow: 0 26px 70px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.06) !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-header {
                background: transparent !important;
                border-bottom: 1px solid var(--chat-panel-border, rgba(255, 255, 255, 0.08)) !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-messages {
                background: var(--chat-panel-bg, rgba(255, 255, 255, 0.025)) !important;
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), inset 0 -12px 24px rgba(0, 0, 0, 0.08) !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-input-area {
                background: transparent !important;
                border-top: 1px solid var(--chat-panel-border, rgba(255, 255, 255, 0.08)) !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-input,
            .chat-window:not(.admin-mode-layout) .chat-action-btn {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-action-btn {
                background: var(--chat-panel-bg, rgba(255, 255, 255, 0.025)) !important;
                border: 1px solid var(--chat-panel-border, rgba(255, 255, 255, 0.08)) !important;
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), inset 0 -12px 24px rgba(0, 0, 0, 0.08) !important;
                min-width: 36px !important;
                min-height: 36px !important;
                flex: 0 0 36px !important;
                margin: 0 !important;
                appearance: none !important;
                -webkit-appearance: none !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-action-btn i {
                width: 16px !important;
                height: 16px !important;
                display: inline-flex !important;
                justify-content: center !important;
                align-items: center !important;
                font-size: 16px !important;
                line-height: 1 !important;
            }

            .chat-window:not(.admin-mode-layout) #chatEmojiBtn.chat-action-btn {
                width: 36px !important;
                height: 36px !important;
                min-width: 36px !important;
                min-height: 36px !important;
                flex: 0 0 36px !important;
                padding: 0 !important;
                margin: 0 !important;
                background: transparent !important;
                border: none !important;
                border-radius: 50% !important;
                box-shadow: none !important;
                outline: none !important;
                color: rgba(255, 255, 255, 0.7) !important;
            }

            .chat-window:not(.admin-mode-layout) #chatEmojiBtn.chat-action-btn:hover {
                background: transparent !important;
                color: white !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-input {
                background: var(--chat-input-bg, rgba(0, 0, 0, 0.2)) !important;
                border: 1px solid var(--chat-input-border, rgba(255, 255, 255, 0.1)) !important;
                box-shadow: none !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-input:focus {
                background: var(--chat-input-bg-focus, rgba(0, 0, 0, 0.4)) !important;
                border-color: var(--chat-accent-blue, rgba(126, 184, 239, 0.96)) !important;
                box-shadow: 0 0 0 3px var(--chat-accent-blue-soft, rgba(126, 184, 239, 0.12)) !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-send-btn {
                color: var(--chat-accent-blue, rgba(126, 184, 239, 0.96)) !important;
            }

            .chat-window:not(.admin-mode-layout) .emoji-picker-popover {
                background: var(--chat-shell-bg, rgba(11, 14, 20, 0.94)) !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                border: 1px solid var(--chat-panel-border, rgba(255, 255, 255, 0.08)) !important;
                box-shadow: 0 26px 70px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.06) !important;
            }

            .chat-window:not(.admin-mode-layout) .message.admin {
                background: rgba(255, 255, 255, 0.12) !important;
                color: rgba(255, 255, 255, 0.92) !important;
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), inset 0 -12px 24px rgba(0, 0, 0, 0.08) !important;
            }

            body.chat-spotlight-suspended .spotlight-overlay,
            body.chat-spotlight-suspended .poetry-nav-container:hover .spotlight-overlay,
            body.chat-spotlight-suspended #ambientCanvas,
            body.chat-spotlight-suspended #starryCanvas {
                opacity: 0 !important;
                visibility: hidden !important;
                transition: none !important;
            }
            
            /* Hide site navigation smoothly and prevent WebKit texture limit bugs when chat opens */
            html.chat-widget-open {
                background-color: #000 !important;
            }
            body.chat-widget-open {
                background-color: transparent !important;
            }
            
            @media (max-width: 768px) {
                body.chat-widget-open .framer-nav,
                body.chat-widget-open .top-right-nav {
                    opacity: 0 !important;
                    pointer-events: none !important;
                    transform: translateY(-10px) !important;
                    transition: opacity 0.3s ease, transform 0.3s ease !important;
                }
            }
            
            /* Overlay for user mode (same as admin) */
            .chat-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: var(--chat-overlay-bg, rgba(7, 9, 12, 0.28));
                z-index: 9997;
                backdrop-filter: var(--chat-overlay-filter, blur(14px) saturate(108%));
                -webkit-backdrop-filter: var(--chat-overlay-filter, blur(14px) saturate(108%));
                transform: translateZ(0);
                -webkit-transform: translateZ(0);
                will-change: opacity, backdrop-filter;
                opacity: 0;
                transition: opacity 190ms cubic-bezier(0.22, 1, 0.36, 1);
            }
            .chat-overlay.visible {
                display: block;
                opacity: 1;
            }
            .chat-overlay.closing {
                display: block;
                opacity: 0;
                background: var(--chat-overlay-bg, rgba(7, 9, 12, 0.28));
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
                transition: opacity 120ms linear 140ms;
            }
            
            /* Narrow desktop: keep the natural desktop pop animation, only tighten size */
            @media (max-width: 700px) and (hover: hover) and (pointer: fine) {
                .chat-window:not(.admin-mode-layout) {
                    width: min(380px, calc(100vw - 24px)) !important;
                    max-width: calc(100vw - 24px) !important;
                    height: min(600px, calc(100vh - 88px)) !important;
                    max-height: calc(100vh - 88px) !important;
                    top: 50% !important;
                    left: 50% !important;
                    right: auto !important;
                    bottom: auto !important;
                    transform: translate3d(-50%, calc(-50% + 20px), 0) scale(0.95) !important;
                    transform-origin: center center !important;
                }

                .chat-window:not(.admin-mode-layout).active {
                    transform: translate3d(-50%, -50%, 0) scale(1) !important;
                }
            }

            /* Touch narrow screens: use the centered modal animation */
            @media (max-width: 700px) and (hover: none), (max-width: 700px) and (pointer: coarse) {
                .chat-window:not(.admin-mode-layout) .chat-header {
                    justify-content: flex-start !important;
                }

                .chat-window:not(.admin-mode-layout) {
                    --chat-base-translate-y: -50%;
                    --chat-shift-y: 0px;
                    --chat-open-offset-x: 0px;
                    --chat-open-offset-y: 0px;
                    --chat-open-scale: 1;
                    --chat-close-scale: 0.11;
                    position: fixed !important;
                    top: 50% !important;
                    left: 50% !important;
                    right: auto !important;
                    bottom: auto !important;
                    /* Mobile position must stay stable; keyboard movement is controlled by JS only. */
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                    width: 90vw !important;
                    max-width: 400px !important;
                    height: 70vh !important;
                    max-height: 600px !important;
                    /* Force opaque — rely on visibility:hidden + scale for animation, not opacity */
                    opacity: 1 !important;
                    /* Disable backdrop-filter during animation to avoid Chromium flash bug */
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }

                .chat-window:not(.admin-mode-layout).chat-opening {
                    visibility: visible !important;
                    pointer-events: none !important;
                    opacity: 0 !important;
                    transform: translate3d(
                        calc(-50% + var(--chat-open-offset-x, 0px)),
                        calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px) + var(--chat-open-offset-y, 0px)),
                        0
                    ) scale(var(--chat-open-scale, 0.2)) !important;
                    transform-origin: center center !important;
                }
                
                .chat-window:not(.admin-mode-layout).active {
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }

                .chat-window:not(.admin-mode-layout).chat-opening.active {
                    visibility: visible !important;
                    pointer-events: all !important;
                    opacity: 1 !important;
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                    transition:
                        opacity 190ms cubic-bezier(0.22, 1, 0.36, 1),
                        transform 280ms cubic-bezier(0.18, 0.88, 0.24, 1) !important;
                }

                .chat-window:not(.admin-mode-layout).chat-closing {
                    visibility: visible !important;
                    pointer-events: none !important;
                    opacity: 1 !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                    transform-origin: center center !important;
                }

                .chat-window:not(.admin-mode-layout).chat-closing.chat-closing-end {
                    opacity: 0 !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                    transform: translate3d(
                        calc(-50% + var(--chat-open-offset-x, 0px)),
                        calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px) + var(--chat-open-offset-y, 0px)),
                        0
                    ) scale(var(--chat-close-scale, 0.11)) !important;
                    transition:
                        opacity 120ms linear 140ms,
                        transform 280ms cubic-bezier(0.18, 0.88, 0.24, 1) !important;
                }
            }
            
            /* Enforce instant scrolling for user mode too */
            .chat-window:not(.admin-mode-layout) .chat-messages {
                scroll-behavior: auto !important;
                overscroll-behavior-y: contain;
            }
        `;
        document.head.appendChild(style);
    }

    renderUserMode() {
        this.isAdmin = false;

        // Create Chat Window
        this.chatWindow = document.createElement('div');
        this.chatWindow.className = 'chat-window';
        this.chatWindow.innerHTML = `
            <div class="chat-header">
                <div class="chat-header-info">
                    <div class="chat-avatar">
                        <div class="mascot-wrapper mascot-wrapper--compact">
                            <div class="mascot-head">
                                <div class="mascot-ears"></div>
                                <div class="mascot-face">
                                    <div class="mascot-eyes">
                                        <span class="eye left"></span>
                                        <span class="eye right"></span>
                                    </div>
                                    <div class="mascot-mouth"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="chat-title">
                        <h3>${this.t('chat.onlineSupport', '在线客服')}</h3>
                        <div class="chat-status-row">
                            <div class="chat-status-indicator">
                                <span class="status-dot online"></span>
                                <span class="status-text target-admin-status">${this.t('chat.adminOnline', '管理员在线')}</span>
                            </div>
                            <div class="chat-header-actions" id="chatHeaderActions" hidden>
                                <button type="button" class="chat-header-mode-switch" id="chatHeaderSupportBtn">${this.escapeHtml(this.getSupportEntryLabel())}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="chat-messages" id="chatMessages">
                <!-- Welcome Message -->
                <div class="message admin">
                    ${this.t('chat.welcomeMessage', '您好！有什么可以帮您的吗？')}
                </div>
            </div>
            <div class="chat-support-panel" id="chatSupportPanel" hidden></div>
            <div class="chat-input-area">
                <input type="file" id="chatImageInput" class="chat-file-input" accept="image/*">
                <button class="chat-action-btn" id="chatUploadBtn"><i class="fas fa-plus"></i></button>
                <input type="text" class="chat-input" id="chatInput" placeholder="${this.t('chat.inputMessagePlaceholder', '输入消息...')}">
                <button class="chat-action-btn" id="chatEmojiBtn"><i class="far fa-smile"></i></button>
                <button class="chat-send-btn" id="chatSendBtn"><i class="fas fa-paper-plane"></i></button>
            </div>
            <div class="emoji-picker-popover" id="emojiPicker">
                ${this.emojis.map(e => `<div class="emoji-item">${e}</div>`).join('')}
            </div>
        `;
        document.body.appendChild(this.chatWindow);

        // Create overlay for clicking outside to close (same as admin mode)
        this.overlay = document.createElement('div');
        this.overlay.className = 'chat-overlay';
        document.body.appendChild(this.overlay);

        // Inject user mode styles (glassmorphism enhancement)
        this.injectUserLayoutStyles();

        this.messagesContainer = this.chatWindow.querySelector('#chatMessages');
        this.supportPanel = this.chatWindow.querySelector('#chatSupportPanel');
        this.inputArea = this.chatWindow.querySelector('.chat-input-area');
        this.input = this.chatWindow.querySelector('#chatInput');
        this.emojiPicker = this.chatWindow.querySelector('#emojiPicker');
        this.headerActions = this.chatWindow.querySelector('#chatHeaderActions');
        this.headerSupportToggle = this.chatWindow.querySelector('#chatHeaderSupportBtn');
        this.renderSupportRootPanel();
    }

    bindUserEvents() {
        // Overlay click to close (same as admin mode)
        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.toggleChat());
        }

        // Send Message
        this.chatWindow.querySelector('#chatSendBtn').addEventListener('click', () => this.sendMessage());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        this._bindInputFocusStabilizer(this.input);
        this.supportPanel?.addEventListener('click', (event) => this.handleSupportPanelClick(event));
        this.supportPanel?.addEventListener('submit', (event) => this.handleSupportPanelSubmit(event));
        this.messagesContainer?.addEventListener('click', (event) => this.handleSupportAssistMessageClick(event));
        this.headerSupportToggle?.addEventListener('click', () => this.renderSupportRootPanel());

        // Emoji Picker
        const emojiBtn = this.chatWindow.querySelector('#chatEmojiBtn');
        this._bindEmojiPicker(emojiBtn);

        // Image Upload
        const uploadBtn = this.chatWindow.querySelector('#chatUploadBtn');
        const fileInput = this.chatWindow.querySelector('#chatImageInput');

        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleImageUpload(e));

        // HIGH REFRESH RATE: Setup scroll optimization
        this.setupScrollOptimization();
    }

    toggleChat() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            if (!this.isAdmin) {
                if (this.input) this.input.value = '';
                this.renderSupportRootPanel();
            } else {
                this.refreshOpsAlerts({ announceNew: false }).catch((error) => {
                    console.warn('[ChatWidget] Failed to refresh ops alerts on open:', error?.message || error);
                });
            }
            this._pauseFabAmbientMotion();
            document.documentElement.classList.add('chat-widget-open');
            document.body.classList.add('chat-widget-open');
            this._clearOpeningAnimationTimer();
            this._clearClosingAnimationTimer();
            this.chatWindow.classList.remove('chat-closing');
            this.chatWindow.classList.remove('chat-closing-end');
            this.chatWindow.classList.add('chat-opening');
            this._primeOpeningAnimationFromFab();
            this._setChatWindowTransitionless(false);
            this._setChatWindowForceHidden(false);
            this._showStatusBarShield();
            // 1. 先执行所有会触发布局突变的操作（弹窗此刻仍然 opacity:0, visibility:hidden）
            this._setFabTransitionless(false);
            this._setFabHidden(true);
            this._setFabDisabled(true);
            if (this.overlay) {
                this.overlay.classList.remove('closing');
                this.overlay.classList.add('visible');
            }
            this._freezeOverlay();

            if (window.iOSScrollLock) {
                // Strictly use lockLight across all platforms.
                // Using hard lock (position: fixed) on iOS violently conflicts with 
                // native Safari scroll-to-input behaviors during keyboard popup, causing visual jitter.
                window.iOSScrollLock.lockLight(this.chatWindow);
            }
            this._enableSessionVisualLock();
            if (this._shouldUseFocusDockFallback()) {
                this._attachKeyboardListener();
            }

            // 2. 等布局稳定后，再启动动画（double-rAF 确保浏览器已完成一次渲染）
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!this.isOpen) return; // 用户可能在等待期间关闭了
                    this.chatWindow.classList.add('active');
                    this._captureStableDockHeight();
                    this._openingAnimationTimer = setTimeout(() => {
                        this._openingAnimationTimer = null;
                        if (this.isOpen && this.chatWindow) {
                            this.chatWindow.classList.remove('chat-opening');
                            this._clearOpeningAnimationState();
                            if (!this.chatWindow.classList.contains('keyboard-docked')) {
                                this._setChatWindowTransitionless(false);
                            }
                        }
                    }, 280);
                });
            });

        } else {
            this._pauseFabAmbientMotion(1800);
            document.documentElement.classList.remove('chat-widget-open');
            document.body.classList.remove('chat-widget-open');
            if (this._startClosingAnimation()) return;
            this._finalizeChatClose();
        }
    }

    /**
     * iOS 键盘适配：不阻止 Safari 滚动（会抖），
     * 只在键盘弹出时给聊天窗口加 bottom 偏移，让输入框露在键盘上方
     */
    _attachKeyboardListener() {
        if (!window.visualViewport) {
            this._onChatFocusIn = () => {
                if (this._shouldUseFocusDockFallback()) {
                    this._clearPendingUndockTimer();
                    this._applyKeyboardDock(window.innerHeight || 0, 0, true);
                    this._keyboardDocked = true;
                    this._lastKeyboardInset = 0;
                }
            };
            this._onChatFocusOut = () => {
                if (this._isIOSMobile()) {
                    this._clearPendingUndockTimer();
                    this._resetKeyboardViewportStyles(true);
                    this._keyboardDocked = false;
                    this._lastKeyboardInset = 0;
                } else {
                    this._scheduleUndock();
                }
            };
            this.chatWindow?.addEventListener('focusin', this._onChatFocusIn, true);
            this.chatWindow?.addEventListener('focusout', this._onChatFocusOut, true);
            return;
        }

        const vv = window.visualViewport;
        this._viewportBaseHeight = Math.max(
            this._viewportBaseHeight || 0,
            window.innerHeight || 0,
            document.documentElement.clientHeight || 0,
            (vv.height || 0) + (vv.offsetTop || 0)
        );
        this._viewportBaseVisualHeight = Math.max(
            this._viewportBaseVisualHeight || 0,
            vv.height || 0
        );
        this._captureStableDockHeight();

        this._onViewportResize = () => {
            const vv = window.visualViewport;
            const visualTop = Math.max(0, vv.offsetTop || 0);
            const visualHeight = Math.max(0, vv.height || 0);
            const visualBottom = visualTop + visualHeight;

            this._viewportBaseHeight = Math.max(
                this._viewportBaseHeight || 0,
                window.innerHeight || 0,
                document.documentElement.clientHeight || 0,
                visualBottom
            );

            this._viewportBaseVisualHeight = Math.max(
                this._viewportBaseVisualHeight || 0,
                visualHeight
            );

            const insetFromLayout = Math.max(0, this._viewportBaseHeight - visualBottom);
            const insetFromViewportDelta = Math.max(0, (this._viewportBaseVisualHeight || visualHeight) - visualHeight);
            const bottomInset = Math.max(insetFromLayout, insetFromViewportDelta);
            if (bottomInset < 40) {
                this._captureStableDockHeight();
            } else {
                this._scheduleStableKeyboardInset(bottomInset);
            }
            const isFocusedInChat = this._isChatInputFocused();
            const isIOS = this._isIOSMobile();
            const shouldDock = this._isNarrowViewport() && (
                isIOS
                    ? (
                        !this._keyboardBlurUndocking &&
                        (this._keyboardDocked ? bottomInset > 8 : bottomInset > 24)
                    )
                    : (bottomInset > 60)
            );

            if (isIOS && !isFocusedInChat && bottomInset <= 8) {
                this._keyboardBlurUndocking = false;
                this._pendingStableKeyboardInset = 0;
                this._clearKeyboardSettleTimer();
            }

            if (shouldDock) {
                this._clearPendingUndockTimer();
                this._keyboardPreLiftActive = false;
                if (!this._keyboardDocked) {
                    if (isIOS) {
                        this._scheduleInitialKeyboardDock(visualHeight, bottomInset);
                    } else {
                        // Only animate on the edge transition into keyboard-docked state.
                        this._applyKeyboardDock(visualHeight, bottomInset, true);
                        this._keyboardDocked = true;
                        this._lastKeyboardInset = bottomInset;
                    }
                } else if (Math.abs(bottomInset - this._lastKeyboardInset) > 1) {
                    if (this._isHighRefreshDisplay && performance.now() < this._keyboardDockAnimatingUntil) {
                        this._lastKeyboardInset = bottomInset;
                        return;
                    }
                    // Follow keyboard without animation to avoid repeated transition restarts.
                    this._applyKeyboardDock(visualHeight, bottomInset, false);
                    this._lastKeyboardInset = bottomInset;
                }
            } else {
                this._clearPendingFirstDock();
                if (!isIOS) {
                    // 非 iOS 保留平滑过渡
                    this._scheduleUndock();
                } else {
                    this._clearPendingUndockTimer();
                    if (this._keyboardDocked) {
                        this._resetKeyboardViewportStyles(true);
                    }
                    this._keyboardDocked = false;
                    this._lastKeyboardInset = 0;
                }
            }
        };
        this._onViewportChange = () => this._requestViewportSync();
        window.visualViewport.addEventListener('resize', this._onViewportChange, { passive: true });
        window.visualViewport.addEventListener('scroll', this._onViewportChange, { passive: true });

        this._onChatFocusIn = () => {
            this._keyboardBlurUndocking = false;
            this._keyboardPreLiftActive = false;
            if (window.visualViewport) {
                const vv = window.visualViewport;
                this._viewportBaseHeight = Math.max(
                    this._viewportBaseHeight || 0,
                    window.innerHeight || 0,
                    document.documentElement.clientHeight || 0,
                    (vv.height || 0) + (vv.offsetTop || 0)
                );
                this._viewportBaseVisualHeight = Math.max(
                    this._viewportBaseVisualHeight || 0,
                    vv.height || 0
                );
            }
            this._captureStableDockHeight();
            this._clearKeyboardSettleTimer();
            this._requestViewportSync();
            setTimeout(() => this._requestViewportSync(), 160);
        };
        this._onChatFocusOut = () => {
            this._clearPendingUndockTimer();
            this._clearKeyboardSettleTimer();
            this._keyboardPreLiftActive = false;
            requestAnimationFrame(() => {
                if (this._isChatInputFocused()) return;
                this._keyboardBlurUndocking = true;
                if (this._keyboardDocked) {
                    this._resetKeyboardViewportStyles(true);
                }
                this._requestViewportSync();
            });
        };
        this.chatWindow?.addEventListener('focusin', this._onChatFocusIn, true);
        this.chatWindow?.addEventListener('focusout', this._onChatFocusOut, true);

        this._requestViewportSync();
    }

    _detachKeyboardListener() {
        if (window.visualViewport && this._onViewportChange) {
            window.visualViewport.removeEventListener('resize', this._onViewportChange);
            window.visualViewport.removeEventListener('scroll', this._onViewportChange);
            this._onViewportChange = null;
        }
        if (this._viewportThrottleTimer) {
            clearTimeout(this._viewportThrottleTimer);
            this._viewportThrottleTimer = null;
        }
        if (this._viewportRafId) {
            cancelAnimationFrame(this._viewportRafId);
            this._viewportRafId = null;
        }
        if (this._onViewportResize) {
            this._onViewportResize = null;
        }
        if (this.chatWindow && this._onChatFocusIn) {
            this.chatWindow.removeEventListener('focusin', this._onChatFocusIn, true);
            this._onChatFocusIn = null;
        }
        if (this.chatWindow && this._onChatFocusOut) {
            this.chatWindow.removeEventListener('focusout', this._onChatFocusOut, true);
            this._onChatFocusOut = null;
        }
        this._viewportBaseHeight = null;
        this._viewportBaseVisualHeight = null;
        this._stableDockHeight = null;
        this._keyboardDocked = false;
        this._lastKeyboardInset = 0;
        this._keyboardBlurUndocking = false;
        this._keyboardPreLiftActive = false;
        this._clearKeyboardSettleTimer();
        this._clearTransitionCleanupTimer();
        this._clearPendingFirstDock();
        this._clearPendingUndockTimer();
        this._restoreMotionVisuals();
    }

    _captureStableDockHeight() {
        if (!this.chatWindow) return;
        if (window.visualViewport) {
            const vv = window.visualViewport;
            const visualBottom = (vv.height || 0) + (vv.offsetTop || 0);
            const layoutHeight = Math.max(
                window.innerHeight || 0,
                document.documentElement.clientHeight || 0,
                visualBottom
            );
            const keyboardInset = Math.max(0, layoutHeight - visualBottom);
            if (keyboardInset > 60) return;
        }
        const rect = this.chatWindow.getBoundingClientRect();
        const height = Math.round(rect.height || 0);
        if (height > 220) {
            this._stableDockHeight = height;
        }
    }

    _isNarrowViewport() {
        return window.matchMedia('(max-width: 700px)').matches;
    }

    _isIOSMobile() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    _isTouchPrimaryInput() {
        if (navigator.maxTouchPoints > 0) return true;
        if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
            return true;
        }
        return 'ontouchstart' in window;
    }

    _usesTouchNarrowLayout() {
        return this._isNarrowViewport() && (this._isIOSMobile() || this._isTouchPrimaryInput());
    }

    _shouldUseFocusDockFallback() {
        return this._usesTouchNarrowLayout();
    }

    _isChatInputFocused() {
        const active = document.activeElement;
        if (!active || !this.chatWindow) return false;
        if (!this.chatWindow.contains(active)) return false;
        return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    }

    _focusInputWithoutScroll(inputEl) {
        if (!inputEl) return;
        if (!this._isIOSMobile() || !this._isNarrowViewport()) {
            inputEl.focus();
            return;
        }
        try {
            inputEl.focus({ preventScroll: true });
        } catch (err) {
            inputEl.focus();
        }
    }

    _bindInputFocusStabilizer(inputEl) {
        if (!inputEl || inputEl.dataset.preventScrollBind === '1') return;

        const handleTouchFocus = (e) => {
            if (!this.isOpen || !this._isIOSMobile() || !this._isNarrowViewport()) return;
            if (e.cancelable) e.preventDefault();
            this._focusInputWithoutScroll(inputEl);
        };

        inputEl.addEventListener('touchstart', handleTouchFocus, { passive: false });
        inputEl.dataset.preventScrollBind = '1';
    }

    _freezeOverlay() {
        if (!this.overlay) return;
        const vv = window.visualViewport;
        const initialViewportHeight = Math.max(
            window.innerHeight || 0,
            document.documentElement.clientHeight || 0,
            vv ? ((vv.height || 0) + (vv.offsetTop || 0)) : 0,
            window.screen?.height || 0
        );
        this._overlayBaseHeight = initialViewportHeight + 64;

        // 高度基线，避免 body.no-scroll 裁切导致底部漏层
        this._toggleElementClass(this.overlay, 'chat-overlay--frozen', true);
        this._syncOverlayFrame = () => {
            if (!this.overlay) return;
            const vv = window.visualViewport;
            const overlayHeight = Math.max(
                this._overlayBaseHeight || 0,
                window.innerHeight || 0,
                document.documentElement.clientHeight || 0,
                vv ? ((vv.height || 0) + (vv.offsetTop || 0) + 64) : 0,
                window.screen?.height || 0
            );
            this._setRuntimeStyle(this.overlay, '--chat-overlay-frozen-height', `${overlayHeight}px`, 'important');
        };
        this._syncOverlayFrame();

        window.addEventListener('resize', this._syncOverlayFrame, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this._syncOverlayFrame, { passive: true });
            window.visualViewport.addEventListener('scroll', this._syncOverlayFrame, { passive: true });
        }
    }

    _restoreOverlay() {
        if (!this.overlay) return;
        if (this._syncOverlayFrame) {
            window.removeEventListener('resize', this._syncOverlayFrame);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', this._syncOverlayFrame);
                window.visualViewport.removeEventListener('scroll', this._syncOverlayFrame);
            }
            this._syncOverlayFrame = null;
        }
        this._toggleElementClass(this.overlay, 'chat-overlay--frozen', false);
        this._setRuntimeStyle(this.overlay, '--chat-overlay-frozen-height', null);
        this._overlayBaseHeight = null;
    }

    _applyKeyboardDock(visualHeight, bottomInset, animate = false) {
        if (!this.chatWindow) return;

        this.chatWindow.classList.add('keyboard-docked');
        this._clearTransitionCleanupTimer();
        const dockDuration = this._getAdaptiveKeyboardDuration(9, 70, 150);
        if (animate) {
            this._applyMotionVisualLock(dockDuration + 40);
            this._keyboardDockAnimatingUntil = performance.now() + dockDuration + 24;
            this._setChatWindowTransitionless(false);
            this._setChatWindowKeyboardAnimating(true, dockDuration);
            this._transitionCleanupTimer = setTimeout(() => {
                this._transitionCleanupTimer = null;
                if (this.chatWindow && this.chatWindow.classList.contains('keyboard-docked')) {
                    this._setChatWindowKeyboardAnimating(false);
                }
            }, dockDuration + 40);
        } else {
            this._setChatWindowKeyboardAnimating(false);
            this._setChatWindowTransitionless(true);
        }

        const isIOS = this._isIOSMobile();
        if (isIOS) {
            const baseViewportHeight = Math.max(
                this._viewportBaseHeight || 0,
                window.innerHeight || 0,
                document.documentElement.clientHeight || 0,
                visualHeight + Math.max(0, bottomInset)
            );
            const fallbackHeight = Math.min(600, Math.max(420, Math.round(baseViewportHeight * 0.7)));
            const dockHeight = Math.max(320, Math.round(this._stableDockHeight || fallbackHeight));
            // Compute the docked offset directly so Safari never paints an intermediate centered state.
            const centeredBottom = (baseViewportHeight * 0.5) + (dockHeight * 0.5);
            const keyboardTop = Math.max(0, baseViewportHeight - Math.max(0, bottomInset));
            const targetBottom = Math.max(40, keyboardTop - 12);
            const deltaY = Math.max(-520, Math.min(520, targetBottom - centeredBottom));
            this._setChatWindowDockBottom(null);
            this._setChatWindowDockHeight(dockHeight);
            this._setChatTranslateVars('-50%', deltaY);
            return;
        }
        const dockBottom = Math.max(0, bottomInset);
        // 覆盖移动端居中定位，改为贴近键盘上沿
        this._setChatWindowDockHeight(null);
        this._setChatWindowDockBottom(dockBottom);
        this._setChatTranslateVars('0px', 0);
    }

    _scheduleUndock() {
        if (!this._isNarrowViewport()) {
            this._resetKeyboardViewportStyles();
            return;
        }
        this._clearPendingUndockTimer();
        this._pendingUndockTimer = setTimeout(() => {
            if (!this._isChatInputFocused()) {
                this._resetKeyboardViewportStyles();
            }
            this._pendingUndockTimer = null;
        }, 260);
    }

    _clearPendingUndockTimer() {
        if (this._pendingUndockTimer) {
            clearTimeout(this._pendingUndockTimer);
            this._pendingUndockTimer = null;
        }
    }

    _requestViewportSync() {
        if (!this._onViewportResize) return;
        const useHighRefreshGuard = this._isIOSMobile() && this._isNarrowViewport() && this._isHighRefreshDisplay;
        if (useHighRefreshGuard) {
            const now = performance.now();
            const minInterval = 1000 / 60;
            const elapsed = now - this._lastViewportSyncAt;
            if (elapsed < minInterval) {
                if (this._viewportThrottleTimer) return;
                this._viewportThrottleTimer = setTimeout(() => {
                    this._viewportThrottleTimer = null;
                    this._requestViewportSync();
                }, Math.max(0, Math.round(minInterval - elapsed)));
                return;
            }
        }
        if (this._viewportRafId) return;
        this._viewportRafId = requestAnimationFrame(() => {
            this._viewportRafId = null;
            this._lastViewportSyncAt = performance.now();
            this._onViewportResize?.();
        });
    }

    _clearKeyboardSettleTimer() {
        if (this._keyboardSettleTimer) {
            clearTimeout(this._keyboardSettleTimer);
            this._keyboardSettleTimer = null;
        }
    }

    _clearOpeningAnimationTimer() {
        if (this._openingAnimationTimer) {
            clearTimeout(this._openingAnimationTimer);
            this._openingAnimationTimer = null;
        }
    }

    _clearClosingAnimationTimer() {
        if (this._closingAnimationTimer) {
            clearTimeout(this._closingAnimationTimer);
            this._closingAnimationTimer = null;
        }
    }

    _getFabMotionMetrics() {
        if (!this.chatWindow || !this.fab || this.chatWindow.classList.contains('admin-mode-layout')) return;
        if (!this._usesTouchNarrowLayout()) return;

        const chatRect = this.chatWindow.getBoundingClientRect();
        const fabRect = this.fab.getBoundingClientRect();
        if (!chatRect.width || !chatRect.height || !fabRect.width || !fabRect.height) return;

        const chatCenterX = chatRect.left + (chatRect.width / 2);
        const chatCenterY = chatRect.top + (chatRect.height / 2);
        const fabCenterX = fabRect.left + (fabRect.width / 2);
        const fabCenterY = fabRect.top + (fabRect.height / 2);
        const offsetX = Math.round(fabCenterX - chatCenterX);
        const offsetY = Math.round(fabCenterY - chatCenterY);
        const scaleX = fabRect.width / chatRect.width;
        const scaleY = fabRect.height / chatRect.height;
        const startScale = Math.max(0.16, Math.min(0.28, Math.min(scaleX, scaleY) * 1.15));
        const closeScale = Math.max(0.08, Math.min(0.13, Math.min(scaleX, scaleY) * 0.82));

        return { offsetX, offsetY, startScale, closeScale, chatRect, fabRect };
    }

    _primeOpeningAnimationFromFab() {
        const motion = this._getFabMotionMetrics();
        if (!motion || !this.chatWindow) {
            this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-x', '0px');
            this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-y', '0px');
            this._setRuntimeStyle(this.chatWindow, '--chat-open-scale', '0.2');
            this._setRuntimeStyle(this.chatWindow, '--chat-close-scale', '0.11');
            return;
        }

        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-x', `${motion.offsetX}px`);
        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-y', `${motion.offsetY}px`);
        this._setRuntimeStyle(this.chatWindow, '--chat-open-scale', motion.startScale.toFixed(3));
        this._setRuntimeStyle(this.chatWindow, '--chat-close-scale', motion.closeScale.toFixed(3));
    }

    _clearOpeningAnimationState() {
        if (!this.chatWindow) return;
        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-x', null);
        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-y', null);
        this._setRuntimeStyle(this.chatWindow, '--chat-open-scale', null);
        this._setRuntimeStyle(this.chatWindow, '--chat-close-scale', null);
    }

    _finalizeChatClose() {
        if (!this.chatWindow) return;
        this.chatWindow.classList.remove('chat-opening');
        this.chatWindow.classList.remove('chat-closing');
        this.chatWindow.classList.remove('chat-closing-end');
        this.chatWindow.classList.remove('active');
        this._clearOpeningAnimationState();
        this._setChatWindowTransitionless(true);
        this._setChatWindowForceHidden(true);
        this._setFabDisabled(true);
        if (this.overlay) {
            this.overlay.classList.remove('visible');
            this.overlay.classList.remove('closing');
        }

        this._disableSessionVisualLock();
        this._detachKeyboardListener();
        this._resetKeyboardViewportStyles();
        this._clearPendingUndockTimer();
        this._restoreOverlay();
        this._stableDockHeight = null;

        if (window.iOSScrollLock) window.iOSScrollLock.unlock();
        this._hideStatusBarShield();

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (this.isOpen) return;
                this._setFabTransitionless(true);
                this._setFabHidden(false);
                this._setFabDisabled(false);
                this._scheduleFabAmbientMotion();
                requestAnimationFrame(() => {
                    if (!this.isOpen) {
                        this._setFabTransitionless(false);
                        this._setChatWindowTransitionless(false);
                    }
                });
            });
        });
    }

    _startClosingAnimation() {
        if (!this.chatWindow) return false;
        if (this.chatWindow.classList.contains('admin-mode-layout')) return false;
        if (!this._usesTouchNarrowLayout()) return false;

        this._clearOpeningAnimationTimer();
        this._clearClosingAnimationTimer();
        this.chatWindow.classList.remove('chat-opening');
        this.chatWindow.classList.add('chat-closing');
        this.chatWindow.classList.remove('chat-closing-end');
        this._primeOpeningAnimationFromFab();
        this._setChatWindowTransitionless(false);
        this._setChatWindowForceHidden(false);
        if (this.overlay) {
            this.overlay.classList.add('closing');
            this.overlay.classList.remove('visible');
        }
        this._setFabTransitionless(true);
        this._setFabHidden(false);
        this._setFabDisabled(true);
        this._detachKeyboardListener();

        const activeInput = document.activeElement;
        if (activeInput && this.chatWindow.contains(activeInput) && typeof activeInput.blur === 'function') {
            activeInput.blur();
        }

        // Force Safari to commit the fully-visible closing start state before flipping to the end state.
        void this.chatWindow.offsetWidth;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (this.isOpen || !this.chatWindow) return;
                this.chatWindow.classList.add('chat-closing-end');
            });
        });

        this._closingAnimationTimer = setTimeout(() => {
            this._closingAnimationTimer = null;
            if (this.isOpen) return;
            this._finalizeChatClose();
        }, 300);

        return true;
    }

    _setPromptSpotlightSuspended(suspended) {
        const path = window.location.pathname || '';
        if (!/\/prompts(?:\.html)?$/i.test(path)) return;
        if (!document.body) return;

        document.body.classList.toggle('chat-spotlight-suspended', suspended);

        const container = document.querySelector('.poetry-nav-container');
        if (!container) return;
        this._toggleElementClass(container, 'chat-prompt-spotlight-suspended', suspended);
    }

    _clearTransitionCleanupTimer() {
        if (this._transitionCleanupTimer) {
            clearTimeout(this._transitionCleanupTimer);
            this._transitionCleanupTimer = null;
        }
    }

    _clearPendingFirstDock() {
        if (this._pendingFirstDockTimer) {
            clearTimeout(this._pendingFirstDockTimer);
            this._pendingFirstDockTimer = null;
        }
        this._pendingFirstDockParams = null;
    }

    _scheduleInitialKeyboardDock(visualHeight, bottomInset) {
        const requiresFirstKeyboardWarmup = this._isIOSMobile() && this._lastStableKeyboardInset <= 40;
        let predictedInset = bottomInset;
        if (this._isIOSMobile() && this._lastStableKeyboardInset > 40) {
            if (bottomInset < 24) {
                predictedInset = this._lastStableKeyboardInset;
            } else {
                predictedInset = Math.min(bottomInset, this._lastStableKeyboardInset + 12);
            }
        }
        this._pendingFirstDockParams = {
            visualHeight,
            bottomInset: predictedInset,
            animate: !requiresFirstKeyboardWarmup
        };
        if (this._pendingFirstDockTimer) return;
        const delay = requiresFirstKeyboardWarmup
            ? (this._isHighRefreshDisplay ? 120 : 88)
            : (this._isHighRefreshDisplay ? 50 : 34);
        this._pendingFirstDockTimer = setTimeout(() => {
            const params = this._pendingFirstDockParams;
            this._pendingFirstDockTimer = null;
            this._pendingFirstDockParams = null;
            if (!params || !this.isOpen || !this.chatWindow || this._keyboardDocked) return;
            if (!this._isChatInputFocused()) return;
            this._applyKeyboardDock(params.visualHeight, params.bottomInset, params.animate !== false);
            this._keyboardDocked = true;
            this._lastKeyboardInset = params.bottomInset;
            if (params.bottomInset > 40) {
                this._lastStableKeyboardInset = params.bottomInset;
            }
        }, delay);
    }

    _clearMotionVisualLockTimer() {
        if (this._motionVisualLockTimer) {
            clearTimeout(this._motionVisualLockTimer);
            this._motionVisualLockTimer = null;
        }
    }

    _applyStableVisualStyles() {
        if (!this.chatWindow) return;
        this._toggleElementClass(this.chatWindow, 'chat-window--stable-visuals', true);
    }

    _enableSessionVisualLock() {
        if (!this.chatWindow) return;
        this._setPromptSpotlightSuspended(true);
        if (!(this._isIOSMobile() && this._isNarrowViewport())) {
            this._sessionVisualLocked = false;
            return;
        }
        this._sessionVisualLocked = true;
        this._applyStableVisualStyles();
    }

    _disableSessionVisualLock() {
        this._setPromptSpotlightSuspended(false);
        this._sessionVisualLocked = false;
        this._restoreMotionVisuals();
    }

    _restoreMotionVisuals() {
        this._clearMotionVisualLockTimer();
        if (!this.chatWindow) return;
        if (this._sessionVisualLocked) {
            this._applyStableVisualStyles();
            return;
        }
        this._toggleElementClass(this.chatWindow, 'chat-window--stable-visuals', false);
    }

    _applyMotionVisualLock(duration = 180) {
        if (!this.chatWindow) return;
        if (!this._isIOSMobile() || !this._isNarrowViewport()) return;
        if (this._sessionVisualLocked) {
            this._applyStableVisualStyles();
            return;
        }
        this._clearMotionVisualLockTimer();
        // iOS 移动 backdrop-filter 图层时会偶发重采样闪烁，动画期临时关闭磨砂层。
        this._applyStableVisualStyles();
        this._motionVisualLockTimer = setTimeout(() => {
            this._motionVisualLockTimer = null;
            this._restoreMotionVisuals();
        }, Math.max(130, duration));
    }

    _applyKeyboardPreLift() {
        if (!this.chatWindow || this._keyboardPreLiftActive) return;
        this._keyboardPreLiftActive = true;
        this._clearTransitionCleanupTimer();
        this._applyMotionVisualLock(160);
        this._setChatWindowTransitionless(false);
        this._setChatWindowKeyboardAnimating(true, 120);
        this._setChatTranslateVars('-50%', -24);
        this._transitionCleanupTimer = setTimeout(() => {
            this._transitionCleanupTimer = null;
            if (this.chatWindow && !this.chatWindow.classList.contains('keyboard-docked')) {
                this._setChatWindowKeyboardAnimating(false);
            }
        }, 150);
    }

    _resetKeyboardViewportStyles(animate = false) {
        this._keyboardDocked = false;
        this._lastKeyboardInset = 0;
        this._keyboardPreLiftActive = false;
        if (this.chatWindow) {
            this.chatWindow.classList.remove('keyboard-docked');
            this._clearTransitionCleanupTimer();
            const resetDuration = this._getAdaptiveKeyboardDuration(10, 80, 170);
            if (animate) {
                this._applyMotionVisualLock(resetDuration + 40);
                this._keyboardDockAnimatingUntil = performance.now() + resetDuration + 24;
                this._setChatWindowTransitionless(false);
                this._setChatWindowKeyboardAnimating(true, resetDuration);
            } else {
                this._setChatWindowKeyboardAnimating(false);
                this._setChatWindowTransitionless(true);
                this._restoreMotionVisuals();
            }
            this._setChatWindowDockHeight(null);

            if (this.isOpen && this._isNarrowViewport()) {
                this._setChatWindowDockBottom(null);
                this._setChatTranslateVars('-50%', 0);
            } else {
                this._setChatWindowDockBottom(null);
                this._setRuntimeStyle(this.chatWindow, '--chat-base-translate-y', null);
                this._setRuntimeStyle(this.chatWindow, '--chat-shift-y', null);
                this._setRuntimeStyle(this.chatWindow, 'transform', null);
            }

            if (animate) {
                this._transitionCleanupTimer = setTimeout(() => {
                    this._transitionCleanupTimer = null;
                    if (this.chatWindow && !this.chatWindow.classList.contains('keyboard-docked')) {
                        this._setChatWindowKeyboardAnimating(false);
                    }
                }, resetDuration + 40);
            } else {
                requestAnimationFrame(() => {
                    if (this.chatWindow && !this.chatWindow.classList.contains('keyboard-docked')) {
                        this._setChatWindowTransitionless(false);
                    }
                });
            }
        }

        if (this.overlay) {
            // overlay 由 _freezeOverlay/_restoreOverlay 负责生命周期管理
        }
    }

    async sendMessage() {
        const text = this.input.value.trim();
        if (!text) return;

        // Optimistic UI update
        this.appendMessage(text, this.getMessageRenderType(false), 'text');
        this.input.value = '';

        const autoSupportAssistPromise = this.maybeRunAutoSupportAssist(text).catch((error) => {
            console.warn('[ChatWidget] Auto support assist failed:', error?.message || error);
            return false;
        });

        try {
            const { user, sessionId } = await this.refreshUserSessionContext();
            const userId = user ? user.id : null;

            const { error } = await this.supabase
                .from('chat_messages')
                .insert({
                    content: text,
                    message_type: 'text',
                    user_id: userId,
                    session_id: sessionId,
                    is_admin: false
                });

            if (error) throw error;
        } catch (err) {
            console.error('Error sending message:', err);
            // Could add retry logic or error indicator here
        }

        await autoSupportAssistPromise;
    }

    // Client-side image compression
    async compressImage(file) {
        return new Promise((resolve, reject) => {
            const maxWidth = 1920;
            const quality = 0.7;
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = (maxWidth / width) * height;
                        width = maxWidth;
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            // Create a new File object with .webp extension
                            const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                                type: 'image/webp',
                                lastModified: Date.now(),
                            });
                            resolve(newFile);
                        } else {
                            reject(new Error('Canvas is empty'));
                        }
                    }, 'image/webp', quality);
                };
                img.onerror = (error) => reject(error);
            };
            reader.onerror = (error) => reject(error);
        });
    }

    async handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            // Compress image
            const compressedFile = await this.compressImage(file);

            // Upload to Supabase Storage
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.webp`;
            const filePath = `chat-images/${fileName}`; // Keep filePath structure but use webp

            const { error: uploadError } = await this.supabase.storage
                .from('chat-assets') // Make sure this bucket exists
                .upload(filePath, compressedFile);

            if (uploadError) throw uploadError;

            // Get Public URL
            const { data: { publicUrl } } = this.supabase.storage
                .from('chat-assets')
                .getPublicUrl(filePath);

            // Optimistic UI for Image
            this.appendMessage(publicUrl, this.getMessageRenderType(false), 'image');

            // Save to DB
            const { user, sessionId } = await this.refreshUserSessionContext();
            const userId = user ? user.id : null;

            await this.supabase
                .from('chat_messages')
                .insert({
                    content: publicUrl,
                    message_type: 'image',
                    user_id: userId,
                    session_id: sessionId,
                    is_admin: false
                });

        } catch (err) {
            console.error('Error uploading image:', err);
            alert('图片上传失败，请重试');
        }
    }

    // isNewMessage: true for real-time messages, false for history (skip animation)
    appendMessage(content, type, messageType = 'text', timestamp = null, isNewMessage = false) {
        // Smart time display - only show if 5+ minutes since last shown time
        const currentTime = timestamp ? new Date(timestamp) : new Date();
        let showTime = false;

        if (!this.lastDisplayedTime) {
            // First message - always show time
            showTime = true;
        } else {
            const timeDiff = Math.abs(currentTime.getTime() - this.lastDisplayedTime.getTime());
            if (timeDiff >= this.timeDisplayThreshold) {
                showTime = true;
            }
        }

        // If time needs to be shown, insert a time separator BEFORE the message
        if (showTime) {
            this.lastDisplayedTime = currentTime;
            const timeStr = currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const timeSeparator = document.createElement('div');
            timeSeparator.className = 'message-time-separator';
            timeSeparator.textContent = timeStr;
            this.messagesContainer.appendChild(timeSeparator);
        }

        // Create the message bubble (no time inside)
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${type}${isNewMessage ? ' new-message' : ''}`;

        if (messageType === 'support-assist' && content && typeof content === 'object') {
            msgDiv.classList.add('message--support-assist');

            const textEl = document.createElement('span');
            textEl.className = 'message-text';
            textEl.textContent = String(content.text || '').trim();
            msgDiv.appendChild(textEl);

            const actions = Array.isArray(content.actions) ? content.actions : [];
            if (actions.length) {
                const actionsEl = document.createElement('div');
                actionsEl.className = 'chat-support-assist-actions';

                actions.forEach((action) => {
                    if (!action || typeof action !== 'object') return;

                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = `chat-support-assist-btn${action.primary ? ' chat-support-assist-btn--primary' : ''}${action.kind === 'root' ? ' chat-support-assist-btn--secondary' : ''}`;
                    button.textContent = String(action.label || '').trim();

                    if (action.kind === 'root') {
                        button.setAttribute('data-support-chat-root', '1');
                    } else {
                        button.setAttribute('data-support-chat-action-id', String(action.actionId || '').trim());
                        button._supportAssistState = {
                            detected: content.detected || null,
                            explanation: content.explanation || null,
                            fallbackError: content.fallbackError || ''
                        };
                    }

                    actionsEl.appendChild(button);
                });

                if (actionsEl.childNodes.length) {
                    msgDiv.appendChild(actionsEl);
                }
            }
        } else if (messageType === 'image') {
            const safeUrl = this.sanitizeMediaUrl(content);
            if (safeUrl) {
                const img = document.createElement('img');
                img.src = safeUrl;
                img.className = 'message-image';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.referrerPolicy = 'no-referrer';
                img.addEventListener('click', () => window.open(safeUrl, '_blank', 'noopener'));
                msgDiv.appendChild(img);
            } else {
                const fallback = document.createElement('span');
                fallback.className = 'message-text';
                fallback.textContent = this.t('chat.imageUnavailable', '[图片地址无效]');
                msgDiv.appendChild(fallback);
            }
        } else {
            msgDiv.innerHTML = `<span class="message-text">${this.escapeHtml(content)}</span>`;
        }

        this.messagesContainer.appendChild(msgDiv);

        // Only scroll for new messages (not history batch loads)
        if (isNewMessage) {
            this.scrollToBottom();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    subscribeToMessages() {
        if (this.userMessageChannel) {
            this.supabase.removeChannel(this.userMessageChannel);
        }

        this.userMessageChannel = this.supabase
            .channel('chat-room')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages'
                },
                (payload) => {
                    const activeSessionIds = this.getActiveUserSessionIds();
                    if (!activeSessionIds.includes(payload.new.session_id)) {
                        return;
                    }

                    // Only append if it's NOT from us (avoid duplicate since we did optimistic UI)
                    // Or check if is_admin is true
                    if (payload.new.is_admin) {
                        // Real-time message - animate with isNewMessage=true
                        this.appendMessage(
                            payload.new.content,
                            this.getMessageRenderType(payload.new.is_admin),
                            payload.new.message_type,
                            payload.new.created_at,
                            true
                        );

                        // Show cute notification if chat is closed
                        const messageContent = payload.new.message_type === 'image' ? '📷 发送了一张图片' : payload.new.content;
                        this.showNotification(messageContent, '💬 客服');
                    }
                }
            )
            .subscribe();
    }

    async loadHistory() {
        // PRELOAD STRATEGY: Lock scroll during history loading
        this.lockScroll();

        try {
            const sessionIds = this.getActiveUserSessionIds();
            if (!sessionIds.length) return;

            let query = this.supabase
                .from('chat_messages')
                .select('*')
                .order('created_at', { ascending: true });

            query = sessionIds.length === 1
                ? query.eq('session_id', sessionIds[0])
                : query.in('session_id', sessionIds);

            const { data, error } = await query;

            if (data) {
                // Batch render all history messages before enabling scroll
                data.forEach(msg => {
                    this.appendMessage(
                        msg.content,
                        this.getMessageRenderType(msg.is_admin),
                        msg.message_type,
                        msg.created_at
                    );
                });

                // Scroll to bottom after all messages loaded
                this.scrollToBottom();
            }

            // PRELOAD COMPLETE: Unlock scroll
            this.unlockScroll();

        } catch (err) {
            console.error('Error loading history:', err);
            // Unlock scroll even on error
            this.unlockScroll();
        }
    }
}

// Auto-init specific styling for mobile viewport handling (optional)
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        // Adjust chat window height if keyboard opens on mobile
    });
}
