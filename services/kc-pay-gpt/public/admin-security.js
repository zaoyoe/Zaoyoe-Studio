/* Sensitive admin proofs and revealed credentials live only in this page's memory. */
(() => {
    'use strict';
    let proof = null;
    let pending = null;
    let proofTimer;
    let generation = 0;
    let activeToken = null;
    const openDialogs = new Set();
    function clear() {
        generation += 1;
        pending = null;
        activeToken = null;
        proof = null;
        clearTimeout(proofTimer);
        for (const dialog of [...openDialogs]) dialog.close();
    }
    function ask(label, { password = false, value = '', reveal = false } = {}) {
        return new Promise((resolve, reject) => {
            const dialog = document.createElement('dialog');
            dialog.style.cssText = 'max-width:460px;width:90%;padding:24px;border-radius:16px;background:#141824;color:#fff;border:1px solid #555';
            const form = document.createElement('form'); form.method = 'dialog';
            const title = document.createElement('label'); title.textContent = label;
            const input = document.createElement(reveal ? 'pre' : 'input');
            input.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:16px 0;padding:10px;white-space:pre-wrap;overflow-wrap:anywhere';
            if (reveal) input.textContent = value;
            else { input.type = password ? 'password' : 'text'; input.autocomplete = password ? 'current-password' : 'one-time-code'; input.required = true; input.maxLength = password ? 1024 : 6; }
            const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = reveal ? '关闭' : '确认';
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.addEventListener('click', () => dialog.close());
            form.append(title, input, submit); if (!reveal) form.append(cancel);
            dialog.append(form); document.body.append(dialog); openDialogs.add(dialog);
            let accepted = false; let result = '';
            form.addEventListener('submit', () => { accepted = true; result = reveal ? '' : input.value; });
            const timer = setTimeout(() => dialog.close(), reveal ? 30_000 : 120_000);
            dialog.addEventListener('close', () => {
                clearTimeout(timer); if (reveal) input.textContent = ''; else input.value = '';
                dialog.remove(); openDialogs.delete(dialog);
                if (accepted || reveal) resolve(result); else reject(new Error('已取消身份验证'));
            }, { once: true });
            dialog.showModal(); if (!reveal) input.focus();
        });
    }
    async function requestJson(url, body, token) {
        const response = await fetch(url, { method: 'POST', cache: 'no-store', headers: {
            Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'
        }, body: JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || '身份验证失败');
        return data;
    }
    function assertCurrent(epoch, token) {
        if (epoch !== generation || token !== activeToken || document.hidden) throw new Error('身份验证已取消，请重试');
    }
    function bufferToBase64Url(buffer) {
        const bytes = new Uint8Array(buffer);
        let str = '';
        for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
        return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function base64UrlToBuffer(str) {
        const padding = '='.repeat((4 - (str.length % 4)) % 4);
        const base64 = (str + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
        return output.buffer;
    }
    async function verifyWithWebAuthn(token, epoch) {
        if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) return false;
        let challengeRes;
        try {
            challengeRes = await requestJson('/api/admin/webauthn/challenge', {}, token);
        } catch (_) {
            return false;
        }
        if (!challengeRes.success || !challengeRes.options || !challengeRes.options.allowCredentials?.length) {
            return false;
        }
        assertCurrent(epoch, token);
        const opts = challengeRes.options;
        const publicKey = {
            challenge: base64UrlToBuffer(opts.challenge),
            rpId: opts.rpId,
            allowCredentials: opts.allowCredentials.map(c => ({
                id: base64UrlToBuffer(c.id),
                type: 'public-key',
                transports: c.transports
            })),
            userVerification: 'required',
            timeout: opts.timeout || 60000
        };
        let assertion;
        try {
            assertion = await navigator.credentials.get({ publicKey });
        } catch (_) {
            return false;
        }
        assertCurrent(epoch, token);
        if (!assertion || !assertion.response) return false;

        const payload = {
            challenge: opts.challenge,
            id: assertion.id,
            clientDataJSON: bufferToBase64Url(assertion.response.clientDataJSON),
            authenticatorData: bufferToBase64Url(assertion.response.authenticatorData),
            signature: bufferToBase64Url(assertion.response.signature)
        };
        const data = await requestJson('/api/admin/webauthn/verify', payload, token);
        assertCurrent(epoch, token);
        if (typeof data.secondaryToken !== 'string' || !Number.isFinite(data.expiresAt)
            || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 300_000) throw new Error('无效验证响应');
        proof = { token: data.secondaryToken, expiresAt: data.expiresAt, adminToken: token };
        clearTimeout(proofTimer);
        proofTimer = setTimeout(() => { proof = null; }, Math.max(0, data.expiresAt - Date.now()));
        return true;
    }
    async function registerWebAuthn(name = 'Mac Touch ID') {
        const token = activeToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('admin_token') : null);
        if (!token) throw new Error('未登录');
        if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
            throw new Error('当前浏览器不支持 WebAuthn / Passkey 指纹认证');
        }

        const optRes = await requestJson('/api/admin/webauthn/register-options', {}, token);
        if (!optRes.success || !optRes.options) throw new Error('获取注册选项失败');
        const opts = optRes.options;

        const publicKey = {
            challenge: base64UrlToBuffer(opts.challenge),
            rp: opts.rp,
            user: {
                id: base64UrlToBuffer(opts.user.id),
                name: opts.user.name,
                displayName: opts.user.displayName
            },
            pubKeyCredParams: opts.pubKeyCredParams,
            authenticatorSelection: opts.authenticatorSelection,
            timeout: opts.timeout || 60000,
            attestation: opts.attestation || 'none'
        };

        const credential = await navigator.credentials.create({ publicKey });
        if (!credential) throw new Error('指纹注册已取消');

        let publicKeySpki = '';
        if (typeof credential.response.getPublicKey === 'function') {
            const keyBuf = credential.response.getPublicKey();
            if (keyBuf) publicKeySpki = bufferToBase64Url(keyBuf);
        }

        const confirmPayload = {
            challenge: opts.challenge,
            id: credential.id,
            name,
            clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
            attestationObject: bufferToBase64Url(credential.response.attestationObject),
            publicKeySpki
        };

        return await requestJson('/api/admin/webauthn/register-confirm', confirmPayload, token);
    }
    async function verify(token, epoch) {
        try {
            const ok = await verifyWithWebAuthn(token, epoch);
            if (ok) return;
        } catch (e) {
            if (e.message && e.message.includes('已取消')) throw e;
        }
        assertCurrent(epoch, token);
        const password = await ask('敏感操作：请输入当前登录密码', { password: true });
        assertCurrent(epoch, token);
        const challenge = await requestJson('/api/admin/secondary/challenge', { password }, token);
        assertCurrent(epoch, token);
        const code = challenge.method ? await ask(challenge.method === 'totp' ? '请输入 Authenticator 六位验证码' : '请输入 Telegram 六位验证码') : '';
        assertCurrent(epoch, token);
        const data = await requestJson('/api/admin/verify-secondary', { challengeId: challenge.challengeId, code }, token);
        assertCurrent(epoch, token);
        if (typeof data.secondaryToken !== 'string' || !Number.isFinite(data.expiresAt)
            || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 300_000) throw new Error('无效验证响应');
        proof = { token: data.secondaryToken, expiresAt: data.expiresAt, adminToken: token };
        clearTimeout(proofTimer);
        proofTimer = setTimeout(() => { proof = null; }, Math.max(0, data.expiresAt - Date.now()));
    }
    function guardResponse(response, epoch, token) {
        const readers = new Set(['json', 'text', 'blob', 'arrayBuffer', 'formData', 'bytes']);
        return new Proxy(response, {
            get(target, key) {
                // Response methods require their original receiver. Recheck after body reads,
                // which may finish after logout, page hiding, or a new login.
                const value = Reflect.get(target, key, target);
                if (key === 'clone') return () => {
                    assertCurrent(epoch, token);
                    return guardResponse(target.clone(), epoch, token);
                };
                if (readers.has(key) && typeof value === 'function') return async (...args) => {
                    assertCurrent(epoch, token);
                    const body = await value.apply(target, args);
                    assertCurrent(epoch, token);
                    return body;
                };
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
    }
    async function securedFetch(url, options = {}, token) {
        const parsed = new URL(url, location.origin);
        if (parsed.origin !== location.origin || !parsed.pathname.startsWith('/api/admin/')) throw new Error('无效管理接口');
        if (activeToken !== token) { clear(); activeToken = token; }
        const epoch = generation;
        const { stepUp = true, ...fetchOptions } = options;
        let sentProof;
        const send = async () => {
            assertCurrent(epoch, token);
            const headers = new Headers(fetchOptions.headers || {});
            headers.set('Authorization', `Bearer ${token}`);
            headers.delete('x-admin-secondary-token');
            sentProof = proof?.adminToken === token && proof.expiresAt > Date.now() ? proof.token : null;
            if (sentProof) headers.set('x-admin-secondary-token', sentProof);
            const response = await fetch(parsed.href, { ...fetchOptions, cache: 'no-store', headers });
            assertCurrent(epoch, token);
            return response;
        };
        let response = await send();
        const rejectedProof = sentProof;
        const body = response.status === 403 ? await response.clone().json().catch(() => null) : null;
        assertCurrent(epoch, token);
        if (body?.code === 'STEP_UP_REQUIRED' && stepUp) {
            // A late response using an older proof must not trigger another challenge.
            if (!proof || proof.token === rejectedProof || proof.expiresAt <= Date.now()) {
                if (!pending) {
                    const operation = verify(token, epoch);
                    pending = { token, operation };
                    operation.finally(() => { if (pending?.operation === operation) pending = null; }).catch(() => {});
                }
                await pending.operation;
            }
            assertCurrent(epoch, token);
            // Only an explicit pre-handler rejection is retried, exactly once.
            response = await send();
        }
        return guardResponse(response, epoch, token);
    }
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    window.KcAdminSecurity = {
        fetch: securedFetch,
        clear,
        showSecret: text => document.hidden ? Promise.reject(new Error('页面已隐藏')) : ask('敏感凭证（30 秒后自动清除）', { reveal: true, value: text }),
        registerWebAuthn,
        verifyWithWebAuthn
    };
})();
