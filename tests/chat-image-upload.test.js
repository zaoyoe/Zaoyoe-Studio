const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getR2Credentials,
    getR2PublicUrlBase,
    parseImageDataUrl,
    sanitizeR2KeySegment,
    uploadChatImage
} = require('../api/_lib/chat-image-upload');

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('chat image upload writes a public CDN object and never uses r2.dev', async () => {
    const puts = [];
    const url = await uploadChatImage(
        {
            imageData: PNG_DATA_URL,
            sessionId: 'newapi:70e83ef5-0181-4efd-9a7b-f827655e243f'
        },
        {
            env: {
                R2_PUBLIC_URL: 'https://pub-123.r2.dev',
                R2_BUCKET_NAME: 'zaoyoe-images'
            },
            now: 1_725_000_000_000,
            randomKey: () => 'randkey1',
            putObject: async (input) => {
                puts.push(input);
            }
        }
    );

    assert.equal(puts.length, 1);
    assert.equal(puts[0].ContentType, 'image/png');
    assert.equal(
        puts[0].Key,
        'chat/newapi_70e83ef5-0181-4efd-9a7b-f827655e243f/1725000000000_randkey1.png'
    );
    assert.equal(
        url,
        'https://cdn.fatherkey.com/chat/newapi_70e83ef5-0181-4efd-9a7b-f827655e243f/1725000000000_randkey1.png'
    );
    assert.equal(url.includes('r2.dev'), false);
});

test('chat image upload rejects invalid data URLs before putting an object', async () => {
    const puts = [];
    await assert.rejects(
        () => uploadChatImage(
            { imageData: 'https://cdn.fatherkey.com/chat/not-a-data-url.png', sessionId: 'session' },
            { putObject: async (input) => puts.push(input) }
        ),
        /Invalid image data URL/
    );
    assert.equal(puts.length, 0);
});

test('chat image helpers keep public URLs on the first-party CDN', () => {
    assert.equal(getR2PublicUrlBase({}), 'https://cdn.fatherkey.com');
    assert.equal(
        getR2PublicUrlBase({ R2_PUBLIC_URL: 'https://images.fatherkey.com/' }),
        'https://images.fatherkey.com'
    );
    assert.equal(
        getR2PublicUrlBase({ R2_PUBLIC_URL: 'https://pub-abc.r2.dev' }),
        'https://cdn.fatherkey.com'
    );
    assert.equal(sanitizeR2KeySegment('newapi:abc/../x'), 'newapi_abc_.._x');
    assert.equal(parseImageDataUrl(PNG_DATA_URL).contentType, 'image/png');
});

test('chat image upload reuses the AI image R2 credentials when R2_* is absent', async () => {
    const puts = [];
    const url = await uploadChatImage(
        {
            imageData: PNG_DATA_URL,
            sessionId: 'newapi:70e83ef5-0181-4efd-9a7b-f827655e243f'
        },
        {
            env: {
                AI_IMAGE_R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
                AI_IMAGE_R2_ACCESS_KEY_ID: 'ai-access',
                AI_IMAGE_R2_SECRET_ACCESS_KEY: 'ai-secret',
                AI_IMAGE_R2_BUCKET_NAME: 'zaoyoeimages',
                AI_IMAGE_R2_PUBLIC_URL: 'https://cdn.fatherkey.com'
            },
            now: 1_725_000_000_000,
            randomKey: () => 'randkey1',
            putObject: async (input) => {
                puts.push(input);
            }
        }
    );

    assert.equal(puts.length, 1);
    assert.equal(puts[0].Bucket, 'zaoyoeimages');
    assert.equal(
        url,
        'https://cdn.fatherkey.com/chat/newapi_70e83ef5-0181-4efd-9a7b-f827655e243f/1725000000000_randkey1.png'
    );
});

test('chat image helpers prefer AI_IMAGE_R2_* and default to the production bucket', () => {
    const credentials = getR2Credentials({
        AI_IMAGE_R2_ENDPOINT: 'https://ai.r2.example/storage',
        AI_IMAGE_R2_ACCESS_KEY_ID: 'ai-key',
        AI_IMAGE_R2_SECRET_ACCESS_KEY: 'ai-secret',
        AI_IMAGE_R2_BUCKET_NAME: 'zaoyoeimages',
        R2_ACCESS_KEY_ID: 'legacy-key',
        R2_BUCKET_NAME: 'legacy-bucket'
    });
    assert.equal(credentials.endpoint, 'https://ai.r2.example/storage');
    assert.equal(credentials.accessKeyId, 'ai-key');
    assert.equal(credentials.secretAccessKey, 'ai-secret');
    assert.equal(credentials.bucketName, 'zaoyoeimages');
    assert.equal(getR2Credentials({}).bucketName, 'zaoyoeimages');
    assert.equal(
        getR2PublicUrlBase({ AI_IMAGE_R2_PUBLIC_URL: 'https://cdn.fatherkey.com/' }),
        'https://cdn.fatherkey.com'
    );
});
