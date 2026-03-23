(function () {
    'use strict';

    function initChatWidget() {
        const tryInit = () => {
            if (window.supabaseClient && typeof window.ChatWidget === 'function') {
                new window.ChatWidget();
                return;
            }

            window.setTimeout(tryInit, 500);
        };

        tryInit();
    }

    function bindArchivedIndexHandlers() {
        if (document.body?.dataset.archivedIndexBound === '1') {
            return;
        }

        if (document.body) {
            document.body.dataset.archivedIndexBound = '1';
        }

        document.querySelectorAll('[data-old-stop-overlay="1"]').forEach((element) => {
            ['click', 'mousedown', 'mouseup'].forEach((eventName) => {
                element.addEventListener(eventName, (event) => {
                    event.stopPropagation();
                });
            });
        });

        document.querySelectorAll('[data-old-overlay-close="1"]').forEach((overlay) => {
            ['mousedown', 'mouseup'].forEach((eventName) => {
                overlay.addEventListener(eventName, (event) => {
                    window.closeModal?.(event);
                });
            });
        });

        document.addEventListener('click', (event) => {
            const actionEl = event.target.closest('[data-old-action]');
            if (!actionEl) {
                return;
            }

            switch (actionEl.dataset.oldAction) {
                case 'close-modal':
                    window.closeModal?.(event);
                    break;
                case 'guestbook-upload-image':
                    document.getElementById('imageUpload')?.click();
                    break;
                case 'shop-copy-content':
                    window.ShopClient?.copyContent?.();
                    break;
                case 'shop-close-success':
                    document.getElementById('shopSuccessModal')?.classList.remove('active');
                    break;
                case 'copy-text':
                    event.stopPropagation();
                    window.copyText?.(actionEl.dataset.copyText || '');
                    break;
                case 'close-profile-modal':
                    document.getElementById('profileModal')?.classList.remove('active');
                    break;
                case 'switch-profile-tab':
                    window.switchProfileTab?.(actionEl.dataset.profileTab);
                    break;
                case 'trigger-avatar-upload':
                    window.triggerAvatarUpload?.();
                    break;
                case 'toggle-nickname-edit':
                    window.toggleNicknameEdit?.(actionEl.dataset.editing === 'true');
                    break;
                case 'save-nickname':
                    window.saveNickname?.();
                    break;
                case 'expand-security-card':
                    window.expandSecurityCard?.(event, actionEl.dataset.securityCard);
                    break;
                case 'change-password':
                    window.changePassword?.(actionEl.dataset.mode || undefined);
                    break;
                case 'send-phone-code':
                    window.sendPhoneVerificationCode?.(actionEl.dataset.mode || undefined);
                    break;
                case 'bind-phone':
                    window.bindPhone?.(actionEl.dataset.mode || undefined);
                    break;
                case 'delete-account':
                    window.deleteAccount?.();
                    break;
                default:
                    break;
            }
        });

        document.addEventListener('change', (event) => {
            const actionEl = event.target.closest('[data-old-change]');
            if (!actionEl) {
                return;
            }

            if (actionEl.dataset.oldChange === 'avatar-upload') {
                window.handleAvatarUpload?.(event);
            }
        });
    }

    function initArchivedIndexPage() {
        console.log('🚀 Page loaded');
        initChatWidget();
        bindArchivedIndexHandlers();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initArchivedIndexPage, { once: true });
    } else {
        initArchivedIndexPage();
    }
}());
