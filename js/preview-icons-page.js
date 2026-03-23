(function () {
    'use strict';

    function getNumberDatasetValue(name, fallback) {
        const rawValue = document.body?.dataset?.[name];
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : fallback;
    }

    function animateIcon(element) {
        if (!element) {
            return;
        }

        element.classList.remove('active');
        void element.offsetWidth;
        element.classList.add('active');

        window.setTimeout(() => {
            element.classList.remove('active');
        }, getNumberDatasetValue('previewResetDelay', 1000));
    }

    function triggerAll() {
        const stagger = getNumberDatasetValue('previewStagger', 100);
        const icons = document.querySelectorAll('.icon-wrapper');
        icons.forEach((icon, index) => {
            window.setTimeout(() => animateIcon(icon), index * stagger);
        });
    }

    function bindPreviewInteractions() {
        if (document.body?.dataset.previewInteractionsBound === '1') {
            return;
        }

        if (document.body) {
            document.body.dataset.previewInteractionsBound = '1';
        }

        document.addEventListener('click', (event) => {
            const trigger = event.target.closest('[data-preview-trigger-all="1"]');
            if (trigger) {
                triggerAll();
                return;
            }

            const icon = event.target.closest('.icon-wrapper');
            if (icon) {
                animateIcon(icon);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindPreviewInteractions, { once: true });
    } else {
        bindPreviewInteractions();
    }
}());
