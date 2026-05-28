(function initAdminEntry(globalScope) {
    const POST_LOGIN_REDIRECT_STORAGE_KEY = 'zaoyoe_post_login_redirect_v1';
    const POST_LOGIN_REDIRECT_TTL_MS = 15 * 60 * 1000;

    function setEntryState(state, options = {}) {
        const body = globalScope.document?.body;
        if (body) {
            body.dataset.state = state;
        }

        const titleEl = globalScope.document?.getElementById('entryTitle');
        const messageEl = globalScope.document?.getElementById('entryMessage');
        const iconEl = globalScope.document?.getElementById('entryIcon');
        const primaryAction = globalScope.document?.getElementById('entryPrimaryAction');
        const secondaryAction = globalScope.document?.getElementById('entrySecondaryAction');

        if (titleEl) {
            titleEl.textContent = options.title || (state === 'pending' ? '正在校验后台访问权限' : '无法继续进入后台');
        }

        if (messageEl) {
            messageEl.textContent = options.message || '';
        }

        if (iconEl) {
            iconEl.innerHTML = state === 'pending'
                ? '<i class="fas fa-shield-alt"></i>'
                : '<i class="fas fa-lock"></i>';
        }

        if (primaryAction) {
            primaryAction.textContent = options.primaryLabel || '返回首页';
            primaryAction.href = options.primaryHref || 'index.html';
        }

        if (secondaryAction) {
            secondaryAction.textContent = options.secondaryLabel || '重新登录';
            secondaryAction.href = options.secondaryHref || 'index.html';
        }
    }

    function getSafeTarget() {
        const url = new URL(globalScope.location.href);
        const requested = url.searchParams.get('next') || 'admin-studio.html';
        return globalScope.AdminAccess?.sanitizeAdminStudioTarget?.(requested) || 'admin-studio.html';
    }

    function normalizePostLoginRedirectTarget(rawTarget = '') {
        const raw = String(rawTarget || '').trim();
        if (!raw) {
            return '';
        }

        try {
            const baseUrl = new URL(globalScope.location?.href || 'https://www.fatherkey.com/');
            const targetUrl = new URL(raw, baseUrl);
            if (targetUrl.origin !== baseUrl.origin || /\/auth-callback\.html$/i.test(targetUrl.pathname)) {
                return '';
            }

            return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
        } catch (_) {
            return '';
        }
    }

    function buildPostLoginRedirectTarget(target = 'admin-studio.html') {
        const safeTarget = globalScope.AdminAccess?.sanitizeAdminStudioTarget?.(target) || 'admin-studio.html';
        const entryUrl = new URL('admin-entry.html', globalScope.location?.href || 'https://www.fatherkey.com/');
        entryUrl.searchParams.set('next', safeTarget);
        return normalizePostLoginRedirectTarget(`${entryUrl.pathname}${entryUrl.search}${entryUrl.hash}`);
    }

    function persistPendingPostLoginRedirectTarget(target = '') {
        const safeTarget = normalizePostLoginRedirectTarget(target);
        if (!safeTarget || !globalScope.localStorage?.setItem) {
            return null;
        }

        try {
            globalScope.localStorage.setItem(POST_LOGIN_REDIRECT_STORAGE_KEY, JSON.stringify({
                target: safeTarget,
                savedAt: Date.now(),
                ttlMs: POST_LOGIN_REDIRECT_TTL_MS
            }));
            return safeTarget;
        } catch (error) {
            console.warn('[AdminEntry] Failed to persist post-login redirect target:', error);
            return null;
        }
    }

    async function bootAdminEntry() {
        const safeTarget = getSafeTarget();

        setEntryState('pending', {
            title: '正在校验后台访问权限',
            message: '请稍候，我们正在确认当前账号是否拥有 Admin Studio 访问权限。'
        });

        try {
            if (!globalScope.AdminAccess?.getCurrentAdminAccess || !globalScope.AdminAccess?.createAdminStudioSession) {
                setEntryState('error', {
                    title: '后台入口初始化失败',
                    message: '当前页面缺少后台访问校验模块，请返回首页刷新后重试。'
                });
                return;
            }

            const access = await globalScope.AdminAccess.getCurrentAdminAccess();
            if (!access?.user) {
                persistPendingPostLoginRedirectTarget(buildPostLoginRedirectTarget(safeTarget));
                setEntryState('denied', {
                    title: '请先登录管理员账号',
                    message: '当前浏览器里没有有效登录态。请先返回首页登录，登录完成后会自动返回后台入口继续验证。'
                });
                return;
            }

            if (!access.isAdmin) {
                setEntryState('denied', {
                    title: '当前账号没有后台权限',
                    message: '你已经登录，但当前账号并未被授予 Admin Studio 权限，因此无法继续进入后台。'
                });
                return;
            }

            const session = await globalScope.AdminAccess.createAdminStudioSession({
                userId: access.user.id
            });
            if (!session?.ok) {
                setEntryState('error', {
                    title: '后台凭证签发失败',
                    message: '管理员身份已确认，但短时访问凭证下发失败。请稍后刷新重试，或重新回到首页进入后台。'
                });
                return;
            }

            if (typeof globalScope.location?.replace === 'function') {
                globalScope.location.replace(safeTarget);
                return;
            }

            globalScope.location.href = safeTarget;
        } catch (error) {
            console.error('[AdminEntry] Failed to continue into Admin Studio:', error);
            setEntryState('error', {
                title: '后台入口暂时不可用',
                message: '验证管理员权限时发生异常。请稍后刷新重试，或重新回到首页再进入后台。'
            });
        }
    }

    if (globalScope.document?.readyState === 'loading') {
        globalScope.document.addEventListener('DOMContentLoaded', () => {
            void bootAdminEntry();
        }, { once: true });
        return;
    }

    void bootAdminEntry();
})(typeof window !== 'undefined' ? window : globalThis);
