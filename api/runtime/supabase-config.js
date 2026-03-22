const {
    buildSupabaseRuntimeScript
} = require('../_lib/public-runtime-config');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.status(405).setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Method not allowed');
        return;
    }

    try {
        const script = buildSupabaseRuntimeScript(process.env);
        res.status(200);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
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
