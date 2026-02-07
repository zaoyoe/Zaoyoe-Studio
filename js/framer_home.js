/**
 * ==========================================
 * Framer Home - Dynamic Content Engine
 * ==========================================
 */

const FramerHome = {
  // Cached data
  cachedData: null,
  config: null,

  /**
   * Initialize the homepage
   */
  async init() {
    console.log('🚀 Initializing Framer Home...');

    // Scroll to top on page load
    window.scrollTo(0, 0);
    // Check performance and apply degradation if needed
    this.checkPerformance();

    // Load configuration and data
    await this.loadAll();

    // Render all sections
    this.renderAll();

    // Initialize navigation dropdowns (only once, after initial render)
    this.initNavDropdowns();

    // Initialize interactions
    this.initInteractions();

    // Initialize scroll animations
    this.initScrollAnimations();

    // Listen for language changes and re-render all content
    window.addEventListener('languageChanged', async (e) => {
      console.log(`🌐 Homepage language changed to: ${e.detail.lang}, re-rendering...`);

      // Re-build all data with new language
      this.cachedData.hero = this.buildHeroData(this.config.hero || {});

      // CRITICAL: Rebuild ticker data with new language-specific tags
      this.cachedData.ticker = await this.buildTickerData(this.config.ticker);

      // Re-render everything (but DON'T re-init dropdowns)
      this.renderAll();

      // CRITICAL: Re-initialize scroll animations for new DOM elements
      // Without this, new .fade-in-up elements stay at opacity: 0
      this.initScrollAnimations();

      console.log('✅ Homepage content re-rendered with new language');
    });

    console.log('✅ Framer Home initialized successfully');
  },

  /**
   * Performance check - disable glassmorphism on low-end devices
   */
  checkPerformance() {
    const isLowEnd = navigator.hardwareConcurrency < 4 ||
      /iPhone [4-6]/.test(navigator.userAgent) ||
      /Android [2-4]/.test(navigator.userAgent);

    if (isLowEnd) {
      document.body.classList.add('low-performance');
      console.warn('⚡ Low-end device detected, glassmorphism disabled');
    }
  },

  /**
   * Load all configuration and aggregate data
   */
  async loadAll() {
    try {
      // Fetch homepage config from Supabase
      this.config = await this.fetchHomepageConfig();

      // Aggregate all section data
      this.cachedData = {
        hero: this.buildHeroData(this.config.hero),
        prompts: await this.aggregatePrompts(this.config.prompts),
        shop: await this.aggregateShop(this.config.shop),
        verify: this.buildVerifyData(this.config.verify),
        guestbook: await this.aggregateGuestbook(this.config.guestbook),
        ticker: await this.buildTickerData(this.config.ticker)
      };

      console.log('📦 Data aggregated:', this.cachedData);
    } catch (error) {
      console.error('❌ Failed to load data:', error);
      // Use fallback default data
      this.useFallbackData();
    }
  },

  /**
   * Fetch homepage configuration from Supabase
   */
  async fetchHomepageConfig() {
    const { data, error } = await window.supabaseClient
      .from('homepage_config')
      .select('*')
      .eq('is_visible', true)
      .order('display_order', { ascending: true });

    if (error) throw error;

    // Convert array to object keyed by section
    const config = {};
    data.forEach(item => {
      config[item.section] = item.content;
    });

    return config;
  },

  /**
   * Build hero section data
   */
  buildHeroData(config) {
    return {
      title: config.title || window.i18n?.t('home.hero.title') || '早鸟工作室',
      subtitle: config.subtitle || window.i18n?.t('home.hero.subtitle') || '创意 · 效率 · 无限可能',
      cta: config.cta || {
        primary: { text: '开始探索', link: '#prompts' },
        secondary: { text: '了解更多', link: '#about' }
      },
      customImage: config.custom_image || null,
      entries: [
        { icon: 'fa-wand-magic-sparkles', text: window.i18n?.t('home.entries.prompts') || '提示词', link: '/prompts.html', color: '#f472b6' },
        { icon: 'fa-store', text: window.i18n?.t('home.entries.shop') || '商城', link: '/shop.html', color: '#4ade80' },
        { icon: 'fa-robot', text: window.i18n?.t('home.entries.verify') || '验证', link: '/verify.html', color: '#667eea' },
        { icon: 'fa-comment-dots', text: window.i18n?.t('home.entries.guestbook') || '留言板', link: '/guestbook.html', color: '#f59e0b' }
      ]
    };
  },

  /**
   * Aggregate prompts data (auto or manual)
   */
  async aggregatePrompts(config) {
    // Manual mode - use custom selected items
    if (!config.enable_auto && config.featured_items?.length > 0) {
      return config.featured_items
        .map(item => window.PROMPTS.find(p => p.id === item.id))
        .filter(Boolean)
        .slice(0, config.max_items || 24);
    }

    // Auto mode - sort by strategy
    const maxItems = config.max_items || 24;
    const sortStrategy = config.sort || 'popular';

    let sorted = [...window.PROMPTS];

    if (sortStrategy === 'popular') {
      // Sort by number of AI tags (rough popularity metric)
      sorted.sort((a, b) => {
        const aCount = Object.values(a.aiTags || {}).flat().length;
        const bCount = Object.values(b.aiTags || {}).flat().length;
        return bCount - aCount;
      });
    } else if (sortStrategy === 'latest') {
      // Prompts are already in order, just reverse
      sorted.reverse();
    } else if (sortStrategy === 'random') {
      // Fisher-Yates shuffle
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
    }

    return sorted.slice(0, maxItems);
  },

  /**
   * Aggregate shop products from Supabase
   */
  async aggregateShop(config) {
    if (!config.enable_auto && config.custom_items?.length > 0) {
      return config.custom_items;
    }

    try {
      let query = window.supabaseClient
        .from('shop_products')
        .select('id, name, description, icon_url, price_points, stock_count, category')
        .eq('is_active', true);

      if (config.category && config.category !== 'all') {
        query = query.eq('category', config.category);
      }

      const { data, error } = await query
        .order('display_order', { ascending: false })
        .limit(50); // Fetch more for random selection

      if (error) throw error;

      // Randomly select 6 products
      const shuffled = (data || []).sort(() => Math.random() - 0.5);
      return shuffled.slice(0, 6);
    } catch (error) {
      console.error('Failed to fetch shop products:', error);
      return [];
    }
  },

  /**
   * Build Gemini verify section data
   */
  buildVerifyData(config) {
    return {
      title: 'Gemini 验证', // Hardcoded to override DB config
      subtitle: config.section_subtitle || '快速验证您的 API 密钥，实时返回结果',
      screenshot: config.screenshot_path || '/assets/verify-preview.png',
      features: config.features || ['免费', '实时', '安全'],
      link: '/verify.html'
    };
  },

  /**
   * Aggregate guestbook messages
   */
  async aggregateGuestbook(config) {
    if (!config.enable_auto) return [];

    try {
      const { data, error } = await window.supabaseClient
        .from('guestbook_messages')
        .select(`
          id, 
          content, 
          image_url,
          like_count,
          created_at,
          user_id,
          profiles:user_id (username, avatar_url)
        `)
        .order('created_at', { ascending: false })
        .limit(config.max_items || 5);

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Failed to fetch guestbook:', error);
      return [];
    }
  },

  /**
   * Build ticker data (tags + products)
   */
  async buildTickerData(config) {
    const lang = window.i18n?.getCurrentLanguage() || 'zh';
    const tagsField = lang === 'en' ? 'tags_en' : 'tags';

    // Extract unique tags from prompts using language-specific field
    const tags = [...new Set(
      window.PROMPTS.flatMap(p => p[tagsField] || p.tags || [])
    )].slice(0, 20);

    // Get product names using localized fields
    const productNames = this.cachedData?.shop?.map(p =>
      this.getLocalizedField(p, 'name')
    ) || [];

    return {
      top: tags,
      bottom: productNames,
      speed: config.speed || 30
    };
  },

  /**
  * Fallback data when config fails to load
  */
  useFallbackData() {
    console.warn('⚠️ Using fallback data');
    this.config = {
      hero: { enable_auto: true },
      prompts: { enable_auto: true, max_items: 24, sort: 'popular', section_title: 'AI 提示词工作室', section_subtitle: '让创作更高效，让灵感更自由' },
      shop: { enable_auto: true, max_items: 8, section_title: '精选资源商城', section_subtitle: '优质资源，助力成长' },
      verify: { enable_auto: true, section_title: 'Gemini 验证', section_subtitle: '快速验证您的 API 密钥' },
      guestbook: { enable_auto: true, max_items: 5, section_title: '留言板', section_subtitle: '用户的声音' },
      ticker: { enable_auto: true, speed: 30 }
    };

    // Rebuild cachedData with fallback config
    this.cachedData = {
      hero: this.buildHeroData(this.config.hero),
      prompts: window.PROMPTS ? window.PROMPTS.slice(0, 6) : [],
      shop: [],
      verify: this.buildVerifyData(this.config.verify),
      guestbook: [],
      ticker: {
        top: window.PROMPTS ? [...new Set(window.PROMPTS.flatMap(p => p.tags || []))].slice(0, 20) : [],
        bottom: []
      }
    };
  },

  /**
   * Get localized field value based on current language
   * @param {Object} obj - Object with bilingual fields
   * @param {String} fieldBase - Base field name (e.g., 'title', 'name', 'description')
   * @returns {String} Localized value
   */
  getLocalizedField(obj, fieldBase) {
    if (!obj) return '';
    const lang = window.i18n?.getCurrentLanguage() || 'zh';

    // Try language-specific field first (field_en / field_zh)
    const langField = `${fieldBase}_${lang}`;
    if (obj[langField]) return obj[langField];

    // Fallback to base field
    if (obj[fieldBase]) return obj[fieldBase];

    // Last resort: try the other language
    const otherLang = lang === 'en' ? 'zh' : 'en';
    const otherField = `${fieldBase}_${otherLang}`;
    return obj[otherField] || '';
  },

  /**
   * Render all sections
   */
  renderAll() {
    this.renderHero();
    this.renderPrompts();
    this.renderShop();
    this.renderVerify();
    this.renderGuestbook();
    this.renderTicker();
    // Don't re-initialize dropdowns - they are already initialized once on page load
    // Re-initializing causes duplicate event listeners and breaks language toggle
  },

  /**
   * Initialize navigation dropdown menus
   * Dropdowns are appended to body (outside nav) to enable backdrop-filter
   */
  initNavDropdowns() {
    const self = this;

    // Get top 6 tags from prompts data
    const getTopTags = () => {
      const tagCounts = {};
      (this.cachedData.prompts || []).forEach(p => {
        // Handle multiple tag formats
        if (p.ai_tags && Array.isArray(p.ai_tags)) {
          p.ai_tags.forEach(tag => tagCounts[tag] = (tagCounts[tag] || 0) + 1);
        }
        if (p.aiTags && typeof p.aiTags === 'object') {
          ['styles', 'objects', 'scenes', 'mood'].forEach(cat => {
            if (p.aiTags[cat]?.zh) p.aiTags[cat].zh.forEach(tag => tagCounts[tag] = (tagCounts[tag] || 0) + 1);
          });
        }
        if (p.tags && Array.isArray(p.tags)) {
          p.tags.forEach(tag => tagCounts[tag] = (tagCounts[tag] || 0) + 1);
        }
      });

      let topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([tag]) => tag);

      return topTags.length > 0 ? topTags : ['卡通风格', '3D艺术', '渲染', '可爱', '数字艺术', '微缩'];
    };

    // Get shop categories
    const getShopCategories = () => {
      const categories = [...new Set((this.cachedData.shop || []).map(p => p.category).filter(Boolean))];
      return categories.length > 0 ? categories : ['全部商品', 'API密钥', '会员服务', '资源包'];
    };

    // Dropdown content data
    const dropdownData = {
      prompts: {
        items: getTopTags(),
        urlPrefix: '/prompts.html?tag='
      },
      shop: {
        items: getShopCategories(),
        urlPrefix: '/shop.html?category='
      },
      settings: {
        type: 'custom',
        render: () => {
          return `
            <div class="settings-dropdown-content">
              <button id="langToggleDropdown" class="lang-toggle-simple">
                <span id="langZhDropdown" class="lang-text active">中</span>
                <span class="lang-separator">|</span>
                <span id="langEnDropdown" class="lang-text">EN</span>
              </button>
            </div>
          `;
        }
      }
    };

    // Create dropdown elements and attach to body
    const triggers = document.querySelectorAll('.nav-trigger[data-dropdown]');

    triggers.forEach(trigger => {
      const dropdownType = trigger.dataset.dropdown;
      const data = dropdownData[dropdownType];
      if (!data) return;

      // Create dropdown element
      const dropdown = document.createElement('div');
      dropdown.className = 'nav-dropdown-portal';
      dropdown.id = `dropdown-${dropdownType}`;

      // Handle custom rendering or standard list
      if (data.type === 'custom' && data.render) {
        dropdown.innerHTML = data.render();
      } else {
        dropdown.innerHTML = data.items.map(item =>
          `<a href="${data.urlPrefix}${encodeURIComponent(item)}">${item}</a>`
        ).join('');
      }

      document.body.appendChild(dropdown);

      // Bind language toggle event (for settings dropdown only)
      if (dropdownType === 'settings') {
        const langToggleBtn = document.getElementById('langToggleDropdown');
        if (langToggleBtn) {
          langToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent dropdown from closing
            if (window.i18n && typeof window.i18n.toggleLanguage === 'function') {
              window.i18n.toggleLanguage();
              console.log('🌐 Language toggle clicked');
            } else {
              console.error('❌ i18n.toggleLanguage not available');
            }
          });

          // Listen for language changes to update button states
          window.addEventListener('languageChanged', (e) => {
            const langZh = document.getElementById('langZhDropdown');
            const langEn = document.getElementById('langEnDropdown');

            if (langZh && langEn) {
              if (e.detail.lang === 'zh') {
                langZh.classList.add('active');
                langEn.classList.remove('active');
              } else {
                langZh.classList.remove('active');
                langEn.classList.add('active');
              }
              console.log(`✅ Dropdown button state updated: ${e.detail.lang}`);
            }
          });
        }
      }

      let hideTimeout = null;

      const showDropdown = () => {
        clearTimeout(hideTimeout);
        // Position dropdown below nav bar (not trigger)
        const nav = document.querySelector('.framer-nav');
        const navRect = nav.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        dropdown.style.left = `${triggerRect.left + triggerRect.width / 2}px`;
        dropdown.style.top = `${navRect.bottom}px`;
        dropdown.classList.add('visible');
      };

      const hideDropdown = () => {
        hideTimeout = setTimeout(() => {
          dropdown.classList.remove('visible');
        }, 300);
      };

      const keepDropdownOpen = () => {
        clearTimeout(hideTimeout);
      };

      // Events
      trigger.addEventListener('mouseenter', showDropdown);
      trigger.addEventListener('mouseleave', hideDropdown);
      dropdown.addEventListener('mouseenter', keepDropdownOpen);
      dropdown.addEventListener('mouseleave', hideDropdown);
    });
  },

  /**
   * Render Hero section
   */
  renderHero() {
    const data = this.cachedData.hero;
    const section = document.getElementById('hero-section');

    section.innerHTML = `
      <div class="hero-glow" ${data.customImage ? `style="background-image: url(${data.customImage})"` : ''}></div>
      <h1 class="hero-title fade-in-up">${data.title}</h1>
      <p class="hero-subtitle fade-in-up">${data.subtitle}</p>
      
      <!-- Progress Indicator (Ruler Style) -->
      <div class="hero-progress fade-in-up">
        <div class="hero-progress-track">
          <div class="hero-progress-thumb"></div>
          ${Array(20).fill(0).map(() => `<span class="progress-tick"></span>`).join('')}
        </div>
      </div>
      
      <!-- Horizontal Scroll Carousel -->
      <div class="hero-carousel fade-in-up">
        <div class="hero-carousel-track">
          ${data.entries.map((entry, index) => `
            <a href="${entry.link}" class="entry-card" data-index="${index}">
              <i class="fas ${entry.icon}" style="color: ${entry.color}"></i>
              <span>${entry.text}</span>
            </a>
          `).join('')}
        </div>
      </div>
    `;

    // Initialize carousel interactions
    this.initCarousel();
  },

  /**
   * Distribute cards across masonry columns using shortest column algorithm
   * @param {Array} cards - Array of card data
   * @param {number} columnCount - Number of columns
   * @returns {Array} Array of columns, each containing card data
   */
  distributeCardsToColumns(cards, columnCount = 5) {
    const columns = Array.from({ length: columnCount }, () => []);
    const columnHeights = Array(columnCount).fill(0);

    // Fixed height estimation for consistent distribution
    cards.forEach(card => {
      // Find the shortest column
      const shortestIndex = columnHeights.indexOf(Math.min(...columnHeights));

      // Add card to shortest column
      columns[shortestIndex].push(card);

      // Use fixed height estimate + gap
      const estimatedHeight = 280; // Fixed base height
      columnHeights[shortestIndex] += estimatedHeight + 12; // +12 for margin-bottom
    });

    return columns;
  },

  /**
   * Render Prompts section with masonry layout
   */
  renderPrompts() {
    const prompts = this.cachedData.prompts;
    const config = this.config.prompts;
    const section = document.getElementById('prompts-section');

    // Change section class to masonry style
    section.className = 'prompts-masonry-section';

    // Distribute cards across 5 columns for balanced layout
    const columns = this.distributeCardsToColumns(prompts, 5);

    section.innerHTML = `
      <div class="section-header fade-in-up">
        <h2 class="section-title">${this.getLocalizedField(config, 'section_title') || window.i18n?.t('home.prompts.title') || 'AI 提示词工作室'}</h2>
        <p class="section-subtitle">${this.getLocalizedField(config, 'section_subtitle') || window.i18n?.t('home.prompts.subtitle') || '让创作更高效，让灵感更自由'}</p>
      </div>
      
      <div class="prompts-masonry-wrapper">
        <div class="masonry-container">
          ${columns.map((columnCards, columnIndex) => `
            <div class="masonry-column" data-column="${columnIndex}">
              ${columnCards.map(prompt => {
      // Extract 2-3 key tags for overlay
      const displayTags = (prompt.ai_tags || []).slice(0, 3);

      return `
                  <div class="masonry-card">
                    <img src="${prompt.images[0]}" 
                         alt="${prompt.title}" 
                         loading="lazy" />
                    <div class="masonry-card-tags">
                      ${displayTags.map(tag => `<span class="masonry-tag">${tag}</span>`).join('')}
                    </div>
                  </div>
                `;
    }).join('')}
            </div>
          `).join('')}
        </div>
        
        ${(() => {
        // Collect all unique tags for the mask
        const allTags = new Set();
        prompts.forEach(p => {
          if (p.aiTags) {
            ['styles', 'objects', 'scenes', 'mood'].forEach(c => {
              if (p.aiTags[c] && p.aiTags[c].zh) p.aiTags[c].zh.forEach(t => allTags.add(t));
            });
          } else if (p.tags) p.tags.forEach(t => allTags.add(t));
        });
        const tagList = Array.from(allTags).slice(0, 8); // Top 8 tags

        // Randomize slightly for variety
        const shuffled = tagList.sort(() => 0.5 - Math.random());
        const row1 = shuffled.slice(0, 4);
        const row2 = shuffled.slice(4, 8);

        return `
          <div class="prompts-gradient-mask">
            <div class="mask-labels-container" onclick="window.location.href='/prompts.html'">
              <div class="mask-labels-row">
                ${row1.map(tag => `<span class="mask-tag">${tag}</span>`).join('')}
              </div>
              <div class="mask-cta">
                <span class="mask-cta-text">${window.i18n?.t('home.prompts.viewMore') || '查看更多'}</span>
                <span class="mask-cta-arrow">›</span>
              </div>
              <div class="mask-labels-row">
                ${row2.map(tag => `<span class="mask-tag">${tag}</span>`).join('')}
              </div>
            </div>
          </div>
        `;
      })()}
      </div>
    `;

    // Initialize parallax after render
    this.initMasonryParallax();
  },

  /**
   * Render Shop section
   */
  renderShop() {
    const products = this.cachedData.shop;
    const config = this.config.shop;
    const section = document.getElementById('shop-section');

    if (!products || products.length === 0) {
      section.style.display = 'none';
      return;
    }

    // Duplicate products for seamless infinite scroll
    const duplicatedProducts = [...products, ...products];

    section.innerHTML = `
      <div class="section-header fade-in-up">
        <h2 class="section-title">${this.getLocalizedField(config, 'section_title') || window.i18n?.t('home.shop.title') || '精选资源商城'}</h2>
        <p class="section-subtitle">${this.getLocalizedField(config, 'section_subtitle') || window.i18n?.t('home.shop.subtitle') || '优质资源，助力成长'}</p>
      </div>
      
      <div class="shop-carousel-wrapper">
        <div class="shop-carousel-track">
          ${duplicatedProducts.map(product => `
            <a href="/shop.html" class="shop-carousel-card">
              <div class="shop-card-image">
                ${product.icon_url.startsWith('http')
        ? `<img src="${product.icon_url}" alt="${this.getLocalizedField(product, 'name')}">`
        : (product.icon_url.startsWith('fa-') ? `<i class="fas ${product.icon_url}" style="font-size: 48px; color: var(--accent-blue);"></i>` : `<img src="${product.icon_url}" alt="${this.getLocalizedField(product, 'name')}">`)}
              </div>
              <div class="shop-card-info">
                <h3>${this.getLocalizedField(product, 'name')}</h3>
                <p>${this.getLocalizedField(product, 'description')}</p>
              </div>
            </a>
          `).join('')}
        </div>
      </div>
    `;
  },

  /**
   * Render Gemini Verify section
   */
  renderVerify() {
    const data = this.cachedData.verify;
    const section = document.getElementById('verify-section');

    section.innerHTML = `
      <div class="grid-2 fade-in-up" style="align-items: center; gap: 80px; grid-template-columns: 0.8fr 1.2fr;">
        <div>
          <h2 class="section-title">${data.title || window.i18n?.t('home.verify.title') || 'Gemini 验证'}</h2>
          <p class="section-subtitle">${data.subtitle || window.i18n?.t('home.verify.subtitle') || '快速验证您的 API 密钥，实时返回结果'}</p>
          
          <div style="margin-top: 32px; display: flex; gap: 12px; flex-wrap: wrap;">
            ${data.features.map(feature => `
              <span style="padding: 8px 16px; background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple)); border-radius: 999px; font-size: 14px; font-weight: 600;">
                ${feature}
              </span>
            `).join('')}
          </div>
          
          <div style="margin-top: 48px;">
            <a href="${data.link}" class="btn btn-primary">${window.i18n?.t('home.verify.cta') || '立即验证'}</a>
          </div>
        </div>
        
        <div class="verify-3d-container">
          <div class="verify-card-3d">
            <img src="/assets/verify-card-3d.png" alt="Gemini Verify" style="width: 100%; border-radius: 12px;">
            <div class="verify-card-shine"></div>
          </div>
        </div>
      </div>
      </div>
    `;

    // Initialize 3D interaction
    this.initVerifyAnimation();
  },

  /**
   * Initialize Verify 3D Card Animation
   * - Entrance: Zoom in when visible
   * - Scroll: Parallax scale effect (Focus on center)
   */
  initVerifyAnimation() {
    const card = document.querySelector('.verify-card-3d');
    if (!card) return;

    // 1. Entrance Observer
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          card.classList.add('visible');
          observer.unobserve(card);
        }
      });
    }, { threshold: 0.15 });

    observer.observe(card);

    // 2. Scroll Interaction (Parallax Scale)
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking && card.classList.contains('visible')) {
        window.requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const viewHeight = window.innerHeight;

          // Only animate if roughly in view
          if (rect.top < viewHeight && rect.bottom > 0) {
            const center = viewHeight / 2;
            const cardCenter = rect.top + rect.height / 2;

            // Calculate distance from center (-0.5 to 0.5 relative to viewport)
            const dist = (center - cardCenter) / viewHeight;

            // Scale logic: 
            // Center (dist~0) -> Max Scale (1.02)
            // Edges (dist~0.5) -> Min Scale (0.92)
            // This creates a "breathing" effect where it grows as it hits center screen
            const targetScale = 1.02 - (Math.abs(dist) * 0.2);

            // Apply transform (maintain rotation)
            card.style.transform = `rotateY(-12deg) rotateX(6deg) scale(${Math.max(0.9, targetScale)})`;
          }
          ticking = false;
        });
        ticking = true;
      }
    });
  },

  /**
   * Render Guestbook section
   */
  renderGuestbook() {
    const messages = this.cachedData.guestbook;
    const config = this.config.guestbook;
    const section = document.getElementById('guestbook-section');

    if (!messages || messages.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.innerHTML = `
      <div class="section-header fade-in-up">
        <h2 class="section-title">${this.getLocalizedField(config, 'section_title') || window.i18n?.t('home.guestbook.title') || '留言板'}</h2>
        <p class="section-subtitle">${this.getLocalizedField(config, 'section_subtitle') || window.i18n?.t('home.guestbook.subtitle') || '用户的声音'}</p>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 24px; max-width: 800px; margin: 0 auto;">
        ${messages.map(msg => `
          <div class="glass-card fade-in-up" style="display: flex; gap: 16px;">
            <img src="${msg.profiles?.avatar_url || '/assets/default-avatar.png'}" 
                 style="width: 48px; height: 48px; border-radius: 50%; border: 2px solid var(--border-subtle);">
            <div style="flex: 1;">
              <div style="font-weight: 600; margin-bottom: 4px;">${msg.profiles?.username || '匿名用户'}</div>
              <p style="color: var(--text-secondary); font-size: 14px; line-height: 1.6;">${msg.content}</p>
              <div style="font-size: 12px; color: var(--text-tertiary); margin-top: 8px;">
                ${new Date(msg.created_at).toLocaleDateString('zh-CN')}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
      
      <div style="text-align: center; margin-top: 48px;">
        <a href="/guestbook.html" class="btn btn-secondary">${window.i18n?.t('home.guestbook.viewAll') || '查看全部留言'}</a>
      </div>
    `;
  },

  /**
   * Render infinite ticker section
   */
  renderTicker() {
    const data = this.cachedData.ticker;
    const section = document.getElementById('ticker-section');

    // Duplicate data for seamless loop
    const topItems = [...data.top, ...data.top];
    const bottomItems = [...data.bottom, ...data.bottom];

    section.innerHTML = `
      <div class="ticker-row">
        <div class="ticker ticker-left">
          <div class="ticker-track">
            ${topItems.map(tag => `<div class="ticker-item">${tag}</div>`).join('')}
          </div>
        </div>
      </div>
      
      <div class="ticker-row">
        <div class="ticker ticker-right">
          <div class="ticker-track">
            ${bottomItems.map(name => `<div class="ticker-item">${name}</div>`).join('')}
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Initialize hero carousel with horizontal scroll and scaling
   */
  initCarousel() {
    const carousel = document.querySelector('.hero-carousel');
    const track = document.querySelector('.hero-carousel-track');
    const cards = document.querySelectorAll('.hero-carousel .entry-card');
    const thumb = document.querySelector('.hero-progress-thumb');

    console.log('🎠 initCarousel called', { carousel, track, cards: cards.length, thumb });

    if (!carousel || !track || cards.length === 0) {
      console.warn('⚠️ Carousel elements not found, skipping init');
      return;
    }

    console.log('✅ Carousel elements found, binding events...');
    console.log('📏 Carousel dimensions:', {
      scrollWidth: carousel.scrollWidth,
      clientWidth: carousel.clientWidth,
      canScroll: carousel.scrollWidth > carousel.clientWidth
    });

    let currentIndex = 0;
    const cardCount = cards.length;

    // Update card scales and progress indicator
    const updateCarousel = () => {
      const scrollLeft = carousel.scrollLeft;
      const scrollWidth = carousel.scrollWidth - carousel.clientWidth;
      const progress = scrollWidth > 0 ? scrollLeft / scrollWidth : 0;

      // Update progress indicator position (relative to track)
      if (thumb) {
        const track = document.querySelector('.hero-progress-track');
        if (track) {
          const trackWidth = track.offsetWidth;
          const thumbWidth = thumb.offsetWidth;
          // Move thumb from 0 to (trackWidth - thumbWidth)
          const maxOffset = trackWidth - thumbWidth;
          thumb.style.left = `${progress * maxOffset}px`;
        }
      }

      // Calculate which card is centered and apply scaling
      const viewportCenter = window.innerWidth / 2;

      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        const cardCenter = rect.left + rect.width / 2;
        const distanceFromCenter = Math.abs(cardCenter - viewportCenter);
        const maxDistance = rect.width * 1.5;

        // Scale: 1.1 when centered, 0.85 when far (more dramatic effect)
        const scale = Math.max(0.85, 1.1 - (distanceFromCenter / maxDistance) * 0.25);
        // Opacity: 1.0 when centered, 0.5 when far
        const opacity = Math.max(0.5, 1 - (distanceFromCenter / maxDistance) * 0.5);

        card.style.transform = `scale(${scale})`;
        card.style.opacity = opacity;
      });
    };

    // Track scroll activity for thumb glow effect
    let scrollTimeout = null;

    const activateThumb = () => {
      if (thumb) thumb.classList.add('active');
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        if (thumb) thumb.classList.remove('active');
      }, 300);
    };


    // Touch swipe support for mobile
    let touchStartX = 0;
    let touchStartScrollLeft = 0;

    carousel.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartScrollLeft = carousel.scrollLeft;
    }, { passive: true });

    carousel.addEventListener('touchmove', (e) => {
      const deltaX = touchStartX - e.touches[0].clientX;
      carousel.scrollLeft = touchStartScrollLeft + deltaX;
      updateCarousel();
    }, { passive: true });

    // Scroll event for smooth updates
    carousel.addEventListener('scroll', updateCarousel);

    // Click behavior: center card first, then navigate
    const centerThreshold = 50; // pixels - how close to center to be considered "centered"

    cards.forEach((card) => {
      card.addEventListener('click', (e) => {
        const viewportCenter = window.innerWidth / 2;
        const rect = card.getBoundingClientRect();
        const cardCenter = rect.left + rect.width / 2;
        const distanceFromCenter = Math.abs(cardCenter - viewportCenter);

        // If card is not centered, scroll to center it and prevent navigation
        if (distanceFromCenter > centerThreshold) {
          e.preventDefault();
          e.stopPropagation();

          // Calculate how much to scroll to center this card
          const scrollDelta = cardCenter - viewportCenter;

          carousel.scrollTo({
            left: carousel.scrollLeft + scrollDelta,
            behavior: 'smooth'
          });

          activateThumb();
        }
        // If already centered, let the click through to navigate
      });
    });

    // Initial update
    requestAnimationFrame(updateCarousel);
  },

  /**
   * Initialize interactions (nav, mobile menu)
   */
  initInteractions() {
    // Scroll effect on navbar
    window.addEventListener('scroll', () => {
      const nav = document.querySelector('.framer-nav');
      if (window.scrollY > 50) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    });

    // Mobile menu toggle
    const hamburger = document.querySelector('.nav-hamburger');
    const mobileMenu = document.querySelector('.mobile-menu');

    if (hamburger && mobileMenu) {
      // Toggle mobile menu on hamburger click
      hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        mobileMenu.classList.toggle('active');
      });

      // Sync desktop dropdown content to mobile submenus
      const syncDropdownToMobile = (desktopDropdownId, mobileSubmenuId) => {
        const desktopDropdown = document.getElementById(desktopDropdownId);
        const mobileSubmenu = document.getElementById(mobileSubmenuId);

        if (desktopDropdown && mobileSubmenu) {
          // Clone the content from desktop dropdown
          const content = desktopDropdown.cloneNode(true);
          // Remove any IDs to avoid duplicates
          content.removeAttribute('id');
          mobileSubmenu.innerHTML = content.innerHTML;
        }
      };

      // Sync all dropdowns (wait a bit to ensure dropdowns are rendered)
      setTimeout(() => {
        syncDropdownToMobile('dropdown-prompts', 'prompts-mobile');
        syncDropdownToMobile('dropdown-shop', 'shop-mobile');
        syncDropdownToMobile('dropdown-settings', 'settings-mobile');
      }, 100);

      // Mobile submenu toggle
      const mobileTriggers = mobileMenu.querySelectorAll('.mobile-menu-trigger');
      mobileTriggers.forEach(trigger => {
        trigger.addEventListener('click', () => {
          const submenuId = trigger.getAttribute('data-submenu');
          const submenu = document.getElementById(submenuId);

          if (submenu) {
            trigger.classList.toggle('active');
            submenu.classList.toggle('active');
          }
        });
      });

      // Close mobile menu on link click
      mobileMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
          hamburger.classList.remove('active');
          mobileMenu.classList.remove('active');

          // Also close all open submenus
          mobileMenu.querySelectorAll('.mobile-submenu.active').forEach(submenu => {
            submenu.classList.remove('active');
          });
          mobileMenu.querySelectorAll('.mobile-menu-trigger.active').forEach(trigger => {
            trigger.classList.remove('active');
          });
        });
      });
    }
  },

  /**
   * Initialize parallax scroll effect for masonry columns
   */
  initMasonryParallax() {
    const columns = document.querySelectorAll('.masonry-column');
    if (columns.length === 0) return;

    // Define alternating scroll speed multipliers (Every other column slides faster)
    // 1.0 = normal scroll, 1.2 = moves faster (slides up)
    const speedMultipliers = [1.0, 1.2, 1.0, 1.2];

    let ticking = false;

    const updateParallax = () => {
      const scrollY = window.pageYOffset;
      const section = document.querySelector('.prompts-masonry-section');

      if (!section) {
        ticking = false;
        return;
      }

      const sectionTop = section.offsetTop;
      const sectionHeight = section.offsetHeight;
      const viewportHeight = window.innerHeight;

      // Only apply parallax when section is in view
      if (scrollY + viewportHeight > sectionTop && scrollY < sectionTop + sectionHeight) {
        // Calculate progress relative to the section top
        // Anchor exactly at section start so it begins aligned
        const relativeScroll = scrollY - sectionTop;

        columns.forEach((column, index) => {
          // Use modulus to cycle through multipliers for any number of columns
          const speed = speedMultipliers[index % speedMultipliers.length];

          // Calculate offset: 
          // If speed is 1.0, offset is 0.
          // If speed is 1.2, offset is negative (moves UP faster than scroll)
          let offset = relativeScroll * (1 - speed) * 0.4;

          // Prevent "sinking": Clamp offset to be <= 0
          // This ensures columns never move DOWN below their original position,
          // keeping the top edge perfectly aligned when at the top of the section.
          // They will only slide UP (negative y) as you scroll down.
          if (offset > 0) offset = 0;

          column.style.transform = `translate3d(0, ${offset}px, 0)`;
        });
      }

      ticking = false;
    };

    const requestTick = () => {
      if (!ticking) {
        requestAnimationFrame(updateParallax);
        ticking = true;
      }
    };

    window.addEventListener('scroll', requestTick, { passive: true });
    updateParallax(); // Initial position
  },

  /**
   * Initialize scroll-triggered animations
   */
  initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -100px 0px'
    });

    document.querySelectorAll('.fade-in-up').forEach(el => {
      observer.observe(el);
    });
  }
};

// Auto-initialize when DOM is ready and dependencies are loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    // Wait for PROMPTS and supabaseClient to be available
    const waitForDeps = setInterval(() => {
      if (window.PROMPTS && window.supabaseClient) {
        clearInterval(waitForDeps);
        FramerHome.init();
      }
    }, 100);
  });
} else {
  // DOM already loaded, check for deps
  const waitForDeps = setInterval(() => {
    if (window.PROMPTS && window.supabaseClient) {
      clearInterval(waitForDeps);
      FramerHome.init();
    }
  }, 100);
}

// Export to window for global access
window.FramerHome = FramerHome;

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FramerHome;
}
