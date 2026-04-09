const admin = require('../_lib/admin');
const requestSecurity = require('../_lib/request-security');
const {
    DEFAULT_SECURITY_CONFIG,
    buildSecurityPayload,
    createLoginSecurityHandler,
    loadSecurityConfig,
    recordFailureState,
    runSecurityAction,
    sanitizeEmail,
    unwrapSingleResult
} = require('../../server/api-handlers/public/auth-login-security');

module.exports = createLoginSecurityHandler({
    admin,
    requestSecurity,
    env: process.env
});
module.exports._private = {
    DEFAULT_SECURITY_CONFIG,
    buildSecurityPayload,
    loadSecurityConfig,
    recordFailureState,
    runSecurityAction,
    sanitizeEmail,
    unwrapSingleResult
};
