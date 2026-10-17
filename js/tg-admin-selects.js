(function initTgAdminSelects(scope) {
    'use strict';
    const document = scope.document;
    const selector = document.currentScript?.dataset.selectScope;
    const defaultRoot = selector ? document.querySelector(selector) : document;
    const controls = new Map();
    let opened = null;
    let sequence = 0;

    function close({ focus = false } = {}) {
        if (!opened) return;
        const control = opened; opened = null;
        control.menu.hidden = true;
        control.trigger.setAttribute('aria-expanded', 'false');
        control.trigger.removeAttribute('aria-activedescendant');
        control.wrapper.classList.remove('is-open');
        if (focus) control.trigger.focus();
    }
    function enabled(control, index) {
        const option = control.select.options[index];
        return !!option && !option.disabled && !option.hidden;
    }
    function highlight(control, index) {
        control.active = index;
        control.items.forEach((item, i) => item.classList.toggle('is-active', i === index));
        const item = control.items[index];
        if (item) {
            control.trigger.setAttribute('aria-activedescendant', item.id);
            // Scroll only the options, so navigating a menu never moves the page.
            const top = item.offsetTop; const bottom = top + item.offsetHeight;
            if (top < control.menu.scrollTop) control.menu.scrollTop = top;
            else if (bottom > control.menu.scrollTop + control.menu.clientHeight) control.menu.scrollTop = bottom - control.menu.clientHeight;
        }
    }
    function syncOne(control) {
        const { select, trigger, label, menu } = control;
        trigger.disabled = select.disabled;
        label.textContent = select.selectedOptions[0]?.textContent || '请选择';
        if (select.disabled && opened === control) close();
        control.items = Array.from(select.options, (option, index) => {
            const item = document.createElement('div'); item.className = 'tg-select-option';
            item.id = `${select.id}-option-${index}`; item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(option.selected));
            item.setAttribute('aria-disabled', String(option.disabled)); item.hidden = option.hidden;
            const text = document.createElement('span'); text.textContent = option.textContent;
            const check = document.createElement('span'); check.className = 'tg-select-check';
            check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
            item.append(text, check);
            // Keep focus on the combobox; otherwise focusin can close the menu
            // between mousedown and click before the option is selected.
            item.addEventListener('mousedown', event => event.preventDefault());
            item.addEventListener('pointermove', () => { if (enabled(control, index)) highlight(control, index); });
            item.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); choose(control, index); });
            return item;
        });
        menu.replaceChildren(...control.items);
        if (opened === control) highlight(control, select.selectedIndex);
    }
    function prune() {
        for (const [select, control] of controls) {
            if (select.isConnected !== false) continue;
            if (opened === control) close();
            control.observer?.disconnect();
            select.removeEventListener('change', control.onChange);
            select.form?.removeEventListener('reset', control.onReset);
            control.wrapper.remove();
            select.hidden = control.wasHidden;
            controls.delete(select);
        }
    }
    function sync(root = defaultRoot) {
        enhance(root);
        for (const control of controls.values()) if (root === document || root === control.select || root.contains?.(control.select)) syncOne(control);
    }
    function open(control, direction = 1) {
        if (control.select.disabled) return;
        close(); syncOne(control); opened = control;
        control.menu.hidden = false;
        control.wrapper.classList.remove('opens-up');
        control.wrapper.classList.add('is-open');
        control.trigger.setAttribute('aria-expanded', 'true');
        const rect = control.trigger.getBoundingClientRect();
        const container = control.wrapper.closest?.('#tgDetailContent, .tg-purchase-review')?.getBoundingClientRect();
        const below = Math.min(scope.innerHeight, container?.bottom ?? scope.innerHeight) - rect.bottom - 12;
        const above = rect.top - Math.max(0, container?.top ?? 0) - 12;
        const upwards = below < Math.min(280, control.menu.scrollHeight) && above > below;
        control.wrapper.classList.toggle('opens-up', upwards);
        control.menu.style.maxHeight = `${Math.max(80, Math.min(280, upwards ? above : below))}px`;
        const indexes = control.items.map((_, i) => i).filter(i => enabled(control, i));
        const selected = control.select.selectedIndex;
        highlight(control, enabled(control, selected) ? selected : direction > 0 ? indexes[0] : indexes.at(-1));
    }
    function choose(control, index) {
        if (control.select.disabled || !enabled(control, index)) return;
        const changed = control.select.selectedIndex !== index;
        control.select.selectedIndex = index;
        close({ focus: true }); syncOne(control);
        if (changed) control.select.dispatchEvent(new scope.Event('change', { bubbles: true }));
    }
    function move(control, direction) {
        for (let index = control.active + direction; index >= 0 && index < control.items.length; index += direction) {
            if (enabled(control, index)) { highlight(control, index); return; }
        }
    }
    function onKey(control, event) {
        const key = event.key;
        if (key === 'Tab') { close(); return; }
        if (key === 'Escape') { if (opened === control) { event.preventDefault(); close({ focus: true }); } return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
            event.preventDefault();
            if (opened !== control) {
                open(control, key === 'ArrowUp' ? -1 : 1);
                if (key !== 'Home' && key !== 'End') return;
            }
            if (key === 'Enter' || key === ' ') { choose(control, control.active); return; }
            if (key === 'ArrowDown' || key === 'ArrowUp') move(control, key === 'ArrowDown' ? 1 : -1);
            else {
                const indexes = control.items.map((_, i) => i).filter(i => enabled(control, i));
                highlight(control, key === 'Home' ? indexes[0] : indexes.at(-1));
            }
            return;
        }
        if (key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        if (opened !== control) open(control);
        const now = Date.now(); control.search = (now - control.searchAt < 700 ? control.search : '') + key.toLocaleLowerCase(); control.searchAt = now;
        const index = Array.from(control.select.options).findIndex((option, i) => enabled(control, i) && option.textContent.trim().toLocaleLowerCase().startsWith(control.search));
        if (index >= 0) highlight(control, index);
    }
    function enhance(root = defaultRoot) {
        prune();
        const selects = root.matches?.('select') ? [root] : root.querySelectorAll('select');
        for (const select of selects) {
            if (controls.has(select) || select.isConnected === false) continue;
            if (!select.id) {
                let id;
                do { id = `tg-admin-select-${++sequence}`; } while (document.getElementById?.(id));
                select.id = id;
            }
            const wrapper = document.createElement('div'); wrapper.className = 'tg-custom-select';
            const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'tg-select-trigger';
            trigger.id = `${select.id}-trigger`; trigger.setAttribute('role', 'combobox');
            trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
            const name = select.getAttribute('aria-label') || Array.from(select.labels || []).map(label => Array.from(label.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim()).join(' ') || '请选择';
            trigger.setAttribute('aria-label', name);
            const label = document.createElement('span'); label.className = 'tg-select-value';
            const arrow = document.createElement('span'); arrow.className = 'tg-select-arrow'; arrow.setAttribute('aria-hidden', 'true');
            trigger.append(label, arrow);
            const menu = document.createElement('div'); menu.className = 'tg-select-menu'; menu.hidden = true;
            menu.id = `${select.id}-listbox`; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', name);
            trigger.setAttribute('aria-controls', menu.id);
            wrapper.append(trigger, menu); select.after(wrapper);
            // Keep the original select for FormData, reset and existing change
            // handlers; the visible control never opens the native picker.
            const wasHidden = select.hidden;
            select.hidden = true;
            const control = { select, wrapper, trigger, label, menu, wasHidden, items: [], active: 0, search: '', searchAt: 0 };
            controls.set(select, control); syncOne(control);
            trigger.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (opened === control) close(); else open(control); });
            trigger.addEventListener('keydown', event => onKey(control, event));
            control.onChange = () => syncOne(control);
            control.onReset = () => scope.queueMicrotask(sync);
            select.addEventListener('change', control.onChange);
            if (scope.MutationObserver) {
                control.observer = new scope.MutationObserver(() => { if (select.isConnected === false) prune(); else syncOne(control); });
                control.observer.observe(select, { attributes: true, attributeFilter: ['disabled', 'selected', 'hidden', 'label'], subtree: true, childList: true, characterData: true });
            }
            select.form?.addEventListener('reset', control.onReset);
        }
    }
    enhance();
    document.addEventListener('pointerdown', event => { if (opened && !opened.wrapper.contains(event.target)) close(); });
    document.addEventListener('focusin', event => { if (opened && !opened.wrapper.contains(event.target)) close(); });
    scope.TgAdminSelects = Object.freeze({ enhance, sync, close });
})(window);
