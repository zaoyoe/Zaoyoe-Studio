const COOKIE_NAME = 'zaoyoe_admin_studio';
const DEFAULT_TTL_SECONDS = 10 * 60;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function getRuntimeBuffer() {
    return typeof Buffer !== 'undefined' ? Buffer : null;
}

function bytesToBase64(bytes) {
    const RuntimeBuffer = getRuntimeBuffer();
    if (RuntimeBuffer) {
        return RuntimeBuffer.from(bytes).toString('base64');
    }

    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

function base64ToBytes(base64Value) {
    const RuntimeBuffer = getRuntimeBuffer();
    if (RuntimeBuffer) {
        return new Uint8Array(RuntimeBuffer.from(base64Value, 'base64'));
    }

    const binary = atob(base64Value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function base64UrlEncode(input) {
    const bytes = input instanceof Uint8Array ? input : textEncoder.encode(String(input || ''));
    return bytesToBase64(bytes)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function base64UrlDecode(base64UrlValue) {
    const padded = String(base64UrlValue || '')
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(String(base64UrlValue || '').length / 4) * 4, '=');
    return base64ToBytes(padded);
}

function constantTimeEquals(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    if (left.length !== right.length) return false;

    let diff = 0;
    for (let index = 0; index < left.length; index += 1) {
        diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return diff === 0;
}

export function getAdminStudioAccessSecret() {
    const fromEnv = process.env.ADMIN_STUDIO_ACCESS_SECRET || process.env.ADMIN_CONFIG_ENCRYPTION_KEY || '';
    if (fromEnv) return fromEnv;

    if (shouldAllowLocalDevAdminStudioSecret()) {
        return 'local-dev-admin-studio-access-secret';
    }

    throw new Error('Missing required environment variable: ADMIN_STUDIO_ACCESS_SECRET or ADMIN_CONFIG_ENCRYPTION_KEY');
}

function isTruthyFlag(value) {
    if (value === true) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function isProductionLikeRuntime() {
    const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
    const vercelEnv = String(process.env.VERCEL_ENV || '').trim().toLowerCase();
    const railwayEnv = String(process.env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase();
    const deploymentTier = String(process.env.DEPLOYMENT_TIER || process.env.APP_ENV || '').trim().toLowerCase();

    return nodeEnv === 'production'
        || vercelEnv === 'production'
        || railwayEnv === 'production'
        || deploymentTier === 'production';
}

function hostLooksPublic(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return false;

    try {
        const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
        const hostname = parsed.hostname;
        return hostname === 'fatherkey.com'
            || hostname === 'www.fatherkey.com'
            || hostname === 'zaoyoe.com'
            || hostname === 'www.zaoyoe.com'
            || hostname === 'zaoyoe.xyz'
            || hostname === 'www.zaoyoe.xyz'
            || hostname.endsWith('.vercel.app')
            || hostname.endsWith('.up.railway.app');
    } catch (_) {
        return raw.includes('fatherkey.com')
            || raw.includes('zaoyoe.com')
            || raw.includes('zaoyoe.xyz')
            || raw.includes('vercel.app')
            || raw.includes('up.railway.app');
    }
}

function shouldAllowLocalDevAdminStudioSecret() {
    if (isProductionLikeRuntime()) return false;

    const vercelEnv = String(process.env.VERCEL_ENV || '').trim();
    const railwayEnv = String(process.env.RAILWAY_ENVIRONMENT_NAME || '').trim();
    const publicHost = hostLooksPublic(process.env.APP_BASE_URL)
        || hostLooksPublic(process.env.VERCEL_URL)
        || hostLooksPublic(process.env.RAILWAY_PUBLIC_DOMAIN);

    if (publicHost) return false;

    if (!vercelEnv && !railwayEnv) {
        return String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production';
    }

    return isTruthyFlag(process.env.ALLOW_LOCAL_ADMIN_STUDIO_ACCESS_SECRET);
}

export function getAdminStudioCookieName() {
    return COOKIE_NAME;
}

export function getAdminStudioTtlSeconds() {
    const raw = Number.parseInt(process.env.ADMIN_STUDIO_ACCESS_TTL_SECONDS || '', 10);
    if (!Number.isFinite(raw)) return DEFAULT_TTL_SECONDS;
    return Math.min(Math.max(raw, 60), 60 * 60);
}

async function signPayload(encodedPayload, secret) {
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, textEncoder.encode(encodedPayload));
    return base64UrlEncode(new Uint8Array(signature));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validPayload(payload) {
    const now = Math.floor(Date.now() / 1000);
    return payload && typeof payload === 'object' && !Array.isArray(payload)
        && payload.v === 2 && payload.scope === 'admin-studio'
        && typeof payload.sub === 'string' && UUID_PATTERN.test(payload.sub)
        && typeof payload.sid === 'string' && UUID_PATTERN.test(payload.sid)
        && Number.isSafeInteger(payload.iat) && payload.iat <= now + 5
        && Number.isSafeInteger(payload.exp) && payload.exp > now
        && payload.exp > payload.iat && payload.exp - payload.iat <= 3600;
}

export async function issueAdminStudioToken(payload = {}) {
    const iat = Math.floor(Date.now() / 1000);
    const normalizedPayload = {
        v: 2, scope: 'admin-studio', sub: payload.sub, sid: payload.sid,
        iat, exp: payload.exp ?? (iat + getAdminStudioTtlSeconds())
    };
    if (!validPayload(normalizedPayload)) throw new Error('Invalid admin studio session payload');
    const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(normalizedPayload)));
    const signature = await signPayload(encodedPayload, getAdminStudioAccessSecret());
    return `${encodedPayload}.${signature}`;
}

export async function verifyAdminStudioToken(token) {
    if (typeof token !== 'string' || token.length > 2048
        || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const [encodedPayload, providedSignature] = token.split('.');
    const expectedSignature = await signPayload(encodedPayload, getAdminStudioAccessSecret());
    if (!constantTimeEquals(expectedSignature, providedSignature)) return null;
    try {
        const payload = JSON.parse(textDecoder.decode(base64UrlDecode(encodedPayload)));
        return validPayload(payload) ? payload : null;
    } catch (_) { return null; }
}

export function buildAdminStudioSetCookie(token, options = {}) {
    const maxAge = Number.parseInt(options.maxAge || `${getAdminStudioTtlSeconds()}`, 10);
    const directives = [
        `${COOKIE_NAME}=${encodeURIComponent(String(token || ''))}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${Number.isFinite(maxAge) ? maxAge : getAdminStudioTtlSeconds()}`
    ];

    if (options.secure !== false) {
        directives.splice(3, 0, 'Secure');
    }

    return directives.join('; ');
}

export function buildClearAdminStudioCookie(options = {}) {
    const directives = [
        `${COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        'Max-Age=0',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    ];

    if (options.secure !== false) {
        directives.splice(3, 0, 'Secure');
    }

    return directives.join('; ');
}
