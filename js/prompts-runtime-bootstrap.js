(function () {
    'use strict';

    if (typeof window.dayjs !== 'undefined' && typeof window.dayjs_plugin_relativeTime !== 'undefined') {
        dayjs.extend(dayjs_plugin_relativeTime);
        dayjs.locale('zh-cn');
        console.log('Day.js initialized with zh-cn locale');
    }

    if (document.body) {
        document.body.classList.add('loaded');
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.body?.classList.add('loaded');
        }, { once: true });
    }
}());
