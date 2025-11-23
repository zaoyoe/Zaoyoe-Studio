/**
 * Dynamic Glass Slider Effect
 * Creates an iOS-style interactive glass element that follows touch gestures
 */

class GlassSlider {
    constructor() {
        this.slider = null;
        this.cards = [];
        this.currentCard = null;
        this.isDragging = false;
        this.touchStartY = 0;
        this.init();
    }

    init() {
        // Create the glass slider element
        this.createSlider();

        // Get all interactive cards
        this.cards = Array.from(document.querySelectorAll('.glass-box'));

        // Add touch event listeners to the container
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
            background: radial-gradient(circle at center, 
                rgba(255, 255, 255, 0.3) 0%, 
                rgba(255, 255, 255, 0.15) 50%, 
                rgba(255, 255, 255, 0.05) 100%);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 24px;
            pointer-events: none;
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.2s ease, width 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            box-shadow: 
                0 8px 32px rgba(0, 0, 0, 0.2),
                inset 0 1px 0 rgba(255, 255, 255, 0.4),
                inset 0 -1px 0 rgba(255, 255, 255, 0.1);
            transform-origin: center;
            will-change: transform, opacity;
        `;
        document.body.appendChild(this.slider);
    }

    handleTouchStart(e) {
        const touch = e.touches[0];
        this.touchStartY = touch.clientY;

        // Find if touch started on a card
        const card = this.getCardAtPosition(touch.clientX, touch.clientY);
        if (card) {
            this.isDragging = true;
            this.currentCard = card;

            // Show slider at touch position
            const rect = card.getBoundingClientRect();
            this.slider.style.left = `${rect.left}px`;
            this.slider.style.top = `${rect.top}px`;
            this.slider.style.width = `${rect.width}px`;
            this.slider.style.height = `${rect.height}px`;
            this.slider.style.opacity = '1';

            // Add haptic feedback if available
            if (navigator.vibrate) {
                navigator.vibrate(10);
            }
        }
    }

    handleTouchMove(e) {
        if (!this.isDragging) return;

        e.preventDefault(); // Prevent scrolling while dragging

        const touch = e.touches[0];
        const card = this.getCardAtPosition(touch.clientX, touch.clientY);

        if (card && card !== this.currentCard) {
            // Switched to a new card
            this.currentCard = card;
            const rect = card.getBoundingClientRect();

            // Animate to new card position
            this.slider.style.left = `${rect.left}px`;
            this.slider.style.top = `${rect.top}px`;
            this.slider.style.width = `${rect.width}px`;
            this.slider.style.height = `${rect.height}px`;

            // Add distortion effect
            const distortion = Math.sin(Date.now() / 200) * 2;
            this.slider.style.transform = `scale(${1 + distortion * 0.01}) rotate(${distortion * 0.5}deg)`;

            // Haptic feedback
            if (navigator.vibrate) {
                navigator.vibrate(5);
            }
        } else if (card) {
            // Still on the same card, update position smoothly
            const rect = card.getBoundingClientRect();
            this.slider.style.left = `${rect.left}px`;
            this.slider.style.top = `${rect.top}px`;
        }
    }

    handleTouchEnd(e) {
        if (!this.isDragging) return;

        this.isDragging = false;

        // Hide slider with animation
        this.slider.style.opacity = '0';
        this.slider.style.transform = 'scale(0.95)';

        // Trigger the card action if we're on a valid card
        if (this.currentCard) {
            // Add a slight delay for visual feedback
            setTimeout(() => {
                this.currentCard.click();

                // Reset slider transform
                this.slider.style.transform = 'scale(1)';
            }, 100);

            // Strong haptic feedback for activation
            if (navigator.vibrate) {
                navigator.vibrate([10, 50, 10]);
            }
        }

        this.currentCard = null;
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
