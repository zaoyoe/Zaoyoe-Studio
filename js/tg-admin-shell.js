// Restore only the public layout preference before auth dependencies load.
(function prepareTelegramAdminShell(scope) {
    'use strict';
    let section;
    try { section = scope.sessionStorage.getItem('tg-admin-section-v1'); } catch (_) {}
    if (!['Dashboard', 'Query', 'Purchases', 'Orders', 'Codes', 'Products', 'Provider'].includes(section)) section = 'Dashboard';
    scope.document.documentElement.setAttribute('data-tg-admin-section', section);
})(window);
