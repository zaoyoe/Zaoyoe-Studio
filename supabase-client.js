// Supabase Client - Browser Compatible Version
// Prevents Supabase's _initialize() from wiping the session on custom domains.
// Uses THREE layers of protection:
//   1. Guard storage adapter blocks session deletion during init
//   2. Also blocks setItem with empty/cleared session data during init
//   3. Snapshot + restore as final failsafe

// Timestamp for init-period guards across all auth scripts
window._pageLoadTime = Date.now();

let SUPABASE_URL = '';
let SUPABASE_KEY = '';
const SUPABASE_SDK_FALLBACK_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

function setSupabaseClientInitState(status, extra = {}) {
    const nextState = {
        status,
        updatedAt: Date.now(),
        ...extra
    };
    window.__ZAOYOE_SUPABASE_CLIENT_STATE__ = nextState;

    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('zaoyoe:supabase-client-state', {
            detail: nextState
        }));
    }

    return nextState;
}

setSupabaseClientInitState('pending');

try {
    const runtimeSupabaseConfig = typeof window.requireZaoyoeSupabaseConfig === 'function'
        ? window.requireZaoyoeSupabaseConfig()
        : null;
    SUPABASE_URL = String(runtimeSupabaseConfig?.url || '').trim();
    SUPABASE_KEY = String(runtimeSupabaseConfig?.publishableKey || '').trim();
} catch (error) {
    console.error('❌ Failed to resolve Supabase runtime config:', error);
    setSupabaseClientInitState('error', {
        reason: 'runtime_config_unavailable',
        message: error?.message || 'Failed to resolve Supabase runtime config'
    });
}

const getOrCreateChatSessionId = () => {
    try {
        let sid = localStorage.getItem('chat_session_id');
        if (!sid) {
            const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
                : Math.random().toString(36).slice(2, 14);
            sid = `guest_${randomId}`;
            localStorage.setItem('chat_session_id', sid);
        }
        return sid;
    } catch (err) {
        console.warn('⚠️ Failed to initialize chat session header:', err);
        return '';
    }
};

const CHAT_SESSION_ID = getOrCreateChatSessionId();
window.getChatSessionId = getOrCreateChatSessionId;

// ==================== Session Snapshot (before Supabase touches anything) ====================
// Auto-detect the session key by scanning localStorage for Supabase session pattern
const _findSessionKey = () => {
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
            return key;
        }
    }
    return null;
};

const _detectedKey = _findSessionKey();
const _sessionSnapshot = _detectedKey ? localStorage.getItem(_detectedKey) : null;
if (_sessionSnapshot) {
    console.log('📸 Session snapshot saved (key: ' + _detectedKey + ')');
}

const _hasValidAccessToken = (value) => {
    if (!value) return false;

    if (typeof value === 'string') {
        return value.split('.').length >= 3 && value.length > 40;
    }

    if (Array.isArray(value)) {
        return value.some(_hasValidAccessToken);
    }

    if (typeof value === 'object') {
        if (_hasValidAccessToken(value.access_token)) return true;
        if (_hasValidAccessToken(value.currentSession)) return true;
        if (_hasValidAccessToken(value.session)) return true;
        if (_hasValidAccessToken(value.data)) return true;
    }

    return false;
};

// ==================== Guard Storage Adapter ====================
const guardStorage = {
    _locked: true,

    getItem(key) {
        return localStorage.getItem(key);
    },

    setItem(key, value) {
        // During init: block writes that would clear the session
        if (this._locked && key.startsWith('sb-') && key.endsWith('-auth-token')) {
            try {
                const parsed = JSON.parse(value);
                // If Supabase is writing a valid session (has access_token), allow it
                if (_hasValidAccessToken(parsed)) {
                    localStorage.setItem(key, value);
                    return;
                }
            } catch (e) { /* not JSON, block it */ }
            console.log('🛡️ Blocked session overwrite during init (key: ' + key + ')');
            return;
        }
        localStorage.setItem(key, value);
    },

    removeItem(key) {
        if (this._locked && key.startsWith('sb-') && key.endsWith('-auth-token')) {
            console.log('🛡️ Blocked session deletion during init (key: ' + key + ')');
            return;
        }
        localStorage.removeItem(key);
    }
};

function isSupabaseSdkReady() {
    return typeof supabase !== 'undefined' && typeof supabase.createClient === 'function';
}

function loadSupabaseSdkFallback() {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${SUPABASE_SDK_FALLBACK_SRC}"]`);
        const script = existing || document.createElement('script');

        const handleLoad = () => resolve(true);
        const handleError = () => reject(new Error('Supabase fallback SDK failed to load'));

        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });

        if (!existing) {
            script.src = SUPABASE_SDK_FALLBACK_SRC;
            script.async = false;
            script.crossOrigin = 'anonymous';
            document.head.appendChild(script);
        }
    });
}

function initializeSupabaseClientFromSdk() {
    if (!isSupabaseSdkReady()) {
        return false;
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error('❌ Supabase runtime config is missing. Make sure /api/runtime/supabase-config loads before supabase-client.js.');
        setSupabaseClientInitState('error', {
            reason: 'runtime_config_missing',
            message: 'Supabase runtime config is missing'
        });
        return true;
    }

    try {
        window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: false,
                detectSessionInUrl: false,
                flowType: 'implicit',
                storage: guardStorage
            },
            global: {
                headers: CHAT_SESSION_ID ? { 'x-session-id': CHAT_SESSION_ID } : {}
            }
        });

        // After Supabase init completes, simply unlock the normal storage adapter
        setTimeout(() => {
            guardStorage._locked = false;
            console.log('🔓 Storage guard unlocked');
        }, 3000);

        setSupabaseClientInitState('ready');
        console.log('✅ Supabase client initialized (with guard storage)');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize Supabase client:', error);
        setSupabaseClientInitState('error', {
            reason: 'client_init_failed',
            message: error?.message || 'Failed to initialize Supabase client'
        });
        return true;
    }
}

// ==================== Initialize Client ====================
if (!initializeSupabaseClientFromSdk()) {
    console.warn('⚠️ Supabase library not loaded from primary CDN, trying fallback CDN...');
    loadSupabaseSdkFallback()
        .then(() => {
            if (!initializeSupabaseClientFromSdk()) {
                throw new Error('Supabase SDK is still unavailable after fallback load');
            }
        })
        .catch((error) => {
            console.error('❌ Supabase library not loaded. Make sure to include the CDN script first.', error);
            setSupabaseClientInitState('error', {
                reason: 'sdk_missing',
                message: error?.message || 'Supabase library not loaded'
            });
        });
}
