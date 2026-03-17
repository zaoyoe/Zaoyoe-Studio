(function () {
    'use strict';

    function buildProfileModalHTML() {
        return `
    <div class="modal-overlay" id="profileModal" onmousedown="closeModal(event)" onmouseup="closeModal(event)">
        <div class="modal-content profile-modal" onclick="event.stopPropagation()">
            <div class="profile-mobile-topbar">
                <div class="profile-mobile-topbar-shell">
                    <div class="profile-mobile-tabs">
                        <div class="tab-item active" data-profile-tab="profile" onclick="switchProfileTab('profile')"
                            data-i18n="profile.profileTab">资料</div>
                        <div class="tab-item" data-profile-tab="security" onclick="switchProfileTab('security')"
                            data-i18n="profile.securityTab">安全</div>
                        <span class="profile-mobile-tab-indicator" aria-hidden="true"></span>
                    </div>
                </div>
            </div>
            <div class="profile-modal-scroll">
                <div class="profile-flip-container">
                    <div class="profile-flip-inner">
                        <div id="view-profile" class="profile-view profile-front">
                            <input type="file" id="avatarUpload" accept="image/*" style="display: none;"
                                onchange="handleAvatarUpload(event)">

                            <div class="profile-mobile-sheet">
                                <section class="profile-mobile-hero-card">
                                    <button type="button" class="profile-mobile-hero-avatar" onclick="triggerAvatarUpload()"
                                        aria-label="更换头像" data-i18n-title="profile.changeAvatar">
                                        <img id="profileModalAvatarMobile" src="" alt="Avatar">
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
                                                onclick="openProfileEditor(event)" data-i18n="profile.editShort">编辑</button>
                                        </div>
                                    </div>
                                    <div id="profileMobileInlineEditor" class="profile-mobile-inline-editor">
                                        <input type="text" id="profileMobileNicknameInput" class="profile-mobile-inline-input"
                                            placeholder="输入新昵称" data-i18n-placeholder="profile.enterNewNickname">
                                        <div class="profile-mobile-inline-actions">
                                            <button type="button" class="profile-mobile-editor-btn profile-mobile-editor-btn--ghost"
                                                onclick="toggleNicknameEdit(false)" data-i18n="common.cancel">取消</button>
                                            <button type="button" class="profile-mobile-editor-btn profile-mobile-editor-btn--primary"
                                                onclick="saveNickname()" data-i18n="common.save">保存</button>
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
                                        <button type="button" class="profile-mobile-quick-card"
                                            onclick="openProfileWalletView('balance', event)">
                                            <span class="profile-mobile-quick-arrow"><i class="fas fa-chevron-right"></i></span>
                                            <span class="profile-mobile-quick-icon"><i class="fas fa-wallet"></i></span>
                                            <span class="profile-mobile-quick-title" data-i18n="profile.pointsWallet">积分钱包</span>
                                            <span class="profile-mobile-quick-desc" data-i18n="profile.pointsWalletDesc">余额、充值与兑换</span>
                                        </button>
                                        <button type="button" class="profile-mobile-quick-card"
                                            onclick="openProfileWalletView('orders', event)">
                                            <span class="profile-mobile-quick-arrow"><i class="fas fa-chevron-right"></i></span>
                                            <span class="profile-mobile-quick-icon"><i class="fas fa-receipt"></i></span>
                                            <span class="profile-mobile-quick-title" data-i18n="wallet.transactionRecords">交易记录</span>
                                            <span class="profile-mobile-quick-desc" data-i18n="profile.transactionRecordsDesc">订单与提示词解锁</span>
                                        </button>
                                        <button type="button" class="profile-mobile-quick-card"
                                            onclick="openProfileWalletView('affiliate', event)">
                                            <span class="profile-mobile-quick-arrow"><i class="fas fa-chevron-right"></i></span>
                                            <span class="profile-mobile-quick-icon"><i class="fas fa-bullhorn"></i></span>
                                            <span class="profile-mobile-quick-title" data-i18n="profile.affiliateCenter">推广中心</span>
                                            <span class="profile-mobile-quick-desc" data-i18n="profile.affiliateCenterDesc">邀请人数与佣金</span>
                                        </button>
                                        <button type="button" class="profile-mobile-quick-card"
                                            onclick="openProfileWalletView('checkin', event)">
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
                                    <button type="button" class="profile-security-desktop-item active"
                                        data-security-panel="change-password"
                                        onclick="switchProfileSecurityPanel('change-password', event)">
                                        <span class="profile-security-desktop-item-icon"><i class="fas fa-key"></i></span>
                                        <span class="profile-security-desktop-item-title"
                                            data-i18n="security.changePassword">修改密码</span>
                                    </button>
                                    <button type="button" class="profile-security-desktop-item"
                                        data-security-panel="bind-phone"
                                        onclick="switchProfileSecurityPanel('bind-phone', event)">
                                        <span class="profile-security-desktop-item-icon"><i
                                                class="fas fa-mobile-alt"></i></span>
                                        <span class="profile-security-desktop-item-title"
                                            data-i18n="security.bindPhone">绑定手机号</span>
                                    </button>
                                    <button type="button"
                                        class="profile-security-desktop-item profile-security-desktop-item--danger"
                                        data-security-panel="delete-account"
                                        onclick="switchProfileSecurityPanel('delete-account', event)">
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
                                            <input type="password" id="desktop_oldPassword"
                                                class="security-input glass-input" placeholder="当前密码"
                                                autocomplete="new-password"
                                                data-i18n-placeholder="security.currentPassword">
                                        </div>
                                        <div class="input-group">
                                            <input type="password" id="desktop_newPassword"
                                                class="security-input glass-input" placeholder="新密码 (至少6位)"
                                                autocomplete="new-password"
                                                data-i18n-placeholder="security.newPassword">
                                        </div>
                                        <button class="profile-security-desktop-primary-btn" onclick="changePassword()"
                                            data-i18n="security.updatePassword">更新密码</button>
                                    </div>

                                    <div class="profile-security-desktop-panel" data-security-panel="bind-phone">
                                        <h3 class="profile-security-desktop-title" data-i18n="security.bindPhone">绑定手机号
                                        </h3>
                                        <p class="profile-security-desktop-desc" data-i18n="security.bindPhoneDesc">
                                            绑定手机号可以增强账户安全性</p>
                                        <div class="input-group">
                                            <input type="text" id="desktop_phoneNumberInput"
                                                class="security-input glass-input" placeholder="输入手机号" maxlength="11"
                                                data-i18n-placeholder="security.enterPhone">
                                        </div>
                                        <div class="input-group profile-security-desktop-code-row">
                                            <input type="text" id="desktop_phoneCodeInput"
                                                class="security-input glass-input" placeholder="输入6位验证码"
                                                data-i18n-placeholder="security.enterVerifyCode">
                                            <button class="profile-security-desktop-code-btn"
                                                id="desktop_sendPhoneCodeBtn" onclick="sendPhoneVerificationCode()"
                                                data-i18n="security.getVerifyCode">获取验证码</button>
                                        </div>
                                        <button class="profile-security-desktop-primary-btn" onclick="bindPhone()"
                                            data-i18n="security.bindPhone">绑定手机号</button>
                                    </div>

                                    <div class="profile-security-desktop-panel"
                                        data-security-panel="delete-account">
                                        <h3 class="profile-security-desktop-title profile-security-desktop-title--danger"
                                            data-i18n="security.deleteAccount">注销账号</h3>
                                        <p class="profile-security-desktop-desc profile-security-desktop-desc--danger"
                                            data-i18n="security.deleteWarning">⚠️ 此操作不可恢复，您的所有数据将被永久删除。</p>
                                        <button class="profile-security-desktop-danger-btn"
                                            onclick="deleteAccount()">
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
                                        <input type="password" id="mobile_oldPassword" class="security-input glass-input"
                                            placeholder="当前密码" autocomplete="new-password"
                                            data-i18n-placeholder="security.currentPassword">
                                    </div>
                                    <div class="input-group">
                                        <input type="password" id="mobile_newPassword" class="security-input glass-input"
                                            placeholder="新密码 (至少6位)" autocomplete="new-password"
                                            data-i18n-placeholder="security.newPassword">
                                    </div>
                                    <button class="security-mobile-primary-btn" onclick="changePassword()"
                                        data-i18n="security.updatePassword">更新密码</button>
                                </div>

                                <div class="mobile-security-section">
                                    <h3 class="mobile-section-title" data-i18n="security.bindPhone">绑定手机号</h3>
                                    <p class="mobile-section-desc" data-i18n="security.bindPhoneDesc">绑定手机号可以增强账户安全性</p>
                                    <div class="input-group">
                                        <input type="text" id="mobile_phoneNumberInput" class="security-input glass-input"
                                            placeholder="输入手机号" maxlength="11"
                                            data-i18n-placeholder="security.enterPhone">
                                    </div>
                                    <div class="input-group" style="display: flex; gap: 10px;">
                                        <input type="text" id="mobile_phoneCodeInput" class="security-input glass-input"
                                            placeholder="输入6位验证码" style="flex: 1;"
                                            data-i18n-placeholder="security.enterVerifyCode">
                                        <button class="security-mobile-code-btn" id="mobile_sendPhoneCodeBtn"
                                            onclick="sendPhoneVerificationCode()"
                                            data-i18n="security.getVerifyCode">获取验证码</button>
                                    </div>
                                    <button class="security-mobile-primary-btn" onclick="bindPhone()"
                                        data-i18n="security.bindPhone">绑定手机号</button>
                                </div>

                                <div class="mobile-security-section">
                                    <h3 class="mobile-section-title danger" data-i18n="security.deleteAccount">注销账号</h3>
                                    <p class="mobile-section-desc" data-i18n="security.deleteWarning">⚠️
                                        此操作不可恢复，您的所有数据将被永久删除。
                                    </p>
                                    <button class="security-mobile-danger-btn" onclick="deleteAccount()">
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
    </div>`;
    }

    function ensureProfileModal() {
        if (document.getElementById('profileModal')) return;
        document.body.insertAdjacentHTML('beforeend', buildProfileModalHTML());
        window.i18n?.applyTranslations?.();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureProfileModal, { once: true });
    } else {
        ensureProfileModal();
    }
})();
