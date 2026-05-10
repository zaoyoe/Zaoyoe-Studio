const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('image delivery audit covers public image data and legacy bucket lockdown state', () => {
    const script = readRepoFile('scripts/audit-image-delivery.js');
    const normalizeScript = readRepoFile('scripts/normalize-r2-public-urls.js');
    const packageJson = JSON.parse(readRepoFile('package.json'));

    assert.equal(
        packageJson.scripts['audit:image-delivery'],
        'node scripts/audit-image-delivery.js'
    );
    assert.equal(
        packageJson.scripts['cleanup:homepage-inline-images'],
        'node scripts/cleanup-homepage-inline-images.js'
    );

    for (const table of [
        'shop_products',
        'profiles',
        'prompts',
        'prompt_comments',
        'guestbook_messages',
        'chat_messages',
        'homepage_config'
    ]) {
        assert.match(script, new RegExp(`table: '${table}'`));
    }

    for (const bucket of ['prompt-images', 'comment-images', 'chat-assets', 'chat-images']) {
        assert.match(script, new RegExp(`'${bucket}'`));
    }

    assert.match(script, /legacy_supabase_storage/);
    assert.match(script, /raw_r2_dev/);
    assert.match(script, /inline_data_image/);
    assert.match(script, /supabase\.storage\.listBuckets\(\)/);
    assert.match(script, /bucketNeedsLockdown/);
    assert.match(script, /--fail-on-risk/);
    assert.match(script, /--page-size/);
    assert.match(script, /\.range\(from, from \+ safePageSize - 1\)/);

    assert.match(normalizeScript, /table: 'guestbook_messages'/);
    assert.match(normalizeScript, /table: 'homepage_config'/);
    assert.match(normalizeScript, /'guestbook'/);
    assert.match(normalizeScript, /'homepage'/);
    assert.match(normalizeScript, /normalizeJsonUrls\(row\.content\)/);

    const cleanupScript = readRepoFile('scripts/cleanup-homepage-inline-images.js');
    assert.match(cleanupScript, /DEFAULT_VERIFY_SCREENSHOT = '\/assets\/verify-preview\.png'/);
    assert.match(cleanupScript, /\.from\('homepage_config'\)/);
    assert.match(cleanupScript, /isInlineImageData/);
    assert.match(cleanupScript, /fieldName === 'screenshot_path' \? args\.fallback : ''/);
});

test('image upload edge function enforces server-side type size and rate guardrails', () => {
    const source = readRepoFile('supabase/functions/upload-avatar/index.ts');

    assert.match(source, /const ALLOWED_UPLOAD_TYPES = new Set<UploadType>/);
    assert.match(source, /'guestbook'/);
    assert.match(source, /'homepage'/);
    assert.match(source, /const ALLOWED_IMAGE_CONTENT_TYPES = new Set/);
    assert.match(source, /const UPLOAD_SIZE_LIMITS: Record<UploadType \| 'card', number>/);
    assert.match(source, /const UPLOAD_RATE_LIMITS: Record<UploadType/);
    assert.match(source, /const REQUIRED_HOMEPAGE_UPLOAD_PERMISSION = 'homepage\.manage'/);
    assert.match(source, /function normalizeUploadType\(value: unknown\): UploadType/);
    assert.match(source, /function assertAllowedImageContentType/);
    assert.match(source, /function assertImageSize/);
    assert.match(source, /async function enforceUploadRateLimit/);
    assert.match(source, /async function requireAdminImageUploadPermission/);
    assert.match(source, /requireAdminImageUploadPermission\([\s\S]*REQUIRED_HOMEPAGE_UPLOAD_PERMISSION/);
    assert.match(source, /async function recordR2ImageUploadAudit/);
    assert.match(source, /\.from\('admin_audit_logs'\)/);
    assert.match(source, /action_type: `image_upload\.r2\.\$\{type\}`/);
    assert.match(source, /adminClient\.rpc\('take_rate_limit_token'/);
    assert.match(source, /Product card image must be WebP/);
    assert.match(source, /Image URL protocol is not allowed/);
    assert.match(source, /function getR2PublicUrlBase\(\): string/);
    assert.match(source, /parsed\.hostname\.endsWith\('\.r2\.dev'\)/);
    assert.match(source, /homepage\/\$\{safeHomepageSite\}\/\$\{safeHomepageSection\}/);
});

test('homepage screenshot uploads persist CDN URLs instead of inline image payloads', () => {
    const homepageAdminSource = readRepoFile('admin-homepage.js');
    const homepageContractSource = readRepoFile('js/homepage-contract.js');
    const homepageSharedSource = readRepoFile('server/api-handlers/admin/homepage/_shared.js');

    assert.match(homepageAdminSource, /async function uploadHomepageScreenshotToR2/);
    assert.match(homepageAdminSource, /type: 'homepage'/);
    assert.match(homepageAdminSource, /homepageSection: 'verify-screenshot'/);
    assert.match(homepageAdminSource, /setInputValue\('hp-verify-screenshot', uploadedUrl\)/);
    assert.match(homepageAdminSource, /normalizeHomepageManagedImageUrl\(getInputValue\('hp-verify-screenshot'\)\)/);
    assert.doesNotMatch(homepageAdminSource, /Store WebP base64 data directly/);

    assert.match(homepageContractSource, /normalized\.startsWith\('data:image\/'\)[\s\S]*return fallback \|\| ''/);
    assert.match(homepageContractSource, /next\.screenshot_path = sanitizeUrl\(source\.screenshot_path, '', 2048\)/);
    assert.match(homepageSharedSource, /normalized\.startsWith\('data:image\/'\)[\s\S]*return fallback \|\| ''/);
    assert.match(homepageSharedSource, /next\.screenshot_path = sanitizeUrl\(source\.screenshot_path, '', 2048\)/);
});

test('legacy Supabase image buckets are locked down by migration and helper script', () => {
    const migration = readRepoFile('supabase/migrations/20260510_disable_supabase_image_storage_uploads.sql');
    const storagePolicy = readRepoFile('supabase/storage_policy.sql');
    const script = readRepoFile('scripts/lockdown-supabase-image-buckets.js');

    assert.match(migration, /CREATE POLICY "Block direct Supabase image bucket uploads"/);
    assert.match(migration, /AS RESTRICTIVE/);
    assert.match(migration, /FOR INSERT/);
    assert.match(migration, /bucket_id NOT IN/);
    assert.match(migration, /UPDATE storage\.buckets/);
    assert.match(migration, /public = false/);
    assert.match(migration, /file_size_limit = 1/);
    assert.match(migration, /application\/x-supabase-image-bucket-disabled/);

    assert.match(script, /storage\.updateBucket\(bucket\.id/);
    assert.match(script, /public: false/);
    assert.match(script, /fileSizeLimit: 1/);
    assert.match(script, /allowedMimeTypes: DISABLED_MIME_TYPES/);

    assert.match(storagePolicy, /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/);
    assert.match(storagePolicy, /on conflict \(id\) do update/);
    assert.match(storagePolicy, /where id in \(/);
    assert.match(storagePolicy, /create policy "Block direct Supabase image bucket uploads"/);
    assert.match(storagePolicy, /as restrictive/);
    assert.match(storagePolicy, /drop policy if exists "Public Upload"/);
    assert.match(storagePolicy, /drop policy if exists "Public Access"/);
    for (const bucket of ['prompt-images', 'comment-images', 'chat-assets', 'chat-images']) {
        assert.match(storagePolicy, new RegExp(`'${bucket}'`));
    }
});

test('prompt R2 upload edge function requires admin permission and rejects unbounded image payloads', () => {
    const source = readRepoFile('supabase/functions/upload-to-r2/index.ts');

    assert.match(source, /const REQUIRED_PROMPT_UPLOAD_PERMISSION = 'prompts\.manage'/);
    assert.match(source, /const MAX_PROMPT_IMAGES_PER_REQUEST = 25/);
    assert.match(source, /const MAX_PROMPT_IMAGE_BYTES = 6 \* 1024 \* 1024/);
    assert.match(source, /const MAX_PROMPT_UPLOAD_TOTAL_BYTES = 30 \* 1024 \* 1024/);
    assert.match(source, /const ALLOWED_PROMPT_IMAGE_CONTENT_TYPE = 'image\/webp'/);
    assert.match(source, /async function requirePromptImageUploadAdmin/);
    assert.match(source, /\.rpc\('get_user_permissions', \{ p_user_id: user\.id \}\)/);
    assert.match(source, /\.from\('admin_roles'\)/);
    assert.match(source, /Prompt image upload requires prompts\.manage admin permission/);
    assert.match(source, /function normalizePromptImageUploads\(images: unknown\)/);
    assert.match(source, /function assertPromptImageIsWebP\(bytes: Uint8Array\)/);
    assert.match(source, /async function enforcePromptUploadRateLimit\(userId: string\)/);
    assert.match(source, /async function recordPromptR2UploadAudit/);
    assert.match(source, /\.from\('admin_audit_logs'\)/);
    assert.match(source, /action_type: 'image_upload\.r2\.prompt'/);
    assert.match(source, /adminClient\.rpc\('take_rate_limit_token'/);
    assert.match(source, /ContentType: ALLOWED_PROMPT_IMAGE_CONTENT_TYPE/);
    assert.doesNotMatch(source, /\.storage\s*\.from\(/);
});
