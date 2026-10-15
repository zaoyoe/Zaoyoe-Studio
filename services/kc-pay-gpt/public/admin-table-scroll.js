(() => {
    'use strict';

    document.querySelectorAll('.table-container, .data-table-wrapper, [data-table-scroll]').forEach((viewport, index) => {
        const scrollbar = document.createElement('input');
        scrollbar.type = 'range';
        scrollbar.className = 'table-horizontal-scrollbar';
        scrollbar.min = '0';
        scrollbar.max = '0';
        scrollbar.value = '0';
        scrollbar.step = '1';
        scrollbar.hidden = true;
        viewport.id ||= `admin-table-viewport-${index}`;
        viewport.classList.add('table-scroll-viewport');
        const title = viewport.closest('.panel')?.querySelector('.panel-title')?.textContent.trim() || '列表';
        scrollbar.setAttribute('aria-label', `${title}：左右滚动表格`);
        scrollbar.setAttribute('aria-controls', viewport.id);
        viewport.after(scrollbar);

        let table = null;
        let frame = 0;

        function update() {
            frame = 0;
            const nextTable = viewport.querySelector('table');
            if (table !== nextTable) {
                if (table) resizeObserver.unobserve(table);
                table = nextTable;
                if (table) resizeObserver.observe(table);
            }

            const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
            const overflowing = Boolean(table && viewport.clientWidth > 0 && maxScroll > 1);
            scrollbar.hidden = !overflowing;
            viewport.classList.toggle('has-table-scrollbar', overflowing);
            if (!overflowing) return;

            scrollbar.max = String(maxScroll);
            scrollbar.value = String(viewport.scrollLeft);
            scrollbar.setAttribute('aria-valuetext', `已横向滚动 ${Math.round(viewport.scrollLeft / maxScroll * 100)}%`);
            const thumbWidth = Math.max(32, viewport.clientWidth ** 2 / viewport.scrollWidth);
            scrollbar.style.setProperty('--scroll-thumb-width', `${Math.min(viewport.clientWidth, thumbWidth)}px`);
        }

        function scheduleUpdate() {
            if (!frame) frame = requestAnimationFrame(update);
        }

        scrollbar.addEventListener('input', () => {
            viewport.scrollLeft = Number(scrollbar.value);
            scheduleUpdate();
        });

        scrollbar.addEventListener('keydown', (event) => {
            const maxScroll = Number(scrollbar.max);
            const pageStep = viewport.clientWidth * 0.8;
            const targets = {
                ArrowLeft: viewport.scrollLeft - 64,
                ArrowRight: viewport.scrollLeft + 64,
                PageUp: viewport.scrollLeft - pageStep,
                PageDown: viewport.scrollLeft + pageStep,
                Home: 0,
                End: maxScroll
            };
            if (!Object.hasOwn(targets, event.key)) return;
            event.preventDefault();
            viewport.scrollLeft = Math.max(0, Math.min(maxScroll, targets[event.key]));
            scheduleUpdate();
        });

        viewport.addEventListener('scroll', scheduleUpdate, { passive: true });
        const resizeObserver = new ResizeObserver(scheduleUpdate);
        resizeObserver.observe(viewport);
        // Observe replacements as well as sizing: lists refresh their tbody, and API orders insert a new table.
        new MutationObserver(scheduleUpdate).observe(viewport, {
            childList: true,
            subtree: true,
            characterData: true
        });
        scheduleUpdate();
    });
})();
