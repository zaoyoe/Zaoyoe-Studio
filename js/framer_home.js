/**
 * ==========================================
 * Framer Home - Dynamic Content Engine
 * ==========================================
 */

// Utility: Force Safari address bar to solid black when mobile menu is open
window.toggleMobileThemeColor = function (isActive) {
  let metaTheme = document.querySelector('meta[name="theme-color"]');
  if (isActive) {
    if (!metaTheme) {
      metaTheme = document.createElement('meta');
      metaTheme.name = 'theme-color';
      metaTheme.setAttribute('data-injected-by-menu', 'true');
      document.head.appendChild(metaTheme);
    } else if (!metaTheme.hasAttribute('data-original-content')) {
      metaTheme.setAttribute('data-original-content', metaTheme.content);
    }
    metaTheme.content = '#000000';
  } else {
    if (metaTheme) {
      if (metaTheme.hasAttribute('data-injected-by-menu')) {
        metaTheme.remove();
      } else if (metaTheme.hasAttribute('data-original-content')) {
        metaTheme.content = metaTheme.getAttribute('data-original-content');
        metaTheme.removeAttribute('data-original-content'); // cleanup
      }
    }
  }
};

const MOBILE_MENU_LOCK_CLASS = 'mobile-menu-open';
const HOME_SHOP_CAROUSEL_CARD_WIDTH = 200;
const HOME_SHOP_CAROUSEL_GAP = 24;
const HOME_SHOP_CAROUSEL_EXTRA_BUFFER = HOME_SHOP_CAROUSEL_CARD_WIDTH + (HOME_SHOP_CAROUSEL_GAP * 2);
const HOME_LOOP_MIN_PIXELS_PER_SECOND = 10;
const HOME_LOOP_MAX_PIXELS_PER_SECOND = 140;
const HOME_GUESTBOOK_CARD_SLOTS = ['l1', 'l2', 'l3', 'r1', 'r2', 'r3'];
const HOME_GUESTBOOK_PARTICLE_COUNT = 24;
const HOME_GUESTBOOK_PARTICLE_SEED = 20260409;
const HOME_GUESTBOOK_PARTICLE_RESET_SEED = 9090909;
const HOMEPAGE_PREFETCH_CACHE_KEY = 'homepage_prefetch';
const HOMEPAGE_CONFIG_LAST_UPDATED_KEY = 'homepage_config_last_updated_at';
const HOMEPAGE_PREFETCH_SCHEMA_VERSION = '20260411_HOMEPAGE_P2_EXPERIMENTS_1';
const HomepageContract = window.HomepageContract || null;
const HOME_DEFAULT_SECTION_ORDER = Array.isArray(HomepageContract?.MANAGED_SECTION_ORDER)
  ? [...HomepageContract.MANAGED_SECTION_ORDER]
  : ['hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker'];

function getHomepageRuntimeSite() {
  return HomepageContract?.normalizeSite?.(window.SiteConfig?.site) || (window.SiteConfig?.site === 'intl' ? 'intl' : 'cn');
}

function getHomepagePrefetchCacheKey(site = getHomepageRuntimeSite()) {
  return `${HOMEPAGE_PREFETCH_CACHE_KEY}_${site}`;
}

function getHomepageConfigLastUpdatedKey(site = getHomepageRuntimeSite()) {
  return `${HOMEPAGE_CONFIG_LAST_UPDATED_KEY}_${site}`;
}

async function loadHomepageConfigRows(site = getHomepageRuntimeSite()) {
  const { data, error } = await window.supabaseClient
    .rpc('fn_get_homepage_config', {
      p_site: site,
      p_include_hidden: false
    });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function readHomepagePrefetchCache(site = getHomepageRuntimeSite()) {
  const key = getHomepagePrefetchCacheKey(site);
  const raw = sessionStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.site && parsed.site !== site) {
      return null;
    }
    if (parsed?.schemaVersion !== HOMEPAGE_PREFETCH_SCHEMA_VERSION) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch (error) {
    sessionStorage.removeItem(key);
  }

  return null;
}

function clearHomepagePrefetchCache(site = getHomepageRuntimeSite()) {
  sessionStorage.removeItem(getHomepagePrefetchCacheKey(site));
  sessionStorage.removeItem(HOMEPAGE_PREFETCH_CACHE_KEY);
}

function writeHomepagePrefetchCache(payload, site = getHomepageRuntimeSite()) {
  sessionStorage.setItem(getHomepagePrefetchCacheKey(site), JSON.stringify({
    ...payload,
    schemaVersion: HOMEPAGE_PREFETCH_SCHEMA_VERSION,
    site
  }));
  sessionStorage.removeItem(HOMEPAGE_PREFETCH_CACHE_KEY);
}

function escapeHomeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampHomeValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeTickerItems(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function getHomepagePrimaryLanguage() {
  return getHomepageRuntimeSite() === 'intl' ? 'en' : 'zh';
}

function isHomepagePrimaryLanguageActive() {
  return (window.i18n?.getCurrentLanguage?.() || 'zh') === getHomepagePrimaryLanguage();
}

function cloneHomeExperimentValue(value) {
  if (typeof value === 'string') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => ({ ...item }));
  }
  return value;
}

function getHomepageExperimentAssignmentStorageKey(experimentId = '') {
  return `homepage_experiment_assignment_${getHomepageRuntimeSite()}_${String(experimentId || '').trim()}`;
}

function resolveHomepageExperimentVariantKey(experiment = {}) {
  if (!experiment?.id || experiment?.status === 'paused') {
    return 'control';
  }

  try {
    const stored = sessionStorage.getItem(getHomepageExperimentAssignmentStorageKey(experiment.id));
    if (stored === 'control' || stored === 'variant') {
      return stored;
    }
  } catch (error) {
    // Ignore storage failures and fall back to a new assignment.
  }

  const trafficPercent = Math.min(95, Math.max(5, Number(experiment?.traffic_percent || 50) || 50));
  const variantKey = Math.random() * 100 < trafficPercent ? 'variant' : 'control';

  try {
    sessionStorage.setItem(getHomepageExperimentAssignmentStorageKey(experiment.id), variantKey);
  } catch (error) {
    // Ignore storage failures.
  }

  return variantKey;
}

function getHomepageActiveExperimentPayloads() {
  try {
    const experiments = window.getHomepageActiveExperiments?.();
    return Array.isArray(experiments) ? experiments : [];
  } catch (error) {
    return [];
  }
}

function resolveHomepageExperimentSectionsForEvent(eventName = '', payload = {}) {
  const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const explicitSection = String(metadata.section || metadata.homepage_section || '').trim();
  if (explicitSection) {
    return [explicitSection];
  }

  switch (String(eventName || '').trim()) {
    case 'homepage_experiment_impression':
      return [];
    case 'homepage_entry_click':
      return ['hero'];
    case 'homepage_prompt_click':
      return ['prompts'];
    case 'homepage_shop_click':
      return ['shop'];
    case 'homepage_verify_click':
      return ['verify'];
    case 'homepage_guestbook_click':
      return ['guestbook'];
    default:
      return [];
  }
}

function trackHomepageAnalyticsEvent(eventName, payload = {}, options = {}) {
  const tracker = window.UserEventTracker;
  if (!tracker || typeof tracker.track !== 'function') {
    return;
  }

  const metadata = payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata
    : {};
  const normalizedPayload = {
    module: payload.module || 'homepage',
    entityType: payload.entityType || 'homepage_item',
    entityId: payload.entityId || null,
    eventValue: payload.eventValue ?? null,
    metadata: {
      site: getHomepageRuntimeSite(),
      ...metadata
    }
  };
  const experimentSections = resolveHomepageExperimentSectionsForEvent(eventName, payload);
  const activeExperiments = getHomepageActiveExperimentPayloads().filter((experiment) => {
    return experimentSections.length === 0
      ? false
      : experimentSections.includes(String(experiment?.section || '').trim());
  });
  if (activeExperiments.length > 0 && !Array.isArray(normalizedPayload.metadata.experiments)) {
    normalizedPayload.metadata.experiments = activeExperiments;
  }
  const eventType = options.eventType
    || (String(eventName || '').includes('impression') ? 'view' : (String(eventName || '').includes('click') ? 'click' : 'interaction'));
  const trackingPromise = options.dedupeKey && typeof tracker.trackOnce === 'function'
    ? tracker.trackOnce(options.dedupeKey, eventName, normalizedPayload, { eventType })
    : tracker.track(eventName, normalizedPayload, { eventType });

  void Promise.resolve(trackingPromise).catch((error) => {
    console.debug('[HomepageAnalytics] Track failed:', eventName, error?.message || error);
  });
}

function observeHomepageSectionImpression(sectionEl, sectionKey, extraEventName = '') {
  if (!(sectionEl instanceof HTMLElement) || !sectionKey || sectionEl.dataset.homeImpressionTracked === '1') {
    return;
  }
  if (sectionEl.dataset.homeImpressionObserverBound === '1') {
    return;
  }

  sectionEl.dataset.homeImpressionObserverBound = '1';
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || sectionEl.dataset.homeImpressionTracked === '1') {
        return;
      }

      sectionEl.dataset.homeImpressionTracked = '1';
      trackHomepageAnalyticsEvent('homepage_section_impression', {
        entityType: 'homepage_section',
        entityId: sectionKey,
        metadata: {
          section: sectionKey
        }
      }, {
        dedupeKey: `homepage_section_impression:${getHomepageRuntimeSite()}:${sectionKey}`,
        eventType: 'view'
      });

      if (extraEventName) {
        trackHomepageAnalyticsEvent(extraEventName, {
          entityType: 'homepage_section',
          entityId: sectionKey,
          metadata: {
            section: sectionKey
          }
        }, {
          dedupeKey: `${extraEventName}:${getHomepageRuntimeSite()}:${sectionKey}`,
          eventType: 'view'
        });
      }

      const sectionExperiments = window.getHomepageSectionActiveExperiments?.(sectionKey);
      if (Array.isArray(sectionExperiments) && sectionExperiments.length > 0) {
        sectionExperiments.forEach((experiment) => {
          trackHomepageAnalyticsEvent('homepage_experiment_impression', {
            entityType: 'homepage_experiment',
            entityId: experiment.id || null,
            metadata: {
              experiment_id: experiment.id || null,
              experiment_name: experiment.name || '',
              section: experiment.section || sectionKey,
              field: experiment.field || '',
              variant_key: experiment.variant_key || 'control'
            }
          }, {
            dedupeKey: `homepage_experiment_impression:${getHomepageRuntimeSite()}:${experiment.id || ''}:${experiment.variant_key || 'control'}`,
            eventType: 'view'
          });
        });
      }

      observer.disconnect();
    });
  }, {
    threshold: 0.35
  });

  observer.observe(sectionEl);
}

function createHomeSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function resetMobileSubmenus(mobileMenu) {
  if (!mobileMenu) return;

  mobileMenu.querySelectorAll('.mobile-submenu.active').forEach(submenu => {
    submenu.classList.remove('active');
  });
  mobileMenu.querySelectorAll('.mobile-menu-trigger.active').forEach(trigger => {
    trigger.classList.remove('active');
  });
}

function setMobileMenuState(hamburger, mobileMenu, isOpen) {
  if (!mobileMenu) return false;

  hamburger?.classList.toggle('active', isOpen);
  mobileMenu.classList.toggle('active', isOpen);
  document.documentElement.classList.toggle(MOBILE_MENU_LOCK_CLASS, isOpen);
  document.body.classList.toggle(MOBILE_MENU_LOCK_CLASS, isOpen);

  if (!isOpen) {
    resetMobileSubmenus(mobileMenu);
  }

  if (typeof window.toggleMobileThemeColor === 'function') {
    window.toggleMobileThemeColor(isOpen);
  }

  return isOpen;
}

function toggleMobileMenu(hamburger, mobileMenu) {
  return setMobileMenuState(
    hamburger,
    mobileMenu,
    !mobileMenu.classList.contains('active')
  );
}

function findMobileMenuScrollableParent(target, mobileMenu) {
  let node = target instanceof Element ? target : target?.parentElement || null;

  while (node && node !== mobileMenu) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;

    if ((overflowY === 'auto' || overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight + 1) {
      return node;
    }

    node = node.parentElement;
  }

  if (mobileMenu && mobileMenu.scrollHeight > mobileMenu.clientHeight + 1) {
    return mobileMenu;
  }

  return null;
}

function bindMobileMenuScrollGuard(mobileMenu) {
  if (!mobileMenu || mobileMenu._scrollGuardInitialized) return;

  let touchStartY = 0;

  mobileMenu.addEventListener('touchstart', (event) => {
    if (!mobileMenu.classList.contains('active') || event.touches.length === 0) return;
    touchStartY = event.touches[0].clientY;
  }, { passive: true });

  mobileMenu.addEventListener('touchmove', (event) => {
    if (!mobileMenu.classList.contains('active') || event.touches.length === 0) return;

    const scrollable = findMobileMenuScrollableParent(event.target, mobileMenu);
    if (!scrollable) {
      event.preventDefault();
      return;
    }

    const currentY = event.touches[0].clientY;
    const deltaY = touchStartY - currentY;
    const atTop = scrollable.scrollTop <= 0;
    const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;

    if ((atTop && deltaY < 0) || (atBottom && deltaY > 0)) {
      event.preventDefault();
    }
  }, { passive: false });

  mobileMenu._scrollGuardInitialized = true;
}

window.closeActiveMobileMenu = function () {
  return setMobileMenuState(
    document.querySelector('.nav-hamburger'),
    document.querySelector('.mobile-menu'),
    false
  );
};

function openHomepageGuestbookModal(trigger) {
  if (typeof window.openGuestbookModal !== 'function') {
    return false;
  }

  window.openGuestbookModal();

  if (trigger?.dataset?.closeMobileMenu === '1') {
    window.closeActiveMobileMenu?.();
  }

  return true;
}

function bindHomepageStaticDelegates() {
  if (document.documentElement.dataset.homepageStaticDelegatesBound === '1') {
    return;
  }

  document.documentElement.dataset.homepageStaticDelegatesBound = '1';

  document.addEventListener('click', (event) => {
    const eventTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!eventTarget) {
      return;
    }

    const guestbookTrigger = eventTarget.closest('[data-home-open-guestbook="1"]');
    if (guestbookTrigger) {
      if (openHomepageGuestbookModal(guestbookTrigger)) {
        event.preventDefault();
      }
      return;
    }

    const uploadTrigger = eventTarget.closest('[data-home-trigger-upload="1"]');
    if (uploadTrigger) {
      const imageUpload = document.getElementById('imageUpload');
      if (imageUpload) {
        event.preventDefault();
        imageUpload.click();
      }
    }
  });
}

function toHomeCssPropertyName(name) {
  if (typeof name !== 'string' || !name) return '';
  if (name.startsWith('--')) return name;
  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function setHomeRuntimeStyle(target, styles = {}, priority = '') {
  const style = target?.style;
  if (!style) return;

  const setProperty = style['setProperty'].bind(style);
  const removeProperty = style['removeProperty'].bind(style);

  Object.entries(styles).forEach(([name, value]) => {
    const cssName = toHomeCssPropertyName(name);
    if (!cssName) return;
    if (value === null || value === undefined || value === '') {
      removeProperty(cssName);
      return;
    }
    setProperty(cssName, String(value), priority);
  });
}

function getHomeViewportWidth() {
  return Math.max(
    window.innerWidth || 0,
    document.documentElement?.clientWidth || 0,
    document.body?.clientWidth || 0
  );
}

function getHomepageConfigLastUpdatedAt() {
  try {
    const raw = localStorage.getItem(getHomepageConfigLastUpdatedKey());
    const parsed = Number.parseInt(raw || '0', 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch (e) {
    return 0;
  }
}

function getHomeTrackGap(track) {
  if (!track) return 0;
  const computedStyle = window.getComputedStyle(track);
  return Number.parseFloat(computedStyle.columnGap || computedStyle.gap || '0') || 0;
}

function clampHomeSpeedValue(speedValue) {
  const normalized = Number.parseFloat(speedValue);
  if (!Number.isFinite(normalized)) return 30;
  return Math.min(100, Math.max(1, normalized));
}

function getHomeLoopPixelsPerSecond(speedValue) {
  const clampedSpeed = clampHomeSpeedValue(speedValue);
  const progress = Math.pow((clampedSpeed - 1) / 99, 1.35);
  return HOME_LOOP_MIN_PIXELS_PER_SECOND
    + ((HOME_LOOP_MAX_PIXELS_PER_SECOND - HOME_LOOP_MIN_PIXELS_PER_SECOND) * progress);
}

function getHomeLoopDurationSeconds(cycleWidth, speedValue) {
  const normalizedWidth = Math.max(1, Number.parseFloat(cycleWidth) || 0);
  const pixelsPerSecond = getHomeLoopPixelsPerSecond(speedValue);
  return Math.max(12, Math.round((normalizedWidth / pixelsPerSecond) * 10) / 10);
}

function buildHomeLoopGroupMarkup(items, renderItem, {
  repeatCount = 1,
  groupClassName = ''
} = {}) {
  const repeatedItems = Array.from({ length: Math.max(1, repeatCount) }, () => items).flat();
  const groupClassAttr = groupClassName ? ` class="${groupClassName}"` : '';
  const groupMarkup = repeatedItems.map(renderItem).join('');

  return `
    <div${groupClassAttr} data-home-loop-cycle="1">${groupMarkup}</div>
    <div${groupClassAttr} aria-hidden="true">${groupMarkup}</div>
  `;
}

function configureHomeMeasuredLoopTrack(track, items, renderItem, {
  groupClassName = '',
  cycleWidthVar = '--home-loop-cycle-width',
  minimumCycleWidth = 0,
  animationDuration = '',
  speedValue = null
} = {}) {
  if (!track) return;

  const normalizedItems = Array.isArray(items)
    ? items.filter((item) => String(item || '').trim())
    : [];

  if (normalizedItems.length === 0) {
    track.innerHTML = '';
  setHomeRuntimeStyle(track, {
    '--home-animation-duration': track.dataset.homeAnimationDuration || '',
    animationDuration: animationDuration || track.dataset.homeAnimationDuration || '',
    [cycleWidthVar]: ''
  });
  return;
  }

  const targetCycleWidth = Math.max(
    minimumCycleWidth,
    Math.ceil(track.parentElement?.getBoundingClientRect().width || 0),
    getHomeViewportWidth()
  );

  const renderLoop = (repeatCount) => {
    track.innerHTML = buildHomeLoopGroupMarkup(normalizedItems, renderItem, {
      repeatCount,
      groupClassName
    });
    return track.querySelector('[data-home-loop-cycle="1"]');
  };

  const trackGap = getHomeTrackGap(track);
  let primaryCycle = renderLoop(1);
  let cycleWidth = primaryCycle
    ? Math.ceil(primaryCycle.getBoundingClientRect().width + trackGap)
    : 0;

  if (cycleWidth > 0 && cycleWidth < targetCycleWidth) {
    const repeatCount = Math.max(1, Math.ceil(targetCycleWidth / cycleWidth));
    primaryCycle = renderLoop(repeatCount);
    cycleWidth = primaryCycle
      ? Math.ceil(primaryCycle.getBoundingClientRect().width + trackGap)
      : cycleWidth;
  }

  const resolvedAnimationDuration = cycleWidth > 0 && speedValue !== null && speedValue !== undefined
    ? `${getHomeLoopDurationSeconds(cycleWidth, speedValue)}s`
    : (animationDuration || track.dataset.homeAnimationDuration || '');

  setHomeRuntimeStyle(track, {
    '--home-animation-duration': resolvedAnimationDuration,
    animationDuration: resolvedAnimationDuration,
    [cycleWidthVar]: cycleWidth ? `${cycleWidth}px` : ''
  });
}

function setHomeSectionVisibility(section, visible) {
  if (!section) return;
  section.hidden = !visible;
}

function bindHoverLiftTargets(root) {
  root?.querySelectorAll('[data-home-hover-lift="1"]').forEach((element) => {
    if (element.dataset.homeHoverLiftBound === '1') {
      return;
    }

    element.dataset.homeHoverLiftBound = '1';

    const applyHoverState = (isHovered) => {
      element.classList.toggle('home-hover-lift-active', isHovered);
    };

    element.addEventListener('mouseenter', () => applyHoverState(true));
    element.addEventListener('mouseleave', () => applyHoverState(false));
  });
}

function bindImageFallbacks(root, selector, onError) {
  root?.querySelectorAll(selector).forEach((image) => {
    if (image.dataset.homeFallbackBound === '1') {
      return;
    }

    image.dataset.homeFallbackBound = '1';
    image.addEventListener('error', () => onError(image), { once: true });
  });
}

const FramerHome = {
  // Cached data
  cachedData: null,
  config: null,
  guestbookRuntime: null,
  sectionExperimentAssignments: {},
  activeExperiments: [],

  resetActiveExperiments() {
    this.sectionExperimentAssignments = {};
    this.activeExperiments = [];
    window.getHomepageActiveExperiments = () => [];
    window.getHomepageSectionActiveExperiments = () => [];
  },

  resolveSectionExperiments(sectionKey, config = {}) {
    const active = (Array.isArray(config?.experiments) ? config.experiments : [])
      .map((experiment) => {
        if (!experiment?.id || experiment?.status === 'paused') {
          return null;
        }

        const isListField = experiment.field === 'featured_items' || experiment.field === 'custom_items';
        if (!isListField && !isHomepagePrimaryLanguageActive()) {
          return null;
        }

        const variantKey = resolveHomepageExperimentVariantKey(experiment);
        const selectedValue = cloneHomeExperimentValue(
          variantKey === 'variant' ? experiment.variant_value : experiment.control_value
        );

        return {
          id: String(experiment.id || '').trim(),
          name: String(experiment.name || '').trim(),
          section: sectionKey,
          field: String(experiment.field || '').trim(),
          variant_key: variantKey,
          traffic_percent: Number(experiment.traffic_percent || 50) || 50,
          selected_value: selectedValue
        };
      })
      .filter(Boolean);

    this.sectionExperimentAssignments[sectionKey] = active;
    this.activeExperiments = Object.values(this.sectionExperimentAssignments).flat().map((experiment) => ({
      id: experiment.id,
      name: experiment.name,
      section: experiment.section,
      field: experiment.field,
      variant_key: experiment.variant_key
    }));

    window.getHomepageActiveExperiments = () => this.activeExperiments;
    window.getHomepageSectionActiveExperiments = (section) => this.sectionExperimentAssignments?.[section] || [];

    return active;
  },

  getSectionExperimentValue(sectionKey, config = {}, field = '', fallbackValue = null) {
    const experiments = this.resolveSectionExperiments(sectionKey, config);
    const matched = experiments.find((experiment) => experiment.field === field);
    if (!matched) {
      return fallbackValue;
    }

    return cloneHomeExperimentValue(matched.selected_value);
  },

  /**
   * Initialize the homepage
   */
  async init() {
    console.log('🚀 Initializing Framer Home...');

    // Scroll to top on page load
    window.scrollTo(0, 0);
    // Check performance and apply degradation if needed
    this.checkPerformance();

    // First paint Hero immediately to avoid blank first screen on slow networks
    this.renderHeroFirstPaint();

    // Wait for i18n to be ready before loading data
    if (window.i18n?.ready) {
      await window.i18n.ready();
    }

    // Load configuration and data (uses sessionStorage prefetch if available)
    await this.loadAll();

    // Render all sections (single render, no double-paint)
    this.renderAll();

    bindHomepageStaticDelegates();

    // Initialize navigation dropdowns
    this.initNavDropdowns();

    // Initialize interactions
    this.initInteractions();

    // Initialize scroll animations
    this.initScrollAnimations();

    // Listen for language changes and re-render all content
    window.addEventListener('languageChanged', async (e) => {
      console.log(`🌐 Homepage language changed to: ${e.detail.lang}, re-rendering...`);

      // Re-build all data with new language
      this.resetActiveExperiments();
      this.cachedData.hero = this.buildHeroData(this.config.hero || {});
      this.resolveSectionExperiments('prompts', this.config.prompts || {});
      this.resolveSectionExperiments('shop', this.config.shop || {});
      this.cachedData.verify = this.buildVerifyData(this.config.verify || {});
      this.resolveSectionExperiments('guestbook', this.config.guestbook || {});

      // CRITICAL: Rebuild ticker data with new language-specific tags
      this.cachedData.ticker = await this.buildTickerData(this.config.ticker);

      // Update Prompts dropdown with new language tags
      const promptsDropdown = document.getElementById('dropdown-prompts');
      if (promptsDropdown) {
        // Extract top tags for current language
        const currentLang = e.detail.lang;
        const tagCounts = {};

        (this.cachedData.prompts || []).forEach(p => {
          if (p.aiTags && typeof p.aiTags === 'object') {
            ['styles', 'objects', 'scenes', 'mood'].forEach(cat => {
              const tags = p.aiTags[cat]?.[currentLang] || p.aiTags[cat]?.zh || [];
              tags.forEach(tag => tagCounts[tag] = (tagCounts[tag] || 0) + 1);
            });
          }
        });

        let topTags = Object.entries(tagCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([tag]) => tag);

        const fallbackTags = currentLang === 'en'
          ? ['Cartoon', '3D Art', 'Rendering', 'Cute', 'Digital Art', 'Miniature']
          : ['卡通风格', '3D艺术', '渲染', '可爱', '数字艺术', '微缩'];

        topTags = topTags.length > 0 ? topTags : fallbackTags;

        promptsDropdown.innerHTML = topTags.map(tag =>
          `<a href="/prompts.html?tag=${encodeURIComponent(tag)}">${tag}</a>`
        ).join('');
        console.log(`✅ Prompts dropdown updated with ${currentLang} tags:`, topTags);
      }

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

  readHeroTextCache() {
    try {
      const raw = sessionStorage.getItem('homepage_hero_text');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.title) return null;
      const age = Date.now() - (parsed.timestamp || 0);
      if (age > 7 * 24 * 60 * 60 * 1000) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  },

  writeHeroTextCache(hero) {
    if (!hero?.title) return;
    try {
      sessionStorage.setItem('homepage_hero_text', JSON.stringify({
        title: hero.title,
        subtitle: hero.subtitle || '',
        timestamp: Date.now()
      }));
    } catch (e) {
      // ignore storage failures
    }
  },

  /**
   * Render Hero immediately from prefetched/session/fallback data.
   * [DISABLED] - To prevent raw i18n keys from flashing on first load.
   */
  renderHeroFirstPaint() {
    // Disabled. Wait for full data & i18n load in init() instead.
    return;
    try {
      const section = document.getElementById('hero-section');
      if (!section) return;

      const sv = window.SectionVisibility;
      if (sv && !sv.isVisible('hero')) return;

      let heroData = null;
      try {
        const prefetch = readHomepagePrefetchCache();
        if (prefetch) {
          const age = Date.now() - prefetch.timestamp;
          if (age < 300000 && prefetch.cacheKind === 'complete') {
            heroData = prefetch.cachedData?.hero || this.buildHeroData(prefetch.config?.hero || {});
          }
        }
      } catch (e) {
        // Ignore parse errors and fallback below
      }

      if (!heroData) {
        const heroTextCache = this.readHeroTextCache();
        if (heroTextCache) {
          heroData = this.buildHeroData({});
          heroData.title = heroTextCache.title;
          heroData.subtitle = heroTextCache.subtitle || heroData.subtitle;
        }
      }

      if (!heroData) {
        heroData = this.buildHeroData({});
      }

      this.cachedData = this.cachedData || {};
      this.cachedData.hero = heroData;
      this.renderHero();
    } catch (error) {
      console.warn('Hero first paint skipped:', error.message);
    }
  },

  /**
   * Load all configuration and aggregate data
   */
  async loadAll() {
    // === Check sessionStorage for prefetched data ===
    try {
        const prefetch = readHomepagePrefetchCache();
        if (prefetch) {
          const age = Date.now() - prefetch.timestamp;
          const configUpdatedAt = getHomepageConfigLastUpdatedAt();

          // ONLY use cache if it was saved AFTER i18n was ready (a rudimentary check: title shouldn't equal its own key)
          const isTranslated = prefetch.cachedData?.hero?.title && !prefetch.cachedData.hero.title.includes('home.hero');
          const isFreshConfig = !configUpdatedAt || (prefetch.timestamp || 0) >= configUpdatedAt;
          const isCompletePrefetch = prefetch.cacheKind === 'complete';

          // Use if < 5 minutes old and contains actual translated text
          if (age < 300000 && prefetch.cachedData && prefetch.config && isTranslated && isFreshConfig && isCompletePrefetch) {
            this.cachedData = prefetch.cachedData;
            this.config = prefetch.config;
            this.sectionRows = prefetch.sectionRows || {};
            this.sectionOrder = Array.isArray(prefetch.sectionOrder) && prefetch.sectionOrder.length
              ? prefetch.sectionOrder
              : [...HOME_DEFAULT_SECTION_ORDER];
            this.resetActiveExperiments();
            this.resolveSectionExperiments('hero', this.config.hero || {});
            this.resolveSectionExperiments('prompts', this.config.prompts || {});
            this.resolveSectionExperiments('shop', this.config.shop || {});
            this.resolveSectionExperiments('verify', this.config.verify || {});
            this.resolveSectionExperiments('guestbook', this.config.guestbook || {});
            this.cachedData.ticker = await this.buildTickerData(this.config.ticker || {});
            this.writeHeroTextCache(this.cachedData.hero);
            console.log(`⚡ Using prefetched homepage data (${Math.round(age / 1000)}s old)`);
            return;
          } else {
            // Clear poisoned cache containing raw translation keys
            clearHomepagePrefetchCache();
          }
        }
      } catch (e) {
        // Ignore parse errors
        clearHomepagePrefetchCache();
      }

    try {
      // Fetch homepage config from Supabase
      this.config = await this.fetchHomepageConfig();
      this.resetActiveExperiments();

      // Aggregate section data in parallel to reduce initial waiting time
      const [prompts, shop, guestbook, shopCategories] = await Promise.all([
        this.aggregatePrompts(this.config.prompts || {}),
        this.aggregateShop(this.config.shop || {}),
        this.aggregateGuestbook(this.config.guestbook || {}),
        this.fetchShopCategories()
      ]);

      this.cachedData = {
        hero: this.buildHeroData(this.config.hero || {}),
        prompts,
        shop,
        verify: this.buildVerifyData(this.config.verify || {}),
        guestbook,
        shopCategories
      };

      // Build ticker data AFTER cachedData is assigned so it can access shop data
      this.cachedData.ticker = await this.buildTickerData(this.config.ticker || {});
      this.writeHeroTextCache(this.cachedData.hero);

      console.log('📦 Data aggregated:', this.cachedData);

      // Save to sessionStorage so sub-page prefetch can serve it on next visit
      try {
        writeHomepagePrefetchCache({
          cachedData: this.cachedData,
          config: this.config,
          sectionRows: this.sectionRows,
          sectionOrder: this.sectionOrder,
          cacheKind: 'complete',
          timestamp: Date.now()
        });
      } catch (e) {
        // sessionStorage might be full, ignore
      }
    } catch (error) {
      console.error('❌ Failed to load data:', error);
      // Use fallback default data
      this.useFallbackData();
    }
  },

  /**
   * Fetch shop categories for nav dropdown (safe fallback)
   */
  async fetchShopCategories() {
    try {
      const { data } = await window.supabaseClient
        .from('shop_categories')
        .select('name')
        .order('sort_order');
      return (data || []).map(c => c.name);
    } catch (e) {
      return [];
    }
  },

  /**
   * Fetch homepage configuration from Supabase (with cache)
   */
  async fetchHomepageConfig() {
    // Use cache with 30 minute TTL
    return await Cache.loadWithCache('homepage_config', async () => {
      const data = await loadHomepageConfigRows(getHomepageRuntimeSite());
      this.sectionRows = HomepageContract?.mapRowsBySection?.(data) || {};
      this.sectionOrder = HomepageContract?.sortSectionsByDisplayOrder?.(data) || [...HOME_DEFAULT_SECTION_ORDER];

      // Convert array to object keyed by section
      const config = HomepageContract?.buildConfigMap?.(data) || {};

      return config;
    }, 30);
  },

  /**
   * Build hero section data
   */
  buildDefaultHeroEntries() {
    return [
      { id: 'prompts', icon: 'fa-wand-magic-sparkles', text: window.i18n?.t('home.entries.prompts') || '提示词', link: '/prompts.html', color: '#f472b6', section: 'prompts' },
      { id: 'gongyi', icon: 'home-entry-card-icon--gongyi', text: window.i18n?.t('home.entries.gongyi') || '公益站', link: 'https://gongyi.zaoyoe.com', color: '#5ed8f8', section: 'gongyi' },
      { id: 'shop', icon: 'fa-store', text: window.i18n?.t('home.entries.shop') || '商城', link: '/shop.html', color: '#4ade80', section: 'shop' },
      { id: 'verify', icon: 'fa-robot', text: window.i18n?.t('home.entries.verify') || '验证', link: '/verify.html', color: '#667eea', section: 'verify' },
      { id: 'guestbook', icon: 'fa-comment-dots', text: window.i18n?.t('home.entries.guestbook') || '留言板', link: '#', color: '#f59e0b', action: 'openGuestbookModal', section: 'guestbook' }
    ];
  },

  isGongyiHeroEntry(item) {
    const normalizedId = String(item?.id || '').trim().toLowerCase();
    const normalizedSection = String(item?.section || '').trim().toLowerCase();
    const normalizedLink = String(item?.link || '').trim().toLowerCase();
    return normalizedId === 'gongyi' || normalizedSection === 'gongyi' || normalizedLink.includes('gongyi.zaoyoe.com');
  },

  ensureGongyiHeroEntry(entries = []) {
    const sourceEntries = Array.isArray(entries) ? entries.map((item) => ({ ...item })) : [];
    const defaultEntry = this.buildDefaultHeroEntries().find((item) => item.id === 'gongyi');
    const existingGongyi = sourceEntries.find((item) => this.isGongyiHeroEntry(item));
    const nextEntries = sourceEntries.filter((item) => !this.isGongyiHeroEntry(item));
    const normalizedGongyi = {
      ...defaultEntry,
      ...(existingGongyi || {}),
      id: 'gongyi',
      text: String(existingGongyi?.text || defaultEntry?.text || '').trim() || defaultEntry.text,
      link: String(existingGongyi?.link || defaultEntry?.link || '').trim() || defaultEntry.link,
      icon: String(existingGongyi?.icon || defaultEntry?.icon || '').trim() || defaultEntry.icon,
      color: String(existingGongyi?.color || defaultEntry?.color || '').trim() || defaultEntry.color,
      section: String(existingGongyi?.section || defaultEntry?.section || '').trim() || defaultEntry.section
    };

    delete normalizedGongyi.enabled;

    const shopIndex = nextEntries.findIndex((item) => {
      const normalizedId = String(item?.id || '').trim().toLowerCase();
      const normalizedSection = String(item?.section || '').trim().toLowerCase();
      const normalizedLink = String(item?.link || '').trim().toLowerCase();
      return normalizedId === 'shop' || normalizedSection === 'shop' || normalizedLink.includes('/shop.html');
    });
    const insertionIndex = shopIndex >= 0 ? shopIndex : Math.min(1, nextEntries.length);
    nextEntries.splice(insertionIndex, 0, normalizedGongyi);

    return nextEntries.slice(0, 8);
  },

  buildHeroData(config) {
    const configuredEntries = Array.isArray(config?.entries) && config.entries.length > 0
      ? config.entries
      : this.buildDefaultHeroEntries();
    const normalizedEntries = this.ensureGongyiHeroEntry(configuredEntries);
    const experimentTitle = this.getSectionExperimentValue('hero', config, 'title', '');
    const experimentSubtitle = this.getSectionExperimentValue('hero', config, 'subtitle', '');

    return {
      // Prioritize i18n translations for multilingual support
      title: experimentTitle || this.getLocalizedField(config, 'title') || window.i18n?.t('home.hero.title') || '早鸟',
      subtitle: experimentSubtitle || this.getLocalizedField(config, 'subtitle') || window.i18n?.t('home.hero.subtitle') || '创意 · 效率 · 无限可能',
      customImage: config.custom_image || null,
      entries: normalizedEntries
        .filter((item) => item?.enabled !== false)
        .map((item, index) => ({
          id: String(item?.id || item?.section || item?.action || item?.link || `hero_entry_${index + 1}`).trim(),
          icon: String(item?.icon || 'fa-star').trim(),
          text: this.getLocalizedField(item, 'text') || item?.text || `入口 ${index + 1}`,
          link: String(item?.link || (item?.section ? `#${item.section}` : '#')).trim() || '#',
          color: String(item?.color || '#ffffff').trim() || '#ffffff',
          action: String(item?.action || '').trim(),
          section: String(item?.section || '').trim()
        }))
        .slice(0, 8)
    };
  },

  normalizeFeaturedPromptLookupId(value) {
    return String(value ?? '').trim();
  },

  findFeaturedPromptRecord(promptPool = [], item = {}) {
    const normalizedId = this.normalizeFeaturedPromptLookupId(item?.id);
    if (!normalizedId || !Array.isArray(promptPool) || promptPool.length === 0) {
      return null;
    }

    let matchedPrompt = promptPool.find((prompt) => {
      const promptId = this.normalizeFeaturedPromptLookupId(prompt?.supabaseId ?? prompt?.id);
      return Boolean(promptId) && promptId === normalizedId;
    });

    if (matchedPrompt) {
      return matchedPrompt;
    }

    const numericId = Number.parseInt(normalizedId, 10);
    if (Number.isNaN(numericId)) {
      return null;
    }

    matchedPrompt = promptPool.find((prompt) => {
      const supabaseId = Number.parseInt(prompt?.supabaseId, 10);
      const promptId = Number.parseInt(prompt?.id, 10);
      return (!Number.isNaN(supabaseId) && supabaseId === numericId)
        || (!Number.isNaN(promptId) && promptId === numericId);
    });

    return matchedPrompt || null;
  },

  buildFeaturedPromptFallback(item = {}) {
    const normalizedId = this.normalizeFeaturedPromptLookupId(item?.id);
    if (!normalizedId) {
      return null;
    }

    const image = String(item?.image || item?.image_url || '').trim();
    const tags = Array.isArray(item?.tags)
      ? item.tags.map(tag => String(tag || '').trim()).filter(Boolean).slice(0, 8)
      : [];
    const title = String(item?.title || item?.title_zh || item?.title_en || normalizedId).trim() || normalizedId;
    const titleZh = String(item?.title_zh || item?.title || '').trim();
    const titleEn = String(item?.title_en || item?.title || '').trim();

    return {
      id: normalizedId,
      title,
      title_zh: titleZh,
      title_en: titleEn,
      images: image ? [image] : [],
      tags,
      ai_tags: [...tags],
      aiTags: tags.length > 0 ? { styles: { zh: [...tags], en: [...tags] } } : undefined,
      homepage_featured_fallback: true
    };
  },

  /**
   * Aggregate prompts data (auto or manual)
   */
  async aggregatePrompts(config) {
    const promptPool = Array.isArray(window.PROMPTS) ? window.PROMPTS : [];
    const experimentFeaturedItems = this.getSectionExperimentValue('prompts', config, 'featured_items', null);
    const featuredItems = Array.isArray(experimentFeaturedItems) && experimentFeaturedItems.length > 0
      ? experimentFeaturedItems
      : config.featured_items;

    // Manual mode - use custom selected items
    if ((Array.isArray(experimentFeaturedItems) && experimentFeaturedItems.length > 0) || (!config.enable_auto && featuredItems?.length > 0)) {
      return (featuredItems || [])
        .map(item => this.findFeaturedPromptRecord(promptPool, item) || this.buildFeaturedPromptFallback(item))
        .filter(Boolean);
    }

    // Auto mode - sort by strategy
    const maxItems = config.max_items || 24;
    const sortStrategy = config.sort || 'popular';

    let sorted = [...promptPool];

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
   * Aggregate shop products from Supabase (with cache)
   */
  async fetchShopProductCatalog() {
    try {
      return await Cache.loadWithCache('shop_products', async () => {
        const { data, error } = await window.supabaseClient
          .from('shop_products')
          .select('id, name, name_en, description, description_en, icon_url, price_points, price_points_intl, stock_count, category, is_active, display_order')
          .order('display_order', { ascending: false })
          .limit(120);

        if (error) throw error;
        return data || [];
      }, 15);
    } catch (error) {
      console.error('Failed to fetch shop catalog:', error);
      return [];
    }
  },

  resolveShopCuratedItem(productCatalog = [], item = {}) {
    const normalizedId = String(item?.id || '').trim();
    if (!normalizedId) {
      return null;
    }

    const liveProduct = (Array.isArray(productCatalog) ? productCatalog : []).find((product) => String(product?.id || '').trim() === normalizedId);
    const snapshot = liveProduct || item;
    return {
      ...(snapshot || {}),
      id: normalizedId,
      homepage_badge: String(item?.badge || '').trim(),
      homepage_curated: true,
      homepage_missing: !liveProduct
    };
  },

  async aggregateShop(config) {
    try {
      const allProducts = await this.fetchShopProductCatalog();
      const liveActiveProducts = (Array.isArray(allProducts) ? allProducts : []).filter((product) => product?.is_active !== false);
      const experimentCustomItems = this.getSectionExperimentValue('shop', config, 'custom_items', null);
      const sourceCustomItems = Array.isArray(experimentCustomItems) && experimentCustomItems.length > 0
        ? experimentCustomItems
        : config.custom_items;
      const curatedItems = Array.isArray(sourceCustomItems)
        ? sourceCustomItems
          .map((item) => this.resolveShopCuratedItem(allProducts, item))
          .filter(Boolean)
        : [];
      const curatedIds = new Set(curatedItems.map((item) => String(item?.id || '').trim()).filter(Boolean));

      // Filter by category if needed
      let filtered = window.SiteConfig?.filterProductsForCurrentSite
        ? window.SiteConfig.filterProductsForCurrentSite(liveActiveProducts)
        : liveActiveProducts;
      if (config.category && config.category !== 'all') {
        filtered = filtered.filter(p => p.category === config.category);
      }

      const maxItems = Number(config.max_items) || 6;
      const sortStrategy = String(config.sort || 'popular').trim();

      if (sortStrategy === 'latest') {
        filtered = [...filtered].reverse();
      } else if (sortStrategy === 'random') {
        filtered = [...filtered].sort(() => Math.random() - 0.5);
      }

      const autoItems = filtered.filter((item) => !curatedIds.has(String(item?.id || '').trim()));

      if (config.enable_auto === false) {
        return curatedItems.slice(0, maxItems);
      }

      return [...curatedItems, ...autoItems].slice(0, maxItems);
    } catch (error) {
      console.error('Failed to fetch shop products:', error);
      return Array.isArray(config.custom_items)
        ? config.custom_items.slice(0, Number(config.max_items) || 6)
        : [];
    }
  },

  /**
   * Get optimized image URL by using pre-generated thumbnails
   * Thumbnails are stored at: /prompts/thumb/xxx.webp
   * Original images are at:   /prompts/xxx.webp
   * 
   * @param {string} url - Original image URL
   * @returns {string} Thumbnail URL for R2 CDN images, original for others
   */
  getOptimizedImageUrl(url) {
    if (!url) return '';

    // R2 CDN images - use pre-generated thumbnails
    if (url.includes('cdn.zaoyoe.com/prompts/') && !url.includes('/thumb/')) {
      return url.replace('/prompts/', '/prompts/thumb/');
    }

    // Supabase Storage images - use Supabase Transform API
    if (url.includes('supabase.co/storage')) {
      const transformUrl = url.replace(
        '/storage/v1/object/public/',
        '/storage/v1/render/image/public/'
      );
      return `${transformUrl}?width=600&quality=85&format=webp`;
    }

    // Return original URL for other images
    return url;
  },

  /**
   * Build Gemini verify section data
   */
  buildVerifyData(config) {
    const defaultFeatures = [
      window.i18n?.t('home.verify.features.free') || '免费',
      window.i18n?.t('home.verify.features.realtime') || '实时',
      window.i18n?.t('home.verify.features.secure') || '安全'
    ];
    const defaultValueProps = [
      window.i18n?.t('home.verify.valueProps.fast') || '秒级校验',
      window.i18n?.t('home.verify.valueProps.visible') || '过程可见',
      window.i18n?.t('home.verify.valueProps.safe') || '结果可追踪'
    ];
    const defaultModels = [
      'Gemini',
      'Claude',
      'OpenAI'
    ];

    const experimentCtaText = this.getSectionExperimentValue('verify', config, 'cta_text', '');
    return {
      title: this.getLocalizedField(config, 'section_title') || window.i18n?.t('home.verify.title') || 'Gemini 验证',
      subtitle: this.getLocalizedField(config, 'section_subtitle') || window.i18n?.t('home.verify.subtitle') || '快速验证您的 API 密钥，实时返回结果',
      screenshot: config.screenshot_path || '/assets/verify-preview.png',
      features: (config.features && config.features.length > 0) ? config.features : defaultFeatures,
      valueProps: (config.value_props && config.value_props.length > 0) ? config.value_props : defaultValueProps,
      supportedModels: (config.supported_models && config.supported_models.length > 0) ? config.supported_models : defaultModels,
      ctaText: String(experimentCtaText || config.cta_text || '').trim() || (window.i18n?.t('home.verify.cta') || '立即验证'),
      riskNotice: String(config.risk_notice || '').trim() || (window.i18n?.t('home.verify.riskNotice') || '建议先使用测试账号完成校验，再切换正式账号。'),
      link: String(config.cta_link || '').trim() || '/verify.html?source=homepage_verify'
    };
  },

  /**
   * Aggregate guestbook messages (with cache)
   */
  async fetchGuestbookMessages() {
    try {
      return await Cache.loadWithCache('guestbook_messages', async () => {
        const currentSite = window.SiteConfig?.site || 'cn';
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
          .eq('site', currentSite)
          .order('created_at', { ascending: false })
          .limit(24);

        if (error) throw error;
        return data || [];
      }, 10);
    } catch (error) {
      console.error('Failed to fetch guestbook:', error);
      return [];
    }
  },

  resolveGuestbookFeaturedItem(messages = [], item = {}) {
    const normalizedId = String(item?.id || '').trim();
    if (!normalizedId) {
      return null;
    }

    const liveMessage = (Array.isArray(messages) ? messages : []).find((message) => String(message?.id || '').trim() === normalizedId);
    if (liveMessage) {
      return {
        ...liveMessage,
        homepage_curated: true,
        homepage_reason: String(item?.reason || '').trim()
      };
    }

    if (!item?.content) {
      return null;
    }

    return {
      id: normalizedId,
      content: String(item.content || '').trim(),
      image_url: String(item.image_url || '').trim(),
      like_count: Number(item.like_count || 0) || 0,
      created_at: item.created_at || null,
      user_id: item.user_id || null,
      username: item.username || item?.profiles?.username || '',
      avatar_url: item.avatar_url || item?.profiles?.avatar_url || '',
      homepage_curated: true,
      homepage_missing: true,
      homepage_reason: String(item?.reason || '').trim()
    };
  },

  buildGuestbookFallbackCard(item = {}, index = 0) {
    const content = String(item?.content || item?.text || '').trim();
    if (!content) {
      return null;
    }

    return {
      id: String(item?.id || `guestbook_fallback_${index + 1}`).trim(),
      content,
      author: String(item?.author || '').trim(),
      avatar_url: String(item?.avatar_url || '').trim(),
      homepage_fallback: true
    };
  },

  async aggregateGuestbook(config) {
    try {
      const messages = await this.fetchGuestbookMessages();
      const maxItems = Math.max(1, Number(config.max_items) || HOME_GUESTBOOK_CARD_SLOTS.length);
      const experimentFeaturedItems = this.getSectionExperimentValue('guestbook', config, 'featured_items', null);
      const sourceFeaturedItems = Array.isArray(experimentFeaturedItems) && experimentFeaturedItems.length > 0
        ? experimentFeaturedItems
        : config.featured_items;
      const featuredItems = Array.isArray(sourceFeaturedItems)
        ? sourceFeaturedItems
          .map((item) => this.resolveGuestbookFeaturedItem(messages, item))
          .filter(Boolean)
        : [];
      const fallbackItems = Array.isArray(config.fallback_items)
        ? config.fallback_items
          .map((item, index) => this.buildGuestbookFallbackCard(item, index))
          .filter(Boolean)
        : [];
      const featuredIds = new Set(featuredItems.map((item) => String(item?.id || '').trim()).filter(Boolean));
      const autoItems = (Array.isArray(messages) ? messages : []).filter((item) => !featuredIds.has(String(item?.id || '').trim()));

      if (config.enable_auto === false) {
        return [...featuredItems, ...fallbackItems].slice(0, Math.min(maxItems, HOME_GUESTBOOK_CARD_SLOTS.length));
      }

      return [...featuredItems, ...autoItems, ...fallbackItems].slice(0, Math.min(maxItems, HOME_GUESTBOOK_CARD_SLOTS.length));
    } catch (error) {
      console.error('Failed to fetch guestbook:', error);
      const fallbackItems = Array.isArray(config.fallback_items)
        ? config.fallback_items
          .map((item, index) => this.buildGuestbookFallbackCard(item, index))
          .filter(Boolean)
        : [];
      return fallbackItems.slice(0, Math.min(Number(config.max_items) || HOME_GUESTBOOK_CARD_SLOTS.length, HOME_GUESTBOOK_CARD_SLOTS.length));
    }
  },

  /**
   * Build ticker data (tags + products)
   */
  async buildTickerData(config = {}) {
    const lang = window.i18n?.getCurrentLanguage() || 'zh';
    const promptPool = Array.isArray(window.PROMPTS) ? window.PROMPTS : [];
    const promptTagSeed = [
      ...sanitizeTickerItems(config.prompt_tags),
      ...sanitizeTickerItems(config.activity_keywords),
      ...sanitizeTickerItems(config.custom_items_top)
    ];
    const productCategorySeed = [
      ...sanitizeTickerItems(config.product_categories),
      ...sanitizeTickerItems(config.custom_items_bottom)
    ];
    let tags = [...new Set(promptTagSeed)];
    const productCategories = Array.from(new Set(productCategorySeed));

    if ((config.enable_auto !== false || tags.length === 0) && config.enable_prompts !== false) {
      const tagSet = new Set(tags);
      promptPool.forEach(p => {
        if (p.aiTags && typeof p.aiTags === 'object') {
          ['styles', 'objects', 'scenes', 'mood'].forEach(cat => {
            const promptTags = p.aiTags[cat]?.[lang] || p.aiTags[cat]?.zh || [];
            promptTags.forEach(tag => tagSet.add(tag));
          });
        }
      });
      tags = Array.from(tagSet).slice(0, 20);
    }

    if ((config.enable_auto !== false || productCategories.length === 0) && config.enable_products !== false) {
      const categorySet = new Set(productCategories);
      (this.cachedData?.shop || []).forEach((product) => {
        const category = String(product?.category || '').trim();
        if (category) {
          categorySet.add(category);
        }
      });
      productCategories.splice(0, productCategories.length, ...Array.from(categorySet).slice(0, 20));
    }

    return {
      top: tags,
      bottom: productCategories,
      speed: config.speed || 30,
      shopScrollSpeed: config.shop_scroll_speed || config.speed || 30,
      enable_prompts: config.enable_prompts !== false,
      enable_products: config.enable_products !== false
    };
  },

  /**
  * Fallback data when config fails to load
  */
  useFallbackData() {
    console.warn('⚠️ Using fallback data');
    this.resetActiveExperiments();
    const promptPool = Array.isArray(window.PROMPTS) ? window.PROMPTS : [];
    this.config = {
      hero: { enable_auto: true },
      prompts: { enable_auto: true, max_items: 24, sort: 'popular', section_title: 'AI 提示词工作室', section_subtitle: '让创作更高效，让灵感更自由' },
      shop: { enable_auto: true, max_items: 8, section_title: '精选资源商城', section_subtitle: '优质资源，助力成长' },
      verify: { enable_auto: true, section_title: 'Gemini 验证', section_subtitle: '快速验证您的 API 密钥' },
      guestbook: { enable_auto: true, max_items: 6, section_title: '留言板', section_subtitle: '用户的声音' },
      ticker: { enable_auto: true, speed: 30 }
    };
    this.sectionRows = {};
    this.sectionOrder = [...HOME_DEFAULT_SECTION_ORDER];

    // Rebuild cachedData with fallback config
    this.cachedData = {
      hero: this.buildHeroData(this.config.hero),
      prompts: promptPool.slice(0, 6),
      shop: [],
      verify: this.buildVerifyData(this.config.verify),
      guestbook: [],
      ticker: {
        top: [...new Set(promptPool.flatMap(p => p.tags || []))].slice(0, 20),
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
    if (HomepageContract?.getLocalizedField) {
      return HomepageContract.getLocalizedField(obj, fieldBase, window.i18n?.getCurrentLanguage?.() || 'zh') || '';
    }

    if (!obj) return '';
    const lang = window.i18n?.getCurrentLanguage() || 'zh';
    const langField = `${fieldBase}_${lang}`;
    if (obj[langField]) return obj[langField];
    if (obj[fieldBase]) return obj[fieldBase];
    const otherField = `${fieldBase}_${lang === 'en' ? 'zh' : 'en'}`;
    return obj[otherField] || '';
  },

  applyHomepageSectionOrder() {
    const main = document.getElementById('main-content');
    if (!main) {
      return;
    }

    const sectionMap = {
      hero: document.getElementById('hero-section'),
      prompts: document.getElementById('prompts-section'),
      shop: document.getElementById('shop-section'),
      verify: document.getElementById('verify-section'),
      guestbook: document.getElementById('guestbook-section'),
      ticker: document.getElementById('ticker-section')
    };

    const fragment = document.createDocumentFragment();
    (Array.isArray(this.sectionOrder) && this.sectionOrder.length ? this.sectionOrder : HOME_DEFAULT_SECTION_ORDER).forEach((sectionKey) => {
      const section = sectionMap[sectionKey];
      if (section) {
        fragment.appendChild(section);
      }
    });

    const footer = main.querySelector('footer.framer-footer');
    main.insertBefore(fragment, footer || null);
  },

  /**
   * Render all sections
   */
  renderAll() {
    const sv = window.SectionVisibility;
    this.applyHomepageSectionOrder();

    const renderers = {
      hero: () => this.renderHero(),
      prompts: () => this.renderPrompts(),
      shop: () => this.renderShop(),
      verify: () => this.renderVerify(),
      guestbook: () => this.renderGuestbook(),
      ticker: () => this.renderTicker()
    };
    const sectionIds = {
      hero: 'hero-section',
      prompts: 'prompts-section',
      shop: 'shop-section',
      verify: 'verify-section',
      guestbook: 'guestbook-section',
      ticker: 'ticker-section'
    };

    (Array.isArray(this.sectionOrder) && this.sectionOrder.length ? this.sectionOrder : HOME_DEFAULT_SECTION_ORDER).forEach((sectionKey) => {
      const sectionEl = document.getElementById(sectionIds[sectionKey]);
      const isVisible = !sv || sv.isVisible(sectionKey);

      if (sectionKey === 'guestbook' && !isVisible) {
        this.destroyGuestbookExperience();
      }

      if (!sectionEl || typeof renderers[sectionKey] !== 'function') {
        return;
      }

      if (isVisible) {
        setHomeSectionVisibility(sectionEl, true);
        renderers[sectionKey]();
      } else {
        setHomeSectionVisibility(sectionEl, false);
      }
    });

    // Apply nav/footer visibility rules
    if (sv) sv.applySectionVisibility();

    // Don't re-initialize dropdowns - they are already initialized once on page load
    // Re-initializing causes duplicate event listeners and breaks language toggle
  },

  /**
   * Load minimal data needed for navigation dropdowns (for subpages)
   * This is a lightweight alternative to loadAll() that only fetches
   * data needed for the nav dropdown menus.
   */
  async loadNavData() {
    try {
      // Initialize cachedData if null
      if (!this.cachedData) {
        this.cachedData = {};
      }

      // Load prompts from global PROMPTS (if available)
      if (window.PROMPTS && Array.isArray(window.PROMPTS)) {
        this.cachedData.prompts = window.PROMPTS;
      } else {
        // Fallback: empty array (will use fallback tags)
        this.cachedData.prompts = [];
      }

      // Load shop categories from the dedicated shop_categories table
      if (window.supabaseClient) {
        try {
          const { data, error } = await window.supabaseClient
            .from('shop_categories')
            .select('name')
            .order('sort_order');

          if (!error && data && data.length > 0) {
            this.cachedData.shopCategories = data.map(c => c.name);
          } else {
            this.cachedData.shopCategories = [];
          }
        } catch (e) {
          console.warn('Failed to load shop categories for nav:', e);
          this.cachedData.shopCategories = [];
        }
      } else {
        this.cachedData.shopCategories = [];
      }

      console.log('📂 Nav data loaded:', {
        promptsCount: this.cachedData.prompts.length,
        shopCategoriesCount: (this.cachedData.shopCategories || []).length
      });
    } catch (error) {
      console.error('Failed to load nav data:', error);
      // Ensure cachedData exists with empty arrays (preserve any previously loaded data)
      if (!this.cachedData) this.cachedData = {};
      if (!this.cachedData.prompts) this.cachedData.prompts = [];
      if (!this.cachedData.shopCategories) this.cachedData.shopCategories = [];
    }
  },

  /**
   * Initialize navigation dropdown menus
   * Dropdowns are appended to body (outside nav) to enable backdrop-filter
   */
  initNavDropdowns() {
    const self = this;

    // Get top 6 tags from prompts data
    const getTopTags = () => {
      // Get current language
      const currentLang = window.i18n?.getCurrentLanguage() || 'zh';

      const tagCounts = {};
      (this.cachedData?.prompts || []).forEach(p => {
        // Prioritize aiTags with bilingual support
        if (p.aiTags && typeof p.aiTags === 'object') {
          ['styles', 'objects', 'scenes', 'mood'].forEach(cat => {
            // Use current language tags (en or zh)
            const tags = p.aiTags[cat]?.[currentLang] || p.aiTags[cat]?.zh || [];
            tags.forEach(tag => tagCounts[tag] = (tagCounts[tag] || 0) + 1);
          });
        }
        // Only use ai_tags or tags if aiTags is not available
        else if (p.ai_tags && Array.isArray(p.ai_tags)) {
          p.ai_tags.forEach(tag => tagCounts[tag] = (tagCounts[tag] || 0) + 1);
        }
      });

      let topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([tag]) => tag);

      // Fallback tags based on language
      const fallbackTags = currentLang === 'en'
        ? ['Cartoon', '3D Art', 'Rendering', 'Cute', 'Digital Art', 'Miniature']
        : ['卡通风格', '3D艺术', '渲染', '可爱', '数字艺术', '微缩'];

      return topTags.length > 0 ? topTags : fallbackTags;
    };

    // Get shop categories from dedicated shop_categories table
    const getShopCategories = () => {
      // Use categories fetched from shop_categories table
      const categories = this.cachedData?.shopCategories || [];
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
          const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
          return `
            <div class="settings-dropdown-content">
              <button id="langToggleDropdown" class="lang-toggle-simple">
                <span id="langZhDropdown" class="lang-text ${currentLang === 'zh' ? 'active' : ''}">中</span>
                <span class="lang-separator">|</span>
                <span id="langEnDropdown" class="lang-text ${currentLang === 'en' ? 'active' : ''}">EN</span>
              </button>
            </div>
          `;
        }
      },
      support: {
        type: 'custom',
        render: () => `
          <a href="https://status.zaoyoe.com"><span data-i18n="nav.status">状态页</span></a>
          <a href="https://t.me/zaoyoe" target="_blank">TG</a>
          <a href="https://t.me/+I86eX5sPF1c0OTc1" target="_blank"><span data-i18n="nav.tgGroup">TG群组</span></a>
        `
      }
    };

    // FIRST: Remove any existing portals to prevent duplicates from multiple inits
    document.querySelectorAll('.nav-dropdown-portal').forEach(el => el.remove());

    // Create dropdown elements and attach to body
    const triggers = document.querySelectorAll('.nav-trigger[data-dropdown]');

    triggers.forEach(trigger => {
      const dropdownType = trigger.dataset.dropdown;
      const data = dropdownData[dropdownType];
      if (!data) return;

      // Create dropdown element (it's guaranteed to be new now)
      let dropdown = document.createElement('div');
      dropdown.className = 'nav-dropdown-portal';
      dropdown.id = `dropdown-${dropdownType}`;
      // Handle custom rendering or standard list (always update content)
      if (data.type === 'custom' && data.render) {
        dropdown.innerHTML = data.render();
      } else {
        dropdown.innerHTML = data.items.map(item =>
          `<a href="${data.urlPrefix}${encodeURIComponent(item)}">${item}</a>`
        ).join('');
      }

      // Append to body (safe because old ones were cleared)
      document.body.appendChild(dropdown);

      // Bind language toggle event using EVENT DELEGATION (for settings dropdown)
      if (dropdownType === 'settings') {
        // Use event delegation on the dropdown container to avoid listener loss on re-render
        dropdown.addEventListener('click', (e) => {
          e.stopPropagation();

          // Check if clicked on language toggle button or any of its children
          const button = e.target.closest('#langToggleDropdown');
          if (button && window.i18n) {
            // Toggle language
            window.i18n.toggleLanguage();
            console.log('🌐 Language toggled from dropdown');
          }
        });

        // Listen for language changes to trigger re-render
        window.addEventListener('languageChanged', (e) => {
          // Always re-render Settings dropdown to keep highlight in sync
          // (even when not visible, so mobile menu can clone updated HTML)
          if (data.render) {
            dropdown.innerHTML = data.render();
          }
        });
      }

      const showDropdown = () => {
        clearTimeout(trigger._hideTimeout);

        // Re-render settings dropdown to reflect current language
        if (dropdownType === 'settings' && data.type === 'custom' && data.render) {
          dropdown.innerHTML = data.render();
        }

        // Position dropdown perfectly flush with visual bottom of the nav bar
        const nav = document.querySelector('.framer-nav');
        const navRect = nav.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        setHomeRuntimeStyle(dropdown, {
          left: `${triggerRect.left + triggerRect.width / 2}px`
        });

        const navOverlap = parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--nav-dropdown-overlap')
        ) || 1;

        // Shift up slightly to override the nav border so the glass panels stay fused.
        setHomeRuntimeStyle(dropdown, {
          top: `${navRect.bottom - navOverlap}px`
        });

        // Highlight only this trigger
        trigger.classList.add('active');
        dropdown.classList.add('visible');
      };

      // State tracking for intelligent hover
      let isHoveringTrigger = false;
      let isHoveringDropdown = false;

      const hideDropdown = (e) => {
        // Forgiving timeout to prevent premature closing when traversing gaps
        trigger._hideTimeout = setTimeout(() => {
          if (isHoveringTrigger || isHoveringDropdown) return;

          // Extra check: if mouse is currently over either element
          if (trigger.matches(':hover') || dropdown.matches(':hover')) {
            return;
          }

          dropdown.classList.remove('visible');
          trigger.classList.remove('active');
        }, 200);
      };

      const keepDropdownOpen = () => {
        clearTimeout(trigger._hideTimeout);
        // FORCE trigger to stay highlighted
        trigger.classList.add('active');
        dropdown.classList.add('visible');
      };

      // Events - attach to the trigger
      trigger.addEventListener('mouseenter', () => {
        isHoveringTrigger = true;
        showDropdown();
      });
      trigger.addEventListener('mouseleave', (e) => {
        isHoveringTrigger = false;

        // Intelligent gap traversal check
        // If moving straight down towards the dropdown, give extra time
        if (e.movementY > 0) {
          clearTimeout(trigger._hideTimeout);
          trigger._hideTimeout = setTimeout(() => {
            if (!isHoveringTrigger && !isHoveringDropdown) {
              dropdown.classList.remove('visible');
              trigger.classList.remove('active');
            }
          }, 400); // Longer grace period for the physical gap
          return;
        }

        hideDropdown();
      });

      // Events - attach to the precise dropdown element
      dropdown.addEventListener('mouseenter', () => {
        isHoveringDropdown = true;
        keepDropdownOpen();
      });
      dropdown.addEventListener('mouseleave', () => {
        isHoveringDropdown = false;
        hideDropdown();
      });
    });
  },

  /**
   * Render Hero section
   */
  renderHero() {
    const data = this.cachedData.hero;
    const section = document.getElementById('hero-section');
    if (!data || !section) return;
    setHomeSectionVisibility(section, true);

    // Filter out entries for disabled sections
    const sv = window.SectionVisibility;
    const visibleEntries = sv
      ? data.entries.filter(e => !e.section || sv.isVisible(e.section))
      : data.entries;

    const heroSignature = JSON.stringify({
      title: data.title || '',
      subtitle: data.subtitle || '',
      customImage: data.customImage || '',
      cta: {
        primary: data.cta?.primary?.text || '',
        primaryLink: data.cta?.primary?.link || '',
        secondary: data.cta?.secondary?.text || '',
        secondaryLink: data.cta?.secondary?.link || ''
      },
      entries: visibleEntries.map((entry) => ({
        id: entry.id || '',
        icon: entry.icon || '',
        text: entry.text || '',
        link: entry.link || '',
        action: entry.action || '',
        color: entry.color || ''
      }))
    });

    // Avoid replacing Hero DOM when content is unchanged (prevents visual jump on re-init).
    if (section.dataset.renderSignature === heroSignature) {
      return;
    }

    setHomeRuntimeStyle(section, {
      backgroundImage: data.customImage
        ? `linear-gradient(180deg, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0.9)), url("${String(data.customImage).replace(/"/g, '%22')}")`
        : '',
      backgroundSize: data.customImage ? 'cover' : '',
      backgroundPosition: data.customImage ? 'center center' : '',
      backgroundRepeat: data.customImage ? 'no-repeat' : ''
    });

    section.innerHTML = `
      <div class="raycast-beams">
        <div class="ray-beam ray-1"></div>
        <div class="ray-beam ray-2"></div>
        <div class="ray-beam ray-3"></div>
        <div class="ray-beam ray-4"></div>
      </div>
      <div class="hero-noise-overlay"></div>
      <h1 class="hero-title fade-in-up">${escapeHomeHtml(data.title || '')}</h1>
      <p class="hero-subtitle fade-in-up">${escapeHomeHtml(data.subtitle || '')}</p>
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
          ${visibleEntries.map((entry, index) => `
            <a
              href="${escapeHomeHtml(entry.link || '#')}"
              class="entry-card"
              data-index="${index}"
              data-home-entry-id="${escapeHomeHtml(entry.id || `hero_entry_${index + 1}`)}"
              data-home-entry-title="${escapeHomeHtml(entry.text || '')}"
              data-home-entry-link="${escapeHomeHtml(entry.link || '#')}"
              data-home-entry-section="${escapeHomeHtml(entry.section || '')}"
              ${entry.action ? `data-action="${escapeHomeHtml(entry.action)}"` : ''}>
              <span class="entry-card-ui">
                <i class="fas ${entry.icon} home-entry-card-icon" data-home-entry-color="${entry.color}"></i>
                <span>${escapeHomeHtml(entry.text || '')}</span>
              </span>
            </a>
          `).join('')}
        </div>
      </div>
    `;
    section.dataset.renderSignature = heroSignature;
    this.writeHeroTextCache(data);

    // Hero is above-the-fold; reveal immediately instead of waiting for observer.
    section.querySelectorAll('.fade-in-up').forEach(el => {
      el.classList.add('visible');
    });
    section.querySelectorAll('[data-home-entry-color]').forEach((icon) => {
      setHomeRuntimeStyle(icon, {
        color: icon.dataset.homeEntryColor || ''
      });
    });
    observeHomepageSectionImpression(section, 'hero');

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
    if (!section) {
      return;
    }

    // Change section class to masonry style
    section.className = 'prompts-masonry-section';

    // Match the number of columns to the actual card count to avoid empty tracks.
    const columnCount = Math.min(5, Math.max(1, prompts.length || 1));
    const columns = this.distributeCardsToColumns(prompts, columnCount);

    section.innerHTML = `
      <div class="section-header fade-in-up">
        <h2 class="section-title">${this.getLocalizedField(config, 'section_title') || window.i18n?.t('home.prompts.title') || 'AI 提示词工作室'}</h2>
        <p class="section-subtitle">${this.getLocalizedField(config, 'section_subtitle') || window.i18n?.t('home.prompts.subtitle') || '让创作更高效，让灵感更自由'}</p>
      </div>
      
      <div class="prompts-masonry-wrapper">
        <div class="masonry-container" data-columns="${columnCount}">
          ${columns.map((columnCards, columnIndex) => `
            <div class="masonry-column" data-column="${columnIndex}">
                ${columnCards.map(prompt => {
      const promptImage = Array.isArray(prompt.images) ? prompt.images[0] : (prompt.image || '');
      const promptTitle = this.getLocalizedField(prompt, 'title') || prompt.title || prompt.title_zh || prompt.title_en || 'Prompt';
      const promptId = this.normalizeFeaturedPromptLookupId(prompt?.supabaseId ?? prompt?.id);
      const promptHref = promptId ? `/prompts.html?id=${encodeURIComponent(promptId)}` : '/prompts.html';
      const cardMedia = promptImage
        ? `<img src="${this.getOptimizedImageUrl(promptImage)}" 
                         alt="${escapeHomeHtml(promptTitle)}" 
                         loading="lazy"
                         data-home-fallback-src="${encodeURIComponent(promptImage)}" />`
        : `<div class="masonry-card-placeholder" aria-hidden="true"></div>`;

      return `
                  <a
                    href="${promptHref}"
                    class="masonry-card masonry-card-link"
                    data-home-prompt-id="${escapeHomeHtml(promptId || '')}"
                    data-home-prompt-title="${escapeHomeHtml(promptTitle)}">
                    ${cardMedia}
                  </a>
                `;
    }).join('')}
            </div>
          `).join('')}
        </div>
        
        ${(() => {
        // Collect all unique tags for the mask with language support
        const lang = window.i18n?.getCurrentLanguage() || 'zh';
        const langKey = lang === 'en' ? 'en' : 'zh';

        const allTags = new Set();
        prompts.forEach(p => {
          if (p.aiTags) {
            // Extract from aiTags with language-specific keys
            ['styles', 'objects', 'scenes', 'mood'].forEach(c => {
              const langTags = p.aiTags[c]?.[langKey];
              if (langTags) langTags.forEach(t => allTags.add(t));
            });
          } else if (p.tags) {
            // Fallback to simple tags field with language support
            const tagsField = lang === 'en' ? 'tags_en' : 'tags';
            (p[tagsField] || p.tags || []).forEach(t => allTags.add(t));
          }
        });
        const tagList = Array.from(allTags).slice(0, 8); // Top 8 tags

        // Randomize slightly for variety
        const shuffled = tagList.sort(() => 0.5 - Math.random());
        const row1 = shuffled.slice(0, 4);
        const row2 = shuffled.slice(4, 8);

        return `
          <div class="prompts-gradient-mask">
            <a href="/prompts.html" class="mask-labels-container">
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
            </a>
          </div>
        `;
      })()}
      </div>
    `;

    bindImageFallbacks(section, 'img[data-home-fallback-src]', (image) => {
      const fallbackSrc = image.dataset.homeFallbackSrc;
      if (!fallbackSrc || image.dataset.homeFallbackApplied === '1') {
        return;
      }

      image.dataset.homeFallbackApplied = '1';
      image.src = decodeURIComponent(fallbackSrc);
    });

    // Initialize parallax after render
    this.initMasonryParallax();
    section.querySelectorAll('[data-home-prompt-id]').forEach((card) => {
      card.addEventListener('click', () => {
        trackHomepageAnalyticsEvent('homepage_prompt_click', {
          entityType: 'prompt',
          entityId: card.dataset.homePromptId || null,
          metadata: {
            prompt_id: card.dataset.homePromptId || null,
            title: card.dataset.homePromptTitle || ''
          }
        });
      });
    });
    observeHomepageSectionImpression(section, 'prompts');
  },

  /**
   * Render Shop section
   */
  renderShop() {
    const products = this.cachedData.shop;
    const config = this.config.shop;
    const section = document.getElementById('shop-section');

    if (!section) {
      return;
    }

    if (!products || products.length === 0) {
      setHomeSectionVisibility(section, false);
      return;
    }
    setHomeSectionVisibility(section, true);

    const baseSequenceWidth = (products.length * HOME_SHOP_CAROUSEL_CARD_WIDTH)
      + (Math.max(0, products.length - 1) * HOME_SHOP_CAROUSEL_GAP);
    const minimumCycleWidth = Math.max(
      getHomeViewportWidth(),
      HOME_SHOP_CAROUSEL_CARD_WIDTH * 3
    ) + HOME_SHOP_CAROUSEL_EXTRA_BUFFER;
    const repeatCount = baseSequenceWidth > 0
      ? Math.max(1, Math.ceil((minimumCycleWidth + HOME_SHOP_CAROUSEL_GAP) / (baseSequenceWidth + HOME_SHOP_CAROUSEL_GAP)))
      : 1;
    const cycleProducts = Array.from({ length: repeatCount }, () => products).flat();
    const renderShopCard = (product) => {
      const productId = String(product?.id || '').trim();
      const productName = this.getLocalizedField(product, 'name');
      const productDescription = this.getLocalizedField(product, 'description');
      const stockText = Number(product?.stock_count || 0) > 0
        ? `${window.i18n?.t('home.shop.stock') || '库存'} ${Number(product.stock_count || 0)}`
        : (window.i18n?.t('home.shop.lowStock') || '库存紧张');
      return `
      <a
        href="/shop.html"
        class="shop-carousel-card"
        data-home-shop-id="${escapeHomeHtml(productId)}"
        data-home-shop-title="${escapeHomeHtml(productName || '')}">
        ${product.homepage_badge ? `<span class="shop-card-badge">${escapeHomeHtml(product.homepage_badge)}</span>` : ''}
        <div class="shop-card-image">
          ${product.icon_url && (product.icon_url.startsWith('http') || product.icon_url.startsWith('/') || product.icon_url.startsWith('data:'))
      ? `<img src="${product.icon_url}" alt="${escapeHomeHtml(productName)}" loading="lazy" data-home-replace-parent-icon="1">`
      : (product.icon_url && product.icon_url.startsWith('fa-') ? `<i class="fas ${product.icon_url} shop-card-icon"></i>` : `<i class="fas fa-box-open shop-card-icon shop-card-icon--fallback"></i>`)}
        </div>
        <div class="shop-card-info">
          <h3>${escapeHomeHtml(productName)}</h3>
          <p>${escapeHomeHtml(productDescription)}</p>
          <span class="shop-card-meta">${escapeHomeHtml(product.category || '')}${product.category ? ' · ' : ''}${escapeHomeHtml(stockText)}</span>
        </div>
      </a>
    `;
    };

    // Read shop_scroll_speed from ticker config and convert it into pixels-per-second motion
    const shopSpeed = this.config.ticker?.shop_scroll_speed || 30;

    section.innerHTML = `
      <div class="section-header fade-in-up">
        <h2 class="section-title">${this.getLocalizedField(config, 'section_title') || window.i18n?.t('home.shop.title') || '精选资源商城'}</h2>
        <p class="section-subtitle">${this.getLocalizedField(config, 'section_subtitle') || window.i18n?.t('home.shop.subtitle') || '优质资源，助力成长'}</p>
      </div>
      
      <div class="shop-carousel-wrapper">
        <div class="shop-carousel-track" data-home-animation-duration="" data-home-speed-value="${shopSpeed}">
          <div class="shop-carousel-group" data-home-shop-cycle="1">
            ${cycleProducts.map(renderShopCard).join('')}
          </div>
          <div class="shop-carousel-group" aria-hidden="true">
            ${cycleProducts.map(renderShopCard).join('')}
          </div>
        </div>
      </div>
    `;

    bindImageFallbacks(section, 'img[data-home-replace-parent-icon="1"]', (image) => {
      if (image.dataset.homeFallbackApplied === '1') {
        return;
      }

      image.dataset.homeFallbackApplied = '1';
      if (image.parentElement) {
        image.parentElement.innerHTML = '<i class="fas fa-box-open shop-card-icon shop-card-icon--fallback"></i>';
      }
    });
    section.querySelectorAll('[data-home-animation-duration]').forEach((track) => {
      const primaryCycle = track.querySelector('[data-home-shop-cycle="1"]');
      const cycleWidth = primaryCycle
        ? Math.ceil(primaryCycle.getBoundingClientRect().width + HOME_SHOP_CAROUSEL_GAP)
        : 0;
      const speedValue = track.dataset.homeSpeedValue || shopSpeed;
      const animationDuration = cycleWidth > 0
        ? `${getHomeLoopDurationSeconds(cycleWidth, speedValue)}s`
        : '';
      setHomeRuntimeStyle(track, {
        '--home-animation-duration': animationDuration,
        animationDuration,
        '--home-shop-cycle-width': cycleWidth ? `${cycleWidth}px` : ''
      });
    });
    section.querySelectorAll('[data-home-shop-id]').forEach((card) => {
      card.addEventListener('click', () => {
        trackHomepageAnalyticsEvent('homepage_shop_click', {
          entityType: 'shop_product',
          entityId: card.dataset.homeShopId || null,
          metadata: {
            product_id: card.dataset.homeShopId || null,
            title: card.dataset.homeShopTitle || ''
          }
        });
      });
    });
    observeHomepageSectionImpression(section, 'shop');
  },

  /**
   * Render Gemini Verify section
   */
  renderVerify() {
    const data = this.cachedData.verify;
    const section = document.getElementById('verify-section');
    if (!section || !data) {
      return;
    }
    setHomeSectionVisibility(section, true);

    section.innerHTML = `
      <div class="verify-grid fade-in-up">
        <div class="verify-copy">
          <h2 class="section-title">${escapeHomeHtml(data.title || window.i18n?.t('home.verify.title') || 'Gemini 验证')}</h2>
          <p class="section-subtitle">${escapeHomeHtml(data.subtitle || window.i18n?.t('home.verify.subtitle') || '快速验证您的 API 密钥，实时返回结果')}</p>
          
          <div class="verify-features">
            ${(Array.isArray(data.features) ? data.features : []).map(feature => `
              <span class="verify-feature-chip">
                ${escapeHomeHtml(feature)}
              </span>
            `).join('')}
          </div>

          <div class="verify-value-props">
            ${(Array.isArray(data.valueProps) ? data.valueProps : []).map((valueProp) => `
              <div class="verify-value-prop">${escapeHomeHtml(valueProp)}</div>
            `).join('')}
          </div>

          <div class="verify-supported-models">
            ${(Array.isArray(data.supportedModels) ? data.supportedModels : []).map((model) => `
              <span class="verify-supported-model">${escapeHomeHtml(model)}</span>
            `).join('')}
          </div>

          <div class="verify-risk-note">${escapeHomeHtml(data.riskNotice || '')}</div>
          
          <div class="verify-actions">
            <a href="${escapeHomeHtml(data.link || '/verify.html?source=homepage_verify')}" class="btn btn-primary" data-home-verify-cta="1">
              ${escapeHomeHtml(data.ctaText || window.i18n?.t('home.verify.cta') || '立即验证')}
            </a>
          </div>
        </div>
        
        <div class="verify-3d-container">
          <div class="verify-card-3d">
            <img src="${escapeHomeHtml(data.screenshot || '/assets/verify-preview.png')}" alt="Gemini Verify" class="verify-screenshot">
            <div class="verify-card-shine"></div>
          </div>
        </div>
      </div>
    `;

    section.querySelector('[data-home-verify-cta="1"]')?.addEventListener('click', () => {
      trackHomepageAnalyticsEvent('homepage_verify_click', {
        entityType: 'homepage_section',
        entityId: 'verify',
        metadata: {
          section: 'verify',
          title: data.title || '',
          cta_text: data.ctaText || ''
        }
      });
    });
    observeHomepageSectionImpression(section, 'verify', 'homepage_verify_impression');

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
            setHomeRuntimeStyle(card, {
              transform: `rotateY(-12deg) rotateX(6deg) scale(${Math.max(0.9, targetScale)})`
            });
          }
          ticking = false;
        });
        ticking = true;
      }
    });
  },

  /**
   * Stop guestbook-specific scroll + particle runtime
   */
  destroyGuestbookExperience() {
    const runtime = this.guestbookRuntime;
    if (!runtime) {
      return;
    }

    if (runtime.scrollHandler) {
      window.removeEventListener('scroll', runtime.scrollHandler);
    }

    if (runtime.resizeHandler) {
      window.removeEventListener('resize', runtime.resizeHandler);
    }

    if (runtime.progressFrame) {
      window.cancelAnimationFrame(runtime.progressFrame);
    }

    if (runtime.particleFrame) {
      window.cancelAnimationFrame(runtime.particleFrame);
    }

    this.guestbookRuntime = null;
  },

  getGuestbookAvatarUrl(message) {
    const username = String(message?.author || message?.profiles?.username || message?.username || 'U').trim() || 'U';
    return message?.avatar_url
      || message?.profiles?.avatar_url
      || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}&backgroundColor=6b9ece`;
  },

  getGuestbookDisplayName(message) {
    const username = String(message?.author || message?.profiles?.username || message?.username || '').trim();
    return username || (window.i18n?.getCurrentLanguage?.() === 'en' ? 'Anonymous' : '匿名用户');
  },

  getGuestbookMessagePreview(message) {
    return String(message?.content || '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  createGuestbookCardMarkup(message, slot) {
    const displayName = this.getGuestbookDisplayName(message);
    const safeName = escapeHomeHtml(displayName);
    const safeContent = escapeHomeHtml(this.getGuestbookMessagePreview(message));
    const avatarSrc = escapeHomeHtml(this.getGuestbookAvatarUrl(message));
    const fallbackSrc = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName || 'U')}&backgroundColor=6b9ece`;
    const side = slot.startsWith('l') ? 'left' : 'right';
    const reason = escapeHomeHtml(message?.homepage_reason || (message?.homepage_fallback ? (window.i18n?.t('home.guestbook.opsPick') || '运营推荐') : ''));

    return `
      <article class="home-guestbook-card home-guestbook-card--${slot}${message?.homepage_fallback ? ' home-guestbook-card--fallback' : ''}" data-home-guestbook-card data-card-side="${side}">
        <div class="home-guestbook-card__head">
          <img
            src="${avatarSrc}"
            alt="${safeName}"
            class="home-guestbook-avatar"
            loading="lazy"
            decoding="async"
            data-home-avatar-fallback="${encodeURIComponent(fallbackSrc)}">
        </div>
        ${reason ? `<div class="home-guestbook-card__reason">${reason}</div>` : ''}
        <p class="home-guestbook-card__content">${safeContent}</p>
        <div class="home-guestbook-card__author">${safeName}</div>
      </article>
    `;
  },

  getGuestbookParticleModeScale() {
    if (window.innerWidth <= 760) {
      return 0.56;
    }

    if (window.innerWidth <= 980) {
      return 0.68;
    }

    if (window.innerWidth <= 1180) {
      return 0.76;
    }

    if (window.innerWidth <= 1440) {
      return 0.84;
    }

    return 1;
  },

  createGuestbookParticleDescriptor(random, index) {
    const streak = index >= 20;
    const angle = (random() * 360) - 180;
    const minDistance = streak
      ? 90 + (random() * 90)
      : 54 + (random() * 72);
    const maxDistance = streak
      ? 430 + (random() * 150)
      : 340 + (random() * 220);
    const startDistance = minDistance + ((maxDistance - minDistance) * random());

    return {
      angle,
      distance: startDistance,
      minDistance,
      maxDistance,
      speed: streak ? 14 + (random() * 16) : 9 + (random() * 12),
      drift: (random() - 0.5) * (streak ? 0.8 : 0.45),
      phase: random() * Math.PI * 2,
      pulseSpeed: 0.5 + (random() * 0.7),
      tilt: streak ? ((random() - 0.5) * 16) : ((random() - 0.5) * 8),
      opacityBase: streak ? 0.12 + (random() * 0.12) : 0.28 + (random() * 0.42),
      size: streak ? 2 : 1.4 + (random() * 1.8),
      glow: streak ? 0 : 6 + (random() * 8),
      streak,
      length: streak ? 10 + (random() * 10) : 0,
      thickness: streak ? 1.2 + (random() * 0.9) : 0,
      color: streak
        ? (random() > 0.72 ? 'rgba(245,210,100,0.24)' : 'rgba(255,255,255,0.28)')
        : (random() > 0.82
          ? 'rgba(245,210,100,0.5)'
          : random() > 0.6
            ? 'rgba(192,210,255,0.56)'
            : 'rgba(255,255,255,0.68)')
    };
  },

  initializeGuestbookParticles(runtime) {
    if (!runtime?.particleField) {
      return;
    }

    const random = createHomeSeededRandom(HOME_GUESTBOOK_PARTICLE_SEED);
    runtime.particleResetRandom = createHomeSeededRandom(HOME_GUESTBOOK_PARTICLE_RESET_SEED);
    runtime.particles = [];
    runtime.lastParticleFrameTime = 0;

    for (let index = 0; index < HOME_GUESTBOOK_PARTICLE_COUNT; index += 1) {
      const seed = this.createGuestbookParticleDescriptor(random, index);
      const particle = document.createElement('span');
      particle.className = seed.streak ? 'home-guestbook-particle home-guestbook-particle--streak' : 'home-guestbook-particle';
      particle.style.setProperty('--particle-size', String(seed.size || 2));
      particle.style.setProperty('--particle-color', seed.color || 'rgba(255,255,255,0.6)');
      particle.style.setProperty('--particle-glow', String(seed.glow || 10));

      if (seed.streak) {
        particle.style.setProperty('--particle-length', String(seed.length || 10));
        particle.style.setProperty('--particle-thickness', String(seed.thickness || 1.4));
      }

      runtime.particleField.appendChild(particle);
      runtime.particles.push({
        ...seed,
        element: particle
      });
    }

    const animateParticles = (now) => {
      if (!this.guestbookRuntime || this.guestbookRuntime !== runtime) {
        return;
      }

      if (!runtime.lastParticleFrameTime) {
        runtime.lastParticleFrameTime = now;
      }

      const deltaSeconds = Math.min(0.05, (now - runtime.lastParticleFrameTime) / 1000);
      runtime.lastParticleFrameTime = now;
      const timeSeconds = now / 1000;
      const scale = this.getGuestbookParticleModeScale();

      runtime.particles.forEach((particle) => {
        particle.distance += particle.speed * deltaSeconds;
        particle.angle += particle.drift * deltaSeconds * 18;

        if (particle.distance > particle.maxDistance) {
          particle.distance = particle.minDistance + (runtime.particleResetRandom() * Math.min(22, particle.maxDistance - particle.minDistance));
          particle.angle += (runtime.particleResetRandom() - 0.5) * 26;
          particle.phase = runtime.particleResetRandom() * Math.PI * 2;
        }

        const radius = particle.distance * scale;
        const progress = (particle.distance - particle.minDistance) / Math.max(1, particle.maxDistance - particle.minDistance);
        const fadeIn = Math.min(1, progress / 0.22);
        const fadeOut = Math.min(1, (1 - progress) / 0.28);
        const pulse = 0.92 + (Math.sin((timeSeconds * particle.pulseSpeed) + particle.phase) * 0.08);
        const opacity = Math.max(0.02, particle.opacityBase * fadeIn * fadeOut * pulse);
        const tilt = particle.tilt * (0.72 + (progress * 0.28));

        particle.element.style.opacity = opacity.toFixed(3);
        particle.element.style.transform = [
          'translate(-50%, -50%)',
          `rotate(${particle.angle.toFixed(3)}deg)`,
          `translateY(${-radius.toFixed(2)}px)`,
          `rotate(${tilt.toFixed(3)}deg)`
        ].join(' ');
      });

      runtime.particleFrame = window.requestAnimationFrame(animateParticles);
    };

    runtime.particleFrame = window.requestAnimationFrame(animateParticles);
  },

  initGuestbookExperience(section) {
    const stage = section?.querySelector('[data-home-guestbook-stage]');
    const particleField = section?.querySelector('[data-home-guestbook-particles]');
    if (!stage || !particleField) {
      return;
    }

    const runtime = {
      section,
      stage,
      particleField,
      progressFrame: 0,
      particleFrame: 0,
      particles: [],
      scheduled: false
    };

    const updateScrollProgress = () => {
      if (!this.guestbookRuntime || this.guestbookRuntime !== runtime) {
        return;
      }

      if (window.innerWidth <= 760) {
        stage.style.setProperty('--home-guestbook-scroll-progress', '0');
        return;
      }

      const rect = stage.getBoundingClientRect();
      const viewportCenter = window.innerHeight / 2;
      const stageCenter = rect.top + (rect.height / 2);
      const distance = Math.abs(stageCenter - viewportCenter);
      const maxDistance = Math.max(window.innerHeight * 0.72, 1);
      const normalized = clampHomeValue(distance / maxDistance, 0, 1);
      const easedProgress = Math.pow(normalized, 1.08);

      stage.style.setProperty('--home-guestbook-scroll-progress', easedProgress.toFixed(4));
    };

    const scheduleProgressUpdate = () => {
      if (runtime.scheduled) {
        return;
      }

      runtime.scheduled = true;
      runtime.progressFrame = window.requestAnimationFrame(() => {
        runtime.scheduled = false;
        updateScrollProgress();
      });
    };

    runtime.scrollHandler = scheduleProgressUpdate;
    runtime.resizeHandler = scheduleProgressUpdate;
    this.guestbookRuntime = runtime;

    window.addEventListener('scroll', runtime.scrollHandler, { passive: true });
    window.addEventListener('resize', runtime.resizeHandler);

    this.initializeGuestbookParticles(runtime);
    updateScrollProgress();
  },

  /**
   * Render Guestbook section
   */
  renderGuestbook() {
    this.destroyGuestbookExperience();

    const messages = Array.isArray(this.cachedData.guestbook)
      ? this.cachedData.guestbook.slice(0, HOME_GUESTBOOK_CARD_SLOTS.length)
      : [];
    const config = this.config.guestbook || {};
    const section = document.getElementById('guestbook-section');

    if (!messages || messages.length === 0) {
      setHomeSectionVisibility(section, false);
      return;
    }
    setHomeSectionVisibility(section, true);

    const title = escapeHomeHtml(this.getLocalizedField(config, 'section_title') || window.i18n?.t('home.guestbook.title') || '留言板');
    const subtitle = escapeHomeHtml(this.getLocalizedField(config, 'section_subtitle') || window.i18n?.t('home.guestbook.subtitle') || '用户的声音');
    const cardsMarkup = messages
      .map((message, index) => this.createGuestbookCardMarkup(message, HOME_GUESTBOOK_CARD_SLOTS[index]))
      .join('');

    section.innerHTML = `
      <div class="home-guestbook-stage fade-in-up" data-home-guestbook-stage>
        <div class="home-guestbook-particle-field" data-home-guestbook-particles aria-hidden="true"></div>

        <section class="home-guestbook-center" aria-label="${title}">
          <h2 class="home-guestbook-center__title">${title}</h2>
          <p class="home-guestbook-center__subtitle">${subtitle}</p>

          <div class="home-guestbook-center__actions">
            <a href="/guestbook.html"
              data-home-open-guestbook="1"
              data-home-guestbook-action="write"
              data-home-hover-lift="1"
              class="btn btn-secondary guestbook-action-btn">
              <i class="fas fa-pen-fancy"></i>
              ${window.i18n?.t('home.guestbook.writeMessage') || '写留言'}
            </a>
            <a href="/guestbook.html"
              class="btn btn-secondary guestbook-action-btn"
              data-home-guestbook-action="view_all"
              data-home-hover-lift="1">
              ${window.i18n?.t('home.guestbook.viewAll') || '查看全部留言'}
            </a>
          </div>
        </section>

        <div class="guestbook-list">
          <div class="home-guestbook-cards">
            ${cardsMarkup}
          </div>
        </div>
      </div>
    `;

    bindImageFallbacks(section, 'img[data-home-avatar-fallback]', (image) => {
      const fallbackSrc = image.dataset.homeAvatarFallback;
      if (!fallbackSrc || image.dataset.homeFallbackApplied === '1') {
        return;
      }

      image.dataset.homeFallbackApplied = '1';
      image.src = decodeURIComponent(fallbackSrc);
    });
    bindHoverLiftTargets(section);
    section.querySelectorAll('[data-home-guestbook-action]').forEach((actionEl) => {
      actionEl.addEventListener('click', () => {
        trackHomepageAnalyticsEvent('homepage_guestbook_click', {
          entityType: 'homepage_section',
          entityId: 'guestbook',
          metadata: {
            section: 'guestbook',
            action: actionEl.dataset.homeGuestbookAction || '',
            label: actionEl.textContent?.trim() || ''
          }
        });
      });
    });
    observeHomepageSectionImpression(section, 'guestbook');
    this.initGuestbookExperience(section);
  },

  /**
   * Render infinite ticker section
   */
  renderTicker() {
    const data = this.cachedData.ticker;
    const section = document.getElementById('ticker-section');
    if (!section || !data) {
      return;
    }

    const topItems = Array.isArray(data.top) ? data.top.filter(Boolean) : [];
    const bottomItems = Array.isArray(data.bottom) ? data.bottom.filter(Boolean) : [];

    const sv = window.SectionVisibility;
    const tickerVisible = !sv || sv.isVisible('ticker');
    const showTopRow = tickerVisible && data.enable_prompts !== false && (!sv || sv.isVisible('prompts')) && topItems.length > 0;
    const showBottomRow = tickerVisible && data.enable_products !== false && (!sv || sv.isVisible('shop')) && bottomItems.length > 0;

    // If both rows hidden, hide entire ticker
    if (!showTopRow && !showBottomRow) {
      setHomeSectionVisibility(section, false);
      return;
    }
    setHomeSectionVisibility(section, true);

    const tickerSpeed = data.speed || 30;

    section.innerHTML = `
      ${showTopRow ? `
      <div class="ticker-row">
        <div class="ticker ticker-left">
          <div class="ticker-track" data-home-animation-duration="" data-home-ticker-role="top" data-home-speed-value="${tickerSpeed}"></div>
        </div>
      </div>
      ` : ''}
      
      ${showBottomRow ? `
      <div class="ticker-row">
        <div class="ticker ticker-right">
          <div class="ticker-track" data-home-animation-duration="" data-home-ticker-role="bottom" data-home-speed-value="${tickerSpeed}"></div>
        </div>
      </div>
      ` : ''}
    `;

    const renderTickerItem = (label, role) => {
      const safeLabel = escapeHomeHtml(label);
      const href = role === 'top'
        ? `/prompts.html?tag=${encodeURIComponent(label)}`
        : `/shop.html?category=${encodeURIComponent(label)}`;
      return `
        <a
          href="${href}"
          class="ticker-item"
          data-home-ticker-role-click="${role}"
          data-home-ticker-label="${safeLabel}">
          ${safeLabel}
        </a>
      `;
    };
    configureHomeMeasuredLoopTrack(
      section.querySelector('[data-home-ticker-role="top"]'),
      topItems,
      (label) => renderTickerItem(label, 'top'),
      {
        groupClassName: 'ticker-track-group',
        cycleWidthVar: '--home-ticker-cycle-width',
        speedValue: tickerSpeed
      }
    );
    configureHomeMeasuredLoopTrack(
      section.querySelector('[data-home-ticker-role="bottom"]'),
      bottomItems,
      (label) => renderTickerItem(label, 'bottom'),
      {
        groupClassName: 'ticker-track-group',
        cycleWidthVar: '--home-ticker-cycle-width',
        speedValue: tickerSpeed
      }
    );
    section.querySelectorAll('[data-home-ticker-label]').forEach((item) => {
      item.addEventListener('click', () => {
        trackHomepageAnalyticsEvent('homepage_ticker_click', {
          entityType: 'ticker_item',
          entityId: item.dataset.homeTickerLabel || null,
          metadata: {
            section: 'ticker',
            label: item.dataset.homeTickerLabel || '',
            role: item.dataset.homeTickerRoleClick || ''
          }
        });
      });
    });
    observeHomepageSectionImpression(section, 'ticker');
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
    let hasUserInteracted = false; // Track if user has scrolled/clicked
    const getCarouselViewportCenter = () => {
      const carouselRect = carousel.getBoundingClientRect();
      return carouselRect.left + carouselRect.width / 2;
    };
    const triggerCardAction = (card, event) => {
      const action = card.getAttribute('data-action');

      if (action && typeof window[action] === 'function') {
        event.preventDefault();
        window[action]();
        return true;
      }

      return false;
    };

    // Center a specific card
    const centerCard = (index) => {
      const card = cards[index];
      if (!card) return;

      const cardCenterInTrack = card.offsetLeft + card.offsetWidth / 2;
      const viewportCenter = carousel.clientWidth / 2;
      const scrollTarget = cardCenterInTrack - viewportCenter;

      carousel.scrollTo({
        left: Math.max(0, scrollTarget),
        behavior: 'smooth'
      });
    };

    // Center all cards initially by scrolling to middle of carousel
    let isInitializing = true; // Flag to prevent initial scroll from triggering interaction

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
          const thumbLeft = progress * maxOffset;
          setHomeRuntimeStyle(thumb, {
            left: `${thumbLeft}px`
          });

          // Hide ticks overlapping with thumb
          const ticks = track.querySelectorAll('.progress-tick');
          const thumbRight = thumbLeft + thumbWidth;
          ticks.forEach(tick => {
            const tickLeft = tick.offsetLeft;
            const tickRight = tickLeft + tick.offsetWidth;
            if (tickLeft >= thumbLeft - 4 && tickRight <= thumbRight + 4) {
              tick.classList.add('progress-tick--covered');
            } else {
              tick.classList.remove('progress-tick--covered');
            }
          });
        }
      }

      // Only apply scaling effect after user has interacted
      if (!hasUserInteracted) {
        // Initial state: all cards same size and dimmer opacity
        cards.forEach((card) => {
          const cardUi = card.querySelector('.entry-card-ui') || card;
          setHomeRuntimeStyle(cardUi, {
            transform: 'scale(1)',
            opacity: '0.7'
          });
        });
        return;
      }

      // Calculate which card is centered and apply scaling
      const viewportCenter = getCarouselViewportCenter();

      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        const cardCenter = rect.left + rect.width / 2;
        const distanceFromCenter = Math.abs(cardCenter - viewportCenter);
        const maxDistance = rect.width * 1.5;
        const cardUi = card.querySelector('.entry-card-ui') || card;

        // Scale: 1.1 when centered, 0.85 when far (more dramatic effect)
        const scale = Math.max(0.85, 1.1 - (distanceFromCenter / maxDistance) * 0.25);
        // Opacity: 1.0 when centered, 0.5 when far
        const opacity = Math.max(0.5, 1 - (distanceFromCenter / maxDistance) * 0.5);

        setHomeRuntimeStyle(cardUi, {
          transform: `scale(${scale})`,
          opacity
        });
      });
    };

    const applyInitialCenter = () => {
      // Skip if node was replaced by a later render.
      if (!document.body.contains(carousel)) return;
      const maxScroll = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
      carousel.scrollLeft = maxScroll / 2;
      updateCarousel();
    };

    // Apply immediately (before first paint) + one RAF sync for late layout settles.
    applyInitialCenter();
    requestAnimationFrame(() => {
      applyInitialCenter();
      isInitializing = false;
    });

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

    // Enable snapping and highlight on first user interaction
    const enableSnapping = () => {
      if (!hasUserInteracted) {
        hasUserInteracted = true;
        carousel.classList.add('is-snapping');
      }
    };

    carousel.addEventListener('touchstart', (e) => {
      enableSnapping();
      touchStartX = e.touches[0].clientX;
      touchStartScrollLeft = carousel.scrollLeft;
    }, { passive: true });

    carousel.addEventListener('touchmove', (e) => {
      const deltaX = touchStartX - e.touches[0].clientX;
      carousel.scrollLeft = touchStartScrollLeft + deltaX;
      updateCarousel();
    }, { passive: true });

    // Scroll event for smooth updates (don't trigger interaction during initialization)
    carousel.addEventListener('scroll', () => {
      if (!isInitializing) {
        enableSnapping();
      }
      updateCarousel();
    });

    // Click behavior: center card first, then navigate
    const centerThreshold = 50; // pixels - how close to center to be considered "centered"

    cards.forEach((card) => {
      card.addEventListener('click', (e) => {
        const viewportCenter = getCarouselViewportCenter();
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
        } else {
          trackHomepageAnalyticsEvent('homepage_entry_click', {
            entityType: 'hero_entry',
            entityId: card.dataset.homeEntryId || null,
            metadata: {
              section: 'hero',
              entry_id: card.dataset.homeEntryId || null,
              entry_label: card.dataset.homeEntryTitle || '',
              link: card.dataset.homeEntryLink || '',
              target_section: card.dataset.homeEntrySection || '',
              action: card.getAttribute('data-action') || ''
            }
          });
          // Card is centered — check for custom action (e.g. guestbook modal)
          triggerCardAction(card, e);
          // Otherwise let the click through to navigate normally
        }
      });
    });

    // Initial update (safe no-op if already centered)
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
    const closeMobileMenu = () => setMobileMenuState(hamburger, mobileMenu, false);

    if (mobileMenu) {
      bindMobileMenuScrollGuard(mobileMenu);
    }

    // Guard only the hamburger click binding to prevent double-binding
    if (hamburger && mobileMenu && !hamburger._navInitialized) {
      // Toggle mobile menu on hamburger click
      hamburger.addEventListener('click', () => {
        toggleMobileMenu(hamburger, mobileMenu);
      });
      hamburger._navInitialized = true;
    }

    // Always bind mobile submenu triggers, dropdown sync, and close handlers
    // (these may not have been bound by the standalone initNavBar)
    if (hamburger && mobileMenu && !mobileMenu._submenuInitialized) {
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

      // Bind language toggle event for mobile settings submenu
      const bindMobileLanguageToggle = () => {
        const mobileSettings = document.getElementById('settings-mobile');
        if (mobileSettings) {
          // Remove old listener if exists
          const oldListener = mobileSettings._langToggleListener;
          if (oldListener) {
            mobileSettings.removeEventListener('click', oldListener);
          }

          // Add new listener with event delegation
          const listener = (e) => {
            e.stopPropagation();
            const button = e.target.closest('#langToggleDropdown');
            if (button && window.i18n) {
              window.i18n.toggleLanguage();
              console.log('🌐 Language toggled from mobile menu');
            }
          };

          mobileSettings.addEventListener('click', listener);
          mobileSettings._langToggleListener = listener; // Store for cleanup
        }
      };

      // Sync all dropdowns (wait a bit to ensure dropdowns are rendered)
      setTimeout(() => {
        syncDropdownToMobile('dropdown-prompts', 'prompts-mobile');
        syncDropdownToMobile('dropdown-shop', 'shop-mobile');
        syncDropdownToMobile('dropdown-settings', 'settings-mobile');

        // Bind language toggle after syncing settings
        bindMobileLanguageToggle();
      }, 100);

      // Re-sync mobile submenus on language change
      window.addEventListener('languageChanged', () => {
        syncDropdownToMobile('dropdown-prompts', 'prompts-mobile');
        syncDropdownToMobile('dropdown-shop', 'shop-mobile');
        syncDropdownToMobile('dropdown-settings', 'settings-mobile');

        // Re-bind language toggle after re-sync
        bindMobileLanguageToggle();

        console.log('✅ Mobile submenus re-synced for language:', window.i18n.getCurrentLanguage());
      });

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
          closeMobileMenu();
        });
      });

      // Close mobile menu when clicking on blank area (outside menu items)
      mobileMenu.addEventListener('click', (e) => {
        if (e.target === mobileMenu) {
          closeMobileMenu();
        }
      });

      mobileMenu._submenuInitialized = true;
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

          setHomeRuntimeStyle(column, {
            transform: `translate3d(0, ${offset}px, 0)`
          });
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

function scheduleHomepageInit() {
  if (document.documentElement.dataset.homepageInitScheduled === '1') {
    return;
  }

  document.documentElement.dataset.homepageInitScheduled = '1';

  const startTime = Date.now();
  const maxWaitMs = 2500;
  const waitForDeps = setInterval(() => {
    const promptsReady = Boolean(window.PROMPTS);
    const clientReady = Boolean(window.supabaseClient);
    const timedOut = Date.now() - startTime >= maxWaitMs;

    if (!promptsReady) {
      return;
    }

    if (!clientReady && !timedOut) {
      return;
    }

    clearInterval(waitForDeps);

    if (!clientReady) {
      console.warn('⚠️ Supabase client not ready after 2500ms, initializing homepage with fallback-capable mode');
    }

    FramerHome.init();
  }, 100);
}

// Auto-initialize when DOM is ready and dependencies are loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleHomepageInit);
} else {
  scheduleHomepageInit();
}

// Export to window for global access
window.FramerHome = FramerHome;

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FramerHome;
}

/**
 * ==========================================
 * Standalone Navigation Bar Initialization
 * For pages that use framer-nav but aren't homepage
 * ==========================================
 */
document.addEventListener('DOMContentLoaded', function initNavBar() {
  const nav = document.querySelector('.framer-nav');
  if (!nav) return; // No nav bar on this page

  const hamburger = document.querySelector('.nav-hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');
  const closeMobileMenu = () => setMobileMenuState(hamburger, mobileMenu, false);

  if (mobileMenu) {
    bindMobileMenuScrollGuard(mobileMenu);
  }

  // Already initialized by FramerHome? Skip
  if (hamburger && hamburger._navInitialized) return;

  console.log('🍔 Initializing standalone nav bar...');

  // Nav scroll effect
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  });

  // Mobile hamburger menu toggle
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      console.log('🍔 Hamburger clicked');
      toggleMobileMenu(hamburger, mobileMenu);
    });
    hamburger._navInitialized = true;
  }

  // Close mobile menu when clicking a link (standalone fallback)
  if (mobileMenu && !mobileMenu._submenuInitialized) {
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        closeMobileMenu();
      });
    });

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

    // Close mobile menu when clicking on blank area (outside menu items)
    mobileMenu.addEventListener('click', (e) => {
      if (e.target === mobileMenu) {
        closeMobileMenu();
      }
    });

    mobileMenu._submenuInitialized = true;
  }

  // Sync desktop dropdown content to mobile submenus
  const syncDropdownToMobile = (desktopDropdownId, mobileSubmenuId) => {
    const desktopDropdown = document.getElementById(desktopDropdownId);
    const mobileSubmenu = document.getElementById(mobileSubmenuId);

    if (desktopDropdown && mobileSubmenu) {
      const content = desktopDropdown.cloneNode(true);
      content.removeAttribute('id');
      mobileSubmenu.innerHTML = content.innerHTML;
    }
  };

  // Initialize navigation dropdowns for subpages too
  // Need to load data first, then init dropdowns
  if (typeof FramerHome !== 'undefined' && FramerHome.loadNavData && FramerHome.initNavDropdowns) {
    console.log('📂 Loading nav data for subpage...');
    FramerHome.loadNavData().then(() => {
      console.log('📂 Initializing nav dropdowns on subpage...');
      FramerHome.initNavDropdowns();

      // Sync dropdown content to mobile submenus after dropdowns are created
      setTimeout(() => {
        syncDropdownToMobile('dropdown-prompts', 'prompts-mobile');
        syncDropdownToMobile('dropdown-shop', 'shop-mobile');
        syncDropdownToMobile('dropdown-settings', 'settings-mobile');
        console.log('✅ Mobile submenus synced on subpage');
      }, 100);

      // 🆕 Listen for language changes and re-initialize dropdowns
      window.addEventListener('languageChanged', () => {
        console.log('🌐 Language changed on subpage, re-initializing nav dropdowns...');
        FramerHome.initNavDropdowns();

        // Re-sync mobile submenus after dropdown re-init
        setTimeout(() => {
          syncDropdownToMobile('dropdown-prompts', 'prompts-mobile');
          syncDropdownToMobile('dropdown-shop', 'shop-mobile');
          syncDropdownToMobile('dropdown-settings', 'settings-mobile');
        }, 100);
      });
    }).catch(err => {
      console.error('Failed to load nav data:', err);
    });
  }

  console.log('✅ Standalone nav bar initialized');
});
