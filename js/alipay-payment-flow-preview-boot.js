(function bootWalletPreview() {
    const qrSvg = encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220">
            <rect width="220" height="220" fill="white"/>
            <rect x="12" y="12" width="54" height="54" fill="black"/>
            <rect x="24" y="24" width="30" height="30" fill="white"/>
            <rect x="154" y="12" width="54" height="54" fill="black"/>
            <rect x="166" y="24" width="30" height="30" fill="white"/>
            <rect x="12" y="154" width="54" height="54" fill="black"/>
            <rect x="24" y="166" width="30" height="30" fill="white"/>
            <path d="M84 18h18v18H84zm30 0h12v12h-12zm-30 30h42v12H84zm54 30h18v18h-18zm-54 0h12v12H84zm30 0h12v30h-12zm-42 30h36v12H72zm78 0h18v12h-18zm30 0h12v42h-12zM72 138h18v18H72zm30 0h12v12h-12zm24 0h42v18h-42zm-42 30h24v12H84zm42 0h12v24h-12zm30 24h42v12h-42zm-42 0h12v12h-12z" fill="black"/>
            <circle cx="110" cy="110" r="30" fill="#1677ff"/>
            <text x="110" y="122" text-anchor="middle" fill="white" font-size="34" font-weight="900" font-family="PingFang SC, Microsoft YaHei, sans-serif">支</text>
        </svg>
    `);
    const qrDataUrl = `data:image/svg+xml;charset=UTF-8,${qrSvg}`;
    window.__walletPreviewQrDataUrl = qrDataUrl;

    function showToast(message) {
        document.querySelector(".preview-toast")?.remove();
        const toast = document.createElement("div");
        toast.className = "preview-toast";
        toast.textContent = message;
        document.body.appendChild(toast);
        window.setTimeout(() => toast.remove(), 2200);
    }

    function getWalletOverlay() {
        return document.getElementById("wallet-modal-overlay");
    }

    function getPaymentOverlay() {
        return document.querySelector(".wallet-order-modal-overlay");
    }

    function clickFirst(selector) {
        const el = document.querySelector(selector);
        if (!el) return false;
        el.click();
        return true;
    }

    async function ensureWalletOpen() {
        if (!window.WalletModal) return;
        if (!window.WalletModal.__previewQrPatched) {
            window.WalletModal.__previewQrPatched = true;
            window.WalletModal.buildQrImageUrl = () => qrDataUrl;
        }
        if (!window.WalletModal.isOpen) {
            await window.WalletModal.open("recharge", { entry: "wallet_payment_preview" });
        } else {
            window.WalletModal.switchView("recharge");
        }
        document.getElementById("previewLoading")?.remove();
    }

    function triggerAlipay() {
        ensureWalletOpen().then(() => {
            window.__walletPreview.setStatusMode("pending");
            if (!clickFirst('#wallet-recharge-package-methods [data-wallet-payment-method="alipay"]')) {
                showToast("支付宝按钮还没渲染完成");
            }
        });
    }

    document.getElementById("previewOpenWallet").addEventListener("click", () => ensureWalletOpen());
    document.getElementById("previewOpenAlipay").addEventListener("click", triggerAlipay);
    document.getElementById("previewSuccess").addEventListener("click", () => {
        const overlay = getPaymentOverlay();
        if (!overlay) {
            triggerAlipay();
            window.setTimeout(() => window.WalletModal.transitionHostedPaymentQrToSuccess(getPaymentOverlay()), 500);
            return;
        }
        window.__walletPreview.setStatusMode("completed");
        window.WalletModal.transitionHostedPaymentQrToSuccess(overlay);
    });
    document.getElementById("previewTimeout").addEventListener("click", () => {
        const overlay = getPaymentOverlay();
        if (!overlay) {
            triggerAlipay();
            window.setTimeout(() => window.WalletModal.renderHostedPaymentQrTimeout(getPaymentOverlay()), 500);
            return;
        }
        window.__walletPreview.setStatusMode("expired");
        window.WalletModal.renderHostedPaymentQrTimeout(overlay);
    });
    document.getElementById("previewFailed").addEventListener("click", () => {
        const overlay = getPaymentOverlay();
        if (!overlay) {
            triggerAlipay();
            window.setTimeout(() => {
                window.WalletModal.updateHostedPaymentQrStatus(
                    getPaymentOverlay(),
                    "支付未成功，请重新发起支付。",
                    "error"
                );
            }, 500);
            return;
        }
        window.__walletPreview.setStatusMode("failed");
        window.WalletModal.updateHostedPaymentQrStatus(
            overlay,
            "支付未成功，请重新发起支付。",
            "error"
        );
    });

    window.addEventListener("DOMContentLoaded", () => {
        triggerAlipay();
    });
})();
