(function (global) {
    'use strict';

    const VERSION = '20260423_FRAMER_NAV_RUNTIME_DROPDOWN_CURSOR_RUNTIME_4';
    const MOBILE_MENU_LOCK_CLASS = 'mobile-menu-open';
    const runtimeState = {
        cachedData: {
            prompts: [],
            shopCategories: []
        }
    };

    global.toggleMobileThemeColor = function (isActive) {
        let metaTheme = document.querySelector('meta[name="theme-color"]');
        if (isActive) {
            if (!metaTheme) {
                metaTheme = document.createElement('meta');
                metaTheme.name = 'theme-color';
                metaTheme.setAttribute('data-injected-by-menu', 'true');
                document.head.appendChild(metaTheme);
            } else if (!metaTheme.hasAttribute('data-original-content')) {
                metaTheme.setAttribute('data-original-content', metaTheme.content);
            }
            metaTheme.content = '#000000';
            return;
        }

        if (!metaTheme) {
            return;
        }

        if (metaTheme.hasAttribute('data-injected-by-menu')) {
            metaTheme.remove();
        } else if (metaTheme.hasAttribute('data-original-content')) {
            metaTheme.content = metaTheme.getAttribute('data-original-content');
            metaTheme.removeAttribute('data-original-content');
        }
    };

    function resetMobileSubmenus(mobileMenu) {
        if (!mobileMenu) return;

        mobileMenu.querySelectorAll('.mobile-submenu.active').forEach((submenu) => {
            submenu.classList.remove('active');
        });
        mobileMenu.querySelectorAll('.mobile-menu-trigger.active').forEach((trigger) => {
            trigger.classList.remove('active');
        });
    }

    function setMobileMenuState(hamburger, mobileMenu, isOpen) {
        if (!mobileMenu) return false;

        hamburger?.classList.toggle('active', isOpen);
        mobileMenu.classList.toggle('active', isOpen);
        document.documentElement.classList.toggle(MOBILE_MENU_LOCK_CLASS, isOpen);
        document.body.classList.toggle(MOBILE_MENU_LOCK_CLASS, isOpen);

        if (!isOpen) {
            resetMobileSubmenus(mobileMenu);
        }

        if (typeof global.toggleMobileThemeColor === 'function') {
            global.toggleMobileThemeColor(isOpen);
        }

        return isOpen;
    }

    function toggleMobileMenu(hamburger, mobileMenu) {
        return setMobileMenuState(hamburger, mobileMenu, !mobileMenu.classList.contains('active'));
    }

    function findMobileMenuScrollableParent(target, mobileMenu) {
        let node = target instanceof Element ? target : target?.parentElement || null;

        while (node && node !== mobileMenu) {
            const style = global.getComputedStyle(node);
            const overflowY = style.overflowY;

            if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
                return node;
            }

            node = node.parentElement;
        }

        if (mobileMenu && mobileMenu.scrollHeight > mobileMenu.clientHeight + 1) {
            return mobileMenu;
        }

        return null;
    }

    function bindMobileMenuScrollGuard(mobileMenu) {
        if (!mobileMenu || mobileMenu._scrollGuardInitialized) return;

        let touchStartY = 0;

        mobileMenu.addEventListener('touchstart', (event) => {
            if (!mobileMenu.classList.contains('active') || event.touches.length === 0) return;
            touchStartY = event.touches[0].clientY;
        }, { passive: true });

        mobileMenu.addEventListener('touchmove', (event) => {
            if (!mobileMenu.classList.contains('active') || event.touches.length === 0) return;

            const scrollable = findMobileMenuScrollableParent(event.target, mobileMenu);
            if (!scrollable) {
                event.preventDefault();
                return;
            }

            const currentY = event.touches[0].clientY;
            const deltaY = touchStartY - currentY;
            const atTop = scrollable.scrollTop <= 0;
            const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;

            if ((atTop && deltaY < 0) || (atBottom && deltaY > 0)) {
                event.preventDefault();
            }
        }, { passive: false });

        mobileMenu._scrollGuardInitialized = true;
    }

    global.closeActiveMobileMenu = function () {
        return setMobileMenuState(
            document.querySelector('.nav-hamburger'),
            document.querySelector('.mobile-menu'),
            false
        );
    };

    async function loadNavData() {
        if (global.PROMPTS && Array.isArray(global.PROMPTS)) {
            runtimeState.cachedData.prompts = global.PROMPTS;
        }

        if (!global.supabaseClient) {
            runtimeState.cachedData.shopCategories = [];
            return runtimeState.cachedData;
        }

        try {
            const { data, error } = await global.supabaseClient
                .from('shop_categories')
                .select('name')
                .order('sort_order');

            runtimeState.cachedData.shopCategories = !error && Array.isArray(data)
                ? data.map((category) => category.name)
                : [];
        } catch (error) {
            console.warn('[FramerNavRuntime] Failed to load shop categories for nav:', error?.message || error);
            runtimeState.cachedData.shopCategories = [];
        }

        return runtimeState.cachedData;
    }

    function initNavDropdowns() {
        const forceInteractiveCursor = () => {
            document.documentElement.style.setProperty('cursor', 'pointer', 'important');
            document.body.style.setProperty('cursor', 'pointer', 'important');
        };

        const clearInteractiveCursor = () => {
            document.documentElement.style.removeProperty('cursor');
            document.body.style.removeProperty('cursor');
        };

        const forceDropdownCursor = (dropdown) => {
            dropdown.style.setProperty('cursor', 'pointer', 'important');
            dropdown.querySelectorAll('*').forEach((node) => {
                node.style.setProperty('cursor', 'pointer', 'important');
            });
        };

        const currentLang = global.i18n?.getCurrentLanguage?.() || 'zh';
        const getTopTags = () => {
            const tagCounts = {};
            (runtimeState.cachedData.prompts || []).forEach((prompt) => {
                if (prompt.aiTags && typeof prompt.aiTags === 'object') {
                    ['styles', 'objects', 'scenes', 'mood'].forEach((category) => {
                        const tags = prompt.aiTags[category]?.[currentLang] || prompt.aiTags[category]?.zh || [];
                        tags.forEach((tag) => {
                            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                        });
                    });
                } else if (Array.isArray(prompt.ai_tags)) {
                    prompt.ai_tags.forEach((tag) => {
                        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                    });
                }
            });

            const topTags = Object.entries(tagCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([tag]) => tag);

            return topTags.length > 0
                ? topTags
                : (currentLang === 'en'
                    ? ['Cartoon', '3D Art', 'Rendering', 'Cute', 'Digital Art', 'Miniature']
                    : ['卡通风格', '3D艺术', '渲染', '可爱', '数字艺术', '微缩']);
        };

        const getShopCategories = () => {
            const categories = runtimeState.cachedData.shopCategories || [];
            return categories.length > 0 ? categories : ['全部商品', 'API密钥', '会员服务', '资源包'];
        };

        const dropdownData = {
            prompts: {
                items: getTopTags(),
                urlPrefix: '/prompts.html?tag='
            },
            shop: {
                items: getShopCategories(),
                urlPrefix: '/shop.html?category='
            },
            settings: {
                type: 'custom',
                render: () => `
                    <div class="settings-dropdown-content">
                        <button id="langToggleDropdown" class="lang-toggle-simple">
                            <span id="langZhDropdown" class="lang-text ${currentLang === 'zh' ? 'active' : ''}">中</span>
                            <span class="lang-separator">|</span>
                            <span id="langEnDropdown" class="lang-text ${currentLang === 'en' ? 'active' : ''}">EN</span>
                        </button>
                    </div>
                `
            },
            support: {
                type: 'custom',
                render: () => `
                    <a href="https://status.zaoyoe.com"><span data-i18n="nav.status">状态页</span></a>
                    <a href="https://t.me/zaoyoe" target="_blank">TG</a>
                    <a href="https://t.me/+I86eX5sPF1c0OTc1" target="_blank"><span data-i18n="nav.tgGroup">TG群组</span></a>
                `
            }
        };

        document.querySelectorAll('.nav-dropdown-portal').forEach((el) => el.remove());

        document.querySelectorAll('.nav-trigger[data-dropdown]').forEach((trigger) => {
            if (trigger._runtimeDropdownHandlers) {
                trigger.removeEventListener('mouseenter', trigger._runtimeDropdownHandlers.mouseenter);
                trigger.removeEventListener('mouseleave', trigger._runtimeDropdownHandlers.mouseleave);
            }

            const dropdownType = trigger.dataset.dropdown;
            const data = dropdownData[dropdownType];
            if (!data) return;

            const dropdown = document.createElement('div');
            dropdown.className = 'nav-dropdown-portal';
            dropdown.id = `dropdown-${dropdownType}`;
            dropdown.innerHTML = data.type === 'custom' && data.render
                ? data.render()
                : data.items.map((item) => `<a href="${data.urlPrefix}${encodeURIComponent(item)}">${item}</a>`).join('');
            forceDropdownCursor(dropdown);

            document.body.appendChild(dropdown);

            if (dropdownType === 'settings' && !dropdown.dataset.langDelegated) {
                dropdown.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const button = event.target.closest('#langToggleDropdown');
                    if (button && global.i18n) {
                        global.i18n.toggleLanguage();
                    }
                });
                dropdown.dataset.langDelegated = '1';
            }

            const showDropdown = () => {
                global.clearTimeout(trigger._hideTimeout);

                if (dropdownType === 'settings' && data.type === 'custom' && data.render) {
                    dropdown.innerHTML = data.render();
                    forceDropdownCursor(dropdown);
                }

                const nav = document.querySelector('.framer-nav');
                if (!nav) return;

                const navRect = nav.getBoundingClientRect();
                const triggerRect = trigger.getBoundingClientRect();
                const navOverlap = parseFloat(
                    global.getComputedStyle(document.documentElement).getPropertyValue('--nav-dropdown-overlap')
                ) || 1;

                dropdown.style.left = `${triggerRect.left + triggerRect.width / 2}px`;
                dropdown.style.top = `${navRect.bottom - navOverlap}px`;
                dropdown.classList.add('visible');
                trigger.classList.add('active');
                forceInteractiveCursor();
            };

            let isHoveringTrigger = false;
            let isHoveringDropdown = false;

            const hideDropdown = () => {
                trigger._hideTimeout = global.setTimeout(() => {
                    if (isHoveringTrigger || isHoveringDropdown) return;
                    if (trigger.matches(':hover') || dropdown.matches(':hover')) return;

                    dropdown.classList.remove('visible');
                    trigger.classList.remove('active');
                    clearInteractiveCursor();
                }, 200);
            };

            const keepDropdownOpen = () => {
                global.clearTimeout(trigger._hideTimeout);
                dropdown.classList.add('visible');
                trigger.classList.add('active');
            };

            const handleMouseEnter = () => {
                isHoveringTrigger = true;
                showDropdown();
            };

            const handleMouseLeave = (event) => {
                isHoveringTrigger = false;

                if (event.movementY > 0) {
                    global.clearTimeout(trigger._hideTimeout);
                    trigger._hideTimeout = global.setTimeout(() => {
                        if (!isHoveringTrigger && !isHoveringDropdown) {
                            dropdown.classList.remove('visible');
                            trigger.classList.remove('active');
                            clearInteractiveCursor();
                        }
                    }, 400);
                    return;
                }

                hideDropdown();
            };

            trigger.addEventListener('mouseenter', handleMouseEnter);
            trigger.addEventListener('mouseleave', handleMouseLeave);
            trigger._runtimeDropdownHandlers = {
                mouseenter: handleMouseEnter,
                mouseleave: handleMouseLeave
            };

            dropdown.addEventListener('mouseenter', () => {
                isHoveringDropdown = true;
                keepDropdownOpen();
                forceInteractiveCursor();
            });

            dropdown.addEventListener('mouseleave', () => {
                isHoveringDropdown = false;
                hideDropdown();
            });
        });
    }

    function initStandaloneNavBar() {
        const nav = document.querySelector('.framer-nav');
        if (!nav) return;

        const hamburger = document.querySelector('.nav-hamburger');
        const mobileMenu = document.querySelector('.mobile-menu');
        const closeMobileMenu = () => setMobileMenuState(hamburger, mobileMenu, false);

        if (mobileMenu) {
            bindMobileMenuScrollGuard(mobileMenu);
        }

        if (hamburger && !hamburger._navInitialized) {
            hamburger.addEventListener('click', () => {
                toggleMobileMenu(hamburger, mobileMenu);
            });
            hamburger._navInitialized = true;
        }

        if (!nav.dataset.scrollBound) {
            global.addEventListener('scroll', () => {
                nav.classList.toggle('scrolled', global.scrollY > 50);
            }, { passive: true });
            nav.dataset.scrollBound = '1';
        }

        if (mobileMenu && !mobileMenu._submenuInitialized) {
            mobileMenu.querySelectorAll('a').forEach((link) => {
                link.addEventListener('click', closeMobileMenu);
            });

            mobileMenu.querySelectorAll('.mobile-menu-trigger').forEach((trigger) => {
                trigger.addEventListener('click', () => {
                    const submenuId = trigger.getAttribute('data-submenu');
                    const submenu = document.getElementById(submenuId);
                    if (!submenu) return;
                    trigger.classList.toggle('active');
                    submenu.classList.toggle('active');
                });
            });

            mobileMenu.addEventListener('click', (event) => {
                if (event.target === mobileMenu) {
                    closeMobileMenu();
                }
            });

            mobileMenu._submenuInitialized = true;
        }

        const syncDropdownToMobile = (desktopDropdownId, mobileSubmenuId) => {
            const desktopDropdown = document.getElementById(desktopDropdownId);
            const mobileSubmenu = document.getElementById(mobileSubmenuId);
            if (!desktopDropdown || !mobileSubmenu) return;

            const content = desktopDropdown.cloneNode(true);
            content.removeAttribute('id');
            mobileSubmenu.innerHTML = content.innerHTML;
        };

        const syncMobileSubmenus = () => {
            syncDropdownToMobile('dropdown-prompts', 'prompts-mobile');
            syncDropdownToMobile('dropdown-shop', 'shop-mobile');
            syncDropdownToMobile('dropdown-settings', 'settings-mobile');
        };

        loadNavData().then(() => {
            initNavDropdowns();
            global.setTimeout(syncMobileSubmenus, 100);
        }).catch((error) => {
            console.error('[FramerNavRuntime] Failed to load nav data:', error);
        });

        if (!document.documentElement.dataset.framerNavLanguageSync) {
            global.addEventListener('languageChanged', () => {
                initNavDropdowns();
                global.setTimeout(syncMobileSubmenus, 100);
            });
            document.documentElement.dataset.framerNavLanguageSync = '1';
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initStandaloneNavBar, { once: true });
    } else {
        initStandaloneNavBar();
    }

    global.FramerNavRuntime = Object.freeze({
        version: VERSION,
        loadNavData,
        initNavDropdowns,
        initStandaloneNavBar
    });
}(typeof window !== 'undefined' ? window : globalThis));
