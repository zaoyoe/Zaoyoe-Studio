import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface UploadRequest {
    userId: string
    type?: 'avatar' | 'product' | 'poster' | 'comment' | 'guestbook' | 'chat' | 'homepage'  // Upload type
    imageUrl?: string      // External URL (e.g., Google OAuth)
    imageData?: string     // Base64 data (manual upload)
    cardImageData?: string // Product card WebP variant data
    productId?: string     // Product ID for naming (optional)
    posterId?: string      // Poster template ID for naming (optional)
    sessionId?: string     // Chat/session context for scoped filenames
    homepageSection?: string // Homepage section context for admin-managed assets
    site?: 'cn' | 'intl' | string
}

type UploadType = NonNullable<UploadRequest['type']>

const ALLOWED_UPLOAD_TYPES = new Set<UploadType>(['avatar', 'product', 'poster', 'comment', 'guestbook', 'chat', 'homepage'])
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
])
const UPLOAD_SIZE_LIMITS: Record<UploadType | 'card', number> = {
    avatar: 2 * 1024 * 1024,
    product: 5 * 1024 * 1024,
    poster: 5 * 1024 * 1024,
    comment: 3 * 1024 * 1024,
    guestbook: 3 * 1024 * 1024,
    chat: 3 * 1024 * 1024,
    homepage: 5 * 1024 * 1024,
    card: 1024 * 1024
}
const UPLOAD_RATE_LIMITS: Record<UploadType, { limit: number; windowMs: number }> = {
    avatar: { limit: 12, windowMs: 60 * 60 * 1000 },
    product: { limit: 40, windowMs: 60 * 60 * 1000 },
    poster: { limit: 30, windowMs: 60 * 60 * 1000 },
    comment: { limit: 24, windowMs: 10 * 60 * 1000 },
    guestbook: { limit: 18, windowMs: 10 * 60 * 1000 },
    chat: { limit: 36, windowMs: 10 * 60 * 1000 },
    homepage: { limit: 20, windowMs: 60 * 60 * 1000 }
}
const REQUIRED_HOMEPAGE_UPLOAD_PERMISSION = 'homepage.manage'
const ADMIN_UPLOAD_PERMISSIONS: Partial<Record<UploadType, string>> = {
    product: 'shop.manage',
    poster: 'discounts.manage',
    homepage: REQUIRED_HOMEPAGE_UPLOAD_PERMISSION
}
const DEFAULT_REMOTE_IMAGE_HOSTS = [
    'lh3.googleusercontent.com',
    'lh4.googleusercontent.com',
    'lh5.googleusercontent.com',
    'lh6.googleusercontent.com',
    'avatars.githubusercontent.com'
]
const REMOTE_IMAGE_FETCH_TIMEOUT_MS = Math.max(
    1000,
    Number(Deno.env.get('UPLOAD_REMOTE_IMAGE_TIMEOUT_MS') || 5000) || 5000
)

function normalizeUploadType(value: unknown): UploadType {
    const normalized = String(value || 'avatar').trim().toLowerCase() as UploadType
    if (!ALLOWED_UPLOAD_TYPES.has(normalized)) {
        throw new Error('Unsupported upload type')
    }
    return normalized
}

function normalizeImageContentType(value: string): string {
    return String(value || '').split(';')[0].trim().toLowerCase()
}

function assertAllowedImageContentType(contentType: string, label = 'Image') {
    const normalized = normalizeImageContentType(contentType)
    if (!ALLOWED_IMAGE_CONTENT_TYPES.has(normalized)) {
        throw new Error(`${label} type is not allowed`)
    }
}

function getAllowedRemoteImageHosts(): Set<string> {
    const configured = String(Deno.env.get('UPLOAD_REMOTE_IMAGE_HOSTS') || '')
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean)
    return new Set(configured.length ? configured : DEFAULT_REMOTE_IMAGE_HOSTS)
}

function assertSafeRemoteImageUrl(rawUrl: string): URL {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:') {
        throw new Error('Remote image must use HTTPS')
    }

    const hostname = parsed.hostname.toLowerCase()
    if (!getAllowedRemoteImageHosts().has(hostname)) {
        throw new Error('Remote image host is not allowed')
    }

    return parsed
}

async function fetchRemoteImage(url: URL): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REMOTE_IMAGE_FETCH_TIMEOUT_MS)
    try {
        return await fetch(url.toString(), {
            redirect: 'error',
            signal: controller.signal
        })
    } finally {
        clearTimeout(timer)
    }
}

async function readResponseBytesWithLimit(response: Response, limit: number, label = 'Image'): Promise<Uint8Array> {
    const reader = response.body?.getReader()
    if (!reader) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length > limit) {
            throw new Error(`${label} size exceeds ${Math.round(limit / 1024 / 1024)}MB limit`)
        }
        return bytes
    }

    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.length
        if (total > limit) {
            try {
                await reader.cancel()
            } catch (_) {
                // Best-effort stream cleanup before rejecting the upload.
            }
            throw new Error(`${label} size exceeds ${Math.round(limit / 1024 / 1024)}MB limit`)
        }
        chunks.push(value)
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
    }
    return bytes
}

function detectImageContentType(bytes: Uint8Array | null): string {
    if (!bytes || bytes.length < 4) return ''

    const isJpeg = bytes.length >= 3
        && bytes[0] === 0xff
        && bytes[1] === 0xd8
        && bytes[2] === 0xff
    if (isJpeg) return 'image/jpeg'

    const isPng = bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a
    if (isPng) return 'image/png'

    const ascii = String.fromCharCode(...bytes.slice(0, Math.min(bytes.length, 12)))
    if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) {
        return 'image/gif'
    }

    const isWebP = bytes.length >= 12
        && ascii.slice(0, 4) === 'RIFF'
        && ascii.slice(8, 12) === 'WEBP'
    if (isWebP) return 'image/webp'

    return ''
}

function assertImageMagicBytes(bytes: Uint8Array | null, expectedContentType: string, label = 'Image'): string {
    const detected = detectImageContentType(bytes)
    if (!detected) {
        throw new Error(`${label} bytes do not match a supported image format`)
    }

    const expected = normalizeImageContentType(expectedContentType)
    const normalizedExpected = expected === 'image/jpg' ? 'image/jpeg' : expected
    if (normalizedExpected && normalizedExpected !== detected) {
        throw new Error(`${label} content type does not match file bytes`)
    }

    assertAllowedImageContentType(detected, label)
    return detected
}

function decodeImageData(imageData: string): Uint8Array {
    const match = String(imageData || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
    if (!match) {
        throw new Error('Invalid image data URL')
    }
    const base64Data = match[2]
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
}

function getImageDataContentType(imageData: string): string {
    const match = String(imageData || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)
    return normalizeImageContentType(match?.[1] || 'image/jpeg')
}

function getImageExtension(contentType: string): string {
    const normalized = String(contentType || '').toLowerCase()
    if (normalized.includes('webp')) return 'webp'
    if (normalized.includes('png')) return 'png'
    if (normalized.includes('gif')) return 'gif'
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'
    return 'jpg'
}

function sanitizeR2KeySegment(value: unknown): string {
    return String(value || Date.now()).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function randomR2KeySegment(): string {
    return crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function getR2PublicUrlBase(): string {
    const configured = String(Deno.env.get('R2_PUBLIC_URL') || '').trim().replace(/\/+$/, '')
    if (!configured) {
        return 'https://cdn.zaoyoe.com'
    }

    try {
        const parsed = new URL(configured)
        if (parsed.hostname.endsWith('.r2.dev')) {
            return 'https://cdn.zaoyoe.com'
        }
        return parsed.toString().replace(/\/+$/, '')
    } catch (_) {
        return 'https://cdn.zaoyoe.com'
    }
}

function assertImageSize(imageBuffer: Uint8Array | null, type: UploadType | 'card', label = 'Image') {
    const limit = UPLOAD_SIZE_LIMITS[type] || UPLOAD_SIZE_LIMITS.avatar
    if (!imageBuffer || imageBuffer.length > limit) {
        throw new Error(`${label} size exceeds ${Math.round(limit / 1024 / 1024)}MB limit`)
    }
}

async function enforceUploadRateLimit(userId: string, type: UploadType) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY') || ''
    if (!supabaseUrl || !serviceRoleKey) {
        console.warn('⚠️ Upload rate limit skipped: missing service role env')
        return
    }

    const rateLimit = UPLOAD_RATE_LIMITS[type]
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    })

    const { data, error } = await adminClient.rpc('take_rate_limit_token', {
        p_key: `edge:image-upload:${type}:${userId}`,
        p_limit: rateLimit.limit,
        p_window_ms: rateLimit.windowMs
    })

    if (error) {
        console.warn('⚠️ Upload rate limit check skipped:', error.message)
        return
    }

    const result = Array.isArray(data) ? data[0] : data
    if (result?.allowed === false) {
        const retryAfter = Number(result?.retry_after_seconds || 60)
        throw new Error(`Upload rate limit exceeded. Please retry after ${retryAfter} seconds.`)
    }
}

function getServiceRoleClient() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY') || ''
    if (!supabaseUrl || !serviceRoleKey) {
        return null
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    })
}

async function recordR2ImageUploadAudit({
    userId,
    type,
    bucketName,
    filename,
    uploadedImageUrl,
    imageContentType,
    imageBytes,
    productId,
    posterId,
    sessionId,
    homepageSection,
    site,
    cardImageUrl
}: {
    userId: string
    type: UploadType
    bucketName: string
    filename: string
    uploadedImageUrl: string
    imageContentType: string
    imageBytes: number
    productId?: string
    posterId?: string
    sessionId?: string
    homepageSection?: string
    site?: string
    cardImageUrl?: string
}) {
    const adminClient = getServiceRoleClient()
    if (!adminClient) {
        console.warn('⚠️ Upload audit skipped: missing service role env')
        return
    }

    const details = {
        source: 'edge:upload-avatar',
        upload_type: type,
        bucket: bucketName,
        key: filename,
        url: uploadedImageUrl,
        content_type: imageContentType,
        bytes: imageBytes,
        product_id: productId || null,
        poster_id: posterId || null,
        session_id: sessionId || null,
        homepage_section: homepageSection || null,
        site: site || null,
        card_image_url: cardImageUrl || null
    }

    const { error } = await adminClient
        .from('admin_audit_logs')
        .insert({
            admin_id: userId,
            target_user_id: userId,
            action_type: `image_upload.r2.${type}`,
            details
        })

    if (error) {
        console.warn('⚠️ Upload audit insert failed:', error.message)
    }
}

function normalizePermissionList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean)
    }

    if (typeof value === 'string') {
        try {
            return normalizePermissionList(JSON.parse(value))
        } catch (_) {
            return value.split(',').map((item) => item.trim()).filter(Boolean)
        }
    }

    return []
}

function isActiveRole(role: Record<string, unknown> | null | undefined): boolean {
    const expiresAt = String(role?.expires_at || '').trim()
    if (!expiresAt) return true
    return new Date(expiresAt).getTime() > Date.now()
}

function hasAdminUploadPermissionFromRoles(roles: Array<Record<string, unknown>> = [], permission: string): boolean {
    return roles.some((role) => {
        if (!isActiveRole(role)) return false

        const roleName = String(role?.role_name || '').trim().toLowerCase()
        const permissions = normalizePermissionList(role?.permissions)
        return roleName === 'super_admin'
            || permissions.includes('*')
            || permissions.includes(permission)
    })
}

function hasAdminUploadPermissionData(data: Record<string, unknown> | null | undefined, permission: string): boolean {
    if (!data) return false
    const roleName = String(data.role || data.role_name || '').trim().toLowerCase()
    const permissions = normalizePermissionList(data.permissions)

    return data.is_super_admin === true
        || roleName === 'super_admin'
        || permissions.includes('*')
        || permissions.includes(permission)
}

async function requireAdminImageUploadPermission(
    supabaseClient: ReturnType<typeof createClient>,
    user: { id: string; email?: string | null },
    permission: string,
    label: string
) {
    try {
        const { data, error } = await supabaseClient.rpc('get_user_permissions', { p_user_id: user.id })
        if (!error && hasAdminUploadPermissionData(data as Record<string, unknown>, permission)) {
            return
        }
    } catch (permissionError) {
        console.warn(`${label} upload permission RPC failed:`, permissionError)
    }

    const { data: roles, error: roleError } = await supabaseClient
        .from('admin_roles')
        .select('role_name, permissions, expires_at')
        .eq('user_id', user.id)

    if (roleError) {
        console.warn(`${label} upload admin role check failed:`, roleError.message)
        throw new Error('Admin permission check failed')
    }

    if (!hasAdminUploadPermissionFromRoles((roles || []) as Array<Record<string, unknown>>, permission)) {
        throw new Error(`${label} image upload requires ${permission} admin permission`)
    }
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Verify authentication
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            throw new Error('Missing authorization header')
        }

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            {
                global: {
                    headers: { Authorization: authHeader },
                },
            },
        )

        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
        if (userError || !user) {
            throw new Error('Invalid authentication')
        }

        // Parse request
        const payload: UploadRequest = await req.json()
        const { userId, imageUrl, imageData, cardImageData, productId, posterId, sessionId, homepageSection, site } = payload
        const type = normalizeUploadType(payload.type)

        if (!userId) {
            throw new Error('userId is required')
        }

        if (user.id !== userId) {
            throw new Error('Authenticated user does not match upload user')
        }

        if (!imageUrl && !imageData) {
            throw new Error('Either imageUrl or imageData is required')
        }

        const requiredAdminPermission = ADMIN_UPLOAD_PERMISSIONS[type]
        if (requiredAdminPermission) {
            await requireAdminImageUploadPermission(
                supabaseClient,
                user,
                requiredAdminPermission,
                type
            )
        }

        await enforceUploadRateLimit(userId, type)

        console.log(`📸 Processing ${type} image for user: ${userId}`)

        // Get image buffer
        let imageBuffer: Uint8Array | null = null
        let imageContentType = 'image/jpeg'

        if (imageUrl) {
            console.log(`📥 Downloading from URL: ${imageUrl}`)
            const parsedImageUrl = assertSafeRemoteImageUrl(imageUrl)
            const response = await fetchRemoteImage(parsedImageUrl)
            if (!response.ok) {
                throw new Error(`Failed to download image: ${response.statusText}`)
            }
            const responseContentType = normalizeImageContentType(response.headers.get('Content-Type') || '')
            assertAllowedImageContentType(responseContentType, 'Remote image')
            imageContentType = responseContentType

            const contentLength = Number(response.headers.get('Content-Length') || 0) || 0
            if (contentLength > UPLOAD_SIZE_LIMITS[type]) {
                throw new Error(`Remote image size exceeds ${Math.round(UPLOAD_SIZE_LIMITS[type] / 1024 / 1024)}MB limit`)
            }
            imageBuffer = await readResponseBytesWithLimit(response, UPLOAD_SIZE_LIMITS[type], 'Remote image')
            imageContentType = assertImageMagicBytes(imageBuffer, imageContentType, 'Remote image')
        } else if (imageData) {
            console.log(`📄 Processing Base64 data`)
            imageContentType = getImageDataContentType(imageData)
            assertAllowedImageContentType(imageContentType)
            imageBuffer = decodeImageData(imageData)
            imageContentType = assertImageMagicBytes(imageBuffer, imageContentType)
        }

        assertImageSize(imageBuffer, type)

        // Configure R2 client (S3-compatible)
        const r2 = new S3Client({
            region: 'auto',
            endpoint: `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
                secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
            },
        })

        const productKeyBase = sanitizeR2KeySegment(productId || Date.now())
        const productExtension = getImageExtension(imageContentType)
        const safeUserId = sanitizeR2KeySegment(userId)
        const safeSessionId = sanitizeR2KeySegment(sessionId || userId)
        const safeHomepageSite = sanitizeR2KeySegment(String(site || 'cn').trim().toLowerCase() === 'intl' ? 'intl' : 'cn')
        const safeHomepageSection = sanitizeR2KeySegment(homepageSection || posterId || 'homepage')
        const uploadedAt = Date.now()
        const randomKey = sanitizeR2KeySegment(randomR2KeySegment())

        // Generate filename based on type
        let filename: string
        if (type === 'product') {
            filename = `products/${productKeyBase}.${productExtension}`
        } else if (type === 'poster') {
            filename = `affiliate-posters/${sanitizeR2KeySegment(posterId || userId)}_${uploadedAt}.jpg`
        } else if (type === 'comment') {
            filename = `comments/${safeUserId}/${uploadedAt}_${randomKey}.${productExtension}`
        } else if (type === 'guestbook') {
            filename = `guestbook/${safeUserId}/${uploadedAt}_${randomKey}.${productExtension}`
        } else if (type === 'chat') {
            filename = `chat/${safeSessionId}/${uploadedAt}_${randomKey}.${productExtension}`
        } else if (type === 'homepage') {
            filename = `homepage/${safeHomepageSite}/${safeHomepageSection}/${uploadedAt}_${randomKey}.${productExtension}`
        } else {
            filename = `avatars/${safeUserId}.jpg`
        }

        const bucketName = Deno.env.get('R2_BUCKET_NAME') || 'zaoyoe-images'
        const publicUrl = getR2PublicUrlBase()

        console.log(`⬆️ Uploading to R2: ${bucketName}/${filename}`)

        // Upload to R2
        await r2.send(
            new PutObjectCommand({
                Bucket: bucketName,
                Key: filename,
                Body: imageBuffer,
                ContentType: ['product', 'comment', 'guestbook', 'chat', 'homepage'].includes(type) ? imageContentType : 'image/jpeg',
                CacheControl: ['product', 'comment', 'guestbook', 'chat', 'homepage'].includes(type)
                    ? 'public, max-age=31536000, immutable'
                    : 'public, max-age=31536000',
            })
        )

        let productCardImageUrl = ''
        if (type === 'product' && cardImageData) {
            try {
                const cardImageContentType = getImageDataContentType(cardImageData)
                if (cardImageContentType !== 'image/webp') {
                    throw new Error('Product card image must be WebP')
                }
                const cardImageBuffer = decodeImageData(cardImageData)
                assertImageMagicBytes(cardImageBuffer, 'image/webp', 'Product card image')
                assertImageSize(cardImageBuffer, 'card', 'Product card image')

                const cardFilename = `products/card/${productKeyBase}.webp`
                console.log(`⬆️ Uploading product card variant to R2: ${bucketName}/${cardFilename}`)

                await r2.send(
                    new PutObjectCommand({
                        Bucket: bucketName,
                        Key: cardFilename,
                        Body: cardImageBuffer,
                        ContentType: 'image/webp',
                        CacheControl: 'public, max-age=31536000, immutable',
                    })
                )

                productCardImageUrl = `${publicUrl}/${cardFilename}`
                console.log(`✅ product card image uploaded successfully: ${productCardImageUrl}`)
            } catch (cardUploadError) {
                console.warn('⚠️ Product card image upload failed:', cardUploadError)
            }
        }

        // Generate public URL
        const uploadedImageUrl = `${publicUrl}/${filename}`
        const imageAsset = type === 'product'
            ? {
                original: uploadedImageUrl,
                ...(productCardImageUrl ? { card: productCardImageUrl } : {}),
            }
            : null

        await recordR2ImageUploadAudit({
            userId,
            type,
            bucketName,
            filename,
            uploadedImageUrl,
            imageContentType,
            imageBytes: imageBuffer?.length || 0,
            productId,
            posterId,
            sessionId,
            homepageSection,
            site: String(site || '').trim(),
            cardImageUrl: productCardImageUrl || ''
        })

        console.log(`✅ ${type} image uploaded successfully: ${uploadedImageUrl}`)

        return new Response(
            JSON.stringify({
                success: true,
                imageUrl: uploadedImageUrl,
                avatarUrl: uploadedImageUrl,
                cardImageUrl: productCardImageUrl || null,
                imageAsset
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )

    } catch (error) {
        console.error('❌ Error uploading avatar:', error)
        return new Response(
            JSON.stringify({
                success: false,
                error: error.message
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            }
        )
    }
})
