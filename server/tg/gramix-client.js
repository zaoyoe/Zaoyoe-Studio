'use strict';

const DEFAULT_BASE_URL = 'https://api.gramix.io/api/v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const SUPPORTED_PREMIUM_DURATIONS = Object.freeze([3, 6, 12]);

class GramixConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GramixConfigurationError';
        this.code = 'gramix_configuration_error';
        this.retryable = false;
    }
}

class GramixApiError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'GramixApiError';
        this.code = details.code || 'gramix_api_error';
        this.statusCode = Number.isInteger(details.statusCode) ? details.statusCode : undefined;
        this.retryable = Boolean(details.retryable);
    }
}

function isDecimalString(value) {
    // Balances and prices are decimal strings in the Gramix contract. Do not
    // coerce JavaScript numbers: binary floating point would be lossy.
    return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim());
}

function assertDecimalString(value, field = 'amount') {
    if (!isDecimalString(value)) {
        throw new GramixApiError(`${field} must be a decimal string`, {
            code: 'gramix_invalid_decimal',
            retryable: false
        });
    }
    return value.trim();
}

function normalizeTimeout(value) {
    const timeout = Number(value);
    if (!Number.isFinite(timeout) || timeout < 250 || timeout > 120_000) return DEFAULT_TIMEOUT_MS;
    return Math.floor(timeout);
}

function normalizeBaseUrl(value) {
    const raw = String(value ?? '').trim() || DEFAULT_BASE_URL;
    if (raw.length > 512) throw new GramixConfigurationError('Gramix base URL is invalid');
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        throw new GramixConfigurationError('Gramix base URL is invalid');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new GramixConfigurationError('Gramix base URL must be an HTTPS URL without credentials, query, or fragment');
    }
    return parsed.toString().replace(/\/$/, '');
}

function normalizeApiKey(value) {
    const raw = String(value ?? '');
    const key = raw.trim();
    if (!key) throw new GramixConfigurationError('Gramix API key is not configured');
    if (raw.length > 512 || /[\r\n]/.test(raw)) throw new GramixConfigurationError('Gramix API key is invalid');
    return key;
}

function normalizeIdempotencyKey(value) {
    const key = String(value ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
        throw new GramixApiError('A provider idempotency key is required', {
            code: 'gramix_invalid_idempotency_key',
            retryable: false
        });
    }
    return key;
}

function normalizeDuration(value) {
    const duration = Number(value);
    if (!Number.isInteger(duration) || !SUPPORTED_PREMIUM_DURATIONS.includes(duration)) {
        throw new GramixApiError('Premium duration must be 3, 6, or 12 months', {
            code: 'gramix_invalid_premium_duration',
            retryable: false
        });
    }
    return duration;
}

function normalizeRecipient(value) {
    const recipientName = String(value ?? '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[A-Za-z0-9_]{5,32}$/.test(recipientName)) {
        throw new GramixApiError('Telegram recipient username is invalid', {
            code: 'gramix_invalid_recipient',
            retryable: false
        });
    }
    return recipientName;
}

function retryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

class GramixClient {
    constructor(options = {}) {
        const env = options.env || process.env;
        this.baseUrl = normalizeBaseUrl(options.baseUrl || env.GRAMIX_API_BASE_URL);
        this.apiKey = normalizeApiKey(options.apiKey || env.GRAMIX_API_KEY);
        this.timeoutMs = normalizeTimeout(options.timeoutMs ?? env.GRAMIX_API_TIMEOUT_MS);
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        if (typeof this.fetchImpl !== 'function') {
            throw new GramixConfigurationError('A fetch implementation is required');
        }
    }

    async request(path, { method = 'GET', body, idempotencyKey, timeoutMs, expectedStatus = 200 } = {}) {
        const endpoint = `${this.baseUrl}/${String(path).replace(/^\/+/, '')}`;
        const headers = {
            Accept: 'application/json',
            'x-api-key': this.apiKey
        };
        let serializedBody;
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            serializedBody = JSON.stringify(body);
        }
        if (idempotencyKey !== undefined) headers['idempotency-key'] = normalizeIdempotencyKey(idempotencyKey);

        const controller = new AbortController();
        const duration = normalizeTimeout(timeoutMs ?? this.timeoutMs);
        let timer;
        const timeoutPromise = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(new GramixApiError('Gramix request timed out', { code: 'gramix_timeout', retryable: true }));
            }, duration);
        });
        try {
            // The timeout covers both the connection and full JSON body read;
            // the race still stops work if a custom fetch ignores AbortSignal.
            return await Promise.race([timeoutPromise, (async () => {
                const response = await this.fetchImpl(endpoint, {
                    method,
                    headers,
                    body: serializedBody,
                    signal: controller.signal,
                    redirect: 'error'
                });
                const status = Number(response?.status || 0);
                const ok = response?.ok === true || (response?.ok === undefined && status >= 200 && status < 300);
                if (!ok) {
                    // Provider error bodies may contain credentials or personal
                    // data. Keep only the HTTP status, never their message/cause.
                    controller.abort();
                    throw new GramixApiError('Gramix request was rejected', {
                        code: 'gramix_http_error', statusCode: status || 502,
                        retryable: retryableStatus(status)
                    });
                }
                let payload;
                try { payload = await response.json(); } catch (_) {
                    throw new GramixApiError('Gramix response is invalid', { code: 'gramix_invalid_response', retryable: true });
                }
                if (status !== expectedStatus || !payload || typeof payload !== 'object' || Array.isArray(payload)
                    || payload.statusCode !== status || !payload.data || typeof payload.data !== 'object') {
                    throw new GramixApiError('Gramix response is invalid', { code: 'gramix_invalid_response', retryable: true });
                }
                return payload;
            })()]);
        } catch (error) {
            if (error instanceof GramixApiError) throw error;
            const timedOut = error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
            throw new GramixApiError(timedOut ? 'Gramix request timed out' : 'Gramix request failed', {
                code: timedOut ? 'gramix_timeout' : 'gramix_network_error',
                retryable: true
            });
        } finally {
            if (timer) clearTimeout(timer);
        }

    }

    async getBalance(options = {}) {
        const payload = await this.request('/wallets/balance', options);
        assertDecimalString(payload.data.gram, 'gram balance');
        assertDecimalString(payload.data.usdt, 'usdt balance');
        return payload;
    }

    async createDeposit(options = {}) {
        // Official contract: POST with no request body, not an amount transfer.
        const payload = await this.request('/wallets/balance', { ...options, method: 'POST', body: undefined, expectedStatus: 201 });
        if (typeof payload.data.address !== 'string' || !payload.data.address
            || typeof payload.data.memo !== 'string' || !payload.data.memo) {
            throw new GramixApiError('Gramix deposit response is invalid', { code: 'gramix_invalid_response' });
        }
        return payload;
    }

    async purchasePremium({ recipientName, username, duration, paymentCurrency = 'usdt', idempotencyKey } = {}) {
        const normalizedRecipient = normalizeRecipient(recipientName ?? username);
        const normalizedDuration = normalizeDuration(duration);
        const currency = String(paymentCurrency);
        if (!['gram', 'usdt'].includes(currency)) {
            throw new GramixApiError('Payment currency is invalid', { code: 'gramix_invalid_currency' });
        }
        const payload = {
            recipientName: normalizedRecipient,
            paymentCurrency: currency
        };
        return this.request(`/purchase/premium/${normalizedDuration}`, {
            method: 'POST',
            body: payload,
            idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
            expectedStatus: 201
        });
    }

    async purchaseStars({ recipientName, username, stars, paymentCurrency = 'usdt', idempotencyKey } = {}) {
        if (!Number.isInteger(stars) || stars < 50 || stars > 1_000_000) {
            throw new GramixApiError('Stars quantity must be an integer from 50 to 1000000', { code: 'gramix_invalid_stars_quantity' });
        }
        if (!['gram', 'usdt'].includes(paymentCurrency)) {
            throw new GramixApiError('Payment currency is invalid', { code: 'gramix_invalid_currency' });
        }
        return this.request('/purchase/stars', {
            method: 'POST',
            body: { recipientName: normalizeRecipient(recipientName ?? username), paymentCurrency, stars },
            idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
            expectedStatus: 201
        });
    }

    async getOrder(orderId, options = {}) {
        const id = String(orderId ?? '').trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            throw new GramixApiError('Provider order id is invalid', { code: 'gramix_invalid_order_id' });
        }
        return this.request(`/orders/${encodeURIComponent(id)}`, options);
    }

    async listOrders({ limit = 100, offset = 0, ...options } = {}) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
            throw new GramixApiError('Order pagination is invalid', { code: 'gramix_invalid_pagination' });
        }
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        const suffix = params.toString() ? `?${params}` : '';
        return this.request(`/orders${suffix}`, options);
    }
}

function createGramixClient(options) {
    return new GramixClient(options);
}

module.exports = {
    GramixClient,
    GramixApiError,
    GramixConfigurationError,
    SUPPORTED_PREMIUM_DURATIONS,
    assertDecimalString,
    createGramixClient,
    isDecimalString,
    normalizeDuration,
    normalizeIdempotencyKey,
    normalizeRecipient
};
