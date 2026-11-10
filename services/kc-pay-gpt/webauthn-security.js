'use strict';

const crypto = require('node:crypto');

const STEP_UP_TTL_MS = 5 * 60_000;
const P256_SPKI_HEADER = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d03010703420004', 'hex');

function bufferToBase64Url(buffer) {
    return Buffer.from(buffer).toString('base64url');
}

function base64UrlToBuffer(str) {
    return Buffer.from(String(str || ''), 'base64url');
}

function getRpId(req) {
    const origin = req.headers?.origin || req.headers?.host || '';
    if (origin) {
        try {
            const url = origin.includes('://') ? new URL(origin) : new URL(`https://${origin}`);
            return url.hostname;
        } catch (_) {}
    }
    return req.hostname || 'adm.fatherkey.com';
}

function getExpectedOrigin(req) {
    const origin = req.headers?.origin;
    if (origin) return origin;
    const proto = req.headers?.['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host = req.headers?.host || 'adm.fatherkey.com';
    return `${proto}://${host}`;
}

function createRegistrationOptions({ rpId, rpName = 'KC GPT Auto-Recharge', userEmail, userId }) {
    const challenge = crypto.randomBytes(32).toString('base64url');
    return {
        challenge,
        rp: { name: rpName, id: rpId },
        user: {
            id: Buffer.from(String(userId || userEmail || 'admin')).toString('base64url'),
            name: String(userEmail || 'admin'),
            displayName: String(userEmail || 'admin')
        },
        pubKeyCredParams: [
            { type: 'public-key', alg: -7 },   // ES256 (standard for Apple Touch ID)
            { type: 'public-key', alg: -257 }  // RS256
        ],
        authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred'
        },
        timeout: 60000,
        attestation: 'none'
    };
}

function parseCoseP256Key(authData) {
    // In authData (minimum 37 bytes):
    // 32 rpIdHash + 1 flags + 4 signCount
    // If AT flag (bit 6, 0x40) is set:
    // 16 aaguid + 2 credIdLength (L) + L credId + COSE key
    if (authData.length < 55) throw new Error('authData 长度不足');
    const flags = authData[32];
    if ((flags & 0x40) === 0) throw new Error('authData 未包含证明凭据数据 (AT flag not set)');
    const credIdLen = authData.readUInt16BE(53);
    const coseOffset = 55 + credIdLen;
    if (authData.length < coseOffset) throw new Error('凭据 ID 截断');
    const coseBytes = authData.subarray(coseOffset);

    // Search for coordinates X (-2) and Y (-3) in CBOR / COSE buffer
    // CBOR negative int -2 is 0x21, -3 is 0x22
    // Followed by 32 bytes byte string: 0x58 0x20 + 32 bytes
    const xPattern = Buffer.from([0x21, 0x58, 0x20]);
    const yPattern = Buffer.from([0x22, 0x58, 0x20]);
    const xIdx = coseBytes.indexOf(xPattern);
    const yIdx = coseBytes.indexOf(yPattern);
    if (xIdx !== -1 && yIdx !== -1) {
        const x = coseBytes.subarray(xIdx + 3, xIdx + 35);
        const y = coseBytes.subarray(yIdx + 3, yIdx + 35);
        if (x.length === 32 && y.length === 32) {
            const spki = Buffer.concat([P256_SPKI_HEADER, x, y]);
            const pub = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
            return pub.export({ type: 'spki', format: 'pem' });
        }
    }
    throw new Error('无法解析公钥');
}

function verifyRegistration({ expectedChallenge, expectedOrigin, clientDataJSON, publicKeySpki, attestationObject }) {
    if (!clientDataJSON) throw new Error('缺少 clientDataJSON');
    const clientDataBuf = Buffer.isBuffer(clientDataJSON) ? clientDataJSON : base64UrlToBuffer(clientDataJSON);
    const clientData = JSON.parse(clientDataBuf.toString('utf8'));

    if (clientData.type !== 'webauthn.create') throw new Error(`无效的凭据类型: ${clientData.type}`);
    if (clientData.challenge !== expectedChallenge) throw new Error('挑战值不匹配');
    if (expectedOrigin && clientData.origin !== expectedOrigin) {
        // Also allow matching without trailing slash or matching localhost
        const cleanOrigin = expectedOrigin.replace(/\/+$/, '');
        const clientOrigin = String(clientData.origin || '').replace(/\/+$/, '');
        if (cleanOrigin !== clientOrigin) {
            throw new Error(`来源不匹配: 期望 ${cleanOrigin}, 收到 ${clientOrigin}`);
        }
    }

    if (publicKeySpki) {
        const spkiBuf = Buffer.isBuffer(publicKeySpki) ? publicKeySpki : base64UrlToBuffer(publicKeySpki);
        const pub = crypto.createPublicKey({ key: spkiBuf, format: 'der', type: 'spki' });
        return {
            publicKeyPem: pub.export({ type: 'spki', format: 'pem' })
        };
    }

    if (attestationObject) {
        const attBuf = Buffer.isBuffer(attestationObject) ? attestationObject : base64UrlToBuffer(attestationObject);
        // Find authData in attestationObject (CBOR map: 'authData' is 0x68 0x61 0x75 0x74 0x68 0x44 0x61 0x74 0x61)
        const marker = Buffer.from('authData');
        const idx = attBuf.indexOf(marker);
        if (idx !== -1) {
            const afterMarker = attBuf.subarray(idx + marker.length);
            // byte string header in CBOR
            let authData;
            if (afterMarker[0] === 0x58) {
                const len = afterMarker[1];
                authData = afterMarker.subarray(2, 2 + len);
            } else if (afterMarker[0] === 0x59) {
                const len = afterMarker.readUInt16BE(1);
                authData = afterMarker.subarray(3, 3 + len);
            }
            if (authData) {
                const pem = parseCoseP256Key(authData);
                return { publicKeyPem: pem };
            }
        }
    }

    throw new Error('缺少有效的公钥数据');
}

function createAuthenticationOptions({ rpId, credentials = [] }) {
    const challenge = crypto.randomBytes(32).toString('base64url');
    return {
        challenge,
        rpId,
        allowCredentials: credentials.map(c => ({
            id: c.id,
            type: 'public-key',
            transports: c.transports || ['internal']
        })),
        userVerification: 'required',
        timeout: 60000
    };
}

function verifyAuthentication({ expectedChallenge, expectedRpId, expectedOrigin, clientDataJSON, authenticatorData, signature, storedPublicKeyPem }) {
    if (!clientDataJSON || !authenticatorData || !signature || !storedPublicKeyPem) {
        throw new Error('认证参数不完整');
    }
    const clientDataBuf = Buffer.isBuffer(clientDataJSON) ? clientDataJSON : base64UrlToBuffer(clientDataJSON);
    const clientData = JSON.parse(clientDataBuf.toString('utf8'));

    if (clientData.type !== 'webauthn.get') throw new Error(`无效的认证操作类型: ${clientData.type}`);
    if (clientData.challenge !== expectedChallenge) throw new Error('认证挑战值不匹配');
    if (expectedOrigin) {
        const cleanOrigin = expectedOrigin.replace(/\/+$/, '');
        const clientOrigin = String(clientData.origin || '').replace(/\/+$/, '');
        if (cleanOrigin !== clientOrigin) {
            throw new Error(`认证来源不匹配: 期望 ${cleanOrigin}, 收到 ${clientOrigin}`);
        }
    }

    const authDataBuf = Buffer.isBuffer(authenticatorData) ? authenticatorData : base64UrlToBuffer(authenticatorData);
    if (authDataBuf.length < 37) throw new Error('authenticatorData 长度不足');

    if (expectedRpId) {
        const expectedRpIdHash = crypto.createHash('sha256').update(expectedRpId).digest();
        const actualRpIdHash = authDataBuf.subarray(0, 32);
        if (!crypto.timingSafeEqual(expectedRpIdHash, actualRpIdHash)) {
            throw new Error('RP ID 哈希不匹配');
        }
    }

    const flags = authDataBuf[32];
    if ((flags & 0x01) === 0) throw new Error('用户未参与操作 (UP flag not set)');
    if ((flags & 0x04) === 0) throw new Error('用户生物识别未通过 (UV flag not set)');

    const clientDataHash = crypto.createHash('sha256').update(clientDataBuf).digest();
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const sigBuf = Buffer.isBuffer(signature) ? signature : base64UrlToBuffer(signature);
    const pubKey = crypto.createPublicKey(storedPublicKeyPem);

    const isValid = crypto.verify('sha256', signedData, pubKey, sigBuf);
    if (!isValid) throw new Error('指纹签名校验失败');

    return true;
}

module.exports = {
    STEP_UP_TTL_MS,
    bufferToBase64Url,
    base64UrlToBuffer,
    getRpId,
    getExpectedOrigin,
    createRegistrationOptions,
    verifyRegistration,
    createAuthenticationOptions,
    verifyAuthentication
};
