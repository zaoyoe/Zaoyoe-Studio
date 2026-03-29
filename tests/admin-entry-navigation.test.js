const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const adminAccessPath = path.resolve(__dirname, '../js/admin-access.js');

function restoreGlobalProperty(name, value) {
    if (value === undefined) {
        delete global[name];
        return;
    }

    global[name] = value;
}

function loadAdminAccess(overrides = {}) {
    const originalLocation = global.location;
    const originalFetch = global.fetch;
    const originalSupabaseClient = global.supabaseClient;
    const originalAdminAccess = global.AdminAccess;

    if (Object.prototype.hasOwnProperty.call(overrides, 'location')) {
        global.location = overrides.location;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'fetch')) {
        global.fetch = overrides.fetch;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'supabaseClient')) {
        global.supabaseClient = overrides.supabaseClient;
    }

    delete require.cache[adminAccessPath];
    const api = require(adminAccessPath);

    return {
        api,
        restore() {
            delete require.cache[adminAccessPath];
            restoreGlobalProperty('location', originalLocation);
            restoreGlobalProperty('fetch', originalFetch);
            restoreGlobalProperty('supabaseClient', originalSupabaseClient);
            restoreGlobalProperty('AdminAccess', originalAdminAccess);
        }
    };
}

test('openAdminStudio immediately redirects through the admin entry trampoline', async () => {
    const location = {
        href: 'https://www.zaoyoe.com/prompts.html'
    };

    const { api, restore } = loadAdminAccess({
        location,
        fetch() {
            throw new Error('openAdminStudio should not fetch before redirecting');
        },
        supabaseClient: {
            auth: {
                getSession() {
                    throw new Error('openAdminStudio should not read the Supabase session before redirecting');
                }
            }
        }
    });

    try {
        const result = await api.openAdminStudio('admin-studio.html');
        const redirectedUrl = new URL(location.href, 'https://www.zaoyoe.com');

        assert.equal(result, true);
        assert.equal(redirectedUrl.pathname, '/admin-entry.html');
        assert.equal(redirectedUrl.searchParams.get('next'), '/admin-studio.html');
    } finally {
        restore();
    }
});
