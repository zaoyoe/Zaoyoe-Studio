const { buildSupabaseRuntimeScript } = require('../_lib/public-runtime-config');
const {
    RUNTIME_CONFIG_CACHE_CONTROL,
    createRuntimeSupabaseConfigHandler
} = require('../../server/api-handlers/public/runtime-supabase-config');

module.exports = createRuntimeSupabaseConfigHandler({
    buildSupabaseRuntimeScript,
    env: process.env
});

module.exports._private = {
    RUNTIME_CONFIG_CACHE_CONTROL
};
