/**
 * Avatar Uploader
 * Helper functions for uploading avatars to R2 via Supabase Edge Function
 */
(function () {
    'use strict';

    const AVATAR_SUPABASE_URL = 'https://auth.zaoyoe.com';

    /**
     * Upload avatar to R2
     * @param {Object} options
     * @param {string} options.userId - User ID
     * @param {string} [options.imageUrl] - External image URL (e.g., Google OAuth)
     * @param {string} [options.imageData] - Base64 image data (manual upload)
     * @returns {Promise<string>} R2 CDN URL
     */
    async function uploadAvatarToR2({ userId, imageUrl, imageData }) {
        try {
            console.log(`📸 Uploading avatar for user: ${userId}`);

            // Get current user token
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) {
                throw new Error('User not authenticated');
            }

            // Call Edge Function
            const response = await fetch(
                `${AVATAR_SUPABASE_URL}/functions/v1/upload-avatar`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        userId,
                        imageUrl,
                        imageData
                    })
                }
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Upload failed');
            }

            const { avatarUrl } = await response.json();
            console.log(`✅ Avatar uploaded: ${avatarUrl}`);

            // Update profile in database
            const { error: dbError } = await window.supabaseClient
                .from('profiles')
                .update({ avatar_url: avatarUrl })
                .eq('id', userId);

            if (dbError) {
                console.error('❌ Failed to update profile:', dbError);
                // Avatar uploaded but DB update failed - not critical
            }

            // 🆕 Update localStorage cache so avatar shows immediately on refresh
            try {
                const cached = localStorage.getItem('cached_user_profile');
                if (cached) {
                    const cachedProfile = JSON.parse(cached);
                    cachedProfile.avatarUrl = avatarUrl;
                    localStorage.setItem('cached_user_profile', JSON.stringify(cachedProfile));
                    console.log('💾 Updated cached_user_profile with new avatar URL');
                }
            } catch (e) {
                console.warn('⚠️ Failed to update cached profile:', e);
            }

            return avatarUrl;

        } catch (error) {
            console.error('❌ Error uploading avatar:', error);

            // Fallback to DiceBear default avatar
            const fallbackUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`;
            console.log(`⚠️ Using fallback avatar: ${fallbackUrl}`);

            return fallbackUrl;
        }
    }

    /**
     * Resize image on client side before upload
     * @param {File|Blob} file - Image file
     * @param {number} maxSize - Maximum dimension (default: 200)
     * @returns {Promise<string>} Base64 data URL
     */
    function resizeImage(file, maxSize = 200) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                const img = new Image();

                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    let width = img.width;
                    let height = img.height;

                    // Calculate new dimensions
                    if (width > height) {
                        if (width > maxSize) {
                            height *= maxSize / width;
                            width = maxSize;
                        }
                    } else {
                        if (height > maxSize) {
                            width *= maxSize / height;
                            height = maxSize;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convert to JPEG with 80% quality
                    const base64 = canvas.toDataURL('image/jpeg', 0.8);
                    resolve(base64);
                };

                img.onerror = reject;
                img.src = e.target.result;
            };

            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Export for global access
    window.uploadAvatarToR2 = uploadAvatarToR2;
    window.resizeImage = resizeImage;

    console.log('✅ Avatar uploader initialized');
})();
