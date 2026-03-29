(function initAdminEntry(globalScope) {
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
            titleEl.textContent = options.title || (state === 'pending' ? '正在验证后台访问' : '无法继续进入后台');
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

    async function bootAdminEntry() {
        const safeTarget = getSafeTarget();

        setEntryState('pending', {
            title: '正在验证后台访问',
            message: '请稍候，我们正在检查管理员权限并签发短时访问凭证。'
        });

        try {
            if (!globalScope.AdminAccess?.getCurrentAdminAccess || !globalScope.AdminAccess?.createAdminStudioSession) {
                setEntryState('error', {
                    title: '后台入口初始化失败',
                    message: '当前页面缺少后台访问校验模块，请返回首页刷新后重试。'
                });
                return;
            }

            const access = await globalScope.AdminAccess.getCurrentAdminAccess({ forceRefresh: true });
            if (!access?.user) {
                setEntryState('denied', {
                    title: '请先登录管理员账号',
                    message: '当前浏览器里没有有效登录态。请先返回首页登录，再从管理员入口进入后台。'
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

            const session = await globalScope.AdminAccess.createAdminStudioSession();
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
