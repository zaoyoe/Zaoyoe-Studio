import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { S3Client, PutObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROMPT_IMAGE_VARIANT_PREFIXES: Record<string, string> = {
    original: 'prompts',
    thumb: 'prompts/thumb',
    featured: 'prompts/featured',
    card: 'prompts/card',
    home: 'prompts/home',
};
const REQUIRED_PROMPT_UPLOAD_PERMISSION = 'prompts.manage';
const MAX_PROMPT_IMAGES_PER_REQUEST = 25;
const MAX_PROMPT_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_PROMPT_UPLOAD_TOTAL_BYTES = 30 * 1024 * 1024;
const ALLOWED_PROMPT_IMAGE_CONTENT_TYPE = 'image/webp';
const PROMPT_UPLOAD_RATE_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };

class HttpError extends Error {
    status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

function sanitizePromptImageFilename(filename: unknown): string {
    const safeName = String(filename || '')
        .split(/[\\/]/)
        .pop()
        ?.replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 160) || '';

    if (!safeName) return '';
    return safeName.toLowerCase().endsWith('.webp')
        ? safeName
        : `${safeName.replace(/\.[^.]+$/, '') || 'image'}.webp`;
}

function getPromptImageUploadTarget(image: Record<string, unknown>) {
    const isThumb = Boolean(image?.isThumb);
    const requestedVariant = String(image?.variant || (isThumb ? 'thumb' : 'original')).trim();
    if (!Object.prototype.hasOwnProperty.call(PROMPT_IMAGE_VARIANT_PREFIXES, requestedVariant)) {
        throw new HttpError(`Unsupported prompt image variant: ${requestedVariant}`, 400);
    }

    const variant = requestedVariant;
    const filename = sanitizePromptImageFilename(image?.filename);
    const prefix = PROMPT_IMAGE_VARIANT_PREFIXES[variant];

    return {
        key: filename ? `${prefix}/${filename}` : '',
        filename,
        variant,
        isOriginal: variant === 'original',
    };
}

function normalizePermissionList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        try {
            return normalizePermissionList(JSON.parse(value));
        } catch (_) {
            return value.split(',').map((item) => item.trim()).filter(Boolean);
        }
    }

    return [];
}

function isActiveRole(role: Record<string, unknown> | null | undefined): boolean {
    const expiresAt = String(role?.expires_at || '').trim();
    if (!expiresAt) return true;
    return new Date(expiresAt).getTime() > Date.now();
}

function hasPromptUploadPermissionFromRoles(roles: Array<Record<string, unknown>> = []): boolean {
    return roles.some((role) => {
        if (!isActiveRole(role)) return false;

        const roleName = String(role?.role_name || '').trim().toLowerCase();
        const permissions = normalizePermissionList(role?.permissions);
        return roleName === 'super_admin'
            || permissions.includes('*')
            || permissions.includes(REQUIRED_PROMPT_UPLOAD_PERMISSION);
    });
}

function hasPromptUploadPermissionData(data: Record<string, unknown> | null | undefined): boolean {
    if (!data) return false;
    const roleName = String(data.role || data.role_name || '').trim().toLowerCase();
    const permissions = normalizePermissionList(data.permissions);

    return data.is_super_admin === true
        || roleName === 'super_admin'
        || permissions.includes('*')
        || permissions.includes(REQUIRED_PROMPT_UPLOAD_PERMISSION);
}

async function requirePromptImageUploadAdmin(
    supabaseClient: ReturnType<typeof createClient>,
    user: { id: string; email?: string | null }
) {
    try {
        const { data, error } = await supabaseClient.rpc('get_user_permissions', { p_user_id: user.id });
        if (!error && hasPromptUploadPermissionData(data as Record<string, unknown>)) {
            return;
        }
    } catch (permissionError) {
        console.warn('Prompt upload permission RPC failed:', permissionError);
    }

    const { data: roles, error: roleError } = await supabaseClient
        .from('admin_roles')
        .select('role_name, permissions, expires_at')
        .eq('user_id', user.id);

    if (roleError) {
        console.warn('Prompt upload admin role check failed:', roleError.message);
        throw new HttpError('Admin permission check failed', 403);
    }

    if (!hasPromptUploadPermissionFromRoles((roles || []) as Array<Record<string, unknown>>)) {
        throw new HttpError('Prompt image upload requires prompts.manage admin permission', 403);
    }
}

function decodePromptImageBase64(base64: unknown): Uint8Array {
    const rawValue = String(base64 || '').trim();
    const dataUrlMatch = rawValue.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);

    if (dataUrlMatch && dataUrlMatch[1].toLowerCase() !== ALLOWED_PROMPT_IMAGE_CONTENT_TYPE) {
        throw new HttpError('Prompt image must be WebP', 400);
    }

    const rawBase64 = dataUrlMatch ? dataUrlMatch[2] : rawValue;
    if (!rawBase64) {
        throw new HttpError('Prompt image data is required', 400);
    }

    let binaryString = '';
    try {
        binaryString = atob(rawBase64);
    } catch (_) {
        throw new HttpError('Invalid prompt image data', 400);
    }

    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function assertPromptImageIsWebP(bytes: Uint8Array) {
    const isWebP = bytes.length >= 12
        && bytes[0] === 0x52
        && bytes[1] === 0x49
        && bytes[2] === 0x46
        && bytes[3] === 0x46
        && bytes[8] === 0x57
        && bytes[9] === 0x45
        && bytes[10] === 0x42
        && bytes[11] === 0x50;

    if (!isWebP) {
        throw new HttpError('Prompt image must be WebP', 400);
    }
}

function normalizePromptImageUploads(images: unknown) {
    if (!Array.isArray(images) || images.length === 0) {
        throw new HttpError('No images provided', 400);
    }

    if (images.length > MAX_PROMPT_IMAGES_PER_REQUEST) {
        throw new HttpError(`Too many prompt images in one request; limit is ${MAX_PROMPT_IMAGES_PER_REQUEST}`, 400);
    }

    let totalBytes = 0;
    return images.map((image, index) => {
        if (!image || typeof image !== 'object') {
            throw new HttpError(`Invalid prompt image payload at index ${index}`, 400);
        }

        const target = getPromptImageUploadTarget(image as Record<string, unknown>);
        if (!target.key || !target.filename) {
            throw new HttpError(`Prompt image filename is required at index ${index}`, 400);
        }

        const bytes = decodePromptImageBase64((image as Record<string, unknown>).base64);
        if (bytes.length > MAX_PROMPT_IMAGE_BYTES) {
            throw new HttpError(`Prompt image exceeds ${Math.round(MAX_PROMPT_IMAGE_BYTES / 1024 / 1024)}MB limit`, 400);
        }
        assertPromptImageIsWebP(bytes);

        totalBytes += bytes.length;
        if (totalBytes > MAX_PROMPT_UPLOAD_TOTAL_BYTES) {
            throw new HttpError(`Prompt image batch exceeds ${Math.round(MAX_PROMPT_UPLOAD_TOTAL_BYTES / 1024 / 1024)}MB limit`, 400);
        }

        return {
            ...target,
            bytes,
        };
    });
}

async function enforcePromptUploadRateLimit(userId: string) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY') || '';
    if (!supabaseUrl || !serviceRoleKey) {
        console.warn('Prompt upload rate limit skipped: missing service role env');
        return;
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    const { data, error } = await adminClient.rpc('take_rate_limit_token', {
        p_key: `edge:prompt-image-upload:${userId}`,
        p_limit: PROMPT_UPLOAD_RATE_LIMIT.limit,
        p_window_ms: PROMPT_UPLOAD_RATE_LIMIT.windowMs,
    });

    if (error) {
        console.warn('Prompt upload rate limit check skipped:', error.message);
        return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (result?.allowed === false) {
        const retryAfter = Number(result?.retry_after_seconds || 60);
        throw new HttpError(`Prompt image upload rate limit exceeded. Please retry after ${retryAfter} seconds.`, 429);
    }
}

function getServiceRoleClient() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY') || '';
    if (!supabaseUrl || !serviceRoleKey) {
        return null;
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

async function recordPromptR2UploadAudit(
    userId: string,
    details: Record<string, unknown>
) {
    const adminClient = getServiceRoleClient();
    if (!adminClient) {
        console.warn('Prompt upload audit skipped: missing service role env');
        return;
    }

    const { error } = await adminClient
        .from('admin_audit_logs')
        .insert({
            admin_id: userId,
            target_user_id: userId,
            action_type: 'image_upload.r2.prompt',
            details: {
                source: 'edge:upload-to-r2',
                ...details,
            },
        });

    if (error) {
        console.warn('Prompt upload audit insert failed:', error.message);
    }
}

serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Verify authentication
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Initialize Supabase client to verify user is logged in
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            {
                global: {
                    headers: { Authorization: authHeader },
                },
            }
        );

        // Get user from token
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Invalid authentication' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        await requirePromptImageUploadAdmin(supabaseClient, user);
        console.log(`✅ Prompt image upload admin authenticated: ${user.email}`);

        // Parse request body
        const { images } = await req.json();
        const normalizedUploads = normalizePromptImageUploads(images);
        await enforcePromptUploadRateLimit(user.id);

        // Initialize R2 S3 client
        const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT');
        const R2_ACCESS_KEY = Deno.env.get('R2_ACCESS_KEY');
        const R2_SECRET_KEY = Deno.env.get('R2_SECRET_KEY');
        const R2_PUBLIC_URL = 'https://cdn.fatherkey.com';

        if (!R2_ENDPOINT || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
            console.error('R2 credentials not configured');
            return new Response(
                JSON.stringify({ error: 'R2 configuration error' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const s3Client = new S3Client({
            region: 'auto',
            endpoint: R2_ENDPOINT,
            credentials: {
                accessKeyId: R2_ACCESS_KEY,
                secretAccessKey: R2_SECRET_KEY,
            },
        });

        // Upload images to R2
        const uploadedUrls: string[] = [];
        const uploadedAssetsByFilename = new Map<string, Record<string, string>>();
        const uploadedAssetOrder: string[] = [];
        const uploadedAuditItems: Array<Record<string, unknown>> = [];

        for (const image of normalizedUploads) {
            const { bytes, filename, key, variant, isOriginal } = image;
            try {
                await s3Client.send(
                    new PutObjectCommand({
                        Bucket: 'zaoyoeimages',
                        Key: key,
                        Body: bytes,
                        ContentType: ALLOWED_PROMPT_IMAGE_CONTENT_TYPE,
                        CacheControl: 'public, max-age=31536000, immutable',
                    })
                );

                const publicUrl = `${R2_PUBLIC_URL}/${key}`;
                const safeFilename = sanitizePromptImageFilename(filename);
                if (safeFilename) {
                    if (!uploadedAssetsByFilename.has(safeFilename)) {
                        uploadedAssetsByFilename.set(safeFilename, {});
                    }

                    const asset = uploadedAssetsByFilename.get(safeFilename)!;
                    asset[variant] = publicUrl;

                    if (isOriginal && !uploadedAssetOrder.includes(safeFilename)) {
                        uploadedAssetOrder.push(safeFilename);
                    }
                }

                // Only add original images to uploadedUrls (not thumbnails/variants)
                if (isOriginal) {
                    uploadedUrls.push(publicUrl);
                }

                uploadedAuditItems.push({
                    filename,
                    key,
                    variant,
                    url: publicUrl,
                    bytes: bytes.length,
                    content_type: ALLOWED_PROMPT_IMAGE_CONTENT_TYPE,
                });

                console.log(`✅ Uploaded (${variant}): ${filename} → ${publicUrl}`);
            } catch (uploadError) {
                console.error(`Failed to upload ${filename}:`, uploadError);
                // Continue with other images even if one fails
            }
        }

        if (uploadedUrls.length === 0) {
            return new Response(
                JSON.stringify({ error: 'All uploads failed' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        await recordPromptR2UploadAudit(user.id, {
            bucket: 'zaoyoeimages',
            count: uploadedAuditItems.length,
            original_count: uploadedUrls.length,
            total_bytes: uploadedAuditItems.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
            items: uploadedAuditItems,
        });

        return new Response(
            JSON.stringify({
                urls: uploadedUrls,
                assets: uploadedAssetOrder
                    .map((filename) => uploadedAssetsByFilename.get(filename))
                    .filter((asset) => asset?.original),
                count: uploadedUrls.length,
            }),
            {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );
    } catch (error) {
        console.error('Edge function error:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Internal server error' }),
            {
                status: error instanceof HttpError ? error.status : 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );
    }
});
