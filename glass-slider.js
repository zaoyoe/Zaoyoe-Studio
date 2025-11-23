/**
 * Dynamic Glass Slider Effect - iOS 26 Liquid Glass Style
 * Ultra-transparent, high-blur glass that doesn't obscure content
 */

class GlassSlider {
    constructor() {
        this.slider = null;
        this.cards = [];
        this.currentCard = null;
        this.isDragging = false;
        this.init();
    }

    init() {
        this.createSlider();
        this.cards = Array.from(document.querySelectorAll('.glass-box'));

        const container = document.querySelector('.bento-container');
        if (container) {
            container.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
            container.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
            container.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
        }
    }

    createSlider() {
        this.slider = document.createElement('div');
        this.slider.className = 'dynamic-glass-slider';
        this.slider.style.cssText = `
            position: fixed;
            width: 0;
            height: 0;
            /* iOS 26 Liquid Glass: ultra-transparent with strong blur */
            background: linear-gradient(135deg, 
                rgba(255, 255, 255, 0.08) 0%, 
                rgba(255, 255, 255, 0.04) 50%,
                rgba(255, 255, 255, 0.02) 100%);
            backdrop-filter: blur(40px) saturate(200%) brightness(1.1);
            -webkit-backdrop-filter: blur(40px) saturate(200%) brightness(1.1);
            border: 1.5px solid rgba(255, 255, 255, 0.25);
            border-radius: 28px;
            pointer-events: none;
            z-index: 999;
            opacity: 0;
            transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 
                0 8px 32px rgba(0, 0, 0, 0.15),
                inset 0 1px 0 rgba(255, 255, 255, 0.5),
                inset 0 -1px 0 rgba(255, 255, 255, 0.15),
                0 0 0 0.5px rgba(255, 255, 255, 0.1);
            transform-origin: center;
            will-change: transform, opacity, left, top, width, height;
            /* Ensure glass doesn't cover icons */
            mix-blend-mode: screen;
        `;

        // Add dynamic light reflection overlay
        const reflection = document.createElement('div');
        reflection.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: radial-gradient(circle at 30% 30%, 
                rgba(255, 255, 255, 0.3) 0%, 
                transparent 60%);
            border-radius: 28px;
            opacity: 0.6;
            pointer-events: none;
        `;
        this.slider.appendChild(reflection);

        document.body.appendChild(this.slider);
    }

    handleTouchStart(e) {
        const touch = e.touches[0];
        const card = this.getCardAtPosition(touch.clientX, touch.clientY);

        if (card) {
            this.isDragging = true;
            this.currentCard = card;

            const rect = card.getBoundingClientRect();
            this.updateSliderPosition(rect);
            this.slider.style.opacity = '1';

            if (navigator.vibrate) {
                navigator.vibrate(8);
            }
        }
    }

    handleTouchMove(e) {
        if (!this.isDragging) return;
        e.preventDefault();

        const touch = e.touches[0];
        const card = this.getCardAtPosition(touch.clientX, touch.clientY);

        if (card) {
            if (card !== this.currentCard) {
                this.currentCard = card;
                if (navigator.vibrate) {
                    navigator.vibrate(4);
                }
            }

            const rect = card.getBoundingClientRect();
            this.updateSliderPosition(rect);
        }
    }

    handleTouchEnd(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.slider.style.opacity = '0';

        if (this.currentCard) {
            setTimeout(() => {
                this.currentCard.click();
            }, 80);

            if (navigator.vibrate) {
                navigator.vibrate([8, 40, 8]);
            }
        }

        this.currentCard = null;
    }

    updateSliderPosition(rect) {
        // Smooth position update without transition for real-time tracking
        this.slider.style.transition = 'opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s ease-out'; // Keep transform transition for potential future effects
        this.slider.style.left = `${rect.left}px`;
        this.slider.style.top = `${rect.top}px`;
        this.slider.style.width = `${rect.width}px`;
        this.slider.style.height = `${rect.height}px`;
    }

    getCardAtPosition(x, y) {
        // Find which card the touch position is over
        for (const card of this.cards) {
            const rect = card.getBoundingClientRect();
            if (
                x >= rect.left &&
                x <= rect.right &&
                y >= rect.top &&
                y <= rect.bottom
            ) {
                return card;
            }
        }
        return null;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new GlassSlider();
    });
} else {
    new GlassSlider();
}
