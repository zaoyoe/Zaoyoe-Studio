import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import {
    createRegistrationOptions,
    verifyRegistration,
    createAuthenticationOptions,
    verifyAuthentication,
    bufferToBase64Url,
    base64UrlToBuffer
} from '../webauthn-security.js';

describe('WebAuthn / Passkey Native Security', () => {
    it('creates registration options with required platform authenticator and algorithms', () => {
        const options = createRegistrationOptions({
            rpId: 'adm.fatherkey.com',
            userEmail: 'admin@vru.cc'
        });
        expect(options.rp.id).toBe('adm.fatherkey.com');
        expect(options.user.name).toBe('admin@vru.cc');
        expect(options.authenticatorSelection.authenticatorAttachment).toBe('platform');
        expect(options.authenticatorSelection.userVerification).toBe('required');
        expect(options.pubKeyCredParams).toEqual(expect.arrayContaining([
            { type: 'public-key', alg: -7 }
        ]));
    });

    it('verifies registration from modern SPKI public key', () => {
        const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
        const challenge = 'sample-register-challenge-12345';
        const clientData = Buffer.from(JSON.stringify({
            type: 'webauthn.create',
            challenge,
            origin: 'https://adm.fatherkey.com'
        }));

        const result = verifyRegistration({
            expectedChallenge: challenge,
            expectedOrigin: 'https://adm.fatherkey.com',
            clientDataJSON: clientData,
            publicKeySpki: bufferToBase64Url(spkiDer)
        });

        expect(result.publicKeyPem).toContain('BEGIN PUBLIC KEY');
        expect(result.publicKeyPem).toBe(publicKey.export({ type: 'spki', format: 'pem' }));
    });

    it('creates authentication options with allowed credentials and rpId', () => {
        const options = createAuthenticationOptions({
            rpId: 'adm.fatherkey.com',
            credentials: [{ id: 'cred-1', transports: ['internal'] }]
        });
        expect(options.rpId).toBe('adm.fatherkey.com');
        expect(options.allowCredentials).toHaveLength(1);
        expect(options.allowCredentials[0].id).toBe('cred-1');
        expect(options.userVerification).toBe('required');
    });

    it('verifies valid Touch ID assertion signature and checks UP/UV flags', () => {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const pem = publicKey.export({ type: 'spki', format: 'pem' });
        const rpId = 'adm.fatherkey.com';
        const origin = 'https://adm.fatherkey.com';
        const challenge = crypto.randomBytes(32).toString('base64url');

        const clientDataJSON = Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge,
            origin
        }));

        const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
        const flags = Buffer.from([0x05]); // UP (0x01) + UV (0x04)
        const signCount = Buffer.alloc(4);
        const authenticatorData = Buffer.concat([rpIdHash, flags, signCount]);

        const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
        const signedData = Buffer.concat([authenticatorData, clientDataHash]);
        const signature = crypto.sign('sha256', signedData, privateKey);

        const ok = verifyAuthentication({
            expectedChallenge: challenge,
            expectedRpId: rpId,
            expectedOrigin: origin,
            clientDataJSON,
            authenticatorData,
            signature,
            storedPublicKeyPem: pem
        });

        expect(ok).toBe(true);
    });

    it('rejects assertion when UV (user verification) flag is absent', () => {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const pem = publicKey.export({ type: 'spki', format: 'pem' });
        const rpId = 'adm.fatherkey.com';
        const origin = 'https://adm.fatherkey.com';
        const challenge = 'test-challenge';

        const clientDataJSON = Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge,
            origin
        }));

        const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
        const flags = Buffer.from([0x01]); // Only UP, UV is 0!
        const signCount = Buffer.alloc(4);
        const authenticatorData = Buffer.concat([rpIdHash, flags, signCount]);

        const signedData = Buffer.concat([authenticatorData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
        const signature = crypto.sign('sha256', signedData, privateKey);

        expect(() => verifyAuthentication({
            expectedChallenge: challenge,
            expectedRpId: rpId,
            expectedOrigin: origin,
            clientDataJSON,
            authenticatorData,
            signature,
            storedPublicKeyPem: pem
        })).toThrow(/生物识别未通过/);
    });

    it('rejects assertion when signature is forged', () => {
        const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const otherKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const pem = publicKey.export({ type: 'spki', format: 'pem' });
        const rpId = 'adm.fatherkey.com';
        const origin = 'https://adm.fatherkey.com';
        const challenge = 'test-challenge';

        const clientDataJSON = Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge,
            origin
        }));

        const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
        const flags = Buffer.from([0x05]);
        const authenticatorData = Buffer.concat([rpIdHash, flags, Buffer.alloc(4)]);

        const signedData = Buffer.concat([authenticatorData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
        // Signed by otherKey!
        const signature = crypto.sign('sha256', signedData, otherKey.privateKey);

        expect(() => verifyAuthentication({
            expectedChallenge: challenge,
            expectedRpId: rpId,
            expectedOrigin: origin,
            clientDataJSON,
            authenticatorData,
            signature,
            storedPublicKeyPem: pem
        })).toThrow(/指纹签名校验失败/);
    });

    it('end-to-end adminSecurity registration and Touch ID verification flow', async () => {
        process.env.ADMIN_TOKEN_SECRET = 'offline-fixture-signing-key-at-least-32-bytes';
        const adminSecurity = (await import('../admin-security.js')).createAdminSecurity;
        let passkeys = [];
        const store = {
            getAdminAuthConfig: async () => ({ email: 'admin@vru.cc', passwordVersion: 1 }),
            getAdminPasskeys: async () => passkeys,
            saveAdminPasskey: async (pk) => { passkeys.push(pk); return passkeys; },
            deleteAdminPasskey: async (id) => { passkeys = passkeys.filter(k => k.id !== id); return passkeys; }
        };
        const handlers = adminSecurity({ store, ensureStoreReady: async () => {}, sendTelegramLoginCode: async () => {} });
        const makeRes = () => ({
            statusCode: 200,
            headers: {},
            setHeader(k, v) { this.headers[k] = v; },
            status(code) { this.statusCode = code; return this; },
            json(data) { this.data = data; return this; }
        });
        const req = (body = {}) => ({
            body,
            headers: { origin: 'https://adm.fatherkey.com', host: 'adm.fatherkey.com' },
            ip: '192.0.2.10',
            admin: { pv: 1, email: 'admin@vru.cc' },
            adminToken: 'test-admin-token'
        });

        // 1. Initial status: no passkeys
        let res = makeRes();
        await handlers.webauthnStatus(req(), res);
        expect(res.data.enrolled).toBe(false);

        // 2. Request register options
        res = makeRes();
        await handlers.webauthnRegisterOptions(req(), res);
        expect(res.data.success).toBe(true);
        const challenge = res.data.options.challenge;
        expect(res.data.options.rp.id).toBe('adm.fatherkey.com');

        // 3. Register a credential
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
        const regClientData = Buffer.from(JSON.stringify({
            type: 'webauthn.create',
            challenge,
            origin: 'https://adm.fatherkey.com'
        }));
        res = makeRes();
        await handlers.webauthnRegisterConfirm(req({
            challenge,
            id: 'cred-touchid-1',
            name: 'My Mac Touch ID',
            clientDataJSON: regClientData,
            publicKeySpki: bufferToBase64Url(spkiDer)
        }), res);
        expect(res.data.success).toBe(true);

        // 4. Status should now be enrolled
        res = makeRes();
        await handlers.webauthnStatus(req(), res);
        expect(res.data.enrolled).toBe(true);
        expect(res.data.passkeys[0].name).toBe('My Mac Touch ID');

        // 5. Authentication challenge
        res = makeRes();
        await handlers.webauthnChallenge(req(), res);
        expect(res.data.success).toBe(true);
        const authChallenge = res.data.options.challenge;

        // 6. Sign challenge with Mac Touch ID private key
        const authClientData = Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: authChallenge,
            origin: 'https://adm.fatherkey.com'
        }));
        const rpIdHash = crypto.createHash('sha256').update('adm.fatherkey.com').digest();
        const flags = Buffer.from([0x05]); // UP + UV
        const authData = Buffer.concat([rpIdHash, flags, Buffer.alloc(4)]);
        const signedPayload = Buffer.concat([authData, crypto.createHash('sha256').update(authClientData).digest()]);
        const sig = crypto.sign('sha256', signedPayload, privateKey);

        // 7. Verify Touch ID assertion
        res = makeRes();
        await handlers.webauthnVerify(req({
            challenge: authChallenge,
            id: 'cred-touchid-1',
            clientDataJSON: authClientData,
            authenticatorData: authData,
            signature: sig
        }), res);
        expect(res.data.success).toBe(true);
        expect(typeof res.data.secondaryToken).toBe('string');
        expect(res.data.expiresAt).toBeGreaterThan(Date.now());
    });
});
