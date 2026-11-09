/**
 * LabelInput (LBI) - Universal Floating Notch Border Input Component
 * Provides morphing SVG notch border, sequential letter hop animation,
 * and eye password toggle for all form inputs across the site.
 */
(() => {
    'use strict';

    const S = 0.78;
    const IN = 0.75;

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function buildLabelSpans(text) {
        return [...String(text || '')].map((char, index) => {
            return `<span style="--i: ${index};">${escapeHtml(char)}</span>`;
        }).join('');
    }

    function createSvgRing() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'lbi-ring');
        svg.setAttribute('viewBox', '0 0 380 48');
        svg.setAttribute('aria-hidden', 'true');

        const left = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        left.setAttribute('class', 'lbi-left');
        left.setAttribute('d', '');

        const right = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        right.setAttribute('class', 'lbi-right');
        right.setAttribute('d', '');

        const gapLeft = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        gapLeft.setAttribute('class', 'lbi-gap lbi-gap-left');
        gapLeft.setAttribute('pathLength', '1');
        gapLeft.setAttribute('d', '');

        const gapRight = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        gapRight.setAttribute('class', 'lbi-gap lbi-gap-right');
        gapRight.setAttribute('pathLength', '1');
        gapRight.setAttribute('d', '');

        svg.appendChild(left);
        svg.appendChild(right);
        svg.appendChild(gapLeft);
        svg.appendChild(gapRight);
        return svg;
    }

    function createEyeToggle(input) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lbi-eye';
        btn.dataset.show = 'false';
        btn.setAttribute('aria-label', '显示密码');
        btn.setAttribute('tabindex', '-1');

        btn.innerHTML = `
            <svg class="lbi-eye-open" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
            </svg>
            <svg class="lbi-eye-closed" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 10.5c2.4 3.8 5.6 5.5 8 5.5s5.6-1.7 8-5.5" />
                <path d="m6.5 13.5-1.5 2.5" />
                <path d="M12 16v3" />
                <path d="m17.5 13.5 1.5 2.5" />
            </svg>
        `;

        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const willShow = btn.dataset.show !== 'true';
            btn.dataset.show = String(willShow);
            btn.setAttribute('aria-label', willShow ? '隐藏密码' : '显示密码');
            input.type = willShow ? 'text' : 'password';
            input.focus();
        });

        return btn;
    }

    function updateLbiField(root) {
        if (!root) return;
        const input = root.querySelector('input') || root.querySelector('.lbi-field');
        const box = root.querySelector('.lbi-box');
        const ring = root.querySelector('.lbi-ring');
        const label = root.querySelector('.lbi-label');
        if (!input || !box || !ring || !label) return;

        if (input.placeholder) {
            input.setAttribute('data-lbi-placeholder', input.placeholder);
            input.removeAttribute('placeholder');
        }

        const currentText = String(label.textContent || '').trim();
        if (label.dataset.lbiPrepared !== currentText) {
            label.dataset.lbiPrepared = currentText;
            if (currentText) {
                label.replaceChildren(...[...currentText].map((char, idx) => {
                    const span = document.createElement('span');
                    span.textContent = char;
                    span.style.setProperty('--i', String(idx));
                    return span;
                }));
            }
        }

        const corner = Number(root.dataset.corner || 20);
        const boxRect = box.getBoundingClientRect();
        const W = Math.round(boxRect.width) || 380;
        const H = Math.round(boxRect.height) || 48;

        ring.setAttribute('viewBox', `0 0 ${W} ${H}`);

        const r = Math.min(H / 2, Math.max(0, corner));
        const hasValue = Boolean(input.value && input.value.length > 0);
        const isFocused = root.dataset.focus === 'true';
        const up = isFocused || hasValue;
        const lx = Math.max(16, r + 6);
        const x0 = Math.max(r, lx - 5);
        const labelWidth = label.offsetWidth || (currentText ? currentText.length * 15 : 44);
        const x1 = Math.min(W - r, Math.max(x0 + 10, Math.round(lx + labelWidth * S + 5)));
        const a = Math.max(0, r - IN);
        const R = W - IN;
        const B = H - IN;
        const mid = Math.round(W / 2);
        const nm = Math.round((x0 + x1) / 2);

        root.dataset.up = String(up);
        root.dataset.filled = String(hasValue);
        box.style.borderRadius = `${r}px`;
        box.style.setProperty('--lbi-x', `${lx}px`);

        const right = r > 0
            ? `M${x1},${IN} ${x1 < W - r ? `L${W - r},${IN} ` : ''}A${a},${a} 0 0 1 ${R},${r} L${R},${H - r} A${a},${a} 0 0 1 ${W - r},${B} L${mid},${B}`
            : `M${x1},${IN} L${R},${IN} L${R},${B} L${mid},${B}`;
        const left = r > 0
            ? `M${x0},${IN} ${x0 > r ? `L${r},${IN} ` : ''}A${a},${a} 0 0 0 ${IN},${r} L${IN},${H - r} A${a},${a} 0 0 0 ${r},${B} L${mid},${B}`
            : `M${x0},${IN} L${IN},${IN} L${IN},${B} L${mid},${B}`;

        const pathRight = root.querySelector('.lbi-right');
        const pathLeft = root.querySelector('.lbi-left');
        const pathGapLeft = root.querySelector('.lbi-gap-left');
        const pathGapRight = root.querySelector('.lbi-gap-right');

        if (pathRight) pathRight.setAttribute('d', right);
        if (pathLeft) pathLeft.setAttribute('d', left);
        if (pathGapLeft) pathGapLeft.setAttribute('d', `M${nm},${IN} L${x0},${IN}`);
        if (pathGapRight) pathGapRight.setAttribute('d', `M${nm},${IN} L${x1},${IN}`);

        const hasEye = Boolean(root.querySelector('.lbi-eye'));
        input.style.paddingRight = hasEye ? '44px' : `${lx}px`;
        input.style.paddingLeft = `${lx}px`;
    }

    function bindLbiField(root) {
        if (!root || root.dataset.lbiBound === 'true') {
            updateLbiField(root);
            return;
        }

        const input = root.querySelector('input') || root.querySelector('.lbi-field');
        const box = root.querySelector('.lbi-box');
        const label = root.querySelector('.lbi-label');
        if (!input || !box || !label) return;

        // Clear native placeholder so it doesn't clash with floating label
        if (input.placeholder) {
            input.setAttribute('data-lbi-placeholder', input.placeholder);
            input.removeAttribute('placeholder');
        }

        if (typeof ResizeObserver !== 'undefined' && box && !root._lbiRo) {
            root._lbiRo = new ResizeObserver(() => updateLbiField(root));
            root._lbiRo.observe(box);
        }

        root.dataset.lbiBound = 'true';

        input.addEventListener('focus', () => {
            root.dataset.focus = 'true';
            root.dataset.up = 'true';
            // Trigger sequential letter hop animation
            const spans = label.querySelectorAll('span');
            spans.forEach((s) => {
                s.style.animation = 'none';
            });
            window.requestAnimationFrame(() => {
                spans.forEach((s) => {
                    s.style.animation = '';
                });
            });
            updateLbiField(root);
        });

        input.addEventListener('blur', () => {
            root.dataset.focus = 'false';
            root.dataset.up = String(Boolean(input.value && input.value.length > 0));
            root.dataset.filled = String(Boolean(input.value && input.value.length > 0));
            updateLbiField(root);
        });

        input.addEventListener('input', () => {
            root.dataset.filled = String(Boolean(input.value && input.value.length > 0));
            root.dataset.up = String(Boolean(input.value && input.value.length > 0) || root.dataset.focus === 'true');
            updateLbiField(root);
        });

        input.addEventListener('change', () => {
            updateLbiField(root);
        });

        box.addEventListener('click', (event) => {
            if (event.target.closest('.lbi-eye')) return;
            input.focus();
        });

        label.addEventListener('click', () => {
            input.focus();
        });

        const eye = root.querySelector('.lbi-eye');
        if (eye && !eye._lbiBound) {
            eye._lbiBound = true;
            eye.addEventListener('pointerdown', (e) => e.preventDefault());
            eye.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const willShow = eye.dataset.show !== 'true';
                eye.dataset.show = String(willShow);
                eye.setAttribute('aria-label', willShow ? '隐藏密码' : '显示密码');
                input.type = willShow ? 'text' : 'password';
                updateLbiField(root);
                input.focus();
            });
        }

        updateLbiField(root);
    }

    /**
     * Enhances an existing native <input> element into a full .lbi component.
     * Retains all element attributes, IDs, event listeners, and form bindings.
     */
    function enhanceInput(input, options = {}) {
        if (!input || !(input instanceof HTMLInputElement)) return null;
        if (input.closest('.lbi')) {
            updateLbiField(input.closest('.lbi'));
            return input.closest('.lbi');
        }

        const labelText = options.label ||
            input.getAttribute('data-lbi-label') ||
            input.placeholder ||
            input.getAttribute('aria-label') ||
            '';

        if (!labelText) return null;

        const corner = options.corner || input.getAttribute('data-corner') || 20;
        const isPassword = input.type === 'password';

        // Clear native placeholder so it doesn't clash with floating label
        if (input.placeholder) {
            input.setAttribute('data-lbi-placeholder', input.placeholder);
            input.removeAttribute('placeholder');
        }

        const root = document.createElement('div');
        root.className = 'lbi';
        root.dataset.field = labelText;
        root.dataset.corner = String(corner);

        const box = document.createElement('div');
        box.className = 'lbi-box';

        const svgRing = createSvgRing();

        const label = document.createElement('label');
        label.className = 'lbi-label';
        if (input.id) {
            label.setAttribute('for', input.id);
        }
        if (input.hasAttribute('data-i18n-placeholder')) {
            const i18nKey = input.getAttribute('data-i18n-placeholder');
            label.setAttribute('data-i18n', i18nKey);
            input.removeAttribute('data-i18n-placeholder');
        }
        label.innerHTML = buildLabelSpans(labelText);
        label.dataset.lbiPrepared = labelText;

        box.appendChild(svgRing);
        box.appendChild(label);

        // Insert wrapper into DOM where input was, and place input inside box
        const parent = input.parentNode;
        parent.insertBefore(root, input);
        box.appendChild(input);

        input.classList.add('lbi-field');

        // Check if parent or outer container has external redundant label text
        if (parent.tagName === 'LABEL' || parent.classList.contains('guest-orders-field') || parent.classList.contains('guest-shop-modal__field')) {
            parent.classList.add('lbi-hide-external-label');
        }
        const fieldContainer = input.closest('.guest-orders-field, .guest-shop-modal__field, .verify-form-field, .guest-orders-ticket-field, label');
        if (fieldContainer) {
            fieldContainer.classList.add('lbi-hide-external-label');
        }

        if (isPassword && !options.noEye) {
            const eye = createEyeToggle(input);
            box.appendChild(eye);
        }

        root.appendChild(box);
        bindLbiField(root);
        return root;
    }

    function enhanceAll(selector, options = {}) {
        const elements = typeof selector === 'string'
            ? document.querySelectorAll(selector)
            : (selector || []);
        const results = [];
        elements.forEach((el) => {
            const root = enhanceInput(el, options);
            if (root) results.push(root);
        });
        return results;
    }

    function scanAndEnhance() {
        // 1. Initialize any already-structured .lbi elements
        document.querySelectorAll('.lbi').forEach(bindLbiField);

        // 2. Enhance marked inputs
        enhanceAll('[data-lbi="true"], .lbi-auto');

        // 3. Shop modal inputs
        enhanceAll('#guestCashContact', { label: '邮箱地址（用于查询订单）' });
        enhanceAll('#guestCashOrderPassword', { label: '查询密码' });
        enhanceAll('#purchaseDiscountCode', { label: '优惠码 / 兑换券' });

        // 4. Guest orders inputs
        enhanceAll('#guestOrdersEmail', { label: '下单邮箱' });
        enhanceAll('#guestOrdersPassword', { label: '查询密码' });
        enhanceAll('#guestOrdersOrderNo', { label: '订单号（可选）' });
        enhanceAll('#guestOrdersResetEmail', { label: '下单邮箱' });
        enhanceAll('#guestOrdersResetPassword', { label: '新查询密码' });
        enhanceAll('#guestOrdersResetPasswordConfirm', { label: '确认新查询密码' });
        enhanceAll('#ticketModalEmail', { label: '联系邮箱' });

        // 5. Verify inputs
        enhanceAll('#verifyEmailInput', { label: 'Gmail 地址' });
        enhanceAll('#verifyPasswordInput', { label: '账号密码' });
        enhanceAll('#verifyTotpInput', { label: '2FA 密钥 (Base32)' });

        // 6. Profile modal inputs
        enhanceAll('#desktop_oldPassword, #mobile_oldPassword', { label: '当前密码' });
        enhanceAll('#desktop_newPassword, #mobile_newPassword', { label: '新密码（至少6位）' });
        enhanceAll('#desktop_phoneNumberInput, #mobile_phoneNumberInput', { label: '输入手机号' });
        enhanceAll('#desktop_phoneCodeInput, #mobile_phoneCodeInput', { label: '6位验证码' });
    }

    // Auto-run on DOM ready and expose API
    window.LabelInput = {
        enhance: enhanceInput,
        enhanceAll,
        update: updateLbiField,
        bind: bindLbiField,
        scan: scanAndEnhance
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scanAndEnhance);
    } else {
        scanAndEnhance();
    }

    // Re-scan when dynamic modals open or custom events fire
    window.addEventListener('load', scanAndEnhance);
    window.addEventListener('zaoyoe:label-input-refresh', scanAndEnhance);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            document.querySelectorAll('.lbi').forEach(updateLbiField);
        }
    });
})();
