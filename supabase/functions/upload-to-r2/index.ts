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

function sanitizePromptImageFilename(filename: unknown): string {
    return String(filename || '')
        .split(/[\\/]/)
        .pop()
        ?.replace(/[^a-zA-Z0-9._-]/g, '_') || '';
}

function getPromptImageUploadTarget(image: Record<string, unknown>) {
    const isThumb = Boolean(image?.isThumb);
    const requestedVariant = String(image?.variant || (isThumb ? 'thumb' : 'original')).trim();
    const variant = Object.prototype.hasOwnProperty.call(PROMPT_IMAGE_VARIANT_PREFIXES, requestedVariant)
        ? requestedVariant
        : (isThumb ? 'thumb' : 'original');
    const filename = sanitizePromptImageFilename(image?.filename);
    const prefix = PROMPT_IMAGE_VARIANT_PREFIXES[variant];

    return {
        key: filename ? `${prefix}/${filename}` : '',
        variant,
        isOriginal: variant === 'original',
    };
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

        console.log(`✅ User authenticated: ${user.email}`);


        // Parse request body
        const { images } = await req.json();

        if (!images || !Array.isArray(images) || images.length === 0) {
            return new Response(
                JSON.stringify({ error: 'No images provided' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Initialize R2 S3 client
        const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT');
        const R2_ACCESS_KEY = Deno.env.get('R2_ACCESS_KEY');
        const R2_SECRET_KEY = Deno.env.get('R2_SECRET_KEY');
        const R2_PUBLIC_URL = 'https://cdn.zaoyoe.com';

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

        for (const image of images) {
            const { base64, filename } = image;
            const { key, variant, isOriginal } = getPromptImageUploadTarget(image);

            if (!base64 || !filename || !key) {
                console.warn('Skipping invalid image:', image);
                continue;
            }

            try {
                // Convert base64 to buffer
                const binaryString = atob(base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                await s3Client.send(
                    new PutObjectCommand({
                        Bucket: 'zaoyoeimages',
                        Key: key,
                        Body: bytes,
                        ContentType: 'image/webp',
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
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );
    }
});
