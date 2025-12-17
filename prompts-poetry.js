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
    initSpotlight();
    renderGallery('all');
    setupFilters();
    setupInfiniteScroll();

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

        // Always load ALL prompts into filtered items
        allFilteredItems = [...PROMPTS];
    }

    loadMoreCards();
}

// Filter cards using CSS display instead of re-rendering
function filterCardsCSS(filter) {
    const cards = document.querySelectorAll('.prompt-card');
    let visibleIndex = 0;

    cards.forEach(card => {
        const cardTags = card.dataset.tags ? card.dataset.tags.split(',') : [];
        if (filter === 'all' || cardTags.includes(filter)) {
            card.style.display = '';
            // Re-trigger animation with stagger
            card.classList.remove('card-visible');
            card.style.animationDelay = `${visibleIndex * 0.03}s`;
            visibleIndex++;

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    card.classList.add('card-visible');
                });
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
        card.style.animationDelay = `${index * 0.05}s`; // Stagger effect
        card.onclick = () => openPromptModal(item.id);

        card.innerHTML = `
            <img src="${item.images[0]}" class="card-image" loading="lazy" alt="${item.title}">
            <div class="card-overlay">
                <div class="card-title">${item.title}</div>
                <div class="card-tags">
                    ${item.tags.map(t => `<span>#${t}</span>`).join('')}
                </div>
            </div>
        `;

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
