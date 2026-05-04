(function setupWalletPreviewRuntime() {
    const packages = [
        { id: "starter", name: "新手尝鲜包", name_en: "Starter Pack", points_amount: 10, bonus_points: 0, price_cny: 10 },
        { id: "pro", name: "超值进阶包", name_en: "Value Pack", points_amount: 50, bonus_points: 0, price_cny: 50 },
        { id: "gift", name: "新礼包", name_en: "Gift Pack", points_amount: 100, bonus_points: 0, price_cny: 100 }
    ];

    const paymentChannels = {
        active_provider: "zpay",
        providers: {
            zpay: {
                enabled: true,
                display_name: "支付宝",
                checkout_url: "https://example.com/alipay-preview",
                order_query_enabled: false
            },
            nowpayments: {
                enabled: true,
                display_name: "USDT",
                network_name: "BEP20",
                pay_currency: "usdtbsc"
            },
            afdian: { enabled: false },
            mock: { enabled: false }
        }
    };

    const rechargeOptions = {
        custom_amount_enabled: true,
        custom_amount_min_points: 0.01,
        custom_amount_points_per_cny: 1,
        mock_payment_enabled: false
    };

    let statusMode = "pending";
    let paymentCounter = 5527457400;
    let nextQuoteTtlMs = 5 * 60 * 1000;
    let lastPaymentPoints = 100;

    window.__walletPreview = {
        packages,
        setNextQuoteTtl(ms) {
            nextQuoteTtlMs = Math.max(100, Number(ms) || 3000);
        },
        setStatusMode(mode) {
            statusMode = mode || "pending";
        },
        getStatusMode() {
            return statusMode;
        }
    };

    window.SiteConfig = { site: "cn" };
    window.i18n = {
        t(_key) {
            return "";
        },
        isEnglish() {
            return false;
        },
        getCurrentLanguage() {
            return "zh-CN";
        }
    };

    window.UserEventTracker = {
        track() {},
        trackOnce() {}
    };

    window.supabaseClient = {
        auth: {
            async getSession() {
                return {
                    data: {
                        session: {
                            user: {
                                id: "preview-user",
                                email: "preview@zaoyoe.local"
                            }
                        }
                    }
                };
            }
        },
        async rpc(name, args) {
            if (name === "get_system_config") {
                if (args?.p_key === "payment_channels") return { data: paymentChannels, error: null };
                if (args?.p_key === "recharge_options") return { data: rechargeOptions, error: null };
            }
            return { data: null, error: null };
        }
    };

    const originalFetch = window.fetch?.bind(window);
    window.fetch = async function previewFetch(input, init) {
        const url = typeof input === "string" ? input : String(input?.url || "");
        if (url === "/api/payments/config" || url.endsWith("/api/payments/config")) {
            return new Response(JSON.stringify({
                success: true,
                config: paymentChannels,
                recharge_options: rechargeOptions,
                runtime: {
                    mock_payment: {
                        allowed: false,
                        reason: "preview",
                        message: "预览环境不使用模拟支付。"
                    }
                }
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (originalFetch) return originalFetch(input, init);
        throw new Error(`Preview fetch is not available for ${url}`);
    };

    function findPackage(input = {}) {
        const id = String(input.package_id || "").trim();
        return packages.find((item) => String(item.id) === id) || packages[2];
    }

    function customAmount(input = {}) {
        const value = Number(input.points_amount || input.amount || input.paid_amount || 0);
        return Number.isFinite(value) && value > 0 ? value : 100;
    }

    function buildNowpaymentsResult(input = {}) {
        const pkg = input.package_id ? findPackage(input) : null;
        const paidAmount = pkg ? Number(pkg.price_cny) : customAmount(input);
        const pointsAmount = pkg ? Number(pkg.points_amount) : paidAmount;
        const payAmount = (paidAmount * 0.1425207511).toFixed(8);
        const orderNo = String(++paymentCounter);
        const expiresAt = new Date(Date.now() + nextQuoteTtlMs).toISOString();
        nextQuoteTtlMs = 5 * 60 * 1000;
        statusMode = "pending";
        lastPaymentPoints = pointsAmount;

        return {
            mode: "crypto_checkout",
            provider: "nowpayments",
            display_name: "USDT",
            package_name: pkg?.name || "自定义充值",
            checkout_session_id: `preview-usdt-${orderNo}`,
            provider_order_no: orderNo,
            paid_amount: paidAmount,
            points_amount: pointsAmount,
            provider_summary: {
                payment_id: orderNo,
                pay_address: "0x1551Ad7D1A433df2e827C09a7f8c1af7E5CE3fC3",
                pay_amount: payAmount,
                pay_amount_text: payAmount,
                pay_currency: "USDT",
                network_code: "BSC/BEP20",
                network_name: "BNB Smart Chain",
                qr_data: "0x1551Ad7D1A433df2e827C09a7f8c1af7E5CE3fC3",
                quote_expires_at: expiresAt,
                expiration_estimate_date: expiresAt,
                local_amount: paidAmount,
                grantedPoints: pointsAmount
            }
        };
    }

    function buildAlipayResult(input = {}) {
        const pkg = input.package_id ? findPackage(input) : null;
        const paidAmount = pkg ? Number(pkg.price_cny) : customAmount(input);
        const pointsAmount = pkg ? Number(pkg.points_amount) : paidAmount;
        const orderNo = String(++paymentCounter);
        statusMode = "pending";
        lastPaymentPoints = pointsAmount;

        return {
            mode: "redirect",
            provider: "zpay",
            display_name: "支付宝",
            checkout_url: "https://example.com/alipay-preview",
            checkout_session_id: `preview-alipay-${orderNo}`,
            provider_order_no: orderNo,
            paid_amount: paidAmount,
            points_amount: pointsAmount,
            provider_summary: {
                out_trade_no: orderNo,
                qrcode_img_url: window.__walletPreviewQrDataUrl || "",
                qrcode_url: "https://example.com/alipay-preview"
            },
            message: "支付宝付款信息已生成。"
        };
    }

    window.PointsService = {
        isUnsafeDirectRechargeAllowed() {
            return false;
        },
        peekWalletBalance() {
            return {
                total_balance: 128.5,
                paid_balance: 100,
                bonus_balance: 28.5
            };
        },
        async getBalance() {
            return {
                total_balance: 128.5,
                paid_balance: 100,
                bonus_balance: 28.5
            };
        },
        async getPackages() {
            return packages;
        },
        async getHistory() {
            return [];
        },
        async getWalletTransactions() {
            return {
                shopOrders: [],
                ledgerEntries: [],
                promptTitles: {}
            };
        },
        async getWalletDiscountAssets() {
            return {
                summary: { available: 0, expiring: 0, used: 0, inactive: 0 },
                assets: []
            };
        },
        peekWalletDiscountAssets() {
            return null;
        },
        async createPaymentRequest(input = {}) {
            return input.provider_key === "nowpayments"
                ? buildNowpaymentsResult(input)
                : buildAlipayResult(input);
        },
        async getPaymentRequestStatus() {
            if (statusMode === "completed") {
                return {
                    status: "completed",
                    points_amount: lastPaymentPoints,
                    message: `支付成功，积分+${lastPaymentPoints}`
                };
            }
            if (statusMode === "failed") {
                return {
                    status: "failed",
                    message: "支付未成功，请重新发起支付。"
                };
            }
            if (statusMode === "expired") {
                return {
                    status: "failed",
                    checkout_session_status: "expired",
                    message: "支付会话已过期，请重新发起支付。"
                };
            }
            if (statusMode === "review") {
                return {
                    status: "review",
                    message: "支付已提交，正在等待平台确认，请稍后。"
                };
            }
            return { status: "pending" };
        }
    };
})();
