(function (global) {
    'use strict';

    const documentRef = global.document;
    if (!documentRef) return;

    const BRANDS = Object.freeze({
        fatherkey: Object.freeze({
            name: 'Fatherkey',
            site: 'cn'
        }),
        zaoyoe: Object.freeze({
            name: 'Zaoyoe Studio',
            site: 'intl'
        })
    });

    function getForcedSite() {
        try {
            const site = new URLSearchParams(global.location?.search || '').get('site');
            return site === 'cn' || site === 'intl' ? site : '';
        } catch (_error) {
            return '';
        }
    }

    function resolveBrand() {
        const forcedSite = getForcedSite();
        if (forcedSite) {
            return forcedSite === 'cn' ? BRANDS.fatherkey : BRANDS.zaoyoe;
        }

        const hostname = String(global.location?.hostname || '').trim().toLowerCase();
        if (hostname === 'fatherkey.com' || hostname.endsWith('.fatherkey.com')) {
            return BRANDS.fatherkey;
        }

        return BRANDS.zaoyoe;
    }

    function applyBrand() {
        const brand = resolveBrand();
        documentRef.documentElement?.setAttribute('data-legal-brand', brand.site);

        documentRef.querySelectorAll('[data-legal-brand-name]').forEach((element) => {
            element.textContent = brand.name;
        });

        documentRef.querySelectorAll('[data-legal-brand-home-link]').forEach((element) => {
            element.setAttribute('aria-label', `返回 ${brand.name} 首页`);
        });

        const pageHeading = documentRef.querySelector('h1')?.textContent?.trim();
        if (pageHeading) {
            documentRef.title = `${pageHeading} - ${brand.name}`;
        }

        const description = documentRef.querySelector('meta[name="description"][data-legal-description]');
        if (description) {
            description.setAttribute('content', `${brand.name} ${description.dataset.legalDescription}`);
        }
    }

    applyBrand();
}(typeof window !== 'undefined' ? window : globalThis));
