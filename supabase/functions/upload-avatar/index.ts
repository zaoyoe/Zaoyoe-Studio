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
    productId?: string     // Product ID for naming (optional)
    posterId?: string      // Poster template ID for naming (optional)
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
        const { userId, type = 'avatar', imageUrl, imageData, productId, posterId }: UploadRequest = await req.json()

        if (!userId) {
            throw new Error('userId is required')
        }

        if (!imageUrl && !imageData) {
            throw new Error('Either imageUrl or imageData is required')
        }

        console.log(`📸 Processing ${type} image for user: ${userId}`)

        // Get image buffer
        let imageBuffer: Uint8Array

        if (imageUrl) {
            console.log(`📥 Downloading from URL: ${imageUrl}`)
            const response = await fetch(imageUrl)
            if (!response.ok) {
                throw new Error(`Failed to download image: ${response.statusText}`)
            }
            const arrayBuffer = await response.arrayBuffer()
            imageBuffer = new Uint8Array(arrayBuffer)
        } else if (imageData) {
            console.log(`📄 Processing Base64 data`)
            // Remove data URL prefix if present
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '')
            const binaryString = atob(base64Data)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i)
            }
            imageBuffer = bytes
        }

        // Validate image size (max 5MB)
        if (imageBuffer.length > 5 * 1024 * 1024) {
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

        // Generate filename based on type
        const filename = type === 'product'
            ? `products/${productId || Date.now()}.jpg`
            : type === 'poster'
                ? `affiliate-posters/${posterId || userId}_${Date.now()}.jpg`
                : `avatars/${userId}.jpg`

        const bucketName = Deno.env.get('R2_BUCKET_NAME') || 'zaoyoe-images'

        console.log(`⬆️ Uploading to R2: ${bucketName}/${filename}`)

        // Upload to R2
        await r2.send(
            new PutObjectCommand({
                Bucket: bucketName,
                Key: filename,
                Body: imageBuffer,
                ContentType: 'image/jpeg',
                CacheControl: 'public, max-age=31536000', // 1 year cache
            })
        )

        // Generate public URL
        const publicUrl = Deno.env.get('R2_PUBLIC_URL') || 'https://cdn.zaoyoe.com'
        const uploadedImageUrl = `${publicUrl}/${filename}`

        console.log(`✅ ${type} image uploaded successfully: ${uploadedImageUrl}`)

        return new Response(
            JSON.stringify({
                success: true,
                imageUrl: uploadedImageUrl
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
