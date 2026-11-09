/**
 * Prompt Spotlight (Authentic Dock-Style Pure Liquid Glass Search Capsule)
 * Pure crystal liquid glass identical to .gdock (--pane 0.038, no milky white washes).
 * Zero page background blur, completely clean ambient backdrop.
 * Identical entrance animation to Dock (520ms cubic-bezier(0.22, 1, 0.36, 1) from translateY(104px)).
 * In-place refresh on Enter with loading indicator, dismissed upward smoothly once the first card image renders.
 * Synchronizes with #gallerySearch without hard page scrolling.
 */
(() => {
    let spotlightMounted = false;
    let isOpen = false;
    let isSearching = false;
    let wasNavVisible = false;

    let overlayEl = null;
    let backdropEl = null;
    let capsuleEl = null;
    let inputWrapEl = null;
    let inputEl = null;
    let caretEl = null;
    let measurerEl = null;
    let actionBtnEl = null;
    let clearBtnEl = null;
    let escBtnEl = null;

    function detectContext() {
        const path = (typeof window !== 'undefined' && window.location?.pathname || '').toLowerCase();
        if (path.includes('shop') || (typeof document !== 'undefined' && document.body?.classList.contains('shop-page'))) {
            return 'shop';
        }
        return 'prompts';
    }

    function getContextConfig() {
        const ctx = detectContext();
        if (ctx === 'shop') {
            return {
                context: 'shop',
                dialogLabel: '商品搜索',
                placeholder: '搜索商品...',
                i18nKey: 'shop.searchPlaceholder',
                changeEventName: 'shop-search-change',
                topSearchInputSelector: '#listSearchInput'
            };
        }
        return {
            context: 'prompts',
            dialogLabel: '提示词搜索',
            placeholder: '搜索提示词...',
            i18nKey: 'gallery.searchPlaceholder',
            changeEventName: 'prompt-search-change',
            topSearchInputSelector: '#gallerySearch'
        };
    }

    function buildDOM() {
        if (overlayEl) return;

        const cfg = getContextConfig();
        let existing = document.getElementById('promptSpotlightOverlay');
        if (existing) {
            overlayEl = existing;
            backdropEl = existing.querySelector('.prompt-spotlight-backdrop');
            capsuleEl = existing.querySelector('.prompt-spotlight-capsule');
            inputWrapEl = existing.querySelector('.prompt-spotlight-input-wrap');
            inputEl = existing.querySelector('.prompt-spotlight-input');
            caretEl = existing.querySelector('.prompt-spotlight-caret');
            measurerEl = existing.querySelector('.prompt-spotlight-measurer');
            actionBtnEl = existing.querySelector('.prompt-spotlight-action-btn') || existing.querySelector('.prompt-spotlight-clear');
            clearBtnEl = actionBtnEl;
            escBtnEl = existing.querySelector('.prompt-spotlight-esc');
            if (capsuleEl) capsuleEl.setAttribute('aria-label', cfg.dialogLabel);
            if (inputEl) {
                inputEl.placeholder = cfg.placeholder;
                inputEl.setAttribute('data-i18n-placeholder', cfg.i18nKey);
            }
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'promptSpotlightOverlay';
        overlay.className = 'prompt-spotlight-overlay';
        overlay.setAttribute('aria-hidden', 'true');

        overlay.innerHTML = `
            <div class="prompt-spotlight-backdrop" id="promptSpotlightBackdrop"></div>
            <div class="prompt-spotlight-capsule gdock" id="promptSpotlightCapsule" role="dialog" aria-modal="true" aria-label="${cfg.dialogLabel}" data-fill="dark" data-stroke="on" data-rim="glass">
                <span class="gdock-glass" aria-hidden="true"></span>
                <div class="prompt-spotlight-inner">
                    <span class="prompt-spotlight-search-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                            <circle cx="10.8" cy="10.8" r="6.8"></circle>
                            <path d="m16 16 5 5"></path>
                        </svg>
                        <span class="prompt-spotlight-spinner" aria-hidden="true"></span>
                    </span>
                    <div class="prompt-spotlight-input-wrap has-custom-caret" id="promptSpotlightInputWrap">
                        <input type="text"
                               class="prompt-spotlight-input"
                               id="promptSpotlightInput"
                               placeholder="${cfg.placeholder}"
                               data-i18n-placeholder="${cfg.i18nKey}"
                               autocomplete="off"
                               spellcheck="false"
                               style="outline:none!important;border:none!important;box-shadow:none!important;" />
                        <span class="prompt-spotlight-caret is-active is-blinking" id="promptSpotlightCaret" aria-hidden="true"></span>
                        <span class="prompt-spotlight-measurer" id="promptSpotlightMeasurer" aria-hidden="true"></span>
                    </div>
                    <span class="prompt-spotlight-loading-badge" aria-hidden="true">正在搜索...</span>
                    <button type="button" class="prompt-spotlight-action-btn" id="promptSpotlightActionBtn" aria-label="搜索" title="搜索 (Enter)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                    </button>
                    <button type="button" class="prompt-spotlight-esc" id="promptSpotlightEsc" aria-label="关闭搜索" title="按 ESC 退出">
                        <span>ESC</span>
                    </button>
                </div>
            </div>
        `;

        if (document.body) {
            document.body.appendChild(overlay);
        }

        overlayEl = overlay;
        backdropEl = overlay.querySelector('.prompt-spotlight-backdrop');
        capsuleEl = overlay.querySelector('.prompt-spotlight-capsule');
        inputWrapEl = overlay.querySelector('.prompt-spotlight-input-wrap');
        inputEl = overlay.querySelector('.prompt-spotlight-input');
        caretEl = overlay.querySelector('.prompt-spotlight-caret');
        measurerEl = overlay.querySelector('.prompt-spotlight-measurer');
        actionBtnEl = overlay.querySelector('.prompt-spotlight-action-btn');
        clearBtnEl = actionBtnEl;
        escBtnEl = overlay.querySelector('.prompt-spotlight-esc');

        // Pre-warm optical refraction on initialization
        if (typeof window.syncDockNavPopups === 'function') {
            window.syncDockNavPopups();
        }
    }

    function syncToGallerySearch(val) {
        const gallerySearch = document.getElementById('gallerySearch');
        if (gallerySearch && gallerySearch.value !== val) {
            gallerySearch.value = val;
            gallerySearch.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (typeof window.filterBySearch === 'function') {
            window.filterBySearch(val.toLowerCase());
        }
    }

    function waitForFirstCardImage(callback) {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            callback();
        };

        // Safety fallback timer: max 1200ms
        const timeoutId = setTimeout(finish, 1200);

        const scheduleNextFrame = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (fn) => setTimeout(fn, 16);

        let attempts = 0;
        const check = () => {
            if (settled) return;
            attempts += 1;
            const isShop = detectContext() === 'shop';
            const firstCard = document.querySelector(
                isShop
                    ? '#userShopGrid .shop-card, #listRows .list-row'
                    : '.gallery-container .prompt-card'
            );
            if (!firstCard) {
                const noResults = document.querySelector(
                    isShop
                        ? '.shop-empty-state, .shop-list-empty'
                        : '.no-results-container, .prompt-no-results, .gallery-empty'
                );
                if (noResults || attempts >= 25) {
                    clearTimeout(timeoutId);
                    setTimeout(finish, 120);
                    return;
                }
                scheduleNextFrame(check);
                return;
            }

            const img = firstCard.querySelector('img');
            if (!img) {
                clearTimeout(timeoutId);
                setTimeout(finish, 80);
                return;
            }

            if (img.complete && img.naturalWidth > 0) {
                clearTimeout(timeoutId);
                setTimeout(finish, 100);
                return;
            }

            img.addEventListener('load', () => {
                clearTimeout(timeoutId);
                setTimeout(finish, 80);
            }, { once: true });
            img.addEventListener('error', () => {
                clearTimeout(timeoutId);
                setTimeout(finish, 80);
            }, { once: true });
        };

        scheduleNextFrame(check);
    }

    async function triggerInPlaceSearch() {
        if (isSearching) return;
        isSearching = true;

        const val = (inputEl?.value || '').trim();

        if (capsuleEl) {
            capsuleEl.classList.add('is-searching');
        }

        const isShop = detectContext() === 'shop';

        if (isShop) {
            const listSearchInput = document.getElementById('listSearchInput');
            if (listSearchInput) {
                listSearchInput.value = val;
            }
            if (window.ShopListLayout && typeof window.ShopListLayout.setSearchQuery === 'function') {
                window.ShopListLayout.setSearchQuery(val);
            } else if (listSearchInput) {
                listSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
                const form = document.getElementById('listSearchForm');
                if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
            }
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('shop-search-change', {
                    detail: { active: Boolean(val), query: val }
                }));
            }
        } else {
            // Keep gallerySearch value updated without dispatching spurious event
            const gallerySearch = document.getElementById('gallerySearch');
            if (gallerySearch) {
                gallerySearch.value = val;
            }

            // Execute in-place search and await until cards are prepared in the DOM
            try {
                if (val) {
                    if (typeof window.filterBySearch === 'function') {
                        await window.filterBySearch(val.toLowerCase());
                    }
                } else {
                    if (typeof window.renderGallery === 'function') {
                        window.renderGallery('all', true, { preserveScroll: true });
                    }
                }
            } catch (err) {
                console.error('[PromptSpotlight] Search execution error:', err);
            }
        }

        // Wait until first image of newly loaded cards renders, then smoothly dismiss upward
        waitForFirstCardImage(() => {
            dismissUpward();
        });
    }

    function dismissUpward() {
        if (!isOpen) return;

        if (capsuleEl) {
            capsuleEl.classList.add('is-dismissing-up');
        }
        if (overlayEl) {
            overlayEl.classList.add('is-dismissing-up');
        }

        setTimeout(() => {
            close();
            if (capsuleEl) {
                capsuleEl.classList.remove('is-dismissing-up', 'is-searching');
            }
            if (overlayEl) {
                overlayEl.classList.remove('is-dismissing-up');
            }
            isSearching = false;
        }, 460);
    }

    function updateCaretPosition() {
        if (!caretEl || !inputEl || !measurerEl) return;
        const isFocused = typeof document !== 'undefined' && document.activeElement === inputEl;
        if (!isFocused) {
            caretEl.classList.remove('is-active', 'is-blinking');
            return;
        }
        caretEl.classList.add('is-active');

        const text = inputEl.value || '';
        const pos = typeof inputEl.selectionStart === 'number' ? inputEl.selectionStart : text.length;
        const sub = text.slice(0, pos);
        measurerEl.textContent = sub;

        let textWidth = 0;
        try {
            if (typeof measurerEl.getBoundingClientRect === 'function') {
                textWidth = measurerEl.getBoundingClientRect().width || 0;
            } else if (typeof measurerEl.offsetWidth === 'number') {
                textWidth = measurerEl.offsetWidth || 0;
            }
        } catch (_) {
            textWidth = 0;
        }

        const scrollLeft = inputEl.scrollLeft || 0;
        const offset = Math.max(0, textWidth - scrollLeft);
        caretEl.style.transform = `translate3d(${offset}px, -50%, 0)`;

        // Restart blink cycle so cursor remains solidly visible while typing
        caretEl.classList.remove('is-blinking');
        if (typeof caretEl.offsetWidth === 'number') {
            void caretEl.offsetWidth;
        }
        caretEl.classList.add('is-blinking');
    }

    function open(initialQuery) {
        buildDOM();

        if (isOpen) {
            if (inputEl) {
                inputEl.focus();
                if (typeof initialQuery === 'string') {
                    inputEl.value = initialQuery;
                    if (actionBtnEl) {
                        actionBtnEl.classList.toggle('has-query', Boolean(initialQuery.trim()));
                    }
                }
                updateCaretPosition();
            }
            return;
        }

        isOpen = true;
        isSearching = false;

        if (capsuleEl) {
            capsuleEl.classList.remove('is-dismissing-up', 'is-searching');
        }
        if (overlayEl) {
            overlayEl.classList.remove('is-dismissing-up');
        }

        // Auto-hide navigation bar upward if currently visible
        const nav = document.querySelector('.framer-nav');
        if (nav) {
            const isHidden = nav.classList.contains('nav-hidden') || nav.classList.contains('spotlight-nav-hidden');
            let rectBottom = 64;
            if (typeof nav.getBoundingClientRect === 'function') {
                try {
                    rectBottom = nav.getBoundingClientRect().bottom;
                } catch (_) {}
            }
            wasNavVisible = !isHidden && (rectBottom > 0);
            nav.classList.add('nav-hidden', 'spotlight-nav-hidden');
        }

        document.body.classList.add('prompt-spotlight-active');

        // Smooth bottom-to-top floating entrance identical to Dock
        if (overlayEl) {
            overlayEl.classList.remove('is-dismissing-up');
            if (overlayEl.style) overlayEl.style.display = 'flex';
            if (typeof overlayEl.offsetWidth === 'number') void overlayEl.offsetWidth;
            overlayEl.classList.add('is-open');
            overlayEl.setAttribute('aria-hidden', 'false');
        }

        // Reset query unless an explicit query string is provided
        const queryToUse = typeof initialQuery === 'string' ? initialQuery : '';

        if (inputEl) {
            inputEl.value = queryToUse;
            if (actionBtnEl) {
                actionBtnEl.classList.toggle('has-query', Boolean(queryToUse.trim()));
            }
            setTimeout(() => {
                try {
                    inputEl.focus({ preventScroll: true });
                } catch (_) {
                    inputEl.focus();
                }
                if (queryToUse && typeof inputEl.select === 'function') {
                    inputEl.select();
                }
                updateCaretPosition();
            }, 60);
        }

        if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('prompt-spotlight-change', { detail: { open: true } }));
        }
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        isSearching = false;

        if (overlayEl) {
            overlayEl.classList.remove('is-open', 'is-dismissing-up');
            overlayEl.setAttribute('aria-hidden', 'true');
            if (overlayEl.style) overlayEl.style.display = 'none';
        }

        document.body.classList.remove('prompt-spotlight-active');

        // Restore navigation bar if it was visible before opening or if user is at the top
        const nav = document.querySelector('.framer-nav');
        if (nav) {
            nav.classList.remove('spotlight-nav-hidden');
            const isNearTop = typeof window !== 'undefined' && (window.scrollY || 0) <= 24;
            if (wasNavVisible || isNearTop) {
                nav.classList.remove('nav-hidden');
            }
        }

        if (inputEl) {
            inputEl.value = '';
            if (typeof inputEl.blur === 'function') {
                inputEl.blur();
            }
        }
        if (caretEl) {
            caretEl.classList.remove('is-active', 'is-blinking');
        }
        if (actionBtnEl) {
            actionBtnEl.classList.remove('has-query');
        }

        if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('prompt-spotlight-change', { detail: { open: false } }));
        }
    }

    function toggle(initialQuery) {
        if (isOpen) {
            close();
        } else {
            open(initialQuery);
        }
    }

    function bindEvents() {
        if (spotlightMounted) return;
        spotlightMounted = true;

        buildDOM();

        // Backdrop click to close (transparent hit area, zero background blur)
        if (backdropEl) {
            backdropEl.addEventListener('click', (e) => {
                e.preventDefault();
                close();
            });
        }

        // ESC button click
        if (escBtnEl) {
            escBtnEl.addEventListener('click', (e) => {
                e.preventDefault();
                close();
            });
        }

        // Input typing, focus, blur, and caret tracking
        if (inputEl) {
            inputEl.addEventListener('input', () => {
                const val = inputEl.value;
                if (actionBtnEl) {
                    actionBtnEl.classList.toggle('has-query', Boolean(val.trim()));
                }
                updateCaretPosition();
            });

            inputEl.addEventListener('focus', () => {
                updateCaretPosition();
            });

            inputEl.addEventListener('blur', () => {
                updateCaretPosition();
            });

            inputEl.addEventListener('click', () => {
                updateCaretPosition();
            });

            inputEl.addEventListener('keyup', (e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Backspace', 'Delete'].includes(e.key)) {
                    updateCaretPosition();
                }
            });

            inputEl.addEventListener('compositionstart', () => {
                updateCaretPosition();
            });

            inputEl.addEventListener('compositionupdate', () => {
                updateCaretPosition();
            });

            inputEl.addEventListener('compositionend', () => {
                updateCaretPosition();
            });

            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    triggerInPlaceSearch();
                }
            });
        }

        if (typeof document !== 'undefined') {
            document.addEventListener('selectionchange', () => {
                if (isOpen && document.activeElement === inputEl) {
                    updateCaretPosition();
                }
            });
        }

        // Action / Search button click
        if (actionBtnEl) {
            actionBtnEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                triggerInPlaceSearch();
            });
        }

        // Keyboard shortcuts: Cmd+K / Ctrl+K
        document.addEventListener('keydown', (e) => {
            const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
            const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
            if (cmdOrCtrl && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                toggle();
                return;
            }

            if (e.key === 'Escape' && isOpen) {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindEvents, { once: true });
    } else {
        bindEvents();
    }

    function resetSearch() {
        if (isOpen) {
            close();
        }
        if (inputEl) {
            inputEl.value = '';
        }
        updateCaretPosition();
        if (actionBtnEl) {
            actionBtnEl.classList.remove('has-query');
        }
        const isShop = detectContext() === 'shop';
        if (isShop) {
            const listSearchInput = document.getElementById('listSearchInput');
            if (listSearchInput) {
                listSearchInput.value = '';
            }
            if (window.ShopListLayout && typeof window.ShopListLayout.resetSearch === 'function') {
                window.ShopListLayout.resetSearch({ preserveScroll: true });
            } else if (listSearchInput) {
                listSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
                const form = document.getElementById('listSearchForm');
                if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
            }
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('shop-search-change', { detail: { active: false, query: '' } }));
            }
        } else {
            const gallerySearch = document.getElementById('gallerySearch');
            if (gallerySearch) {
                gallerySearch.value = '';
            }
            if (typeof window.renderGallery === 'function') {
                window.renderGallery('all', true, { preserveScroll: true });
                const navItems = document.querySelectorAll('.nav-item');
                navItems.forEach(n => n.classList.remove('active'));
                const allItem = document.querySelector('.nav-item[data-filter="all"]');
                if (allItem) allItem.classList.add('active');
            }
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('prompt-search-change', { detail: { active: false } }));
            }
        }
    }

    // Expose API
    const api = {
        open,
        close,
        toggle,
        triggerInPlaceSearch,
        resetSearch,
        detectContext,
        isOpen: () => isOpen,
        isSearching: () => isSearching,
        setQuery: (query) => {
            const val = typeof query === 'string' ? query : '';
            if (inputEl) inputEl.value = val;
            if (actionBtnEl) actionBtnEl.classList.toggle('has-query', Boolean(val.trim()));
            updateCaretPosition();
        }
    };

    if (typeof window !== 'undefined') {
        window.PromptSpotlight = api;
        window.ShopSpotlight = api;
        if (!window.isShopSearchActive) {
            window.isShopSearchActive = () => Boolean(
                window.ShopListLayout?.getSearchQuery?.()
                || document.getElementById('listSearchInput')?.value?.trim()
            );
        }
    }
})();
