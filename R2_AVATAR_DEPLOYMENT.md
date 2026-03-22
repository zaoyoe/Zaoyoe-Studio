# R2 Avatar Upload - Deployment Guide

## 📦 What's Been Implemented

✅ Supabase Edge Function (`/supabase/functions/upload-avatar/index.ts`)
✅ Frontend helper (`/js/avatar-uploader.js`)
✅ Modified avatar upload to use R2 instead of Base64
✅ Automatic Google OAuth avatar upload on login/registration
✅ Fallback to DiceBear avatar on R2 upload failure

---

## 🚀 Deployment Steps

### Step 1: Install Supabase CLI

```bash
npm install -g supabase
```

### Step 2: Link Your Project

```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
supabase link --project-ref <your-project-ref>
```

### Step 3: Set R2 Environment Variables

```bash
# Set R2 credentials as Supabase secrets
supabase secrets set R2_ACCOUNT_ID="your-cloudflare-account-id"
supabase secrets set R2_ACCESS_KEY_ID="your-r2-access-key-id"
supabase secrets set R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
supabase secrets set R2_BUCKET_NAME="zaoyoe-images"
supabase secrets set R2_PUBLIC_URL="https://pub-<your-bucket-public-id>.r2.dev"
```

**Where to get credentials**:
1. **Account ID**: Cloudflare Dashboard → R2 → Overview
2. **Access Keys**: Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token
3. **Public URL**: Your R2 bucket public URL (from bucket settings)

### Step 4: Deploy Edge Function

```bash
supabase functions deploy upload-avatar
```

### Step 5: Verify Deployment

Test the Edge Function:

```bash
curl -X POST https://<your-project-ref>.supabase.co/functions/v1/upload-avatar \
  -H "Authorization: Bearer YOUR_USER_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user-id",
    "imageUrl": "https://example.com/avatar.jpg"
  }'
```

Expected response:
```json
{
  "success": true,
  "avatarUrl": "https://pub-xxx.r2.dev/avatars/test-user-id.jpg"
}
```

---

## 🧪 Testing

### Test 1: Manual Avatar Upload

1. Login to your site (localhost:8000)
2. Open Profile modal
3. Click "Change Avatar"
4. Upload an image
5. Check console for `✅ Avatar uploaded to R2`
6. Verify avatar displays from R2 URL

### Test 2: Google OAuth Avatar

1. Logout
2. Login with Google OAuth
3. Check console for `📸 Uploading Google OAuth avatar to R2...`
4. Verify avatar is uploaded to R2
5. Check `profiles.avatar_url` in database - should be R2 URL

### Test 3: Fallback Behavior

1. Stop the Edge Function (temporarily)
2. Try uploading an avatar
3. Should see fallback to DiceBear avatar
4. No errors should crash the app

---

## 📂 Files Modified

| File | Purpose |
|------|---------|
| `/supabase/functions/upload-avatar/index.ts` | Edge Function for R2 uploads |
| `/js/avatar-uploader.js` | Frontend upload helper |
| `/supabase-auth-functions.js` | Updated `handleAvatarUpload`, added OAuth auto-upload |
| `/index.html` | Loaded `avatar-uploader.js` |
| `/guestbook.html` | Loaded `avatar-uploader.js` |
| `/prompts.html` | Loaded `avatar-uploader.js` |

---

## 🔧 Configuration

### R2 Bucket Setup

Ensure your R2 bucket has:
- ✅ Public read access enabled
- ✅ CORS configured (if needed)
- ✅ `/avatars/` folder (will be created automatically)

### Environment Variables (Supabase Secrets)

```
R2_ACCOUNT_ID         # Your Cloudflare account ID
R2_ACCESS_KEY_ID      # R2 API access key
R2_SECRET_ACCESS_KEY  # R2 API secret key
R2_BUCKET_NAME        # "zaoyoe-images"
R2_PUBLIC_URL         # https://pub-xxx.r2.dev or custom domain
```

---

## 🐛 Troubleshooting

### Edge Function fails to deploy

**Error**: `Missing environment variables`

**Solution**: Ensure all R2 secrets are set:
```bash
supabase secrets list
```

### Avatar upload returns 400

**Error**: `Invalid imageData or imageUrl`

**Solution**: Check console logs - ensure `avatar-uploader.js` is loaded before `supabase-auth-functions.js`

### Google avatar not uploading

**Issue**: Avatar still shows Google URL

**Check**: 
1. Console logs for `📸 Uploading Google OAuth avatar to R2...`
2. If missing, `window.uploadAvatarToR2` may not be defined
3. Ensure `avatar-uploader.js` loads successfully

### R2 upload unauthorized

**Error**: `Access Denied` from R2

**Solution**: 
1. Verify R2 API token has `Object Read & Write` permission
2. Check bucket name matches `R2_BUCKET_NAME`

---

## ✅ Success Criteria

After deployment, verify:

- [  ] Edge Function deploys without errors
- [  ] Manual avatar upload saves to R2
- [  ] Google OAuth avatars auto-upload to R2
- [  ] `profiles.avatar_url` contains R2 URLs (not Base64 or Google URLs)
- [  ] Avatars load from R2 CDN (<500ms)
- [  ] Fallback to DiceBear works if R2 fails

---

## 📞 Next Steps

1. **Deploy Edge Function** (Step 1-4 above)
2. **Test thoroughly** (All 3 tests)
3. **Monitor logs** in Supabase Dashboard → Functions → upload-avatar
4. **Optional**: Migrate existing Base64 avatars to R2 (migration script not included)

---

## 💡 Notes

- **TypeScript Lint Errors**: The lint errors for  `index.ts` are normal - Deno runtime provides `Deno` global and imports at runtime. They won't affect deployment.
- **Cost**: R2 is extremely cheap (~$0/month for <10K users). No egress fees!
- **Performance**: CDN-accelerated globally. Faster than database Base64 avatars.
- **Reliability**: Fallback to DiceBear ensures avatars always display, even if R2 fails.

---

## 🎉 Completion

Once deployed, all new avatars will automatically save to R2, and Google OAuth avatars will be cached on your CDN. No more blocked Google images in China!
