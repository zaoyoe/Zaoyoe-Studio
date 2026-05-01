import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface UploadRequest {
    userId: string
    type?: 'avatar' | 'product' | 'poster'  // Upload type
    imageUrl?: string      // External URL (e.g., Google OAuth)
    imageData?: string     // Base64 data (manual upload)
    cardImageData?: string // Product card WebP variant data
    productId?: string     // Product ID for naming (optional)
    posterId?: string      // Poster template ID for naming (optional)
}

function decodeImageData(imageData: string): Uint8Array {
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '')
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
}

function getImageDataContentType(imageData: string): string {
    const match = String(imageData || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)
    return match?.[1] || 'image/jpeg'
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

        // Parse request
        const { userId, type = 'avatar', imageUrl, imageData, cardImageData, productId, posterId }: UploadRequest = await req.json()

        if (!userId) {
            throw new Error('userId is required')
        }

        if (!imageUrl && !imageData) {
            throw new Error('Either imageUrl or imageData is required')
        }

        console.log(`📸 Processing ${type} image for user: ${userId}`)

        // Get image buffer
        let imageBuffer: Uint8Array | null = null
        let imageContentType = 'image/jpeg'

        if (imageUrl) {
            console.log(`📥 Downloading from URL: ${imageUrl}`)
            const response = await fetch(imageUrl)
            if (!response.ok) {
                throw new Error(`Failed to download image: ${response.statusText}`)
            }
            const responseContentType = response.headers.get('Content-Type') || ''
            if (responseContentType.toLowerCase().startsWith('image/')) {
                imageContentType = responseContentType.split(';')[0].trim()
            }
            const arrayBuffer = await response.arrayBuffer()
            imageBuffer = new Uint8Array(arrayBuffer)
        } else if (imageData) {
            console.log(`📄 Processing Base64 data`)
            imageContentType = getImageDataContentType(imageData)
            imageBuffer = decodeImageData(imageData)
        }

        // Validate image size (max 5MB)
        if (!imageBuffer || imageBuffer.length > 5 * 1024 * 1024) {
            throw new Error('Image size exceeds 5MB limit')
        }

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

        // Generate filename based on type
        const filename = type === 'product'
            ? `products/${productKeyBase}.${productExtension}`
            : type === 'poster'
                ? `affiliate-posters/${posterId || userId}_${Date.now()}.jpg`
                : `avatars/${userId}.jpg`

        const bucketName = Deno.env.get('R2_BUCKET_NAME') || 'zaoyoe-images'
        const publicUrl = Deno.env.get('R2_PUBLIC_URL') || 'https://cdn.zaoyoe.com'

        console.log(`⬆️ Uploading to R2: ${bucketName}/${filename}`)

        // Upload to R2
        await r2.send(
            new PutObjectCommand({
                Bucket: bucketName,
                Key: filename,
                Body: imageBuffer,
                ContentType: type === 'product' ? imageContentType : 'image/jpeg',
                CacheControl: 'public, max-age=31536000', // 1 year cache
            })
        )

        let productCardImageUrl = ''
        if (type === 'product' && cardImageData) {
            try {
                const cardImageBuffer = decodeImageData(cardImageData)
                if (cardImageBuffer.length > 5 * 1024 * 1024) {
                    throw new Error('Product card image size exceeds 5MB limit')
                }

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

        console.log(`✅ ${type} image uploaded successfully: ${uploadedImageUrl}`)

        return new Response(
            JSON.stringify({
                success: true,
                imageUrl: uploadedImageUrl,
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
