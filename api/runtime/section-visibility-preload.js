const admin = require('../_lib/admin');
const {
    RUNTIME_SECTION_VISIBILITY_CACHE_CONTROL,
    createRuntimeSectionVisibilityPreloadHandler
} = require('../../server/api-handlers/public/runtime-section-visibility-preload');

module.exports = createRuntimeSectionVisibilityPreloadHandler({
    admin
});

module.exports._private = {
    RUNTIME_SECTION_VISIBILITY_CACHE_CONTROL
};
