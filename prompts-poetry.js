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

            if (avatarBtn && user.user_metadata?.avatar_url) {
                avatarBtn.innerHTML = `<img src="${user.user_metadata.avatar_url}" alt="Avatar">`;
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

function generateDynamicNav() {
    const navContainer = document.getElementById('navItems');
    if (!navContainer || !PROMPTS) return;

    // Count tag frequency
    const tagCounts = {};
    PROMPTS.forEach(prompt => {
        if (prompt.tags && Array.isArray(prompt.tags)) {
            prompt.tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }
    });

    // Sort by frequency and take top categories (max 6)
    const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([tag]) => tag);

    // Build nav HTML
    let navHTML = `
        <div class="nav-item active" data-filter="all">
            <span class="en">All</span>
            <span class="cn">全部</span>
        </div>
    `;

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
        } else {
            allFilteredItems = [...PROMPTS];
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

    // Generate hot tags from PROMPTS data
    function generateHotTags() {
        if (!hotTagsList || typeof PROMPTS === 'undefined') return;

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
        const topTags = Object.entries(tagFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([tag]) => tag);

        // Render hot tags as circular elements
        hotTagsList.innerHTML = topTags.map((tag, i) =>
            `<span class="hot-tag" data-tag="${tag}" style="--delay: ${i * 0.15}s">${tag}</span>`
        ).join('');

        // Add mousedown handlers to hot tags (mousedown fires before document mousedown)
        hotTagsList.querySelectorAll('.hot-tag').forEach(tagEl => {
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
        if (isDropdownActive) return;
        isDropdownActive = true;
        dropdown.classList.add('active');

        // Show hot tags if search is empty
        const query = searchInput.value.trim();
        if (!query) {
            if (hotTagsSection) hotTagsSection.style.display = 'block';
            if (suggestionsSection) suggestionsSection.style.display = 'none';
            generateHotTags();
        }
    }

    // Hide dropdown
    function hideDropdown() {
        isDropdownActive = false;
        dropdown.classList.remove('active');
    }

    // Show suggestions based on query
    function showSuggestions(query) {
        if (!suggestionsSection || !query) {
            if (hotTagsSection) hotTagsSection.style.display = 'block';
            if (suggestionsSection) suggestionsSection.style.display = 'none';
            return;
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

        const suggestionArray = Array.from(suggestions).slice(0, 6);

        if (suggestionArray.length > 0) {
            if (hotTagsSection) hotTagsSection.style.display = 'none';
            suggestionsSection.style.display = 'flex';
            suggestionsSection.innerHTML = suggestionArray.map(s =>
                `<div class="suggestion-item">${s}</div>`
            ).join('');

            // Add mousedown handlers (mousedown fires before document mousedown)
            suggestionsSection.querySelectorAll('.suggestion-item').forEach(item => {
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // Prevent text selection
                    e.stopPropagation();
                    searchInput.value = item.textContent;
                    filterBySearch(item.textContent.toLowerCase());
                    hideDropdown();
                });
            });
        } else {
            // No suggestions, show hot tags
            if (hotTagsSection) hotTagsSection.style.display = 'block';
            suggestionsSection.style.display = 'none';
        }
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

    // Try Supabase Full-Text Search first (only if not pure color search)
    let supabaseMatchedIds = null;
    if (window.supabaseClient && !searchingForColor) {
        try {
            const { data, error } = await window.supabaseClient
                .from('prompts')
                .select('id')
                .textSearch('fts', query, {
                    type: 'websearch',
                    config: 'english'
                });

            if (!error && data && data.length > 0) {
                supabaseMatchedIds = new Set(data.map(p => p.id));
                console.log(`🔍 Supabase FTS: Found ${supabaseMatchedIds.size} results for "${query}"`);
            }
        } catch (e) {
            console.warn('Supabase search failed, falling back to local:', e);
        }
    }

    // Filter cards based on results
    let visibleIndex = 0;
    cards.forEach(card => {
        const cardId = parseInt(card.dataset.id);
        const item = PROMPTS[cardId];
        if (!item) return;

        let isVisible = false;

        // If searching for a color, only match by color
        if (searchingForColor) {
            isVisible = item.dominantColors && item.dominantColors.includes(searchingForColor);
        } else {
            // Always do local search (including AI tags)
            const titleMatch = item.title.toLowerCase().includes(query);
            const tagMatch = item.tags.some(t => t.toLowerCase().includes(query));
            const descMatch = item.description && item.description.toLowerCase().includes(query);
            const promptMatch = item.prompt && item.prompt.toLowerCase().includes(query);

            // AI Smart Search (Objects, Scenes, Styles, Mood)
            let aiMatch = false;
            if (item.aiTags) {
                const searchIn = (arr) => arr && arr.some(t => t && t.toLowerCase().includes(query));
                aiMatch = searchIn(item.aiTags.objects?.en) ||
                    searchIn(item.aiTags.objects?.zh) ||
                    searchIn(item.aiTags.scenes?.en) ||
                    searchIn(item.aiTags.scenes?.zh) ||
                    searchIn(item.aiTags.styles?.en) ||
                    searchIn(item.aiTags.styles?.zh) ||
                    searchIn(item.aiTags.mood?.en) ||
                    searchIn(item.aiTags.mood?.zh);
            }

            // Supabase FTS match (if available)
            const supabaseMatch = supabaseMatchedIds && supabaseMatchedIds.has(cardId + 1);

            isVisible = titleMatch || tagMatch || descMatch || promptMatch || aiMatch || supabaseMatch;
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

function openPromptModal(id) {
    const item = PROMPTS.find(p => p.id === id);
    if (!item) return;

    const modal = document.getElementById('promptModal');

    // Store images for navigation
    currentModalImages = item.images || [];
    currentModalImageIndex = 0;

    // Reset Image Container
    const imgContainer = document.querySelector('.modal-image-col');
    // Keep navigation buttons, remove old images
    const oldImg = document.getElementById('modalImg');
    if (oldImg) oldImg.remove();

    // Create fresh image
    const newImg = document.createElement('img');
    newImg.id = 'modalImg';
    newImg.className = 'active'; // Visible by default
    newImg.src = currentModalImages[0];
    newImg.alt = item.title;

    // Insert before nav buttons
    const firstBtn = imgContainer.querySelector('.modal-img-nav');
    imgContainer.insertBefore(newImg, firstBtn);

    // Populate Data
    document.getElementById('modalTitle').textContent = item.title;
    document.getElementById('modalDesc').textContent = item.description;
    document.getElementById('modalPromptText').textContent = item.prompt;

    const tagsContainer = document.getElementById('modalTags');
    tagsContainer.innerHTML = item.tags.map(t => `<span style="padding:4px 10px; border:1px solid rgba(0,0,0,0.2); border-radius:12px;">${t}</span>`).join('');

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

    modal.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent background scroll
}

function updateModalImage(index) {
    if (currentModalImages.length === 0) return;

    currentModalImageIndex = index;

    const imgContainer = document.querySelector('.modal-image-col');
    const currentImg = document.getElementById('modalImg');

    // 1. Create new image (hidden)
    const newImg = document.createElement('img');
    newImg.src = currentModalImages[index];
    newImg.className = 'modal-next-image'; // Position absolute, opacity 0

    // Insert after current image
    imgContainer.insertBefore(newImg, currentImg.nextSibling);

    // 2. Wait for load
    newImg.onload = () => {
        requestAnimationFrame(() => {
            // Simultaneously: fade IN new image, fade OUT old image
            newImg.classList.add('animate-in');
            currentImg.classList.add('animate-out'); // Add fade out to old image

            setTimeout(() => {
                // Remove old image and clean up new one
                if (currentImg && currentImg.parentNode) {
                    currentImg.remove();
                }
                newImg.id = 'modalImg';
                newImg.classList.remove('modal-next-image', 'animate-in');
                newImg.className = 'active';
            }, 300); // Slightly faster cleanup
        });
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
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// --- Copy Functionality ---
function copyPromptText(btn) {
    const text = document.getElementById('modalPromptText').textContent;
    navigator.clipboard.writeText(text).then(() => {
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied';
        btn.style.color = '#4ade80';
        btn.style.borderColor = '#4ade80';

        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.style.color = '';
            btn.style.borderColor = '';
        }, 2000);
    });
}

// Close modal on outside click
window.onclick = function (event) {
    const modal = document.getElementById('promptModal');
    if (event.target === modal) {
        closePromptModal();
    }
}
