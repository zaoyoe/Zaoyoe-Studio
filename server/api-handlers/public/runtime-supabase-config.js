const RUNTIME_CONFIG_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';

function createRuntimeSupabaseConfigHandler({
    buildSupabaseRuntimeScript,
    env = process.env
} = {}) {
    if (typeof buildSupabaseRuntimeScript !== 'function') {
        throw new TypeError('buildSupabaseRuntimeScript must be a function');
    }

    return async function runtimeSupabaseConfigHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            res.status(405).setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('Method not allowed');
            return;
        }

        try {
            const script = buildSupabaseRuntimeScript(env, { req });
            res.status(200);
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', RUNTIME_CONFIG_CACHE_CONTROL);
            res.end(script);
        } catch (error) {
            const serializedMessage = JSON.stringify(error.message || 'Failed to resolve public runtime config');
            res.status(500);
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(
                [
                    '(function (global) {',
                    `  console.error('Failed to load Supabase runtime config:', ${serializedMessage});`,
                    '  global.__ZAOYOE_SUPABASE_CONFIG__ = null;',
                    '}(typeof window !== "undefined" ? window : globalThis));'
                ].join('\n')
            );
        }
    };
}

module.exports = {
    RUNTIME_CONFIG_CACHE_CONTROL,
    createRuntimeSupabaseConfigHandler
};
