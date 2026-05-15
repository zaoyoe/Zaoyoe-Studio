(function () {
    'use strict';

    const CROPPER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js';
    const FLATPICKR_SRC = 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js';
    const FLATPICKR_ZH_SRC = 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/zh.js';
    const SCRIPT_INTEGRITY = new Map([
        [CROPPER_SRC, 'sha384-jzwsV9ieM/KUDMeo+d8dc+jm0GEl7ywPNwg10alB5BodVuC/Kx9RpEnyrl2Om9zH'],
        [FLATPICKR_SRC, 'sha384-5JqMv4L/Xa0hfvtF06qboNdhvuYXUku9ZrhZh3bSk8VXF0A/RuSLHpLsSV9Zqhl6'],
        [FLATPICKR_ZH_SRC, 'sha384-VkrKIP0k00t+nCV0whCXV73obyqU1SxOHVMBi51kYfdGdJcg2UPxHUugSnmGCoid']
    ]);

    let cropperPromise = null;
    let flatpickrPromise = null;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === '1') {
                    resolve();
                    return;
                }

                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            const integrity = SCRIPT_INTEGRITY.get(src);
            if (integrity) {
                script.integrity = integrity;
                script.crossOrigin = 'anonymous';
            }
            script.onload = () => {
                script.dataset.loaded = '1';
                resolve();
            };
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    function ensureCropper() {
        if (window.Cropper) {
            return Promise.resolve(window.Cropper);
        }

        if (!cropperPromise) {
            cropperPromise = loadScript(CROPPER_SRC)
                .then(() => {
                    if (!window.Cropper) {
                        throw new Error('Cropper runtime unavailable after script load');
                    }
                    return window.Cropper;
                })
                .catch((error) => {
                    cropperPromise = null;
                    throw error;
                });
        }

        return cropperPromise;
    }

    function ensureFlatpickr() {
        if (window.flatpickr?.l10ns?.zh) {
            return Promise.resolve(window.flatpickr);
        }

        if (!flatpickrPromise) {
            flatpickrPromise = loadScript(FLATPICKR_SRC)
                .then(() => loadScript(FLATPICKR_ZH_SRC))
                .then(() => {
                    if (!window.flatpickr) {
                        throw new Error('Flatpickr runtime unavailable after script load');
                    }
                    return window.flatpickr;
                })
                .catch((error) => {
                    flatpickrPromise = null;
                    throw error;
                });
        }

        return flatpickrPromise;
    }

    window.ensureAdminCropper = ensureCropper;
    window.ensureAdminFlatpickr = ensureFlatpickr;
})();
