# Upload to R2 Edge Function

This Supabase Edge Function handles uploading images directly to Cloudflare R2 CDN from the Admin Studio.

## Features

- ✅ Admin authentication and authorization
- ✅ Direct upload to R2 using S3-compatible API
- ✅ Automatic WebP format support
- ✅ Secure credential management (server-side only)
- ✅ CORS support for browser requests

## Environment Variables Required

Set these using `supabase secrets set`:

```bash
R2_ENDPOINT=https://cd39b0e8dba64c7f804d8e00d40e5d4a.r2.cloudflarestorage.com
R2_ACCESS_KEY=<your-access-key-id>
R2_SECRET_KEY=<your-secret-access-key>
```

## Deployment

```bash
# Deploy the function
supabase functions deploy upload-to-r2

# Set secrets
supabase secrets set R2_ENDPOINT=<endpoint>
supabase secrets set R2_ACCESS_KEY=<key>
supabase secrets set R2_SECRET_KEY=<secret>
```

## Usage

The function is called from `admin-studio.js`:

```javascript
const response = await fetch(
    'https://mmkugdibsaeoevliebzk.supabase.co/functions/v1/upload-to-r2',
    {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            images: [
                { base64: '...', filename: 'image.webp' }
            ]
        })
    }
);
```

## Response Format

Success:
```json
{
    "urls": [
        "https://pub-xxx.r2.dev/prompts/image1.webp",
        "https://pub-xxx.r2.dev/prompts/image2.webp"
    ],
    "count": 2
}
```

Error:
```json
{
    "error": "Error message"
}
```
