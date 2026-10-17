'use strict';

// Incoming asset identifiers, never payout/outcome currency identifiers.
const NETWORKS = Object.freeze([
    Object.freeze({ currency: 'usdtbsc', name: 'BSC (BEP20)', code: 'BSC/BEP20' }),
    Object.freeze({ currency: 'usdtton', name: 'TON', code: 'TON' }),
    Object.freeze({ currency: 'usdtmatic', name: 'Polygon', code: 'Polygon' }),
    Object.freeze({ currency: 'usdttrc20', name: 'TRON (TRC20)', code: 'TRON/TRC20' })
]);
function network(value) { return NETWORKS.find((item) => item.currency === value) || null; }
function validAddress(currency, address) {
    if (typeof address !== 'string') return false;
    if (currency === 'usdtbsc' || currency === 'usdtmatic') return /^0x[0-9a-fA-F]{40}$/.test(address);
    if (currency === 'usdttrc20') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
    if (currency === 'usdtton') return /^(?:[EUek]Q[A-Za-z0-9_-]{46}|-?\d+:[0-9a-fA-F]{64})$/.test(address);
    return false;
}
function memo(value) {
    if (value === undefined || value === null || value === '') return '';
    return typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value) ? value : null;
}
function paymentMemo(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const primary = memo(payload.payin_extra_id);
    const alternate = memo(payload.extra_id);
    if (primary === null || alternate === null || (primary && alternate && primary !== alternate)) return null;
    return primary || alternate;
}
function requireNetwork(value = 'usdtbsc') {
    const result = network(value);
    if (!result) throw Object.assign(new Error('不支持的 USDT 网络，请重新选择'), { code: 'payment_network_unsupported', statusCode: 400 });
    return result;
}
module.exports = { NETWORKS, network, requireNetwork, validAddress, memo, paymentMemo };
