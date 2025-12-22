// --- Theme Toggle ---
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function toggleTheme(event) {
    // Prevent dropdown from closing when clicking the toggle
    if (event) {
        event.stopPropagation();
    }

    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');

    if (currentTheme === 'dark') {
        html.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    } else {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
}

// ========================================
// AVATAR MENU SYSTEM
// ========================================
const ADMIN_EMAIL = 'zaoyoe@gmail.com';
let isAdmin = false;

// ========================================
// SEARCH OPTIMIZATION CONFIG
// ========================================
// Gemini 2.0 Flash for semantic search (high RPD: 1,500/day)
const GEMINI_2_0_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// AI Search Rate Limiting
const AI_SEARCH_RATE_LIMIT = {
    maxPerMinute: 3,           // Max AI searches per minute for regular users
    windowMs: 60000,           // 1 minute window
    userSearchHistory: [],     // Timestamps of AI searches
    cooldownShown: false       // Prevent duplicate cooldown messages
};

// Hot tags cache (computed once on init)
let HOT_TAGS_CACHE = null;

// Inverted search index for O(1) tag lookups (built on init)
// Structure: { "tag_lowercase": [promptIndex1, promptIndex2, ...] }
let SEARCH_INDEX = null;

/**
 * Build inverted search index for all searchable content
 * Called once during initialization for O(1) lookups
 */
function buildSearchIndex() {
    // 如果索引已存在且数据量合理，跳过重建
    // 否则重建（处理数据更新后索引过期的情况）
    if (SEARCH_INDEX && Object.keys(SEARCH_INDEX).length > 50) return;
    if (typeof PROMPTS === 'undefined' || PROMPTS.length === 0) return;

    console.log('🔍 Building search index...');
    SEARCH_INDEX = {};

    PROMPTS.forEach((p, id) => {
        if (!p) return;

        const addToIndex = (term) => {
            if (!term || term.length < 2) return;
            const key = term.toLowerCase().trim();
            if (!SEARCH_INDEX[key]) SEARCH_INDEX[key] = [];
            if (!SEARCH_INDEX[key].includes(id)) {
                SEARCH_INDEX[key].push(id);
            }
        };

        // Index title words
        if (p.title) {
            p.title.split(/\s+/).forEach(addToIndex);
            addToIndex(p.title); // Also index full title
        }

        // Index tags
        if (p.tags) {
            p.tags.forEach(addToIndex);
        }

        // Index AI tags (all categories, both languages)
        // 兼容 aiTags 和 ai_tags 两种字段名
        const aiTags = p.aiTags || p.ai_tags;
        if (aiTags) {
            ['objects', 'scenes', 'styles', 'mood'].forEach(category => {
                const tagData = aiTags[category];
                if (tagData?.en) tagData.en.forEach(addToIndex);
                if (tagData?.zh) tagData.zh.forEach(addToIndex);
            });

            // Index useCase (platform, purpose, format)
            if (aiTags.useCase) {
                if (aiTags.useCase.platform) aiTags.useCase.platform.forEach(addToIndex);
                if (aiTags.useCase.purpose) aiTags.useCase.purpose.forEach(addToIndex);
                if (aiTags.useCase.format) aiTags.useCase.format.forEach(addToIndex);
            }

            // Index commercial (niche, targetAudience)
            if (aiTags.commercial) {
                if (aiTags.commercial.niche) aiTags.commercial.niche.forEach(addToIndex);
                if (aiTags.commercial.targetAudience) aiTags.commercial.targetAudience.forEach(addToIndex);
            }

            // Index difficulty
            if (aiTags.difficulty) addToIndex(aiTags.difficulty);
        }

        // Index dominant colors
        if (p.dominantColors) {
            p.dominantColors.forEach(addToIndex);
        }
    });

    console.log(`✅ Search index built: ${Object.keys(SEARCH_INDEX).length} terms`);
}

/**
 * Fast index-based search (O(1) per term)
 * @param {string} query - Search query
 * @returns {Set<number>} - Set of matching prompt indices
 */
function searchByIndex(query) {
    if (!SEARCH_INDEX) buildSearchIndex();

    const terms = query.toLowerCase().trim().split(/\s+/);
    let results = null;

    terms.forEach(term => {
        // Direct match
        const directMatches = new Set(SEARCH_INDEX[term] || []);

        // Partial match (for terms that are substrings)
        Object.keys(SEARCH_INDEX).forEach(indexedTerm => {
            if (indexedTerm.includes(term) || term.includes(indexedTerm)) {
                SEARCH_INDEX[indexedTerm].forEach(id => directMatches.add(id));
            }
        });

        if (results === null) {
            results = directMatches;
        } else {
            // Intersect for multi-word queries
            results = new Set([...results].filter(id => directMatches.has(id)));
        }
    });

    return results || new Set();
}

// Synonym dictionary for enhanced local search
const SYNONYM_DICTIONARY = {
    // === Style synonyms ===
    'cute': ['adorable', 'kawaii', 'lovely', 'charming', '可爱', '萌', 'かわいい'],
    'vintage': ['retro', 'classic', 'nostalgic', 'old-fashioned', '复古', '怀旧', '经典'],
    'minimalist': ['minimal', 'simple', 'clean', '极简', '简约', '简洁'],
    'futuristic': ['sci-fi', 'cyberpunk', 'tech', 'future', '科幻', '未来感', '赛博朋克'],
    'dreamy': ['ethereal', 'soft', 'hazy', 'fairytale', '梦幻', '朦胧', '童话'],
    'dramatic': ['intense', 'powerful', 'bold', 'cinematic', '戏剧性', '张力', '电影感'],
    'whimsical': ['playful', 'whimsy', 'fantastical', '异想天开', '俏皮', '奇幻'],

    // === Subject synonyms ===
    'portrait': ['headshot', 'face', 'person', '人像', '头像', '肖像', '人物'],
    'landscape': ['scenery', 'nature', 'view', '风景', '山水', '自然', '风光'],
    'food': ['cuisine', 'dish', 'meal', 'culinary', '美食', '食物', '料理'],
    'animal': ['pet', 'creature', 'wildlife', '动物', '宠物', '生物'],

    // === Platform/Use case synonyms ===
    '小红书': ['xiaohongshu', 'xhs', 'red', '种草', 'rednote', '小红书封面'],
    'instagram': ['ins', 'ig', 'insta', 'gram'],
    'wallpaper': ['壁纸', 'background', '背景图', '锁屏', '桌面', '手机壁纸'],
    'avatar': ['头像', 'profile picture', 'pfp', '头图', 'icon'],
    'poster': ['海报', 'banner', '宣传图', '封面'],
    'cover': ['封面', 'thumbnail', '首图', '缩略图'],
    '抖音': ['douyin', 'tiktok', '抖音头图', '短视频'],
    '公众号': ['wechat', 'weixin', '微信公众号', '公众号配图'],
    '淘宝': ['taobao', 'ecommerce', '电商', '淘宝主图', '主图'],

    // === Purpose/Use synonyms ===
    '电商卖货': ['ecommerce', 'selling', '卖货', '带货', '商品'],
    '品牌营销': ['branding', 'marketing', '品牌', '营销推广'],
    '个人IP': ['personal brand', 'ip', '人设', '自媒体'],
    '知识付费': ['course', 'education', '课程', '付费内容'],
    '表情包': ['sticker', 'emoji', 'meme', '贴纸'],
    '自媒体配图': ['blog', 'article', '文章配图', '推文'],

    // === Commercial niche synonyms ===
    '母婴': ['baby', 'parenting', 'mom', '宝宝', '育儿', '亲子'],
    '美妆': ['beauty', 'makeup', 'cosmetic', '化妆', '护肤', '彩妆'],
    '健身': ['fitness', 'gym', 'workout', '运动', '减肥', '塑形'],
    '旅游': ['travel', 'trip', 'vacation', '旅行', '出游', '度假'],
    '教育': ['education', 'learning', 'study', '学习', '培训', '考试'],
    '宠物': ['pet', 'cat', 'dog', '猫', '狗', '萌宠'],
    '家居': ['home', 'interior', 'decor', '装修', '居家', '生活'],
    '时尚': ['fashion', 'style', 'outfit', '穿搭', '潮流', '服饰'],
    '游戏': ['game', 'gaming', 'esports', '电竞', '玩家'],
    '情感': ['emotion', 'love', 'relationship', '恋爱', '情侣', '心理'],

    // === Target audience synonyms ===
    'Z世代': ['gen z', 'genz', '00后', '年轻人', '学生'],
    '职场女性': ['career woman', 'office', '白领', '打工人'],
    '新手妈妈': ['new mom', 'mommy', '宝妈', '准妈妈'],
    '文艺青年': ['artsy', 'artistic', '文青', '小众'],
    '二次元': ['anime', 'acg', '动漫', '宅'],

    // === Difficulty synonyms ===
    '新手友好': ['beginner', 'easy', 'simple', '入门', '简单'],
    '进阶': ['intermediate', 'advanced', '中级', '提高'],
    '专业级': ['professional', 'expert', 'pro', '高级', '专业'],

    // === Mood synonyms ===
    'peaceful': ['serene', 'tranquil', 'calm', 'quiet', '平静', '安宁', '治愈', '宁静'],
    'cozy': ['warm', 'comfortable', 'homey', '温馨', '舒适', '暖心'],
    'mysterious': ['mystic', 'enigmatic', 'dark', '神秘', '迷幻', '暗黑'],
    'elegant': ['graceful', 'refined', 'sophisticated', '优雅', '典雅', '精致'],

    // === Technique synonyms ===
    'miniature': ['mini', 'tiny', 'micro', 'small', '微缩', '迷你', '微观'],
    '3d': ['three-dimensional', '3d art', '3d render', '三维', '立体'],
    'illustration': ['illustrate', 'drawing', 'artwork', '插画', '插图', '绘画'],
    'photography': ['photo', 'photograph', 'camera', '摄影', '照片', '拍摄'],

    // === Nature synonyms ===
    'leaf': ['leaves', 'foliage', '树叶', '叶子', '叶片', '绿叶'],
    'flower': ['floral', 'bloom', 'blossom', '花', '花卉', '鲜花'],
    'tree': ['forest', 'woods', '树', '森林', '树木'],
    'mountain': ['hill', 'peak', '山', '山脉', '峰'],
    'ocean': ['sea', 'water', 'wave', 'beach', '海', '海洋', '海浪', '海滩'],
    'sky': ['cloud', 'starry', '天空', '云', '星空'],
    'snow': ['winter', 'ice', '雪', '冬', '冰'],
    'rain': ['rainy', '雨', '下雨'],

    // === Transport synonyms ===
    'bicycle': ['bike', 'cycling', '自行车', '单车', '脚踏车', '骑行'],
    'car': ['vehicle', 'auto', '汽车', '轿车', '车'],

    // === People synonyms ===
    'girl': ['woman', 'female', 'lady', '女孩', '女生', '女性'],
    'boy': ['man', 'male', 'guy', '男孩', '男生', '男性'],
    'child': ['kid', 'baby', '儿童', '小孩', '宝宝']
};

function toggleAvatarMenu() {
    const dropdown = document.getElementById('avatarDropdown');
    dropdown.classList.toggle('active');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const container = document.getElementById('userAvatarContainer');
    const dropdown = document.getElementById('avatarDropdown');
    if (container && dropdown && !container.contains(e.target)) {
        dropdown.classList.remove('active');
    }
});

// Check auth state and update UI
async function checkAuthState() {
    if (!window.supabaseClient) return;

    try {
        const { data: { user } } = await window.supabaseClient.auth.getUser();

        const identityName = document.querySelector('.identity-name');
        const avatarBtn = document.getElementById('userAvatarBtn');
        const profileBtn = document.getElementById('profileBtn');
        const switchAccountBtn = document.getElementById('switchAccountBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const adminStudioBtn = document.getElementById('adminStudioBtn');

        if (user) {
            // User is logged in
            const displayName = user.email.split('@')[0];
            isAdmin = user.email === ADMIN_EMAIL;

            if (identityName) {
                identityName.innerHTML = isAdmin
                    ? `${displayName} <span class="admin-badge">✨</span>`
                    : displayName;
            }

            // 🆕 Fetch profile from database to get custom avatar
            let customAvatarUrl = null;
            try {
                const { data: profile, error } = await window.supabaseClient
                    .from('profiles')
                    .select('avatar_url')
                    .eq('id', user.id)
                    .single();

                console.log('📷 Profile avatar check:', {
                    hasProfile: !!profile,
                    avatarUrl: profile?.avatar_url ? profile.avatar_url.substring(0, 50) + '...' : 'NULL',
                    error: error?.message
                });

                // Check if avatar is valid AND has sufficient data content (prevent 1x1 pixel images)
                // A 1x1 pixel base64 png is usually very short (~60-80 chars). A real avatar is much larger.
                const MIN_BASE64_LENGTH = 100;

                if (!error && profile?.avatar_url && profile.avatar_url.trim() !== '') {
                    const url = profile.avatar_url;
                    let isValid = false;

                    if (url.startsWith('http')) {
                        isValid = true;
                    } else if (url.startsWith('data:')) {
                        // Check base64 length to filter out broken/empty images
                        if (url.length > MIN_BASE64_LENGTH) {
                            isValid = true;
                        } else {
                            console.warn('⚠️ Ignored invalid/too small base64 avatar:', url.substring(0, 50) + '...');
                        }
                    }

                    if (isValid) {
                        customAvatarUrl = url;
                        console.log('✅ Using custom avatar from profiles table');
                    }
                }
            } catch (e) {
                console.warn('Could not fetch profile avatar:', e);
            }

            if (avatarBtn) {
                // Priority: 1. Custom avatar from profiles table, 2. Google avatar, 3. Default
                const avatarUrl = customAvatarUrl || user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}&background=6b9ece&color=fff`;
                const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}&background=6b9ece&color=fff`;

                // Create image with proper error handling
                const img = document.createElement('img');
                img.alt = 'Avatar';
                img.onerror = function () {
                    console.warn('⚠️ Avatar load failed, using fallback');
                    this.onerror = null;
                    this.src = fallbackUrl;
                };
                img.src = avatarUrl;

                // Clear and append
                avatarBtn.innerHTML = '';
                avatarBtn.appendChild(img);

                // 🆕 Update localStorage cache with correct avatar to prevent flash on next load
                const cachedProfile = {
                    avatarUrl: avatarUrl,
                    nickname: displayName,
                    username: user.email
                };
                localStorage.setItem('cached_user_profile', JSON.stringify(cachedProfile));
                console.log('💾 Updated cached_user_profile with correct avatar');
            }

            // Show Profile and Switch Account for all logged-in users
            if (profileBtn) profileBtn.style.display = 'flex';
            if (switchAccountBtn) switchAccountBtn.style.display = 'flex';
            if (logoutBtn) logoutBtn.style.display = 'flex';

            // Only show Enter Studio for admin
            if (adminStudioBtn) adminStudioBtn.style.display = isAdmin ? 'flex' : 'none';
        } else {
            // Guest - hide all user controls
            if (identityName) identityName.textContent = 'Guest';
            if (profileBtn) profileBtn.style.display = 'none';
            if (switchAccountBtn) switchAccountBtn.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (adminStudioBtn) adminStudioBtn.style.display = 'none';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

function showLoginModal() {
    // Open the admin login modal
    const modal = document.getElementById('adminLoginModal');
    if (modal) {
        modal.classList.add('active');
        toggleAvatarMenu(); // Close the avatar dropdown
    }
}

function closeAdminLoginModal() {
    const modal = document.getElementById('adminLoginModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function handleGoogleLogin() {
    console.log('🔵 Google Login button clicked');

    const redirectUrl = window.location.href.split('?')[0];
    console.log('🔗 Redirect URL:', redirectUrl);

    try {
        const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl
            }
        });

        if (error) throw error;

        console.log('🔄 Redirecting to Google...');
        closeAdminLoginModal();

    } catch (error) {
        console.error('❌ Google login error:', error);
        alert('Google 登录失败: ' + error.message);
    }
}

async function logoutUser() {
    if (!window.supabaseClient) return;
    await window.supabaseClient.auth.signOut();
    checkAuthState();
    toggleAvatarMenu();
}

function openGalleryProfile() {
    // Navigate to homepage with profile modal flag
    toggleAvatarMenu();
    sessionStorage.setItem('openProfileModal', 'true');
    window.location.href = 'index.html';
}

async function switchGalleryAccount() {
    toggleAvatarMenu();
    if (!window.supabaseClient) return;

    // Sign out and redirect to homepage login
    await window.supabaseClient.auth.signOut();
    sessionStorage.setItem('openLoginModal', 'true');
    window.location.href = 'index.html';
}

function enterAdminStudio() {
    // Navigate to Admin Studio
    window.location.href = 'admin-studio.html';
    toggleAvatarMenu();
}

// Initialize theme before page renders
initTheme();

// ========================================
// SUPABASE DATA LOADING
// ========================================
async function loadPromptsFromSupabase() {
    if (!window.supabaseClient) {
        console.log('Supabase client not available, using static data');
        return false;
    }

    try {
        const { data, error } = await window.supabaseClient
            .from('prompts')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Supabase fetch error:', error);
            return false;
        }

        if (data && data.length > 0) {
            // Transform Supabase data to match PROMPTS format
            const supabasePrompts = data.map((item, index) => ({
                id: index,
                supabaseId: item.id, // Keep the real Supabase ID for reference
                title: item.title,
                tags: item.tags || [],
                description: item.description || '',
                prompt: item.prompt_text || '',
                images: item.images || [],
                dominantColors: item.dominant_colors || [],
                aiTags: item.ai_tags || {}
            }));

            // REPLACE PROMPTS with only Supabase data (ignore local prompts-data.js)
            if (typeof PROMPTS !== 'undefined') {
                // Completely clear and replace with Supabase data
                while (PROMPTS.length > 0) {
                    PROMPTS.pop();
                }
                supabasePrompts.forEach(p => PROMPTS.push(p));
            } else {
                // If PROMPTS doesn't exist, create it
                window.PROMPTS = supabasePrompts;
            }

            console.log(`Loaded ${supabasePrompts.length} prompts from Supabase (replaced local data)`);
            return true;
        }

        return false;
    } catch (err) {
        console.error('Error loading from Supabase:', err);
        return false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Try to load from Supabase first
    await loadPromptsFromSupabase();

    // Assign IDs to PROMPTS for favorites to work
    PROMPTS.forEach((p, i) => p.id = i);

    // Build search index for fast lookups
    buildSearchIndex();

    initSpotlight();
    initAmbientLight(); // New: Living background
    initStarrySky(); // New: Starry background for dark mode
    generateDynamicNav(); // New: AI-driven navigation
    renderFeaturedBanner(); // New: Today's featured artwork
    renderGallery('all');
    setupFilters();
    setupInfiniteScroll();
    setupSearch(); // Pinterest-style search
    setupScrollReveal(); // New: Wave scroll animation
    checkAuthState(); // New: Check if admin is logged in

    // Fade in nav after fonts load (or timeout)
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            document.querySelector('.nav-items')?.classList.add('loaded');
        });
    } else {
        // Fallback for older browsers
        setTimeout(() => {
            document.querySelector('.nav-items')?.classList.add('loaded');
        }, 100);
    }
});

// ========================================
// DYNAMIC NAVIGATION (AI-Driven Categories)
// ========================================
const TAG_TRANSLATIONS = {
    // Main categories
    'Miniature': '微缩',
    'Photography': '摄影',
    'Illustration': '插画',
    '3D Art': '3D艺术',
    '3D': '3D',
    'Creative': '创意',
    'Animation': '动画',
    'Logo': '标志',
    'Poster': '海报',
    'Character': '角色',
    'Landscape': '风景',
    'Portrait': '人像',
    'Abstract': '抽象',
    'Concept': '概念',
    'Fantasy': '幻想',
    'Sci-Fi': '科幻',
    // Common AI sub-tags (styles, moods, scenes)
    'Peaceful': '宁静',
    'Whimsical': '梦幻',
    'Digital art': '数字艺术',
    'Digital Art': '数字艺术',
    'Forest': '森林',
    'Photo manipulation': '照片合成',
    'Photo Manipulation': '照片合成',
    'Nostalgic': '怀旧',
    'Cinematic': '电影感',
    'Surreal': '超现实',
    'Minimalist': '极简',
    'Vintage': '复古',
    'Dreamy': '梦境',
    'Ethereal': '空灵',
    'Moody': '情绪',
    'Vibrant': '鲜艳',
    'Serene': '静谧',
    'Mystical': '神秘',
    'Urban': '都市',
    'Nature': '自然',
    'Ocean': '海洋',
    'Mountain': '山脉',
    'Night': '夜晚',
    'Sunset': '日落',
    'Winter': '冬日',
    'Autumn': '秋天',
    'Rainy': '雨天',
    'Foggy': '雾气',
    'Cozy': '温馨',
    'Elegant': '优雅',
    'Futuristic': '未来',
    'Retro': '复古',
    'Dramatic': '戏剧性',
    'Soft': '柔和',
    'Dark': '暗黑',
    'Light': '明亮',
    'Colorful': '多彩',
    'Monochrome': '单色',
    'Warm': '暖色',
    'Cool': '冷色',
    'Realistic': '写实',
    'Stylized': '风格化',
    'Painterly': '绘画风',
    'Geometric': '几何',
    'Organic': '有机',
    'Textured': '纹理',
    'Smooth': '光滑',
    'Glow': '发光',
    'Neon': '霓虹',
    'Pastel': '粉彩',
    'Watercolor': '水彩',
    'Oil painting': '油画',
    'Sketch': '素描',
    'Anime': '动漫',
    'Cartoon': '卡通',
    'Hyperrealistic': '超写实',
    'Macro': '微距',
    'Aerial': '航拍',
    'Underwater': '水下',
    'Space': '太空',
    'Desert': '沙漠',
    'Beach': '海滩',
    'City': '城市',
    'Village': '乡村',
    'Temple': '寺庙',
    'Castle': '城堡',
    'Garden': '花园',
    'Street': '街道',
    'Interior': '室内',
    'Architecture': '建筑',
    'Food': '美食',
    'Animal': '动物',
    'Pet': '宠物',
    'Bird': '鸟类',
    'Flower': '花卉',
    'Tree': '树木',
    'Cloud': '云彩',
    'Star': '星空',
    'Moon': '月亮',
    'Sun': '太阳',
    'Rain': '雨',
    'Snow': '雪',
    'Fire': '火焰',
    'Water': '水',
    'Ice': '冰',
    'Stone': '石头',
    'Metal': '金属',
    'Glass': '玻璃',
    'Wood': '木头',
    'Fabric': '织物',
    // Additional common sub-tags
    '3d render': '3D渲染',
    '3D render': '3D渲染',
    '3d Render': '3D渲染',
    'Playful': '俏皮',
    'Imaginative': '富有想象力',
    'Photorealistic': '照片级写实',
    'Miniature art': '微缩艺术',
    'Miniature Art': '微缩艺术',
    'Cute': '可爱',
    'Kawaii': '卡哇伊',
    'Detailed': '精细',
    'Intricate': '复杂精美',
    'Simple': '简约',
    'Bold': '大胆',
    'Subtle': '细腻',
    'Harmonious': '和谐',
    'Chaotic': '混沌',
    'Dynamic': '动感',
    'Static': '静态',
    'Flowing': '流动',
    'Sharp': '锐利',
    'Blurry': '模糊',
    'Bokeh': '背景虚化',
    'HDR': '高动态范围',
    'Long exposure': '长曝光',
    'Double exposure': '双重曝光',
    'Tilt shift': '移轴',
    'Fisheye': '鱼眼',
    'Wide angle': '广角',
    'Portrait mode': '人像模式',
    'Black and white': '黑白',
    'Sepia': '褐色调',
    'High contrast': '高对比度',
    'Low key': '低调',
    'High key': '高调',
    'Golden hour': '黄金时刻',
    'Blue hour': '蓝色时刻',
    'Silhouette': '剪影',
    'Reflection': '倒影',
    'Shadow': '阴影',
    'Highlight': '高光',
    'Gradient': '渐变',
    'Pattern': '图案',
    'Symmetry': '对称',
    'Asymmetry': '不对称',
    'Perspective': '透视',
    'Isometric': '等距',
    'Flat': '扁平',
    'Volume': '立体',
    'Depth': '景深',
    'Layered': '分层',
    'Collage': '拼贴',
    'Mixed media': '混合媒介',
    'Digital painting': '数字绘画',
    'Concept art': '概念艺术',
    'Matte painting': '接景画',
    'Environment': '环境',
    'Scenery': '风光',
    'Still life': '静物',
    'Portrait photography': '人像摄影',
    'Street photography': '街头摄影',
    'Landscape photography': '风景摄影',
    'Wildlife photography': '野生动物摄影',
    'Fashion photography': '时尚摄影',
    'Product photography': '产品摄影',
    'Food photography': '美食摄影',
    'Travel photography': '旅行摄影',
    'Documentary': '纪实',
    'Fine art': '艺术摄影',
    'Experimental': '实验性'
};

// ========================================
// SEASONAL TAGS CONFIGURATION
// ========================================
const SEASONAL_HOLIDAYS = [
    // Format: { name, nameZh, month, day, icon, keywords }
    // month: 1-12, day: 1-31
    // For lunar calendar holidays, we pre-calculate dates for current/next years
    { name: 'Christmas', nameZh: '圣诞', month: 12, day: 25, icon: '🎄', keywords: ['christmas', 'xmas', 'santa', '圣诞', '圣诞节'] },
    { name: 'New Year', nameZh: '元旦', month: 1, day: 1, icon: '🎆', keywords: ['new year', 'newyear', '元旦', '新年', '跨年'] },
    { name: 'Valentine', nameZh: '情人节', month: 2, day: 14, icon: '💕', keywords: ['valentine', 'love', 'heart', '情人节', '爱情', '浪漫'] },
    { name: 'Halloween', nameZh: '万圣节', month: 10, day: 31, icon: '🎃', keywords: ['halloween', 'spooky', 'ghost', '万圣节', '鬼', '南瓜'] },
    { name: 'Mid-Autumn', nameZh: '中秋', month: 9, day: 17, icon: '🌕', keywords: ['mid-autumn', 'moon', 'mooncake', '中秋', '月饼', '赏月'] }, // 2024 date, update yearly
    { name: 'Dragon Boat', nameZh: '端午', month: 6, day: 10, icon: '🐲', keywords: ['dragon boat', '端午', '粽子', '龙舟'] }, // 2024 date
    { name: 'Labor Day', nameZh: '劳动节', month: 5, day: 1, icon: '👷', keywords: ['labor', 'may day', '劳动节', '五一'] },
    { name: 'Children', nameZh: '儿童节', month: 6, day: 1, icon: '🧸', keywords: ['children', 'kids', '儿童节', '六一', '童趣'] },
    { name: 'National Day', nameZh: '国庆', month: 10, day: 1, icon: '🇨🇳', keywords: ['national day', '国庆', '国庆节', '十一'] },
    { name: 'Thanksgiving', nameZh: '感恩节', month: 11, day: 28, icon: '🦃', keywords: ['thanksgiving', 'thanks', '感恩节', '感恩'] }, // Approximate
    { name: 'Mother Day', nameZh: '母亲节', month: 5, day: 12, icon: '💐', keywords: ['mother', 'mom', '母亲节', '妈妈'] }, // 2024 date
    { name: 'Father Day', nameZh: '父亲节', month: 6, day: 16, icon: '👔', keywords: ['father', 'dad', '父亲节', '爸爸'] }, // 2024 date
];

// Spring Festival dates (Lunar New Year - changes yearly)
// Pre-calculated for 2024-2026
const SPRING_FESTIVAL_DATES = {
    2024: { month: 2, day: 10 },
    2025: { month: 1, day: 29 },
    2026: { month: 2, day: 17 },
    2027: { month: 2, day: 6 },
};

/**
 * Get active seasonal holiday if within range (2 days before to day of)
 * @returns {Object|null} Holiday object or null
 */
function getActiveSeasonalHoliday() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentDay = now.getDate();

    // Check Spring Festival first (special handling for lunar calendar)
    const springFestival = SPRING_FESTIVAL_DATES[currentYear];
    if (springFestival) {
        const daysUntil = getDaysUntil(currentMonth, currentDay, springFestival.month, springFestival.day);
        if (daysUntil >= 0 && daysUntil <= 2) {
            return {
                name: 'Spring Festival',
                nameZh: '春节',
                icon: '🧧',
                keywords: ['spring festival', 'chinese new year', 'lunar', '春节', '新春', '过年', '红包', '年味'],
                daysUntil
            };
        }
    }

    // Check other holidays
    for (const holiday of SEASONAL_HOLIDAYS) {
        const daysUntil = getDaysUntil(currentMonth, currentDay, holiday.month, holiday.day);
        if (daysUntil >= 0 && daysUntil <= 2) {
            return { ...holiday, daysUntil };
        }
    }

    return null;
}

/**
 * Calculate days until a target date (same year, simple calculation)
 */
function getDaysUntil(currentMonth, currentDay, targetMonth, targetDay) {
    const now = new Date();
    const currentYear = now.getFullYear();

    const current = new Date(currentYear, currentMonth - 1, currentDay);
    let target = new Date(currentYear, targetMonth - 1, targetDay);

    // If target has passed this year, check if we're still "on" the day
    const diffTime = target - current;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
}

function generateDynamicNav() {
    const navContainer = document.getElementById('navItems');
    if (!navContainer || !PROMPTS) return;

    // Check for active seasonal holiday
    const activeHoliday = getActiveSeasonalHoliday();

    // Count tag frequency
    const tagCounts = {};
    PROMPTS.forEach(prompt => {
        if (prompt.tags && Array.isArray(prompt.tags)) {
            prompt.tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }
    });

    // Sort by frequency and take top categories
    // If seasonal holiday is active, take 5 regular tags; otherwise take 6
    const maxRegularTags = activeHoliday ? 5 : 6;
    const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxRegularTags)
        .map(([tag]) => tag);

    // Build nav HTML
    let navHTML = `
        <div class="nav-item active" data-filter="all">
            <span class="en">All</span>
            <span class="cn">全部</span>
        </div>
    `;

    // Add seasonal tag first (if active) with special styling
    if (activeHoliday) {
        const statusText = activeHoliday.daysUntil === 0 ? '今天!' :
            activeHoliday.daysUntil === 1 ? '明天' : '即将';
        navHTML += `
            <div class="nav-item seasonal-tag" data-filter="seasonal:${activeHoliday.name}" data-keywords="${activeHoliday.keywords.join(',')}">
                <span class="en">${activeHoliday.icon} ${activeHoliday.name}</span>
                <span class="cn">${activeHoliday.nameZh} <small>${statusText}</small></span>
            </div>
        `;
    }

    topTags.forEach(tag => {
        const cn = TAG_TRANSLATIONS[tag] || tag;
        navHTML += `
            <div class="nav-item" data-filter="${tag}">
                <span class="en">${tag}</span>
                <span class="cn">${cn}</span>
            </div>
        `;
    });

    // Add Saved/Favorites at the end
    navHTML += `
        <div class="nav-item favorites-tab" data-filter="favorites">
            <span class="en">Saved</span>
            <span class="cn">收藏</span>
        </div>
    `;

    navContainer.innerHTML = navHTML;

    // Store for back navigation
    originalNavHTML = navContainer.innerHTML;

    // Mark as loaded for fade-in
    navContainer.classList.add('loaded');
}

// ========================================
// AMBIENT LIGHT SYSTEM (Living Background)
// ========================================
function initAmbientLight() {
    const canvas = document.getElementById('ambientCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationId;
    let blobs = [];

    // Resize canvas
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Color extraction from visible cards
    function getVisibleCardColors() {
        const cards = document.querySelectorAll('.prompt-card');
        const colors = [];
        const viewportHeight = window.innerHeight;

        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            // Only cards in viewport
            if (rect.top < viewportHeight && rect.bottom > 0) {
                const item = PROMPTS[parseInt(card.dataset.id)];
                if (item && item.dominantColors && item.dominantColors.length > 0) {
                    colors.push(...item.dominantColors.slice(0, 2));
                }
            }
        });

        return colors.length > 0 ? colors : ['#9b5de5', '#8b5cf6', '#a78bfa'];
    }

    // Create blob class
    class Blob {
        constructor(color) {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.radius = 200 + Math.random() * 300;
            this.color = color;
            this.vx = (Math.random() - 0.5) * 0.3;
            this.vy = (Math.random() - 0.5) * 0.3;
            this.targetColor = color;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;

            // Bounce off edges
            if (this.x < -this.radius || this.x > canvas.width + this.radius) this.vx *= -1;
            if (this.y < -this.radius || this.y > canvas.height + this.radius) this.vy *= -1;
        }

        draw() {
            const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
            gradient.addColorStop(0, this.hexToRgba(this.color, 0.3));
            gradient.addColorStop(1, this.hexToRgba(this.color, 0));
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }

        hexToRgba(hex, alpha) {
            if (hex.startsWith('rgb')) return hex.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
            const r = parseInt(hex.slice(1, 3), 16) || 155;
            const g = parseInt(hex.slice(3, 5), 16) || 93;
            const b = parseInt(hex.slice(5, 7), 16) || 229;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
    }

    // Initialize blobs
    const initialColors = ['#9b5de5', '#8b5cf6', '#a78bfa', '#c4b5fd'];
    for (let i = 0; i < 4; i++) {
        blobs.push(new Blob(initialColors[i % initialColors.length]));
    }

    // Update blob colors periodically
    function updateBlobColors() {
        const colors = getVisibleCardColors();
        blobs.forEach((blob, i) => {
            blob.color = colors[i % colors.length] || blob.color;
        });
    }

    // Animation loop
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        blobs.forEach(blob => {
            blob.update();
            blob.draw();
        });

        animationId = requestAnimationFrame(animate);
    }

    animate();

    // Update colors on scroll
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(updateBlobColors, 100);
    });

    // Initial color update
    setTimeout(updateBlobColors, 1000);
}

// ========================================
// STARRY SKY (Dark Mode Embellishment)
// ========================================
function initStarrySky() {
    const canvas = document.getElementById('starryCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let stars = [];
    let shootingStars = [];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        initStars();
    }

    class Star {
        constructor() {
            this.reset();
        }

        reset() {
            // Random position - concentrated at top
            if (Math.random() < 0.75) {
                this.y = Math.random() * (canvas.height * 0.35);
            } else {
                this.y = Math.random() * canvas.height * 0.6;
            }
            this.x = Math.random() * canvas.width;

            // Size
            this.size = Math.random() * 1.2 + 0.4;

            // Lifecycle: each star fades in, stays, fades out, then waits
            this.maxAlpha = Math.random() * 0.5 + 0.3;
            this.currentAlpha = 0;
            this.phase = 'waiting'; // waiting, fadingIn, visible, fadingOut
            this.waitTime = Math.random() * 8000 + 2000; // 2-10 seconds wait
            this.fadeSpeed = Math.random() * 0.008 + 0.003;
            this.visibleDuration = Math.random() * 4000 + 2000; // 2-6 seconds visible
            this.timer = 0;
            this.lastTime = performance.now();
        }

        update() {
            const now = performance.now();
            const delta = now - this.lastTime;
            this.lastTime = now;
            this.timer += delta;

            switch (this.phase) {
                case 'waiting':
                    if (this.timer >= this.waitTime) {
                        this.phase = 'fadingIn';
                        this.timer = 0;
                    }
                    break;
                case 'fadingIn':
                    this.currentAlpha += this.fadeSpeed;
                    if (this.currentAlpha >= this.maxAlpha) {
                        this.currentAlpha = this.maxAlpha;
                        this.phase = 'visible';
                        this.timer = 0;
                    }
                    break;
                case 'visible':
                    // Slight twinkle while visible
                    this.currentAlpha = this.maxAlpha * (0.85 + Math.sin(this.timer * 0.002) * 0.15);
                    if (this.timer >= this.visibleDuration) {
                        this.phase = 'fadingOut';
                    }
                    break;
                case 'fadingOut':
                    this.currentAlpha -= this.fadeSpeed;
                    if (this.currentAlpha <= 0) {
                        this.currentAlpha = 0;
                        this.reset(); // Relocate and restart cycle
                    }
                    break;
            }
        }

        draw() {
            if (this.currentAlpha <= 0) return;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${this.currentAlpha})`;
            ctx.fill();
        }
    }

    class ShootingStar {
        constructor() {
            this.reset();
        }

        reset() {
            this.active = false;
            this.x = 0;
            this.y = 0;
            this.length = 0;
            this.speed = 0;
            this.angle = 0;
            this.alpha = 0;
        }

        spawn() {
            this.active = true;
            this.x = Math.random() * canvas.width * 0.8;
            this.y = Math.random() * canvas.height * 0.3;
            this.length = Math.random() * 80 + 40;
            this.speed = Math.random() * 8 + 6;
            this.angle = Math.PI / 4 + (Math.random() - 0.5) * 0.3; // ~45 degrees with variation
            this.alpha = 1;
        }

        update() {
            if (!this.active) return;
            this.x += Math.cos(this.angle) * this.speed;
            this.y += Math.sin(this.angle) * this.speed;
            this.alpha -= 0.015;
            if (this.alpha <= 0 || this.x > canvas.width || this.y > canvas.height) {
                this.reset();
            }
        }

        draw() {
            if (!this.active || this.alpha <= 0) return;
            const tailX = this.x - Math.cos(this.angle) * this.length;
            const tailY = this.y - Math.sin(this.angle) * this.length;

            const gradient = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
            gradient.addColorStop(0, `rgba(255, 255, 255, 0)`);
            gradient.addColorStop(1, `rgba(255, 255, 255, ${this.alpha})`);

            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(this.x, this.y);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    function initStars() {
        stars = [];
        // Fewer stars - around 30-50 total
        const starCount = Math.floor((canvas.width * canvas.height) / 40000) + 15;
        for (let i = 0; i < starCount; i++) {
            const star = new Star();
            // Stagger initial timers so they don't all sync up
            star.timer = Math.random() * star.waitTime;
            stars.push(star);
        }

        shootingStars = [new ShootingStar(), new ShootingStar()];
    }

    // Spawn shooting star occasionally
    function maybeSpawnShootingStar() {
        if (Math.random() < 0.0008) { // ~1 every 20 seconds at 60fps
            const inactive = shootingStars.find(s => !s.active);
            if (inactive) inactive.spawn();
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        stars.forEach(star => {
            star.update();
            star.draw();
        });

        maybeSpawnShootingStar();
        shootingStars.forEach(ss => {
            ss.update();
            ss.draw();
        });

        requestAnimationFrame(animate);
    }

    window.addEventListener('resize', resize);
    resize();
    animate();
}

// ========================================
// FEATURED BANNER (Today's Featured)
// ========================================
function renderFeaturedBanner() {
    const banner = document.getElementById('featuredBanner');
    const image = document.getElementById('featuredImage');
    const title = document.getElementById('featuredTitle');
    const description = document.getElementById('featuredDescription');

    if (!banner) return;

    // Hide banner if no data
    if (!PROMPTS || PROMPTS.length === 0) {
        banner.style.display = 'none';
        return;
    }

    // Show banner with fade-in + float-up animation
    banner.style.display = 'flex';
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(20px)';
    requestAnimationFrame(() => {
        banner.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        banner.style.opacity = '1';
        banner.style.transform = 'translateY(0)';
    });

    // Pick a random artwork (or use a daily seed for consistency)
    const today = new Date().toDateString();
    const seed = today.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const randomIndex = seed % PROMPTS.length;

    const featured = PROMPTS[randomIndex];

    // Set image (use first image from the array)
    if (image && featured.images && featured.images.length > 0) {
        image.src = featured.images[0];
    }

    // Set title
    if (title) {
        title.textContent = featured.title;
    }

    // Generate description from AI tags or use default
    if (description && featured.aiTags) {
        const mood = featured.aiTags.mood?.en?.[0] || '';
        const style = featured.aiTags.styles?.en?.[0] || '';
        const scene = featured.aiTags.scenes?.en?.[0] || '';

        let desc = '';
        if (mood && style) {
            desc = `A ${mood.toLowerCase()} piece with ${style.toLowerCase()} aesthetics`;
            if (scene) desc += `, featuring ${scene.toLowerCase()}`;
            desc += '.';
        }
        description.textContent = desc;
    }

    // Click to open modal
    banner.style.cursor = 'pointer';
    banner.onclick = () => openPromptModal(featured.id);
}

// ========================================
// SCROLL REVEAL ANIMATION (Wave Effect)
// ========================================
function setupScrollReveal() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                // Stagger delay based on position
                const card = entry.target;
                const rect = card.getBoundingClientRect();
                const column = Math.floor(rect.left / 350); // Approximate column
                const delay = column * 0.05; // 50ms stagger per column

                setTimeout(() => {
                    card.classList.add('visible');
                }, delay * 1000);

                observer.unobserve(card);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '50px'
    });

    // Observe all cards (will be called after cards render)
    window.observeCards = () => {
        document.querySelectorAll('.prompt-card.scroll-reveal').forEach(card => {
            observer.observe(card);
        });
    };
}

// --- Spotlight Effect ---
function initSpotlight() {
    const container = document.querySelector('.poetry-nav-container');
    if (!container) return;

    container.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        container.style.setProperty('--cursor-x', `${x}px`);
        container.style.setProperty('--cursor-y', `${y}px`);
    });
}

// --- Pagination State ---
const CARDS_PER_PAGE = 20;
let currentFilter = 'all';
let currentPage = 0;
let isLoading = false;
let allFilteredItems = [];
let allCardsRendered = false; // Track if all cards have been rendered
let renderedCards = new Map(); // Cache rendered cards by id

// --- Favorites System (Pinterest-style) ---
let favorites = new Set(JSON.parse(localStorage.getItem('promptFavorites') || '[]'));

function saveFavorites() {
    localStorage.setItem('promptFavorites', JSON.stringify([...favorites]));
}

function toggleFavorite(id, btn, e) {
    e.stopPropagation();
    e.stopImmediatePropagation(); // Ensure no other click listeners fire

    // Trigger bounce animation
    btn.classList.add('animating');
    setTimeout(() => btn.classList.remove('animating'), 400);

    if (favorites.has(id)) {
        favorites.delete(id);
        btn.classList.remove('saved');
    } else {
        favorites.add(id);
        btn.classList.add('saved');
    }
    saveFavorites();

    // If viewing favorites, remove card if unsaved
    if (currentFilter === 'favorites' && !favorites.has(id)) {
        const card = btn.closest('.prompt-card');
        card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        card.style.transform = 'scale(0.9)';
        card.style.opacity = '0';
        setTimeout(() => card.style.display = 'none', 300);
    }
}

// --- Render Gallery ---
function renderGallery(filter, reset = true) {
    const grid = document.querySelector('.gallery-container');
    if (!grid) return;

    currentFilter = filter;

    // If cards already exist, just filter them via CSS
    if (allCardsRendered) {
        filterCardsCSS(filter);
        return;
    }

    if (reset) {
        grid.innerHTML = '';
        currentPage = 0;

        // Filter items based on current filter
        if (filter === 'favorites') {
            allFilteredItems = PROMPTS.filter(p => favorites.has(p.id));
        } else if (filter === 'all') {
            allFilteredItems = [...PROMPTS];
        } else {
            // Filter by category tag OR AI tags (for sub-tag filtering)
            const filterLower = filter.toLowerCase();
            allFilteredItems = PROMPTS.filter(p => {
                // Check main tags array
                if (p.tags && p.tags.some(t => t.toLowerCase() === filterLower)) {
                    return true;
                }
                // Check AI tags (styles, mood, scenes, objects)
                if (p.aiTags) {
                    const checkTags = (tags) => {
                        if (!tags) return false;
                        return ['en', 'zh'].some(lang =>
                            tags[lang] && tags[lang].some(t => t.toLowerCase().includes(filterLower))
                        );
                    };
                    if (checkTags(p.aiTags.styles) ||
                        checkTags(p.aiTags.mood) ||
                        checkTags(p.aiTags.scenes) ||
                        checkTags(p.aiTags.objects)) {
                        return true;
                    }
                }
                return false;
            });
        }
    }

    loadMoreCards();
}

// Filter cards using CSS classes for smooth animations
function filterCardsCSS(filter) {
    const cards = Array.from(document.querySelectorAll('.prompt-card'));

    // Phase 0: Mark all cards as filtering (disable breathing + scroll-reveal)
    cards.forEach(card => {
        card.classList.add('filtering');
        card.classList.remove('scroll-reveal', 'visible', 'breathing');
    });

    // FIRST: Record positions of currently visible cards
    const firstPositions = new Map();
    cards.forEach(card => {
        if (card.style.display !== 'none') {
            const rect = card.getBoundingClientRect();
            firstPositions.set(card.dataset.id, { x: rect.left, y: rect.top });
        }
    });

    // Determine visibility
    const visibleCards = [];
    const hiddenCards = [];

    cards.forEach(card => {
        const cardTags = card.dataset.tags ? card.dataset.tags.split(',') : [];
        const cardId = parseInt(card.dataset.id);
        const item = PROMPTS[cardId];

        let isVisible = false;
        if (filter === 'all') {
            isVisible = true;
        } else if (filter === 'favorites') {
            isVisible = favorites.has(cardId);
        } else if (filter.startsWith('seasonal:')) {
            // Seasonal filter - search by keywords
            const seasonalName = filter.replace('seasonal:', '');
            const navItem = document.querySelector(`[data-filter="${filter}"]`);
            const keywords = navItem?.dataset.keywords?.split(',') || [];

            if (item) {
                const searchText = [
                    item.title || '',
                    item.description || '',
                    item.prompt || '',
                    ...(item.tags || []),
                    ...(item.aiTags?.styles?.en || []),
                    ...(item.aiTags?.styles?.zh || []),
                    ...(item.aiTags?.mood?.en || []),
                    ...(item.aiTags?.mood?.zh || []),
                    ...(item.aiTags?.scenes?.en || []),
                    ...(item.aiTags?.scenes?.zh || []),
                ].join(' ').toLowerCase();

                isVisible = keywords.some(kw => searchText.includes(kw.toLowerCase()));
            }
        } else if (cardTags.includes(filter)) {
            isVisible = true;
        } else if (item && item.aiTags) {
            const filterLower = filter.toLowerCase();
            const checkTags = (tags) => {
                if (!tags) return false;
                return ['en', 'zh'].some(lang =>
                    tags[lang] && tags[lang].some(t => t.toLowerCase().includes(filterLower))
                );
            };
            isVisible = checkTags(item.aiTags.styles) ||
                checkTags(item.aiTags.mood) ||
                checkTags(item.aiTags.scenes) ||
                checkTags(item.aiTags.objects);
        }

        if (isVisible) {
            visibleCards.push(card);
        } else {
            hiddenCards.push(card);
        }
    });

    // Phase 1: Fade out hidden cards
    hiddenCards.forEach(card => {
        if (card.style.display !== 'none') {
            card.classList.add('filter-fading-out');
        }
    });

    // Phase 2: After fade-out, update layout and animate visible cards
    setTimeout(() => {
        // Hide faded cards
        hiddenCards.forEach(card => {
            card.style.display = 'none';
            card.classList.remove('filter-fading-out');
        });

        // Show visible cards
        visibleCards.forEach(card => card.style.display = '');

        // Force layout calculation
        void document.body.offsetHeight;

        // LAST: Get new positions and animate
        visibleCards.forEach((card, index) => {
            const cardId = card.dataset.id;
            const first = firstPositions.get(cardId);
            const last = card.getBoundingClientRect();

            if (first) {
                // Card was visible - FLIP it to new position
                const dx = first.x - last.left;
                const dy = first.y - last.top;

                if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                    // Set initial inverted position (no transition)
                    card.style.transform = `translate(${dx}px, ${dy}px)`;

                    // Force reflow then add transition
                    requestAnimationFrame(() => {
                        card.classList.add('filter-moving');
                        card.style.transform = '';
                    });
                }
            } else {
                // New card entering - fade in with stagger
                card.style.opacity = '0';
                card.style.transform = 'scale(0.95) translateY(12px)';

                setTimeout(() => {
                    card.classList.add('filter-entering');
                    card.style.opacity = '';
                    card.style.transform = '';
                }, index * 25);
            }
        });

        // Phase 3: Cleanup after animations complete
        setTimeout(() => {
            cards.forEach(card => {
                card.classList.remove('filtering', 'filter-moving', 'filter-entering');
                card.style.transform = '';
                card.style.opacity = '';
                // Re-enable breathing on visible cards
                if (card.style.display !== 'none') {
                    card.classList.add('breathing');
                }
            });
        }, 500);
    }, 180);
}

function loadMoreCards() {
    const grid = document.querySelector('.gallery-container');
    if (!grid || isLoading) return;

    const startIndex = currentPage * CARDS_PER_PAGE;
    const endIndex = startIndex + CARDS_PER_PAGE;
    const itemsToLoad = allFilteredItems.slice(startIndex, endIndex);

    if (itemsToLoad.length === 0) return; // No more items

    isLoading = true;

    itemsToLoad.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'prompt-card card-enter';
        card.dataset.tags = item.tags.join(','); // For CSS filtering
        card.dataset.id = item.id;
        card.dataset.images = JSON.stringify(item.images); // Store all images
        card.style.animationDelay = `${index * 0.05}s`; // Stagger effect
        card.onclick = () => openPromptModal(item.id);

        // Generate image indicator dots if multiple images
        const hasMultiple = item.images.length > 1;
        const indicators = hasMultiple
            ? `<div class="card-indicators">${item.images.map((_, i) => `<span class="indicator-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
            : '';

        // Check if item is already saved
        const isSaved = favorites.has(item.id);

        // Random breathing delay for organic feel (0-4 seconds)
        const breatheDelay = (Math.random() * 4).toFixed(2);
        card.style.setProperty('--breathe-delay', `${breatheDelay}s`);

        card.innerHTML = `
            <button class="card-fav-btn ${isSaved ? 'saved' : ''}" onclick="toggleFavorite(${item.id}, this, event)">
                <i class="fas fa-heart"></i>
            </button>
            <img src="${item.images[0]}" class="card-image" loading="lazy" alt="${item.title}" onload="this.classList.add('loaded')">
            ${indicators}
            <div class="card-overlay">
                <div class="card-title">${item.title}</div>
                <div class="card-tags">
                    ${item.tags.map(t => `<span>#${t}</span>`).join('')}
                </div>
            </div>
        `;

        // Add hover carousel for cards with multiple images
        if (hasMultiple) {
            let hoverInterval = null;
            let currentIndex = 0;

            card.addEventListener('mouseenter', () => {
                const img = card.querySelector('.card-image');
                const dots = card.querySelectorAll('.indicator-dot');
                const images = JSON.parse(card.dataset.images);

                hoverInterval = setInterval(() => {
                    currentIndex = (currentIndex + 1) % images.length;
                    img.src = images[currentIndex];
                    dots.forEach((dot, i) => dot.classList.toggle('active', i === currentIndex));
                }, 1500);
            });

            card.addEventListener('mouseleave', () => {
                clearInterval(hoverInterval);
                currentIndex = 0;
                const img = card.querySelector('.card-image');
                const dots = card.querySelectorAll('.indicator-dot');
                const images = JSON.parse(card.dataset.images);
                img.src = images[0];
                dots.forEach((dot, i) => dot.classList.toggle('active', i === 0));
            });
        }

        grid.appendChild(card);

        // Trigger animation with stagger delay (similar to featured-banner animation-delay)
        const staggerDelay = index * 50; // 50ms stagger per card
        setTimeout(() => {
            card.classList.add('card-visible');
            // Add breathing class AFTER entrance animation completes (0.8s)
            setTimeout(() => {
                card.classList.add('breathing');
            }, 850);
        }, staggerDelay);
    });

    currentPage++;
    isLoading = false;

    // Show container if first load
    if (currentPage === 1) {
        requestAnimationFrame(() => {
            grid.classList.add('visible');
        });
    }

    // Check if all cards are rendered
    if (currentPage * CARDS_PER_PAGE >= PROMPTS.length) {
        allCardsRendered = true;
    }
}

// --- Infinite Scroll ---
function setupInfiniteScroll() {
    window.addEventListener('scroll', () => {
        if (isLoading) return;

        const scrollY = window.scrollY;
        const windowHeight = window.innerHeight;
        const docHeight = document.documentElement.scrollHeight;

        // Load more when near bottom (200px threshold)
        if (scrollY + windowHeight >= docHeight - 200) {
            loadMoreCards();
        }
    });
}

// --- Filter Interactivity ---
let isInSubNav = false;
let originalNavHTML = '';

function setupFilters() {
    const navItems = document.querySelectorAll('.nav-item');
    const navContainer = document.querySelector('.nav-items');

    // Store original nav for back navigation
    if (navContainer) {
        originalNavHTML = navContainer.innerHTML;
    }

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const filterType = item.getAttribute('data-filter');
            handleNavClick(filterType, item);
        });
    });
}

// Handle navigation clicks (both main and sub-nav)
function handleNavClick(filterType, clickedItem) {
    const navItems = document.querySelectorAll('.nav-item');
    const navContainer = document.querySelector('.nav-items');
    const searchInput = document.getElementById('gallerySearch');

    // Clear search
    if (searchInput) searchInput.value = '';

    // Special handling for back button
    if (filterType === 'back') {
        returnToMainNav();
        return;
    }

    // Update active state
    navItems.forEach(n => n.classList.remove('active'));
    clickedItem.classList.add('active');

    // If clicking a main category (not 'all', not 'favorites'), show AI sub-tags
    const mainCategories = ['Miniature', 'Photography', 'Illustration', '3D Art', 'Creative'];
    if (!isInSubNav && mainCategories.includes(filterType)) {
        showAISubTags(filterType, navContainer);
    }

    // Apply filter
    if (allCardsRendered) {
        filterCardsCSS(filterType);
    } else {
        renderGallery(filterType);
    }
}

// Get AI-derived sub-tags for a category (with Chinese translations from aiTags)
function getAISubTags(category) {
    // Filter prompts by category
    const categoryPrompts = PROMPTS.filter(p => p.tags.includes(category));

    // Aggregate all AI tags with their Chinese translations
    const tagData = {}; // { normalizedTag: { count: number, en: string, zh: string } }

    categoryPrompts.forEach(prompt => {
        if (!prompt.aiTags) return;

        // Collect from styles, mood, scenes - pair en and zh
        const collectTags = (tagObj) => {
            if (!tagObj || !tagObj.en) return;
            const enTags = tagObj.en;
            const zhTags = tagObj.zh || [];

            enTags.forEach((tag, index) => {
                const normalized = tag.toLowerCase().trim();
                if (normalized.length > 2) {
                    if (!tagData[normalized]) {
                        tagData[normalized] = {
                            count: 0,
                            en: tag.charAt(0).toUpperCase() + tag.slice(1),
                            zh: zhTags[index] || '' // Get corresponding Chinese translation
                        };
                    }
                    tagData[normalized].count++;
                    // Keep the Chinese translation if we find one
                    if (!tagData[normalized].zh && zhTags[index]) {
                        tagData[normalized].zh = zhTags[index];
                    }
                }
            });
        };

        collectTags(prompt.aiTags.styles);
        collectTags(prompt.aiTags.mood);
        collectTags(prompt.aiTags.scenes);
    });

    // Sort by frequency and take top 6
    const sortedTags = Object.values(tagData)
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

    return sortedTags; // Returns array of { en, zh, count }
}

// Show AI sub-tags in navigation
function showAISubTags(category, navContainer) {
    const subTags = getAISubTags(category);
    if (subTags.length === 0) return;

    isInSubNav = true;

    // Elegant Lift Out (Up + Blur)
    navContainer.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), filter 0.3s ease';
    navContainer.style.opacity = '0';
    navContainer.style.transform = 'translateY(-10px)';
    navContainer.style.filter = 'blur(2px)';

    setTimeout(() => {
        // Build new sub-nav
        let subNavHTML = `
            <div class="nav-item back-nav" data-filter="back">
                <span class="en">← Back</span>
                <span class="cn">返回</span>
            </div>
        `;

        subTags.forEach((tagObj, i) => {
            // Use zh from aiTags data, fallback to TAG_TRANSLATIONS, then empty
            const cnTranslation = tagObj.zh || TAG_TRANSLATIONS[tagObj.en] || TAG_TRANSLATIONS[tagObj.en.toLowerCase()] || '';
            subNavHTML += `
                <div class="nav-item sub-tag" data-filter="${tagObj.en.toLowerCase()}" style="animation-delay: ${i * 0.05}s">
                    <span class="en">${tagObj.en}</span>
                    ${cnTranslation ? `<span class="cn">${cnTranslation}</span>` : ''}
                </div>
            `;
        });

        navContainer.innerHTML = subNavHTML;

        // Attach click handlers to new items
        navContainer.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const filter = item.getAttribute('data-filter');
                handleNavClick(filter, item);
            });
        });

        // Set initial state for entrance (From Down)
        navContainer.style.opacity = '0';
        navContainer.style.transform = 'translateY(10px)';
        navContainer.style.filter = 'blur(2px)';

        // Elegant Lift In (Focus)
        requestAnimationFrame(() => {
            navContainer.style.opacity = '1';
            navContainer.style.transform = 'translateY(0)';
            navContainer.style.filter = 'blur(0)';
        });
    }, 250);
}

// Return to main navigation
function returnToMainNav() {
    const navContainer = document.querySelector('.nav-items');

    isInSubNav = false;

    // Elegant Drop Out (Down + Blur)
    navContainer.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), filter 0.3s ease';
    navContainer.style.opacity = '0';
    navContainer.style.transform = 'translateY(10px)';
    navContainer.style.filter = 'blur(2px)';

    setTimeout(() => {
        navContainer.innerHTML = originalNavHTML;

        // Re-attach handlers
        navContainer.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const filter = item.getAttribute('data-filter');
                handleNavClick(filter, item);
            });
        });

        // Show all and set active
        const allItem = navContainer.querySelector('[data-filter="all"]');
        if (allItem) allItem.classList.add('active');

        if (allCardsRendered) {
            filterCardsCSS('all');
        } else {
            renderGallery('all');
        }

        // Set initial state for entrance (From Up)
        navContainer.style.opacity = '0';
        navContainer.style.transform = 'translateY(-10px)';
        navContainer.style.filter = 'blur(2px)';

        // Elegant Drop In
        requestAnimationFrame(() => {
            navContainer.style.opacity = '1';
            navContainer.style.transform = 'translateY(0)';
            navContainer.style.filter = 'blur(0)';
        });
    }, 250);
}

// --- Pinterest-style Search with Dropdown ---
function setupSearch() {
    const searchInput = document.getElementById('gallerySearch');
    const dropdown = document.getElementById('searchDropdown');
    const hotTagsList = document.getElementById('hotTagsList');
    const hotTagsSection = document.getElementById('searchHotTags');
    const suggestionsSection = document.getElementById('searchSuggestions');

    if (!searchInput || !dropdown) return;

    let debounceTimer;
    let isDropdownActive = false;

    // Generate hot tags from PROMPTS data (with caching)
    function generateHotTags() {
        if (!hotTagsList || typeof PROMPTS === 'undefined') return;

        // Use cached tags if available
        if (HOT_TAGS_CACHE) {
            renderHotTags(HOT_TAGS_CACHE, hotTagsList, searchInput);
            return;
        }

        // Collect all tags with frequency
        const tagFreq = {};
        PROMPTS.forEach(p => {
            if (p.tags) {
                p.tags.forEach(tag => {
                    tagFreq[tag] = (tagFreq[tag] || 0) + 1;
                });
            }
            // Also include AI tags
            if (p.aiTags) {
                const aiTagSources = ['styles', 'mood', 'scenes'];
                aiTagSources.forEach(source => {
                    const tags = p.aiTags[source];
                    if (tags && tags.en) {
                        tags.en.forEach(t => {
                            tagFreq[t] = (tagFreq[t] || 0) + 1;
                        });
                    }
                });
            }
        });

        // Sort by frequency and take top 6
        HOT_TAGS_CACHE = Object.entries(tagFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([tag]) => tag);

        renderHotTags(HOT_TAGS_CACHE, hotTagsList, searchInput);
    }

    // Render hot tags helper function
    function renderHotTags(topTags, container, searchInput) {
        container.innerHTML = topTags.map((tag, i) =>
            `<span class="hot-tag" data-tag="${tag}" style="--delay: ${i * 0.03}s">${tag}</span>`
        ).join('');

        // Add mousedown handlers to hot tags (mousedown fires before document mousedown)
        container.querySelectorAll('.hot-tag').forEach(tagEl => {
            tagEl.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Prevent text selection
                e.stopPropagation(); // Prevent dropdown from closing
                const tag = tagEl.dataset.tag;
                searchInput.value = tag;
                filterBySearch(tag.toLowerCase());
                hideDropdown();
            });
        });
    }

    // Show dropdown
    function showDropdown() {
        // Only show dropdown when user starts typing (handled by showSuggestions)
        // Don't show on empty focus
        const query = searchInput.value.trim();
        if (!query) {
            // Don't show dropdown when empty
            return;
        }

        if (isDropdownActive) return;
        isDropdownActive = true;
        dropdown.classList.add('active');
    }

    // Hide dropdown
    function hideDropdown() {
        isDropdownActive = false;
        dropdown.classList.remove('active');
    }

    // Show suggestions based on query
    function showSuggestions(query) {
        if (!suggestionsSection) return;

        // If no query, hide dropdown entirely (no more hot tags panel on focus)
        if (!query) {
            if (hotTagsSection) hotTagsSection.style.display = 'none';
            suggestionsSection.style.display = 'none';
            hideDropdown();
            return;
        }

        // Activate dropdown when typing
        if (!isDropdownActive) {
            isDropdownActive = true;
            dropdown.classList.add('active');
        }

        // Collect matching suggestions
        const suggestions = new Set();
        const lowerQuery = query.toLowerCase();

        PROMPTS.forEach(p => {
            // Match titles
            if (p.title && p.title.toLowerCase().includes(lowerQuery)) {
                suggestions.add(p.title);
            }
            // Match tags
            if (p.tags) {
                p.tags.forEach(tag => {
                    if (tag.toLowerCase().includes(lowerQuery)) {
                        suggestions.add(tag);
                    }
                });
            }
        });

        const suggestionArray = Array.from(suggestions).slice(0, 5); // Reduced to 5 for inline tags

        // Always hide the old hot tags section
        if (hotTagsSection) hotTagsSection.style.display = 'none';
        suggestionsSection.style.display = 'flex';

        // Build suggestions HTML
        let html = suggestionArray.map(s =>
            `<div class="suggestion-item"><i class="fas fa-search"></i>${s}</div>`
        ).join('');

        // Add 3 inline hot tag hints at the bottom
        const hotTags = getInlineHotTags(3);
        if (hotTags.length > 0) {
            // Add 'with-suggestions' class only when there are suggestions above
            const borderClass = suggestionArray.length > 0 ? 'with-suggestions' : '';
            html += `
                <div class="inline-hot-tags ${borderClass}">
                    <span class="inline-label">热门</span>
                    <div class="inline-hot-tags-list">
                        ${hotTags.map(tag => `<span class="inline-hot-tag" data-tag="${tag}">${tag}</span>`).join('')}
                    </div>
                </div>
            `;
        }

        suggestionsSection.innerHTML = html;

        // Add mousedown handlers for suggestions
        suggestionsSection.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                searchInput.value = item.textContent;
                filterBySearch(item.textContent.toLowerCase());
                hideDropdown();
            });
        });

        // Add mousedown handlers for inline hot tags
        suggestionsSection.querySelectorAll('.inline-hot-tag').forEach(tagEl => {
            tagEl.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const tag = tagEl.dataset.tag;
                searchInput.value = tag;
                filterBySearch(tag.toLowerCase());
                hideDropdown();
            });
        });
    }

    // Get inline hot tags (returns top N hot tags not matching current query)
    function getInlineHotTags(count) {
        if (!HOT_TAGS_CACHE) {
            // Generate cache if not available
            const tagFreq = {};
            PROMPTS.forEach(p => {
                if (p.tags) {
                    p.tags.forEach(tag => {
                        tagFreq[tag] = (tagFreq[tag] || 0) + 1;
                    });
                }
                if (p.aiTags) {
                    ['styles', 'mood', 'scenes'].forEach(source => {
                        const tags = p.aiTags[source];
                        if (tags && tags.en) {
                            tags.en.forEach(t => {
                                tagFreq[t] = (tagFreq[t] || 0) + 1;
                            });
                        }
                    });
                }
            });
            HOT_TAGS_CACHE = Object.entries(tagFreq)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([tag]) => tag);
        }
        return HOT_TAGS_CACHE.slice(0, count);
    }

    // Input event
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        // Show suggestions in dropdown
        showSuggestions(query);

        // Debounce for performance
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            filterBySearch(query.toLowerCase());
        }, 200);
    });

    // Focus event - show dropdown
    searchInput.addEventListener('focus', () => {
        showDropdown();
    });

    // Clear search on ESC
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            filterBySearch('');
            hideDropdown();
            searchInput.blur();
        }
    });

    // Click outside to close dropdown
    // CRITICAL: Use mousedown instead of click to prevent issues with element removal
    document.addEventListener('mousedown', (e) => {
        const searchWrapper = document.querySelector('.nav-search-wrapper');
        if (searchWrapper && !searchWrapper.contains(e.target)) {
            hideDropdown();
        }
    });

    // Prevent dropdown from closing when clicking inside it
    dropdown.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
}

async function filterBySearch(query) {
    const cards = document.querySelectorAll('.prompt-card');

    // If no query, show all cards
    if (!query) {
        let visibleIndex = 0;
        cards.forEach(card => {
            card.style.display = '';
            card.classList.remove('card-visible');
            card.style.animationDelay = `${visibleIndex * 0.03}s`;
            visibleIndex++;
            requestAnimationFrame(() => {
                card.classList.add('card-visible');
            });
        });
        // Re-select "All" when search cleared
        const allItem = document.querySelector('.nav-item[data-filter="all"]');
        if (allItem) allItem.classList.add('active');
        return;
    }

    // Color matching map (supports both English and Chinese color names)
    const COLOR_MAP = {
        'red': ['red', '红', '红色'],
        'orange': ['orange', '橙', '橙色', '橘'],
        'yellow': ['yellow', '黄', '黄色'],
        'green': ['green', '绿', '绿色'],
        'blue': ['blue', '蓝', '蓝色'],
        'purple': ['purple', '紫', '紫色'],
        'pink': ['pink', '粉', '粉色', '粉红'],
        'brown': ['brown', '棕', '棕色', '褐色'],
        'black': ['black', '黑', '黑色'],
        'white': ['white', '白', '白色'],
        'gray': ['gray', 'grey', '灰', '灰色'],
        'cyan': ['cyan', '青', '青色']
    };

    // Check if query is a color search
    let searchingForColor = null;
    for (const [colorKey, aliases] of Object.entries(COLOR_MAP)) {
        if (aliases.some(alias => query.includes(alias))) {
            searchingForColor = colorKey;
            break;
        }
    }

    // === 3-LAYER SEARCH STRATEGY ===

    // Layer 1 & 2: Local search (instant, no network)
    const localResults = performLocalSearch(query, searchingForColor);
    console.log(`🔍 Local search: found ${localResults.size} results for "${query}"`);

    // If local search found results, use them directly
    if (localResults.size > 0) {
        applySearchResults(cards, localResults, searchingForColor);
        return;
    }

    // Layer 3: AI Semantic Search (only if local search failed)
    // Check rate limit for non-admin users
    if (!isAdmin && !checkAISearchRateLimit()) {
        console.log('⏳ AI search rate limited');
        showSearchCooldownMessage();
        applySearchResults(cards, new Set(), searchingForColor); // Show no results
        return;
    }

    // Trigger AI semantic search
    console.log('🔍 Local search: 0 results, triggering AI semantic search...');
    const aiResults = await performAISemanticSearch(query);

    if (aiResults.size > 0) {
        console.log(`✨ AI search: found ${aiResults.size} results`);
        applySearchResults(cards, aiResults, searchingForColor);
    } else {
        console.log('❌ AI search: no results found');
        applySearchResults(cards, new Set(), searchingForColor);
    }
}

// Expand query using synonym dictionary
function expandSynonyms(query) {
    const q = query.toLowerCase();
    const expanded = new Set([q]);

    for (const [key, synonyms] of Object.entries(SYNONYM_DICTIONARY)) {
        const allTerms = [key, ...synonyms].map(s => s.toLowerCase());
        if (allTerms.some(term => q.includes(term) || term.includes(q))) {
            allTerms.forEach(s => expanded.add(s.toLowerCase()));
        }
    }

    return Array.from(expanded);
}

// Layer 1 & 2: Local search with synonym expansion + index optimization
// 【优化】原始词做精确+部分匹配，同义词只做精确匹配
function performLocalSearch(query, searchingForColor) {
    const matchedIds = new Set();
    const originalQuery = query.toLowerCase().trim();
    const expandedTerms = expandSynonyms(query);

    console.log(`🔄 Expanded terms: [${expandedTerms.slice(0, 5).join(', ')}${expandedTerms.length > 5 ? '...' : ''}]`);

    // Color search - still uses linear scan (color-specific)
    if (searchingForColor) {
        PROMPTS.forEach((item, index) => {
            if (item?.dominantColors?.includes(searchingForColor)) {
                matchedIds.add(index);
            }
        });
        return matchedIds;
    }

    if (!SEARCH_INDEX) buildSearchIndex();

    console.log(`📊 Index size: ${Object.keys(SEARCH_INDEX).length} terms`);

    // === 策略1：原始搜索词 - 精确匹配 + 部分匹配 ===
    if (SEARCH_INDEX[originalQuery]) {
        console.log(`✅ Direct match for "${originalQuery}":`, SEARCH_INDEX[originalQuery]);
        SEARCH_INDEX[originalQuery].forEach(id => matchedIds.add(id));
    }
    // 部分匹配 - 只对原始搜索词进行
    if (originalQuery.length >= 2) {
        const partialMatches = [];
        Object.keys(SEARCH_INDEX).forEach(indexedTerm => {
            if (indexedTerm.includes(originalQuery)) {
                partialMatches.push(indexedTerm);
                SEARCH_INDEX[indexedTerm].forEach(id => matchedIds.add(id));
            }
        });
        if (partialMatches.length > 0) {
            console.log(`🔍 Partial matches for "${originalQuery}":`, partialMatches);
        }
    }

    // === 策略2：同义词 - 只做精确匹配 ===
    expandedTerms.forEach(term => {
        if (term !== originalQuery && SEARCH_INDEX[term]) {
            SEARCH_INDEX[term].forEach(id => matchedIds.add(id));
        }
    });

    // If index search found nothing, fall back to linear search for fuzzy matching
    if (matchedIds.size === 0) {
        console.log('📝 Index miss, using linear fallback...');
        PROMPTS.forEach((item, index) => {
            if (!item) return;

            for (const term of expandedTerms) {
                // Check description and prompt text (not indexed)
                const descMatch = item.description?.toLowerCase().includes(term);
                const promptMatch = item.prompt?.toLowerCase().includes(term);

                if (descMatch || promptMatch) {
                    matchedIds.add(index);
                    break;
                }
            }
        });
    }

    return matchedIds;
}

// Check AI search rate limit (returns true if allowed)
function checkAISearchRateLimit() {
    const now = Date.now();
    const windowStart = now - AI_SEARCH_RATE_LIMIT.windowMs;

    // Clean up old entries
    AI_SEARCH_RATE_LIMIT.userSearchHistory = AI_SEARCH_RATE_LIMIT.userSearchHistory.filter(
        ts => ts > windowStart
    );

    // Check if under limit
    if (AI_SEARCH_RATE_LIMIT.userSearchHistory.length >= AI_SEARCH_RATE_LIMIT.maxPerMinute) {
        return false;
    }

    // Record this search
    AI_SEARCH_RATE_LIMIT.userSearchHistory.push(now);
    AI_SEARCH_RATE_LIMIT.cooldownShown = false;
    return true;
}

// Show cooldown message
function showSearchCooldownMessage() {
    if (AI_SEARCH_RATE_LIMIT.cooldownShown) return;
    AI_SEARCH_RATE_LIMIT.cooldownShown = true;

    // Show toast or inline message
    const searchWrapper = document.querySelector('.nav-search-wrapper');
    if (searchWrapper) {
        const existingMsg = searchWrapper.querySelector('.search-cooldown-msg');
        if (existingMsg) existingMsg.remove();

        const msg = document.createElement('div');
        msg.className = 'search-cooldown-msg';
        msg.innerHTML = '<i class="fas fa-clock"></i> AI 搜索冷却中，请稍后再试';
        msg.style.cssText = `
            position: absolute;
            bottom: -30px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(239, 68, 68, 0.9);
            color: white;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            white-space: nowrap;
            z-index: 100;
            animation: fadeIn 0.3s ease;
        `;
        searchWrapper.appendChild(msg);

        setTimeout(() => msg.remove(), 3000);
    }
}

// Layer 3: AI Semantic Search using Gemini 2.0 Flash
async function performAISemanticSearch(query) {
    const matchedIds = new Set();

    // Get API key from localStorage (same as admin-studio)
    const storedKeys = localStorage.getItem('gemini_api_keys');
    let apiKey = null;

    if (storedKeys) {
        try {
            const keys = JSON.parse(storedKeys);
            const activeKey = keys.find(k => k.active);
            if (activeKey) apiKey = activeKey.key;
        } catch (e) {
            console.warn('Failed to parse stored API keys');
        }
    }

    if (!apiKey) {
        console.log('⚠️ No Gemini API key available for semantic search');
        return matchedIds;
    }

    try {
        // Build prompt for intent understanding
        const prompt = `You are a search intent analyzer for an AI art gallery.
User searched: "${query}"

Extract 5-8 specific English tags that match this search intent.
Consider: art styles, moods, subjects, colors, techniques, scenes.

Return ONLY a JSON array of lowercase tags, no explanation:
["tag1", "tag2", ...]`;

        const response = await fetch(`${GEMINI_2_0_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 256
                }
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!text) return matchedIds;

        // Parse JSON response
        if (text.startsWith('```')) {
            text = text.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
        }

        const aiTags = JSON.parse(text);
        console.log(`🤖 AI extracted tags: [${aiTags.join(', ')}]`);

        // Search for these AI-extracted tags locally
        if (Array.isArray(aiTags)) {
            for (const tag of aiTags) {
                const tagLower = tag.toLowerCase();
                PROMPTS.forEach((item, index) => {
                    if (!item) return;

                    // Check title, tags, aiTags
                    const titleMatch = item.title?.toLowerCase().includes(tagLower);
                    const tagMatch = item.tags?.some(t => t.toLowerCase().includes(tagLower));

                    let aiMatch = false;
                    if (item.aiTags) {
                        const searchIn = (arr) => arr && arr.some(t => t && t.toLowerCase().includes(tagLower));
                        aiMatch = searchIn(item.aiTags.objects?.en) ||
                            searchIn(item.aiTags.styles?.en) ||
                            searchIn(item.aiTags.scenes?.en) ||
                            searchIn(item.aiTags.mood?.en);
                    }

                    if (titleMatch || tagMatch || aiMatch) {
                        matchedIds.add(index);
                    }
                });
            }
        }
    } catch (e) {
        console.error('AI semantic search error:', e);
    }

    return matchedIds;
}

// Apply search results to cards with animation
function applySearchResults(cards, matchedIds, searchingForColor) {
    let visibleIndex = 0;

    cards.forEach(card => {
        const cardId = parseInt(card.dataset.id);
        const item = PROMPTS[cardId];
        if (!item) return;

        let isVisible = matchedIds.has(cardId);

        // For color searches with no AI semantic involvement, also check colors
        if (searchingForColor && !isVisible) {
            isVisible = item.dominantColors && item.dominantColors.includes(searchingForColor);
        }

        if (isVisible) {
            card.style.display = '';
            card.classList.remove('card-visible');
            card.style.animationDelay = `${visibleIndex * 0.03}s`;
            visibleIndex++;
            requestAnimationFrame(() => {
                card.classList.add('card-visible');
            });
        } else {
            card.style.display = 'none';
        }
    });

    // Update nav items - deselect all when searching
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
}

// --- Modal Logic ---
let currentModalImageIndex = 0;
let currentModalImages = [];
let isCommentMode = false;
let currentPromptId = null;

function openPromptModal(id) {
    const item = PROMPTS.find(p => p.id === id);
    if (!item) return;

    currentPromptId = item.supabaseId || item.id; // Prefer persistent UUID if available
    const modal = document.getElementById('promptModal');

    // Reset State
    isCommentMode = false;
    modal.querySelector('.modal-inner').classList.remove('comment-mode');

    // Reset Prompt Area (in case it was docked/moved)
    const promptArea = document.getElementById('promptArea');
    const contentCol = document.querySelector('.modal-content-col');
    if (promptArea.parentNode !== contentCol) {
        // Move back to original column
        promptArea.classList.remove('docked');
        contentCol.appendChild(promptArea);
        // Correct insertion order: before comment section
        const commentSection = document.getElementById('commentSection');
        contentCol.insertBefore(promptArea, commentSection);
    }

    // Reset Unlock State
    const unlockBtn = document.getElementById('unlockPromptBtn');
    const promptText = document.getElementById('modalPromptText');
    promptText.classList.add('blur-masked');
    unlockBtn.innerHTML = '<i class="fas fa-gem"></i> 10';
    unlockBtn.onclick = handleUnlockPrompt;
    unlockBtn.className = 'unlock-btn'; // remove 'copy' style

    // Store images for navigation
    currentModalImages = item.images || [];
    currentModalImageIndex = 0;

    // Reset Image Container - remove ALL images (including leftovers from transitions)
    const imgContainer = document.querySelector('.modal-image-col');
    const allImages = imgContainer.querySelectorAll('img');
    allImages.forEach(img => img.remove());

    // Reset animation lock
    isModalImageAnimating = false;

    // Create fresh image
    const newImg = document.createElement('img');
    newImg.id = 'modalImg';
    newImg.className = 'active';
    newImg.src = currentModalImages[0];
    newImg.alt = item.title;

    // Insert before nav buttons
    const firstBtn = imgContainer.querySelector('.modal-img-nav');
    imgContainer.insertBefore(newImg, firstBtn);

    // Populate Data
    document.getElementById('modalTitle').textContent = item.title;
    document.getElementById('modalDesc').textContent = item.description;

    // Set prompt text (ensure clean connection)
    promptText.textContent = item.prompt;

    // Tags hidden as per user request
    const tagsContainer = document.getElementById('modalTags');
    tagsContainer.innerHTML = ''; // Hidden

    // Show/hide navigation arrows and counter
    const hasMultipleImages = currentModalImages.length > 1;
    const leftArrow = document.getElementById('modalImgNavLeft');
    const rightArrow = document.getElementById('modalImgNavRight');
    const counter = document.getElementById('modalImgCounter');

    if (hasMultipleImages) {
        leftArrow.style.display = 'flex';
        rightArrow.style.display = 'flex';
        counter.style.display = 'block';
        updateModalCounter();
    } else {
        leftArrow.style.display = 'none';
        rightArrow.style.display = 'none';
        counter.style.display = 'none';
    }

    // Reset Comments
    document.getElementById('commentList').innerHTML = '';
    document.getElementById('commentCountBadge').textContent = '0';

    // Check unlock status (if logged in)
    checkUnlockStatus(currentPromptId);

    // Fetch comment count
    fetchCommentCount(currentPromptId);

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// --- Spatial Flow & Comment Logic ---

function toggleCommentMode() {
    const modalInner = document.querySelector('.modal-inner');
    const promptArea = document.getElementById('promptArea');
    const dockTarget = document.getElementById('promptDockTarget');
    const contentCol = document.querySelector('.modal-content-col');

    if (isCommentMode) {
        // CLOSE COMMENTS (Revert to default)
        isCommentMode = false;
        modalInner.classList.remove('comment-mode');

        // FLIP: Move Prompt back to Right Column
        // 1. First: Measure current position (docked)
        const first = promptArea.getBoundingClientRect();

        // 2. State: Move DOM
        promptArea.classList.remove('docked');
        const commentSection = document.getElementById('commentSection');
        contentCol.insertBefore(promptArea, commentSection); // Insert before comments

        // 3. Last: Measure new position
        const last = promptArea.getBoundingClientRect();

        // 4. Invert & Play
        const dx = first.left - last.left;
        const dy = first.top - last.top;

        promptArea.style.transform = `translate(${dx}px, ${dy}px)`;
        promptArea.style.width = `${first.width}px`; // Maintain width during transition

        requestAnimationFrame(() => {
            promptArea.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), width 0.5s ease';
            promptArea.style.transform = '';
            promptArea.style.width = '';

            setTimeout(() => {
                promptArea.style.transition = '';
            }, 500);
        });

    } else {
        // OPEN COMMENTS (Activate Spatial Flow)
        isCommentMode = true;
        modalInner.classList.add('comment-mode');

        // Fetch comments
        fetchComments(currentPromptId);

        // FLIP: Move Prompt to Left Column Dock
        // 1. First: Measure current position
        const first = promptArea.getBoundingClientRect();

        // 2. State: Move DOM to Dock Target
        // We append it to the dock target container
        dockTarget.appendChild(promptArea);
        promptArea.classList.add('docked');

        // 3. Last: Measure new position
        const last = promptArea.getBoundingClientRect();

        // 4. Invert & Play
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        const wRatio = first.width / last.width;

        promptArea.style.transform = `translate(${dx}px, ${dy}px) scale(${wRatio})`;
        promptArea.style.transformOrigin = 'top left';

        requestAnimationFrame(() => {
            // Apply transition
            promptArea.style.transition = 'transform 0.6s cubic-bezier(0.19, 1, 0.22, 1)';
            promptArea.style.transform = ''; // Animate to zero

            setTimeout(() => {
                promptArea.style.transition = '';
            }, 600);
        });
    }
}

// --- Unlock & Points Logic ---

async function checkUnlockStatus(promptId) {
    if (!window.supabaseClient) return;
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) return; // Not logged in

    try {
        // Check if unlocked in DB
        const { data, error } = await window.supabaseClient
            .from('prompt_unlocks')
            .select('*')
            .eq('user_id', user.id)
            .eq('prompt_id', promptId) // Assuming promptId matches bigInt logic
            .maybeSingle();

        if (data) {
            setPromptUnlocked();
        }
    } catch (err) {
        console.error("Unlock check failed", err);
    }
}

async function handleUnlockPrompt() {
    if (!window.supabaseClient) {
        alert("Please connect to database for points system.");
        return;
    }

    // 1. Check Auth
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        // Trigger login modal
        showLoginModal();
        return;
    }

    const unlockBtn = document.getElementById('unlockPromptBtn');

    // 2. Optimistic UI update (optional, but safer to wait for RPC)
    unlockBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    // 3. Call RPC
    try {
        const { data, error } = await window.supabaseClient
            .rpc('unlock_prompt', {
                p_prompt_id: currentPromptId,
                p_cost: 10
            });

        if (error) throw error;

        if (data.success) {
            setPromptUnlocked();
            // Show toast or confetti?
            console.log("Unlocked! New Balance:", data.new_balance);
        } else {
            alert(data.error || "Unlock failed");
            unlockBtn.innerHTML = '<i class="fas fa-gem"></i> 10';
        }
    } catch (err) {
        console.error(err);
        alert("Transaction failed");
        unlockBtn.innerHTML = '<i class="fas fa-gem"></i> 10';
    }
}

function setPromptUnlocked() {
    const promptText = document.getElementById('modalPromptText');
    const unlockBtn = document.getElementById('unlockPromptBtn');

    // Remove blur
    promptText.classList.remove('blur-masked');

    // Transform button to Copy
    unlockBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
    unlockBtn.className = 'copy-btn'; // Switch to simple style
    unlockBtn.onclick = function () { copyPromptText(this); };
}

function copyPromptText(btn) {
    const text = document.getElementById('modalPromptText').textContent;
    navigator.clipboard.writeText(text).then(() => {
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied';
        setTimeout(() => {
            btn.innerHTML = originalContent;
        }, 2000);
    });
}

// --- Comment System (Supabase) ---

async function fetchCommentCount(promptId) {
    if (!window.supabaseClient) return;
    const { count } = await window.supabaseClient
        .from('prompt_comments')
        .select('*', { count: 'exact', head: true })
        .eq('prompt_id', promptId);

    document.getElementById('commentCountBadge').textContent = count || 0;
}

async function fetchComments(promptId) {
    if (!window.supabaseClient) return;
    const list = document.getElementById('commentList');
    list.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">Loading...</div>';

    // Start all queries in parallel for faster loading
    const [userResult, commentsResult] = await Promise.all([
        window.supabaseClient.auth.getUser(),
        window.supabaseClient
            .from('prompt_comments')
            .select(`
                *,
                profiles:user_id (id, username, avatar_url)
            `)
            .eq('prompt_id', promptId)
            .order('created_at', { ascending: true })
    ]);

    const currentUser = userResult.data?.user;
    const currentUserId = currentUser?.id || null;
    const { data, error } = commentsResult;

    if (error) {
        console.error("Comment Load Error:", error);
        list.innerHTML = '<div style="padding:20px; text-align:center; color:red;">Failed to load comments</div>';
        return;
    }

    // Parallel fetch: user profile avatar AND likes for all comments
    const commentIds = data.map(c => c.id);

    const [profileResult, likesResult] = await Promise.all([
        // Fetch current user's avatar (only if logged in)
        currentUserId
            ? window.supabaseClient.from('profiles').select('avatar_url').eq('id', currentUserId).single()
            : Promise.resolve({ data: null }),
        // Fetch all likes for these comments (only if there are comments)
        commentIds.length > 0
            ? window.supabaseClient.from('comment_likes').select('comment_id, user_id').in('comment_id', commentIds)
            : Promise.resolve({ data: [] })
    ]);

    // Process user avatar
    let currentUserAvatar = null;
    const dbAvatar = profileResult.data?.avatar_url;
    if (dbAvatar && dbAvatar.trim() !== '' &&
        (dbAvatar.startsWith('http') || (dbAvatar.startsWith('data:') && dbAvatar.length > 100))) {
        currentUserAvatar = dbAvatar;
    }

    // Process likes
    let userLikedCommentIds = new Set();
    let commentLikeCounts = new Map();

    if (likesResult.data) {
        likesResult.data.forEach(like => {
            if (like.user_id === currentUserId) {
                userLikedCommentIds.add(like.comment_id);
            }
            commentLikeCounts.set(
                like.comment_id,
                (commentLikeCounts.get(like.comment_id) || 0) + 1
            );
        });
    }

    list.innerHTML = '';
    if (data.length === 0) {
        list.innerHTML = '<div style="padding:40px; text-align:center; color:#999; font-style:italic;">No comments yet. Be the first to analyze this art.</div>';
        return;
    }

    // Build comment lookup map for finding parent info
    const commentMap = new Map();
    data.forEach(c => commentMap.set(c.id, c));

    // Build reply map: parent_id -> [replies]
    const replyMap = new Map();
    data.filter(c => c.parent_id).forEach(reply => {
        if (!replyMap.has(reply.parent_id)) {
            replyMap.set(reply.parent_id, []);
        }
        replyMap.get(reply.parent_id).push(reply);
    });

    // Get root-level comments (no parent)
    const rootComments = data.filter(c => !c.parent_id);

    // Recursive function to render a comment and all its nested replies
    const renderThread = (comment, isReply = false, isLastInThread = false) => {
        const overrideAvatar = (comment.user_id === currentUserId) ? currentUserAvatar : null;
        const replies = replyMap.get(comment.id) || [];
        const hasReplies = replies.length > 0;

        // Get parent profile for "Replying to" display
        const parentProfile = comment.parent_id ? commentMap.get(comment.parent_id)?.profiles : null;

        // Check if current user has liked this comment
        const isLiked = userLikedCommentIds.has(comment.id);

        // Get like count from our fresh count map
        const likeCount = commentLikeCounts.get(comment.id) || 0;

        renderComment(comment, overrideAvatar, parentProfile, hasReplies, isLastInThread && !hasReplies, isLiked, likeCount);

        // Render all nested replies
        replies.forEach((reply, index) => {
            const isLast = index === replies.length - 1;
            renderThread(reply, true, isLast);
        });
    };

    // Render all root comments and their threads
    rootComments.forEach(rootComment => {
        renderThread(rootComment, false, false);
    });

    // Scroll to top to show first comments
    setTimeout(() => {
        list.scrollTop = 0;
    }, 100);
}

function renderComment(comment, overrideAvatar = null, replyToProfile = null, hasReplies = false, isLastReply = false, isLiked = false, likeCount = 0) {
    const list = document.getElementById('commentList');
    // Handle various profile structures (standard vs metadata)
    const profile = comment.profiles || {};

    // Priority: Profile username -> Metadata name -> Email prefix -> 'Anonymous'
    const name = profile.username || (profile.email ? profile.email.split('@')[0] : 'Anonymous');

    // Robust Avatar Resolution - prioritize override from session
    const avatarUrl = overrideAvatar || getAvatarUrl(profile);
    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6b9ece&color=fff`;

    // Determine if this is a reply
    const isReply = !!comment.parent_id;
    const replyToName = replyToProfile?.username || 'someone';

    // Build "Replying to" HTML if this is a reply
    const replyingToHtml = isReply
        ? `<div class="comment-replying-to">Replying to <span class="comment-mention">@${escapeHtml(replyToName)}</span></div>`
        : '';

    // Remove leading @replyToName from content if it duplicates the "Replying to" display
    let displayContent = comment.content;
    if (isReply && replyToName) {
        // Match @username (case insensitive) at the start of content
        const mentionPattern = new RegExp(`^@${replyToName}\\s*`, 'i');
        displayContent = displayContent.replace(mentionPattern, '').trim();
    }

    // Determine heart icon class and style based on isLiked
    const heartIconClass = isLiked ? 'fas fa-heart' : 'far fa-heart';
    const heartStyle = isLiked ? 'style="color: #e74c3c;"' : '';

    const div = document.createElement('div');
    div.className = 'comment-item' + (isReply ? ' comment-reply' : '') + (hasReplies ? ' has-replies' : '') + (isLastReply ? ' last-reply' : '');
    div.dataset.commentId = comment.id;
    div.innerHTML = `
        ${isReply ? '<div class="thread-line"></div>' : ''}
        <img src="${avatarUrl}" class="comment-avatar" alt="${name}" onerror="this.onerror=null;this.src='${fallbackUrl}';">
        <div class="comment-body">
            ${replyingToHtml}
            <div class="comment-header">
                <span class="comment-author">${escapeHtml(name)} ${isAdminUser(comment.profiles?.email) ? '✨' : ''}</span>
                <span class="comment-time">${new Date(comment.created_at).toLocaleDateString()}</span>
            </div>
            <div class="comment-content">${formatMentions(displayContent)}</div>
            <div class="comment-actions">
                <button class="comment-action-btn like-btn" data-liked="${isLiked}">
                    <i class="${heartIconClass}" ${heartStyle}></i> <span class="like-count">${likeCount}</span>
                </button>
                <button class="comment-action-btn reply-btn">Reply</button>
            </div>
        </div>
    `;

    // Add event listeners
    const likeBtn = div.querySelector('.like-btn');
    const replyBtn = div.querySelector('.reply-btn');

    likeBtn.addEventListener('click', () => handleLikeComment(comment.id, likeBtn));
    replyBtn.addEventListener('click', () => handleReplyComment(comment.id, name));

    list.appendChild(div);
}

async function handleLikeComment(commentId, button) {
    if (!window.supabaseClient) {
        alert('请登录后点赞');
        return;
    }

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        showLoginModal();
        return;
    }

    const isLiked = button.dataset.liked === 'true';
    const icon = button.querySelector('i');
    const countSpan = button.querySelector('.like-count');
    let currentCount = parseInt(countSpan.textContent) || 0;

    // Optimistic UI update
    if (isLiked) {
        // Unlike
        icon.className = 'far fa-heart';
        icon.style.color = '';
        countSpan.textContent = Math.max(0, currentCount - 1);
        button.dataset.liked = 'false';
    } else {
        // Like
        icon.className = 'fas fa-heart';
        icon.style.color = '#e74c3c';
        countSpan.textContent = currentCount + 1;
        button.dataset.liked = 'true';
    }

    // Update database - only manage comment_likes table, count is derived from there
    try {
        if (isLiked) {
            // Remove like from comment_likes table
            await window.supabaseClient
                .from('comment_likes')
                .delete()
                .eq('comment_id', commentId)
                .eq('user_id', user.id);
        } else {
            // Add like to comment_likes table
            await window.supabaseClient
                .from('comment_likes')
                .insert({ comment_id: commentId, user_id: user.id });
        }
    } catch (err) {
        console.error('Like error:', err);
        // Revert on error
        countSpan.textContent = currentCount;
        button.dataset.liked = isLiked ? 'true' : 'false';
        icon.className = isLiked ? 'fas fa-heart' : 'far fa-heart';
        icon.style.color = isLiked ? '#e74c3c' : '';
    }
}

function handleReplyComment(commentId, authorName) {
    const input = document.getElementById('commentInput');
    if (input) {
        input.value = `@${authorName} `;
        input.focus();
        input.dataset.replyTo = commentId;
    }
}

function getAvatarUrl(profile) {
    // Consistent fallback for all avatars (Starry Blue)
    const getDefaultAvatar = (identifier) =>
        `https://ui-avatars.com/api/?name=${encodeURIComponent(identifier || 'User')}&background=6b9ece&color=fff`;

    // Identifier for fallback (prefer username or nothing)
    const identifier = profile?.username || profile?.user_metadata?.full_name || 'User';
    const DEFAULT_AVATAR = getDefaultAvatar(identifier);

    // Helper to validate avatar URL
    const isValidUrl = (url) => {
        if (!url || typeof url !== 'string') return false;
        const trimmed = url.trim();
        if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') return false;

        if (trimmed.startsWith('data:')) {
            // Check base64 length (prevent 1x1 pixel images)
            return trimmed.length > 100;
        }

        return trimmed.startsWith('http');
    };

    if (!profile) return DEFAULT_AVATAR;

    // DEBUG: trace what profile data we receive
    console.log('🔍 getAvatarUrl debug:', {
        profileAvatarUrl: profile.avatar_url ? profile.avatar_url.substring(0, 60) + '...' : 'NULL',
        userMetadataAvatar: profile.user_metadata?.avatar_url ? profile.user_metadata.avatar_url.substring(0, 60) + '...' : 'NULL',
        isValidDbAvatar: isValidUrl(profile.avatar_url)
    });

    // 1. Try direct avatar_url from profile (DB)
    if (isValidUrl(profile.avatar_url)) return profile.avatar_url.trim();

    // 2. Try metadata avatar (Auth)
    const meta = profile.user_metadata || {};
    if (isValidUrl(meta.avatar_url)) return meta.avatar_url.trim();

    // 3. Fallback
    return DEFAULT_AVATAR;
}

function isAdminUser(email) {
    return email === 'zaoyoe@gmail.com'; // Hardcoded check matching existing logic
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMentions(text) {
    // First escape HTML, then wrap @mentions in styled spans
    const escaped = escapeHtml(text);
    return escaped.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
}

function handleCommentKeydown(e) {
    if (e.key === 'Enter') {
        submitComment();
    }
}

async function submitComment() {
    if (!window.supabaseClient) return;

    const input = document.getElementById('commentInput');
    const content = input.value.trim();
    if (!content) return;

    // Check auth
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        showLoginModal();
        return;
    }

    // Get parent_id if this is a reply
    const parentId = input.dataset.replyTo || null;

    // Build insert data
    const insertData = {
        prompt_id: currentPromptId,
        user_id: user.id,
        content: content
    };

    // Only add parent_id if it's a reply
    if (parentId) {
        insertData.parent_id = parentId;
    }

    // Insert to DB
    const { data, error } = await window.supabaseClient
        .from('prompt_comments')
        .insert(insertData)
        .select()
        .single();

    if (error) {
        alert("Failed to post comment");
        return;
    }

    // Clear input and reply state
    input.value = '';
    delete input.dataset.replyTo;

    // Refresh comments to show proper threading
    fetchComments(currentPromptId);

    // Add points logic implies call to server or trigger, handled by DB trigger? 
    // We update UI badge
    const badge = document.getElementById('commentCountBadge');
    badge.textContent = parseInt(badge.textContent) + 1;
}

// Animation lock to prevent rapid click issues
let isModalImageAnimating = false;

function updateModalImage(index) {
    if (currentModalImages.length === 0) return;

    // Prevent rapid clicks from causing issues
    if (isModalImageAnimating) {
        console.log('⏳ Image transition in progress, ignoring click');
        return;
    }
    isModalImageAnimating = true;

    // Safety timeout: release lock after 5 seconds in case image never loads
    const safetyTimeout = setTimeout(() => {
        if (isModalImageAnimating) {
            console.warn('⚠️ Image load timeout, releasing animation lock');
            isModalImageAnimating = false;
        }
    }, 5000);

    currentModalImageIndex = index;

    const imgContainer = document.querySelector('.modal-image-col');
    const currentImg = document.getElementById('modalImg');

    // Remove any leftover transition images first
    const leftoverImages = imgContainer.querySelectorAll('.modal-next-image');
    leftoverImages.forEach(img => img.remove());

    // 1. Create new image (hidden)
    const newImg = document.createElement('img');
    newImg.src = currentModalImages[index];
    newImg.className = 'modal-next-image'; // Position absolute, opacity 0

    // Important: if in comment mode, new image also needs top:35% style? 
    // Handled by CSS selector .modal-inner.comment-mode .modal-image-col img

    // Insert after current image
    imgContainer.insertBefore(newImg, currentImg.nextSibling);

    // 2. Wait for load
    newImg.onload = () => {
        requestAnimationFrame(() => {
            // Simultaneously: fade IN new image, fade OUT old image
            newImg.classList.add('animate-in');
            currentImg.classList.add('animate-out'); // Add fade out to old image

            setTimeout(() => {
                // Clear safety timeout since load was successful
                clearTimeout(safetyTimeout);

                // Remove old image and clean up new one
                if (currentImg && currentImg.parentNode) {
                    currentImg.remove();
                }
                newImg.id = 'modalImg';
                newImg.classList.remove('modal-next-image', 'animate-in');
                newImg.className = 'active';

                // Release the lock
                isModalImageAnimating = false;
            }, 300); // Slightly faster cleanup
        });
    };

    // Fallback: release lock if image fails to load
    newImg.onerror = () => {
        console.warn('⚠️ Modal image failed to load, releasing lock');
        clearTimeout(safetyTimeout);
        isModalImageAnimating = false;
    };

    updateModalCounter();
}

function updateModalCounter() {
    const counter = document.getElementById('modalImgCounter');
    if (counter) {
        counter.textContent = `${currentModalImageIndex + 1} / ${currentModalImages.length}`;
    }
}

function navigateModalImage(direction) {
    if (currentModalImages.length <= 1) return;

    if (direction === 'next') {
        currentModalImageIndex = (currentModalImageIndex + 1) % currentModalImages.length;
    } else {
        currentModalImageIndex = (currentModalImageIndex - 1 + currentModalImages.length) % currentModalImages.length;
    }

    updateModalImage(currentModalImageIndex);
}

function closePromptModal() {
    const modal = document.getElementById('promptModal');

    // If closing while in comment mode, revert DOM first to prevent glitches next time
    if (isCommentMode) {
        // Simple revert without animation
        const promptArea = document.getElementById('promptArea');
        const contentCol = document.querySelector('.modal-content-col');
        const commentSection = document.getElementById('commentSection');
        if (promptArea.parentNode !== contentCol) {
            promptArea.classList.remove('docked');
            contentCol.insertBefore(promptArea, commentSection);
        }
    }

    // Reset image state to prevent issues when reopening
    isModalImageAnimating = false;

    // Clean up any leftover images in the modal
    const imgContainer = document.querySelector('.modal-image-col');
    if (imgContainer) {
        const allImages = imgContainer.querySelectorAll('img');
        allImages.forEach(img => img.remove());
    }

    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// Close modal on outside click
window.onclick = function (event) {
    const modal = document.getElementById('promptModal');
    if (event.target === modal) {
        closePromptModal();
    }
}
