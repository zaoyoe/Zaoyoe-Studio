(function () {
    'use strict';

    function updateLanguageState(language) {
        const langZh = document.getElementById('langZhTest');
        const langEn = document.getElementById('langEnTest');
        if (!langZh || !langEn) {
            return;
        }

        if (language === 'zh') {
            langZh.classList.add('active');
            langEn.classList.remove('active');
        } else {
            langZh.classList.remove('active');
            langEn.classList.add('active');
        }
    }

    function bindLanguageToggleTest() {
        document.getElementById('langToggleTest')?.addEventListener('click', () => {
            window.i18n?.toggleLanguage();
        });

        window.setTimeout(() => {
            const test1 = document.getElementById('test1');
            if (test1) {
                if (window.i18n) {
                    const currentLanguage = window.i18n.getCurrentLanguage();
                    test1.innerHTML = `<div class="status">✅ i18n loaded successfully<br>Current language: <strong>${currentLanguage}</strong></div>`;
                    updateLanguageState(currentLanguage);
                } else {
                    test1.innerHTML = '<div class="status status-error">❌ i18n not loaded</div>';
                }
            }

            window.addEventListener('languageChanged', (event) => {
                const language = event.detail?.lang || 'zh';
                const test2 = document.getElementById('test2');
                const test3 = document.getElementById('test3');
                const test4 = document.getElementById('test4');

                if (test2) {
                    test2.innerHTML = `✅ Language changed to: <strong>${language}</strong>`;
                }

                updateLanguageState(language);

                if (test3) {
                    test3.innerHTML = '<div class="status">✅ Translations applied</div>';
                }

                if (test4) {
                    const stored = localStorage.getItem('zaoyoe_language');
                    test4.innerHTML = `<div class="status">✅ Stored language: <strong>${stored}</strong></div>`;
                }
            });

            const test4 = document.getElementById('test4');
            if (test4) {
                const stored = localStorage.getItem('zaoyoe_language');
                test4.innerHTML = `<div class="status">Stored language: <strong>${stored || 'none'}</strong></div>`;
            }
        }, 500);
    }

    bindLanguageToggleTest();
}());
