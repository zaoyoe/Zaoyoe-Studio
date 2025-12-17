// --- Theme Toggle ---
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function toggleTheme() {
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

// Initialize theme before page renders
initTheme();

document.addEventListener('DOMContentLoaded', () => {
    // Assign IDs to PROMPTS for favorites to work
    PROMPTS.forEach((p, i) => p.id = i);

    initSpotlight();
    renderGallery('all');
    setupFilters();
    setupInfiniteScroll();
    setupSearch(); // Pinterest-style search

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

// Filter cards using CSS display instead of re-rendering
function filterCardsCSS(filter) {
    const cards = document.querySelectorAll('.prompt-card');
    let visibleIndex = 0;

    cards.forEach(card => {
        const cardTags = card.dataset.tags ? card.dataset.tags.split(',') : [];
        const cardId = parseInt(card.dataset.id);

        let isVisible = false;
        if (filter === 'all') {
            isVisible = true;
        } else if (filter === 'favorites') {
            isVisible = favorites.has(cardId);
        } else {
            isVisible = cardTags.includes(filter);
        }

        if (isVisible) {
            card.style.display = '';
            // Re-trigger animation with stagger

            // 1. Reset state instantly
            card.style.transition = 'none';
            card.classList.remove('card-visible');

            // 2. Force reflow
            void card.offsetHeight;

            // 3. Restore transition and trigger animation
            card.style.transition = '';
            card.style.animationDelay = `${visibleIndex * 0.03}s`;
            visibleIndex++;

            requestAnimationFrame(() => {
                card.classList.add('card-visible');
            });
        } else {
            card.style.display = 'none';
        }
    });
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

        card.innerHTML = `
            <button class="card-fav-btn ${isSaved ? 'saved' : ''}" onclick="toggleFavorite(${item.id}, this, event)">
                <i class="fas fa-heart"></i>
            </button>
            <img src="${item.images[0]}" class="card-image" loading="lazy" alt="${item.title}">
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

        // Trigger animation after append
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                card.classList.add('card-visible');
            });
        });
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
function setupFilters() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Update UI
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Clear search input when switching filters
            const searchInput = document.getElementById('gallerySearch');
            if (searchInput) searchInput.value = '';

            // Apply Filter (getting from data-filter attribute)
            const filterType = item.getAttribute('data-filter');

            // If all cards rendered, just filter instantly
            if (allCardsRendered) {
                filterCardsCSS(filterType);
            } else {
                // Still loading, re-render with filter
                renderGallery(filterType);
            }
        });
    });
}

// --- Pinterest-style Search ---
function setupSearch() {
    const searchInput = document.getElementById('gallerySearch');
    if (!searchInput) return;

    let debounceTimer;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();

        // Debounce for performance
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            filterBySearch(query);
        }, 200);
    });

    // Clear search on ESC
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            filterBySearch('');
            searchInput.blur();
        }
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

    // Try Supabase Full-Text Search first
    let matchedIds = null;
    if (window.supabaseClient) {
        try {
            const { data, error } = await window.supabaseClient
                .from('prompts')
                .select('id')
                .textSearch('fts', query, {
                    type: 'websearch',
                    config: 'english'
                });

            if (!error && data) {
                matchedIds = new Set(data.map(p => p.id));
                console.log(`🔍 Supabase FTS: Found ${matchedIds.size} results for "${query}"`);
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

        if (matchedIds !== null) {
            // Use Supabase results (ID is 1-indexed in DB, 0-indexed in PROMPTS array)
            isVisible = matchedIds.has(cardId + 1);
        } else {
            // Fallback to local search
            const titleMatch = item.title.toLowerCase().includes(query);
            const tagMatch = item.tags.some(t => t.toLowerCase().includes(query));
            const descMatch = item.description && item.description.toLowerCase().includes(query);
            const promptMatch = item.prompt && item.prompt.toLowerCase().includes(query);
            isVisible = titleMatch || tagMatch || descMatch || promptMatch;
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
