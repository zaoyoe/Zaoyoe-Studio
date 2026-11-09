(function () {
    'use strict';

    function buildProfileLbiField({
        id,
        type = 'text',
        labelText = '',
        labelI18n = '',
        autocomplete = 'off',
        inputClass = '',
        inputAttributes = '',
        corner = 20
    }) {
        const isPassword = type === 'password';
        const initialText = (window.i18n && typeof window.i18n.t === 'function' ? window.i18n.t(labelI18n) : null) || labelText;
        const labelSpans = [...initialText].map((char, index) => `<span style="--i: ${index};">${char}</span>`).join('');
        const i18nAttr = labelI18n ? ` data-i18n="${labelI18n}"` : '';
        const attrStr = inputAttributes ? ` ${inputAttributes.trim()}` : '';
        return `
            <div class="lbi" data-field="${initialText}" data-corner="${corner}">
                <div class="lbi-box">
                    <svg class="lbi-ring" viewBox="0 0 380 48" aria-hidden="true">
                        <path class="lbi-left" d=""></path>
                        <path class="lbi-right" d=""></path>
                        <path class="lbi-gap lbi-gap-left" pathLength="1" d=""></path>
                        <path class="lbi-gap lbi-gap-right" pathLength="1" d=""></path>
                    </svg>
                    <label class="lbi-label" for="${id}"${i18nAttr} data-lbi-prepared="${initialText}">${labelSpans}</label>
                    <input type="${type}" id="${id}" class="security-input lbi-field${inputClass ? ` ${inputClass}` : ''}" autocomplete="${autocomplete}"${attrStr}>
                    ${isPassword ? `
                    <button class="lbi-eye" type="button" aria-label="显示密码" data-show="false" tabindex="-1">
                        <svg class="lbi-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                        <svg class="lbi-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M4 10.5c2.4 3.8 5.6 5.5 8 5.5s5.6-1.7 8-5.5" />
                            <path d="M6.5 13.5l-2 2.5" />
                            <path d="M12 16v3" />
                            <path d="M17.5 13.5l2 2.5" />
                        </svg>
                    </button>` : ''}
                </div>
            </div>`;
    }

    function buildProfileModalHTML() {
        return `
    <div class="modal-overlay" id="profileModal" data-modal-dismiss-managed="1">
        <div class="glass-ring glass-ring--shell profile-modal-ring">
        <div class="modal-content profile-modal glass-ring__surface">
            <div class="profile-mobile-topbar">
                <div class="profile-mobile-topbar-shell">
                    <div class="profile-mobile-tabs">
                        <div class="tab-item active" data-profile-tab="profile" data-profile-action="switch-tab"
                            data-i18n="profile.profileTab">资料</div>
                        <div class="tab-item" data-profile-tab="security" data-profile-action="switch-tab"
                            data-i18n="profile.securityTab">安全</div>
                        <span class="profile-mobile-tab-indicator" aria-hidden="true"></span>
                    </div>
                </div>
            </div>
            <div class="profile-modal-scroll">
                <div class="profile-flip-container">
                    <div class="profile-flip-inner">
                        <div id="view-profile" class="profile-view profile-front">
                            <input type="file" id="avatarUpload" accept="image/*" class="profile-modal-file-input"
                                data-profile-change="avatar-upload">

                            <div class="profile-mobile-sheet">
                                <section class="profile-mobile-hero-card">
                                    <button type="button" class="profile-mobile-hero-avatar" data-profile-action="trigger-avatar-upload"
                                        aria-label="更换头像" data-i18n-title="profile.changeAvatar">
                                        <img id="profileModalAvatarMobile" class="auth-display-none" alt="" aria-hidden="true"
                                            decoding="async">
                                        <span id="profileModalAvatarMobileFallback"
                                            class="profile-mobile-hero-avatar-fallback">U</span>
                                        <span class="profile-mobile-hero-avatar-editmark" aria-hidden="true"></span>
                                    </button>
                                    <div class="profile-mobile-hero-main">
                                        <div class="profile-mobile-hero-kicker" data-i18n="profile.accountKicker">账户</div>
                                        <div class="profile-mobile-hero-name" id="profileMobileHeroName">Loading...</div>
                                        <div class="profile-mobile-hero-meta">
                                            <span id="profileMobileHeroEmail">加载中...</span><br>
                                            <span id="profileMobileHeroId">ID -</span>
                                        </div>
                                        <div class="profile-mobile-hero-actions">
                                            <button type="button" class="profile-mobile-hero-edit-btn"
                                                data-profile-action="open-editor" data-i18n="profile.editShort">编辑</button>
                                        </div>
                                    </div>
                                    <div id="profileMobileInlineEditor" class="profile-mobile-inline-editor">
                                        <input type="text" id="profileMobileNicknameInput" class="profile-mobile-inline-input"
                                            placeholder="输入新昵称" data-i18n-placeholder="profile.enterNewNickname">
                                        <div class="profile-mobile-inline-actions">
                                            <button type="button" class="profile-mobile-editor-btn profile-mobile-editor-btn--ghost"
                                                data-profile-action="toggle-nickname-edit" data-profile-toggle-visible="false" data-i18n="common.cancel">取消</button>
                                            <button type="button" class="profile-mobile-editor-btn profile-mobile-editor-btn--primary"
                                                data-profile-action="save-nickname" data-i18n="common.save">保存</button>
                                        </div>
                                    </div>
                                </section>

                                <section class="profile-mobile-card profile-mobile-card--essential">
                                    <div class="profile-mobile-section-head">
                                        <div class="profile-mobile-section-title" data-i18n="profile.essentialInfo">必要资料</div>
                                    </div>
                                    <div class="profile-mobile-info-rows">
                                        <div class="profile-mobile-info-row">
                                            <div class="profile-mobile-info-key" data-i18n="profile.nicknameLabel">昵称</div>
                                            <div class="profile-mobile-info-value" id="profileMobileNicknameValue">Loading...</div>
                                        </div>
                                        <div class="profile-mobile-info-row">
                                            <div class="profile-mobile-info-key" data-i18n="profile.emailLabel">邮箱</div>
                                            <div class="profile-mobile-info-value" id="profileMobileEmailValue">加载中...</div>
                                        </div>
                                        <div class="profile-mobile-info-row">
                                            <div class="profile-mobile-info-key" data-i18n="profile.registeredAt">注册时间</div>
                                            <div class="profile-mobile-info-value" id="profileMobileMemberSinceValue">加载中...</div>
                                        </div>
                                    </div>
                                </section>

                                <section class="profile-mobile-card profile-mobile-card--quick">
                                    <div class="profile-mobile-section-head">
                                        <div class="profile-mobile-section-title" data-i18n="profile.quickAccess">快捷入口</div>
                                    </div>
                                    <div class="profile-mobile-quick-grid">
                                        <button type="button" class="profile-mobile-quick-card" data-profile-action="open-wallet-view"
                                            data-wallet-view="balance">
                                            <span class="profile-mobile-quick-arrow"><i class="fas fa-chevron-right"></i></span>
                                            <span class="profile-mobile-quick-icon"><i class="fas fa-wallet"></i></span>
                                            <span class="profile-mobile-quick-title" data-i18n="profile.pointsWallet">积分钱包</span>
                                            <span class="profile-mobile-quick-desc" data-i18n="profile.pointsWalletDesc">余额、充值与兑换</span>
                                        </button>
                                        <button type="button" class="profile-mobile-quick-card" data-profile-action="open-wallet-view"
                                            data-wallet-view="orders">
                                            <span class="profile-mobile-quick-arrow"><i class="fas fa-chevron-right"></i></span>
                                            <span class="profile-mobile-quick-icon"><i class="fas fa-receipt"></i></span>
                                            <span class="profile-mobile-quick-title" data-i18n="wallet.transactionRecords">交易记录</span>
                                            <span class="profile-mobile-quick-desc" data-i18n="profile.transactionRecordsDesc">订单与提示词解锁</span>
                                        </button>
                                        <button type="button" class="profile-mobile-quick-card" data-profile-action="open-wallet-view"
                                            data-wallet-view="affiliate">
                                            <span class="profile-mobile-quick-arrow"><i class="fas fa-chevron-right"></i></span>
                                            <span class="profile-mobile-quick-icon"><i class="fas fa-bullhorn"></i></span>
                                            <span class="profile-mobile-quick-title" data-i18n="profile.affiliateCenter">推广中心</span>
                                            <span class="profile-mobile-quick-desc" data-i18n="profile.affiliateCenterDesc">邀请人数与佣金</span>
                                        </button>
                                        <button type="button" class="profile-mobile-quick-card" data-profile-action="open-wallet-view"
                                            data-wallet-view="checkin">
                                            <span class="profile-mobile-quick-arrow"><i class="fas fa-chevron-right"></i></span>
                                            <span class="profile-mobile-quick-icon"><i class="fas fa-calendar-check"></i></span>
                                            <span class="profile-mobile-quick-title" data-i18n="wallet.dailyCheckin">每日签到</span>
                                            <span class="profile-mobile-quick-desc" data-i18n="profile.dailyCheckinDesc">连续天数与补签</span>
                                        </button>
                                    </div>
                                </section>
                            </div>
                        </div>

                        <div id="view-security" class="profile-view profile-back">
                            <div class="profile-security-desktop-layout">
                                <aside class="profile-security-desktop-sidebar">
                                    <span class="profile-security-desktop-indicator" aria-hidden="true"></span>
                                    <button type="button" class="profile-security-desktop-item active"
                                        data-security-panel="change-password" data-profile-action="switch-security-panel">
                                        <span class="profile-security-desktop-item-icon"><i class="fas fa-key"></i></span>
                                        <span class="profile-security-desktop-item-title"
                                            data-i18n="security.changePassword">修改密码</span>
                                    </button>
                                    <button type="button" class="profile-security-desktop-item"
                                        data-security-panel="bind-phone" data-profile-action="switch-security-panel">
                                        <span class="profile-security-desktop-item-icon"><i
                                                class="fas fa-mobile-alt"></i></span>
                                        <span class="profile-security-desktop-item-title"
                                            data-i18n="security.bindPhone">绑定手机号</span>
                                    </button>
                                    <button type="button"
                                        class="profile-security-desktop-item profile-security-desktop-item--danger"
                                        data-security-panel="delete-account" data-profile-action="switch-security-panel">
                                        <span class="profile-security-desktop-item-icon"><i
                                                class="fas fa-exclamation-triangle"></i></span>
                                        <span class="profile-security-desktop-item-title"
                                            data-i18n="security.deleteAccount">注销账号</span>
                                    </button>
                                </aside>

                                <section class="profile-security-desktop-content">
                                    <div class="profile-security-desktop-panel is-active"
                                        data-security-panel="change-password">
                                        <h3 class="profile-security-desktop-title"
                                            data-i18n="security.changePassword">修改密码</h3>
                                        <div class="input-group">
                                            ${buildProfileLbiField({
                                                id: 'desktop_oldPassword',
                                                type: 'password',
                                                labelText: '当前密码',
                                                labelI18n: 'security.currentPassword',
                                                autocomplete: 'new-password'
                                            })}
                                        </div>
                                        <div class="input-group">
                                            ${buildProfileLbiField({
                                                id: 'desktop_newPassword',
                                                type: 'password',
                                                labelText: '新密码 (至少6位)',
                                                labelI18n: 'security.newPassword',
                                                autocomplete: 'new-password'
                                            })}
                                        </div>
                                        <button type="button" class="profile-security-desktop-primary-btn" data-profile-action="change-password"
                                            data-i18n="security.updatePassword">更新密码</button>
                                    </div>

                                    <div class="profile-security-desktop-panel" data-security-panel="bind-phone">
                                        <h3 class="profile-security-desktop-title" data-i18n="security.bindPhone">绑定手机号
                                        </h3>
                                        <p class="profile-security-desktop-desc" data-i18n="security.bindPhoneDesc">
                                            绑定手机号可以增强账户安全性</p>
                                        <div class="input-group">
                                            ${buildProfileLbiField({
                                                id: 'desktop_phoneNumberInput',
                                                type: 'text',
                                                labelText: '输入手机号',
                                                labelI18n: 'security.enterPhone',
                                                autocomplete: 'tel',
                                                inputAttributes: 'maxlength="11"'
                                            })}
                                        </div>
                                        <div class="input-group profile-security-desktop-code-row">
                                            ${buildProfileLbiField({
                                                id: 'desktop_phoneCodeInput',
                                                type: 'text',
                                                labelText: '输入6位验证码',
                                                labelI18n: 'security.enterVerifyCode',
                                                autocomplete: 'one-time-code'
                                            })}
                                            <button class="profile-security-desktop-code-btn"
                                                id="desktop_sendPhoneCodeBtn" type="button" data-profile-action="send-phone-code"
                                                data-i18n="security.getVerifyCode">获取验证码</button>
                                        </div>
                                        <button type="button" class="profile-security-desktop-primary-btn" data-profile-action="bind-phone"
                                            data-i18n="security.bindPhone">绑定手机号</button>
                                    </div>

                                    <div class="profile-security-desktop-panel"
                                        data-security-panel="delete-account">
                                        <h3 class="profile-security-desktop-title profile-security-desktop-title--danger"
                                            data-i18n="security.deleteAccount">注销账号</h3>
                                        <p class="profile-security-desktop-desc profile-security-desktop-desc--danger"
                                            data-i18n="security.deleteWarning">⚠️ 此操作不可恢复，您的所有数据将被永久删除。</p>
                                        <button type="button" class="profile-security-desktop-danger-btn" data-profile-action="delete-account">
                                            <i class="fas fa-trash-alt"></i>
                                            <span data-i18n="security.confirmDelete">确认注销</span>
                                        </button>
                                    </div>
                                </section>
                            </div>

                            <div class="mobile-security-layout profile-security-layout">
                                <div class="mobile-security-section">
                                    <h3 class="mobile-section-title" data-i18n="security.changePassword">修改密码</h3>
                                    <div class="input-group">
                                        ${buildProfileLbiField({
                                            id: 'mobile_oldPassword',
                                            type: 'password',
                                            labelText: '当前密码',
                                            labelI18n: 'security.currentPassword',
                                            autocomplete: 'new-password'
                                        })}
                                    </div>
                                    <div class="input-group">
                                        ${buildProfileLbiField({
                                            id: 'mobile_newPassword',
                                            type: 'password',
                                            labelText: '新密码 (至少6位)',
                                            labelI18n: 'security.newPassword',
                                            autocomplete: 'new-password'
                                        })}
                                    </div>
                                    <button type="button" class="security-mobile-primary-btn" data-profile-action="change-password"
                                        data-i18n="security.updatePassword">更新密码</button>
                                </div>

                                <div class="mobile-security-section">
                                    <h3 class="mobile-section-title" data-i18n="security.bindPhone">绑定手机号</h3>
                                    <p class="mobile-section-desc" data-i18n="security.bindPhoneDesc">绑定手机号可以增强账户安全性</p>
                                    <div class="input-group">
                                        ${buildProfileLbiField({
                                            id: 'mobile_phoneNumberInput',
                                            type: 'text',
                                            labelText: '输入手机号',
                                            labelI18n: 'security.enterPhone',
                                            autocomplete: 'tel',
                                            inputAttributes: 'maxlength="11"'
                                        })}
                                    </div>
                                    <div class="input-group profile-mobile-code-row">
                                        ${buildProfileLbiField({
                                            id: 'mobile_phoneCodeInput',
                                            type: 'text',
                                            labelText: '输入6位验证码',
                                            labelI18n: 'security.enterVerifyCode',
                                            autocomplete: 'one-time-code',
                                            inputClass: 'profile-mobile-code-input'
                                        })}
                                        <button class="security-mobile-code-btn" id="mobile_sendPhoneCodeBtn"
                                            type="button" data-profile-action="send-phone-code"
                                            data-i18n="security.getVerifyCode">获取验证码</button>
                                    </div>
                                    <button type="button" class="security-mobile-primary-btn" data-profile-action="bind-phone"
                                        data-i18n="security.bindPhone">绑定手机号</button>
                                </div>

                                <div class="mobile-security-section">
                                    <h3 class="mobile-section-title danger" data-i18n="security.deleteAccount">注销账号</h3>
                                    <p class="mobile-section-desc" data-i18n="security.deleteWarning">⚠️
                                        此操作不可恢复，您的所有数据将被永久删除。
                                    </p>
                                    <button type="button" class="security-mobile-danger-btn" data-profile-action="delete-account">
                                        <i class="fas fa-trash-alt"></i>
                                        <span data-i18n="security.confirmDelete">确认注销</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </div>
    </div>`;
    }

    function ensureProfileModal() {
        if (document.getElementById('profileModal')) return;
        document.body.insertAdjacentHTML('beforeend', buildProfileModalHTML());
        window.i18n?.applyTranslations?.();
        try {
            window.LabelInput?.scan?.();
            document.querySelectorAll('#profileModal .lbi').forEach((root) => {
                window.LabelInput?.update?.(root);
            });
        } catch (_) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureProfileModal, { once: true });
    } else {
        ensureProfileModal();
    }
})();
