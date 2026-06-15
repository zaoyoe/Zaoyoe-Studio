/**
 * 💰 Points Service - Commercial Points System
 * A simple, robust implementation for managing user points.
 */
(function () {
    'use strict';

    // Wait for supabaseClient to be available
    const supabase = window.supabaseClient;
    if (!supabase) {
        console.error('[PointsService] ❌ Supabase client not found!');
        return;
    }

    console.log('[PointsService] ✅ Initializing...');

    function normalizePointValue(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : fallback;
    }

    const WALLET_DISCOUNT_ASSETS_CACHE_TTL_MS = 30_000;
    const WALLET_SHOP_ORDER_DETAIL_CACHE_TTL_MS = 60_000;
    const WALLET_AUTH_TOKEN_REFRESH_SKEW_SECONDS = 60;
    const WALLET_AUTH_RESOLVE_TIMEOUT_MS = 4_000;

    function buildPaymentCreateDedupeKey(payload = {}) {
        const normalizedPayload = {
            provider_key: String(payload.provider_key || '').trim().toLowerCase(),
            package_id: String(payload.package_id || '').trim(),
            package_name: String(payload.package_name || '').trim(),
            points_amount: normalizePointValue(payload.points_amount, 0),
            paid_amount: Number.isFinite(Number(payload.paid_amount))
                ? Math.round(Number(payload.paid_amount) * 100) / 100
                : null,
            site: String(payload.site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn'
        };
        return JSON.stringify(normalizedPayload);
    }

    function buildPaymentCreateRequestId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return `pay_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    }

    function isUnsafeDirectRechargeAllowed() {
        const host = String(window.location.hostname || '').toLowerCase();
        return host === 'localhost' || host === '127.0.0.1';
    }

    function resolveWithTimeout(factory, timeoutMs = WALLET_AUTH_RESOLVE_TIMEOUT_MS, fallback = null) {
        let timeoutId = 0;
        return Promise.race([
            Promise.resolve().then(factory),
            new Promise((resolve) => {
                timeoutId = window.setTimeout(() => resolve(fallback), timeoutMs);
            })
        ]).catch(() => fallback).finally(() => {
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        });
    }

    function decodeJwtPayload(token = '') {
        const raw = String(token || '').trim();
        if (!raw || raw.split('.').length < 2) {
            return null;
        }

        try {
            const encoded = raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = encoded + '='.repeat((4 - (encoded.length % 4)) % 4);
            const decode = typeof window.atob === 'function'
                ? window.atob.bind(window)
                : (typeof atob === 'function' ? atob : null);
            if (!decode) {
                return null;
            }
            return JSON.parse(decode(padded));
        } catch (_) {
            return null;
        }
    }

    function isUsableAccessToken(token = '') {
        const raw = String(token || '').trim();
        if (!raw) {
            return false;
        }

        const payload = decodeJwtPayload(raw);
        if (!payload?.exp) {
            return raw.split('.').length >= 3 && raw.length > 40;
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        return Number(payload.exp) > (nowSeconds + WALLET_AUTH_TOKEN_REFRESH_SKEW_SECONDS);
    }

    function normalizeSessionCandidate(value = null) {
        if (!value || typeof value !== 'object') {
            return null;
        }
        return value.currentSession || value.session || value;
    }

    function getSessionAccessToken(session = null) {
        return String(session?.access_token || '').trim();
    }

    function getSessionUserId(session = null) {
        const directUserId = String(session?.user?.id || session?.user_id || '').trim();
        if (directUserId) {
            return directUserId;
        }

        const payload = decodeJwtPayload(getSessionAccessToken(session));
        return String(payload?.sub || '').trim();
    }

    function readPersistedSupabaseSession() {
        try {
            const storage = window.localStorage;
            if (!storage) {
                return null;
            }

            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) {
                    continue;
                }

                const raw = storage.getItem(key);
                if (!raw) {
                    continue;
                }

                const session = normalizeSessionCandidate(JSON.parse(raw));
                if (getSessionAccessToken(session)) {
                    return session;
                }
            }
        } catch (_) {
            return null;
        }

        return null;
    }

    async function refreshSupabaseSession(session = null) {
        const refreshToken = String(session?.refresh_token || '').trim();
        if (!refreshToken || typeof supabase.auth?.refreshSession !== 'function') {
            return null;
        }

        const result = await resolveWithTimeout(
            () => supabase.auth.refreshSession({ refresh_token: refreshToken }),
            WALLET_AUTH_RESOLVE_TIMEOUT_MS,
            null
        );
        const refreshedSession = result?.data?.session || null;
        return isUsableAccessToken(getSessionAccessToken(refreshedSession)) ? refreshedSession : null;
    }

    function isSimulatedPaymentAllowed(options = {}) {
        return options?.allowSimulatedPayment === true || isUnsafeDirectRechargeAllowed();
    }

    function cloneWalletDiscountAssetsPayload(payload = {}) {
        const normalizedPayload = {
            ...payload,
            summary: payload?.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
                ? { ...payload.summary }
                : {},
            available_assets: Array.isArray(payload?.available_assets) ? payload.available_assets : [],
            used_assets: Array.isArray(payload?.used_assets) ? payload.used_assets : [],
            inactive_assets: Array.isArray(payload?.inactive_assets) ? payload.inactive_assets : []
        };

        try {
            return JSON.parse(JSON.stringify(normalizedPayload));
        } catch (error) {
            console.warn('[PointsService] Failed to clone wallet discount assets payload:', error);
            return normalizedPayload;
        }
    }

    function cloneWalletShopOrderDetailPayload(payload = null) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return null;
        }

        try {
            return JSON.parse(JSON.stringify(payload));
        } catch (error) {
            console.warn('[PointsService] Failed to clone wallet shop order detail payload:', error);
            return payload;
        }
    }

    const PointsService = {
        // Cached session to avoid redundant getSession() calls
        _cachedUserId: null,
        _walletOverviewCache: null,
        _walletOverviewCacheSite: '',
        _walletOverviewCacheLimit: 0,
        _walletOverviewCacheAt: 0,
        _walletOverviewPromise: null,
        _walletOverviewPromiseSite: '',
        _discountAssetsCache: new Map(),
        _discountAssetsPromises: new Map(),
        _shopOrderDetailCache: new Map(),
        _shopOrderDetailPromises: new Map(),
        isUnsafeDirectRechargeAllowed,

        clearWalletReadCaches() {
            this._walletOverviewCache = null;
            this._walletOverviewCacheSite = '';
            this._walletOverviewCacheLimit = 0;
            this._walletOverviewCacheAt = 0;
            this._walletOverviewPromise = null;
            this._walletOverviewPromiseSite = '';

            if (this._discountAssetsCache instanceof Map) {
                this._discountAssetsCache.clear();
            } else {
                this._discountAssetsCache = new Map();
            }

            if (this._discountAssetsPromises instanceof Map) {
                this._discountAssetsPromises.clear();
            } else {
                this._discountAssetsPromises = new Map();
            }

            if (this._shopOrderDetailCache instanceof Map) {
                this._shopOrderDetailCache.clear();
            } else {
                this._shopOrderDetailCache = new Map();
            }

            if (this._shopOrderDetailPromises instanceof Map) {
                this._shopOrderDetailPromises.clear();
            } else {
                this._shopOrderDetailPromises = new Map();
            }
        },

        async _getSessionContext() {
            const sessionResult = await resolveWithTimeout(
                () => supabase.auth.getSession(),
                WALLET_AUTH_RESOLVE_TIMEOUT_MS,
                null
            );
            let session = sessionResult?.data?.session || null;
            const persistedSession = readPersistedSupabaseSession();
            let accessToken = getSessionAccessToken(session);
            let userId = getSessionUserId(session);

            if (!isUsableAccessToken(accessToken)) {
                const refreshedSession = await refreshSupabaseSession(session || persistedSession);
                if (refreshedSession) {
                    session = refreshedSession;
                    accessToken = getSessionAccessToken(refreshedSession);
                    userId = getSessionUserId(refreshedSession);
                }
            }

            if (!isUsableAccessToken(accessToken) && typeof supabase.accessToken === 'function') {
                const runtimeAccessToken = String(await resolveWithTimeout(
                    () => supabase.accessToken(),
                    WALLET_AUTH_RESOLVE_TIMEOUT_MS,
                    ''
                ) || '').trim();
                if (isUsableAccessToken(runtimeAccessToken)) {
                    accessToken = runtimeAccessToken;
                    userId = userId || getSessionUserId(persistedSession) || String(decodeJwtPayload(runtimeAccessToken)?.sub || '').trim();
                }
            }

            if (!isUsableAccessToken(accessToken) && persistedSession) {
                const persistedAccessToken = getSessionAccessToken(persistedSession);
                if (isUsableAccessToken(persistedAccessToken)) {
                    session = session || persistedSession;
                    accessToken = persistedAccessToken;
                    userId = userId || getSessionUserId(persistedSession);
                }
            }

            if (!isUsableAccessToken(accessToken)) {
                accessToken = '';
                userId = '';
            }

            const nextUserId = userId || null;

            if (nextUserId !== this._cachedUserId) {
                this.clearWalletReadCaches();
            }

            this._cachedUserId = nextUserId;

            return {
                session,
                accessToken,
                userId: nextUserId
            };
        },

        async _getAccessToken() {
            const { accessToken } = await this._getSessionContext();
            return accessToken;
        },

        async _getUserId() {
            const { userId } = await this._getSessionContext();
            return userId;
        },

        async _fetchWalletJson(path, query = {}) {
            return this._requestWalletJson(path, {
                method: 'GET',
                query
            });
        },

        async _postWalletJson(path, body = {}, query = {}) {
            return this._requestWalletJson(path, {
                method: 'POST',
                query,
                body
            });
        },

        async _requestWalletJson(path, { method = 'GET', query = {}, body = null } = {}) {
            const token = await this._getAccessToken();
            if (!token) throw new Error('请先登录');

            const params = new URLSearchParams();
            Object.entries(query || {}).forEach(([key, value]) => {
                if (value === null || value === undefined || value === '') return;
                params.set(key, String(value));
            });

            const response = await fetch(`${path}${params.toString() ? `?${params.toString()}` : ''}`, {
                method,
                headers: {
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    Authorization: `Bearer ${token}`
                },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.message || '钱包数据加载失败');
            }
            return payload;
        },

        async _getWalletOverview({ historyLimit = 20, force = false, site = '' } = {}) {
            const normalizedLimit = Math.max(1, Math.min(100, Number(historyLimit || 20) || 20));
            const currentSite = String(site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn';
            const now = Date.now();
            if (
                !force
                && this._walletOverviewCache
                && this._walletOverviewCacheSite === currentSite
                && this._walletOverviewCacheLimit >= normalizedLimit
                && (now - this._walletOverviewCacheAt) < 10_000
            ) {
                return this._walletOverviewCache;
            }

            if (!force && this._walletOverviewPromise && this._walletOverviewPromiseSite === currentSite) {
                return this._walletOverviewPromise;
            }

            this._walletOverviewPromise = this._fetchWalletJson('/api/wallet/overview', {
                site: currentSite,
                history_limit: normalizedLimit
            }).then((payload) => {
                this._walletOverviewCache = payload;
                this._walletOverviewCacheSite = currentSite;
                this._walletOverviewCacheLimit = normalizedLimit;
                this._walletOverviewCacheAt = Date.now();
                return payload;
            }).finally(() => {
                this._walletOverviewPromise = null;
                this._walletOverviewPromiseSite = '';
            });
            this._walletOverviewPromiseSite = currentSite;

            return this._walletOverviewPromise;
        },

        peekWalletOverview({ historyLimit = 20, site = '' } = {}) {
            const normalizedLimit = Math.max(1, Math.min(100, Number(historyLimit || 20) || 20));
            const currentSite = String(site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn';
            const now = Date.now();
            if (
                this._walletOverviewCache
                && this._walletOverviewCacheSite === currentSite
                && this._walletOverviewCacheLimit >= normalizedLimit
                && (now - this._walletOverviewCacheAt) < 10_000
            ) {
                return this._walletOverviewCache;
            }
            return null;
        },

        _normalizeWalletBalancePayload(overview = {}) {
            const data = overview?.balance || {};

            return {
                paid_balance: normalizePointValue(data.paid_balance),
                bonus_balance: normalizePointValue(data.bonus_balance),
                total_balance: normalizePointValue(data.total_balance),
                site: overview?.site || window.SiteConfig?.site || 'cn',
                current_site_has_account: overview?.current_site_has_account === true,
                other_site_balances: [],
                _load_failed: false,
                error_message: ''
            };
        },

        peekWalletBalance({ site = '' } = {}) {
            const overview = this.peekWalletOverview({ historyLimit: 20, site });
            if (!overview) {
                return null;
            }

            return this._normalizeWalletBalancePayload(overview);
        },

        buildWalletDiscountAssetsCacheKey({ site = '', userId = '' } = {}) {
            const normalizedSite = String(site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn';
            const normalizedUserId = String(userId || '').trim();
            if (!normalizedUserId) {
                return '';
            }
            return `${normalizedSite}::${normalizedUserId}`;
        },

        readWalletDiscountAssetsCache({ site = '', userId = this._cachedUserId } = {}) {
            const cacheKey = this.buildWalletDiscountAssetsCacheKey({ site, userId });
            if (!cacheKey || !(this._discountAssetsCache instanceof Map)) {
                return null;
            }

            const cachedEntry = this._discountAssetsCache.get(cacheKey);
            if (!cachedEntry) {
                return null;
            }

            const ageMs = Math.max(0, Date.now() - Number(cachedEntry.timestamp || 0));
            if (ageMs > WALLET_DISCOUNT_ASSETS_CACHE_TTL_MS) {
                this._discountAssetsCache.delete(cacheKey);
                return null;
            }

            return cloneWalletDiscountAssetsPayload(cachedEntry.payload || {});
        },

        writeWalletDiscountAssetsCache({ site = '', userId = this._cachedUserId } = {}, payload = {}) {
            const cacheKey = this.buildWalletDiscountAssetsCacheKey({ site, userId });
            if (!cacheKey) {
                return;
            }

            if (!(this._discountAssetsCache instanceof Map)) {
                this._discountAssetsCache = new Map();
            }

            this._discountAssetsCache.set(cacheKey, {
                timestamp: Date.now(),
                payload: cloneWalletDiscountAssetsPayload(payload)
            });
        },

        peekWalletDiscountAssets({ site = '' } = {}) {
            return this.readWalletDiscountAssetsCache({ site, userId: this._cachedUserId });
        },

        invalidateWalletDiscountAssets({ site = '', userId = this._cachedUserId } = {}) {
            if (!(this._discountAssetsCache instanceof Map)) {
                this._discountAssetsCache = new Map();
            }

            const cacheKey = this.buildWalletDiscountAssetsCacheKey({ site, userId });
            if (cacheKey) {
                this._discountAssetsCache.delete(cacheKey);
            }

            if (!(this._discountAssetsPromises instanceof Map)) {
                this._discountAssetsPromises = new Map();
            }

            if (cacheKey) {
                this._discountAssetsPromises.delete(cacheKey);
            }
        },

        async getWalletDiscountAssets({ site = '', force = false } = {}) {
            const currentSite = String(site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn';
            const { userId } = await this._getSessionContext();
            if (!userId) {
                throw new Error('请先登录');
            }

            const cacheKey = this.buildWalletDiscountAssetsCacheKey({
                site: currentSite,
                userId
            });

            if (!force) {
                const cachedPayload = this.readWalletDiscountAssetsCache({
                    site: currentSite,
                    userId
                });
                if (cachedPayload) {
                    return cachedPayload;
                }
            }

            if (!force && this._discountAssetsPromises instanceof Map && this._discountAssetsPromises.has(cacheKey)) {
                return cloneWalletDiscountAssetsPayload(await this._discountAssetsPromises.get(cacheKey));
            }

            const request = this._postWalletJson('/api/shop/my-discount-assets', {
                site: currentSite
            }).then((payload) => {
                const normalizedPayload = cloneWalletDiscountAssetsPayload(payload);
                this.writeWalletDiscountAssetsCache({
                    site: currentSite,
                    userId
                }, normalizedPayload);
                return normalizedPayload;
            }).finally(() => {
                if (this._discountAssetsPromises instanceof Map) {
                    this._discountAssetsPromises.delete(cacheKey);
                }
            });

            if (!(this._discountAssetsPromises instanceof Map)) {
                this._discountAssetsPromises = new Map();
            }
            this._discountAssetsPromises.set(cacheKey, request);

            return cloneWalletDiscountAssetsPayload(await request);
        },

        buildWalletShopOrderDetailCacheKey({ orderId = '', userId = '', site = '' } = {}) {
            const normalizedOrderId = String(orderId || '').trim();
            const normalizedUserId = String(userId || '').trim();
            const normalizedSite = String(site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn';
            if (!normalizedOrderId || !normalizedUserId) {
                return '';
            }
            return `${normalizedSite}::${normalizedUserId}::${normalizedOrderId}`;
        },

        readWalletShopOrderDetailCache({ orderId = '', userId = this._cachedUserId, site = '' } = {}) {
            const cacheKey = this.buildWalletShopOrderDetailCacheKey({ orderId, userId, site });
            if (!cacheKey || !(this._shopOrderDetailCache instanceof Map)) {
                return null;
            }

            const cachedEntry = this._shopOrderDetailCache.get(cacheKey);
            if (!cachedEntry) {
                return null;
            }

            const ageMs = Math.max(0, Date.now() - Number(cachedEntry.timestamp || 0));
            if (ageMs > WALLET_SHOP_ORDER_DETAIL_CACHE_TTL_MS) {
                this._shopOrderDetailCache.delete(cacheKey);
                return null;
            }

            return cloneWalletShopOrderDetailPayload(cachedEntry.payload || null);
        },

        writeWalletShopOrderDetailCache({ orderId = '', userId = this._cachedUserId, site = '' } = {}, payload = null) {
            const cacheKey = this.buildWalletShopOrderDetailCacheKey({ orderId, userId, site });
            if (!cacheKey || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
                return;
            }

            if (!(this._shopOrderDetailCache instanceof Map)) {
                this._shopOrderDetailCache = new Map();
            }

            this._shopOrderDetailCache.set(cacheKey, {
                timestamp: Date.now(),
                payload: cloneWalletShopOrderDetailPayload(payload)
            });
        },

        peekWalletShopOrderDetail({ orderId = '' } = {}) {
            const site = arguments[0]?.site || '';
            return this.readWalletShopOrderDetailCache({ orderId, userId: this._cachedUserId, site });
        },

        invalidateWalletShopOrderDetail({ orderId = '', userId = this._cachedUserId, site = '' } = {}) {
            if (!(this._shopOrderDetailCache instanceof Map)) {
                this._shopOrderDetailCache = new Map();
            }

            const cacheKey = this.buildWalletShopOrderDetailCacheKey({ orderId, userId, site });
            if (cacheKey) {
                this._shopOrderDetailCache.delete(cacheKey);
            }

            if (!(this._shopOrderDetailPromises instanceof Map)) {
                this._shopOrderDetailPromises = new Map();
            }

            if (cacheKey) {
                this._shopOrderDetailPromises.delete(cacheKey);
            }
        },

        async getWalletShopOrderDetail({ orderId = '', force = false } = {}) {
            const site = arguments[0]?.site || '';
            const normalizedOrderId = String(orderId || '').trim();
            const currentSite = String(site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn';
            if (!normalizedOrderId) {
                throw new Error('缺少订单号');
            }

            const { userId } = await this._getSessionContext();
            if (!userId) {
                throw new Error('请先登录');
            }

            const cacheKey = this.buildWalletShopOrderDetailCacheKey({
                orderId: normalizedOrderId,
                userId,
                site: currentSite
            });

            if (!force) {
                const cachedPayload = this.readWalletShopOrderDetailCache({
                    orderId: normalizedOrderId,
                    userId,
                    site: currentSite
                });
                if (cachedPayload) {
                    return cachedPayload;
                }
            }

            if (!force && this._shopOrderDetailPromises instanceof Map && this._shopOrderDetailPromises.has(cacheKey)) {
                return cloneWalletShopOrderDetailPayload(await this._shopOrderDetailPromises.get(cacheKey));
            }

            const request = this._postWalletJson('/api/wallet/order-detail', {
                orderId: normalizedOrderId,
                site: currentSite
            }).then((payload) => {
                const normalizedPayload = cloneWalletShopOrderDetailPayload(
                    payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
                        ? payload.data
                        : null
                );
                if (!normalizedPayload?.order) {
                    throw new Error('加载订单详情失败');
                }

                this.writeWalletShopOrderDetailCache({
                    orderId: normalizedOrderId,
                    userId,
                    site: currentSite
                }, normalizedPayload);
                return normalizedPayload;
            }).finally(() => {
                if (this._shopOrderDetailPromises instanceof Map) {
                    this._shopOrderDetailPromises.delete(cacheKey);
                }
            });

            if (!(this._shopOrderDetailPromises instanceof Map)) {
                this._shopOrderDetailPromises = new Map();
            }
            this._shopOrderDetailPromises.set(cacheKey, request);

            return cloneWalletShopOrderDetailPayload(await request);
        },

        async createPaymentRequest(payload = {}) {
            const dedupeKey = buildPaymentCreateDedupeKey(payload);
            if (!(this._paymentCreateRequestPromises instanceof Map)) {
                this._paymentCreateRequestPromises = new Map();
            }

            const existingRequest = this._paymentCreateRequestPromises.get(dedupeKey);
            if (existingRequest) {
                return existingRequest;
            }

            const request = (async () => {
                const token = await this._getAccessToken();
                if (!token) throw new Error('请先登录');

                const clientPaymentRequestId = String(
                    payload.client_payment_request_id
                    || payload.clientPaymentRequestId
                    || buildPaymentCreateRequestId()
                ).trim();
                const response = await fetch('/api/payments/create', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        ...payload,
                        client_payment_request_id: clientPaymentRequestId,
                        site: payload.site || window.SiteConfig?.site || 'cn'
                    })
                });

                const responsePayload = await response.json().catch(() => ({}));
                if (!response.ok || responsePayload?.success === false) {
                    const error = new Error(responsePayload?.message || '创建支付请求失败');
                    error.code = String(responsePayload?.code || responsePayload?.payment_error?.code || '').trim();
                    error.rawMessage = String(responsePayload?.raw_message || responsePayload?.payment_error?.raw_message || responsePayload?.message || '').trim();
                    error.payload = responsePayload || null;
                    error.paymentError = responsePayload?.payment_error || null;
                    throw error;
                }

                return responsePayload;
            })().finally(() => {
                if (this._paymentCreateRequestPromises instanceof Map) {
                    this._paymentCreateRequestPromises.delete(dedupeKey);
                }
            });

            this._paymentCreateRequestPromises.set(dedupeKey, request);
            return request;
        },

        async getPaymentRequestStatus(payload = {}) {
            const checkoutSessionId = String(payload?.checkout_session_id || '').trim();
            if (!checkoutSessionId) {
                throw new Error('缺少支付会话');
            }

            return this._postWalletJson('/api/payments/status', {
                checkout_session_id: checkoutSessionId,
                provider_order_no: String(payload?.provider_order_no || '').trim() || undefined,
                site: payload.site || window.SiteConfig?.site || 'cn',
                force_provider_refresh: payload?.force_provider_refresh === true
            });
        },

        /**
         * Get user's current balance
         */
        async getBalance(options = {}) {
            try {
                const userId = await this._getUserId();
                if (!userId) {
                    return {
                        paid_balance: 0,
                        bonus_balance: 0,
                        total_balance: 0,
                        site: window.SiteConfig?.site || 'cn',
                        current_site_has_account: false,
                        other_site_balances: [],
                        _load_failed: true,
                        error_message: '当前登录态尚未恢复'
                    };
                }

                const overview = await this._getWalletOverview({
                    historyLimit: 20,
                    force: options.force === true,
                    site: options.site || window.SiteConfig?.site || 'cn'
                });
                return this._normalizeWalletBalancePayload(overview);
            } catch (e) {
                console.error('[PointsService] Exception in getBalance:', e);
                return {
                    paid_balance: 0,
                    bonus_balance: 0,
                    total_balance: 0,
                    site: window.SiteConfig?.site || 'cn',
                    current_site_has_account: false,
                    other_site_balances: [],
                    _load_failed: true,
                    error_message: e?.message || '钱包余额加载失败'
                };
            }
        },

        /**
         * Get transaction history
         */
        async getHistory(limit = 20, options = {}) {
            try {
                const overview = await this._getWalletOverview({
                    historyLimit: limit,
                    site: options.site || window.SiteConfig?.site || 'cn'
                });
                const history = Array.isArray(overview?.recent_history) ? overview.recent_history : [];
                return history.map((item) => ({
                    ...item,
                    amount: normalizePointValue(item.amount)
                }));
            } catch (e) {
                console.error('[PointsService] Exception in getHistory:', e);
                return [];
            }
        },

        async getWalletTransactions(options = {}) {
            try {
                const payload = await this._fetchWalletJson('/api/wallet/transactions', {
                    site: options.site || window.SiteConfig?.site || 'cn',
                    q: String(options.query || '').trim(),
                    limit: options.limit || 100,
                    search_limit: options.searchLimit || 80
                });

                return {
                    shopOrders: Array.isArray(payload?.shop_orders) ? payload.shop_orders : [],
                    ledgerEntries: Array.isArray(payload?.ledger_entries)
                        ? payload.ledger_entries.map((entry) => ({
                            ...entry,
                            amount: normalizePointValue(entry.amount)
                        }))
                        : [],
                    promptTitles: payload?.prompt_titles && typeof payload.prompt_titles === 'object'
                        ? payload.prompt_titles
                        : {}
                };
            } catch (e) {
                console.error('[PointsService] Exception in getWalletTransactions:', e);
                return {
                    shopOrders: [],
                    ledgerEntries: [],
                    promptTitles: {}
                };
            }
        },

        async getWalletPromptTitles(ids = [], options = {}) {
            try {
                const normalizedIds = [...new Set(
                    (Array.isArray(ids) ? ids : [])
                        .map((item) => String(item || '').trim())
                        .filter(Boolean)
                )];
                if (!normalizedIds.length) {
                    return {};
                }

                const payload = await this._postWalletJson('/api/wallet/prompt-titles', {
                    site: options.site || window.SiteConfig?.site || 'cn',
                    ids: normalizedIds
                });

                return payload?.prompt_titles && typeof payload.prompt_titles === 'object'
                    ? payload.prompt_titles
                    : {};
            } catch (e) {
                console.error('[PointsService] Exception in getWalletPromptTitles:', e);
                return {};
            }
        },

        async getWalletVerifyLog(options = {}) {
            try {
                const payload = await this._postWalletJson('/api/wallet/verify-log', {
                    site: options.site || window.SiteConfig?.site || 'cn',
                    order_id: options.orderId || '',
                    reference_id: options.referenceId || '',
                    created_at: options.createdAt || '',
                    points_paid: options.pointsPaid ?? 0,
                    reason: options.reason || ''
                });

                return payload?.verify_log || null;
            } catch (e) {
                console.error('[PointsService] Exception in getWalletVerifyLog:', e);
                return null;
            }
        },

        /**
         * Get available packages
         */
        async getPackages() {
            try {
                const { data, error } = await supabase
                    .from('points_packages')
                    .select('*')
                    .eq('is_active', true)
                    .order('sort_order', { ascending: true });

                if (error) {
                    console.error('[PointsService] Error fetching packages:', error);
                    return [];
                }
                return (data || []).map((pkg) => ({
                    ...pkg,
                    points_amount: normalizePointValue(pkg.points_amount),
                    bonus_points: normalizePointValue(pkg.bonus_points)
                }));
            } catch (e) {
                console.error('[PointsService] Exception in getPackages:', e);
                return [];
            }
        },

        /**
         * Mock payment - accepts optional package data to skip DB fetch
         */
        async mockPay(packageId, packageData, options = {}) {
            if (!isSimulatedPaymentAllowed(options)) {
                throw new Error('当前未开启模拟支付，请使用真实支付流程');
            }
            return this.createPaymentRequest({
                provider_key: 'mock',
                package_id: packageId,
                order_no: `MOCK_PKG_${Date.now()}_${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
                package_name: packageData?.name || ''
            });
        },

        /**
         * Custom recharge points
         */
        async customRecharge(pointsAmount, options = {}) {
            if (!isSimulatedPaymentAllowed(options)) {
                throw new Error('当前未开启模拟支付，请使用真实支付流程');
            }

            const normalizedAmount = normalizePointValue(pointsAmount);
            if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
                throw new Error('请输入大于 0 的充值积分');
            }

            const payload = await this.createPaymentRequest({
                provider_key: 'mock',
                points_amount: normalizedAmount,
                order_no: `MOCK_CUSTOM_${Date.now()}_${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
                site: window.SiteConfig?.site || 'cn'
            });

            return {
                ...payload,
                amount: normalizedAmount
            };
        }
    };

    if (typeof supabase.auth?.onAuthStateChange === 'function') {
        supabase.auth.onAuthStateChange((_event, session) => {
            const nextUserId = getSessionUserId(session) || null;
            if (nextUserId !== PointsService._cachedUserId) {
                PointsService.clearWalletReadCaches();
            }
            PointsService._cachedUserId = nextUserId;
        });
    }

    // Export to window
    window.PointsService = PointsService;
    console.log('[PointsService] ✅ Ready');
})();
