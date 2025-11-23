/**
 * Dynamic Glass Slider Effect - True Glass Refraction
 * Real glass effect with edge distortion and refraction
 */

class GlassSlider {
    constructor() {
        this.slider = null;
        this.cards = [];
        this.currentCard = null;
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.init();
    }

    init() {
        this.createSVGFilter();
        this.createSlider();
        this.cards = Array.from(document.querySelectorAll('.glass-box'));

        const container = document.querySelector('.bento-container');
        if (container) {
            container.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
            container.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
            container.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: true });
        }
    }

    createSVGFilter() {
        // Create SVG filter for glass refraction effect
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position: absolute; width: 0; height: 0;';
        svg.innerHTML = `
            <defs>
                <filter id="glass-refraction" x="-50%" y="-50%" width="200%" height="200%">
                    <!-- Turbulence for glass texture -->
                    <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" result="noise"/>
                    <!-- Displacement map for refraction -->
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G" result="distorted"/>
                    <!-- Gaussian blur for depth -->
                    <feGaussianBlur in="distorted" stdDeviation="1.5" result="blurred"/>
                    <!-- Merge with original for subtle effect -->
                    <feBlend in="blurred" in2="SourceGraphic" mode="normal"/>
                </filter>
                
                <filter id="edge-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <!-- Edge detection -->
                    <feMorphology operator="dilate" radius="2" in="SourceAlpha" result="dilated"/>
                    <feGaussianBlur in="dilated" stdDeviation="4" result="blurred"/>
                    <feFlood flood-color="rgba(255,255,255,0.6)"/>
                    <feComposite in2="blurred" operator="in" result="glow"/>
                    <feMerge>
                        <feMergeNode in="glow"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
        `;
        document.body.appendChild(svg);
    }

    createSlider() {
        this.slider = document.createElement('div');
        this.slider.className = 'dynamic-glass-slider';
        this.slider.style.cssText = `
            position: fixed;
            width: 0;
            height: 0;
            /* True glass material */
            background: linear-gradient(135deg, 
                rgba(255, 255, 255, 0.12) 0%, 
                rgba(255, 255, 255, 0.06) 50%,
                rgba(255, 255, 255, 0.03) 100%);
            backdrop-filter: blur(30px) saturate(180%) brightness(1.15);
            -webkit-backdrop-filter: blur(30px) saturate(180%) brightness(1.15);
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 32px;
            pointer-events: none;
            z-index: 998;
            opacity: 0;
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 
                0 12px 40px rgba(0, 0, 0, 0.25),
                inset 0 2px 0 rgba(255, 255, 255, 0.6),
                inset 0 -2px 0 rgba(255, 255, 255, 0.2),
                inset 2px 0 0 rgba(255, 255, 255, 0.3),
                inset -2px 0 0 rgba(255, 255, 255, 0.3);
            filter: url(#glass-refraction) url(#edge-glow);
            transform-origin: center;
            will-change: transform, opacity, left, top, width, height;
            /* Edge distortion */
            clip-path: polygon(
                2% 0%, 98% 0%, 100% 2%, 100% 98%, 98% 100%, 2% 100%, 0% 98%, 0% 2%
            );
        `;

        // Inner reflection layer
        const reflection = document.createElement('div');
        reflection.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: radial-gradient(ellipse at 25% 25%, 
                rgba(255, 255, 255, 0.4) 0%, 
                transparent 50%);
            border-radius: 32px;
            opacity: 0.8;
            pointer-events: none;
            mix-blend-mode: overlay;
        `;
        this.slider.appendChild(reflection);

        document.body.appendChild(this.slider);
    }

    handleTouchStart(e) {
        const touch = e.touches[0];
        this.startX = touch.clientX;
        this.startY = touch.clientY;

        const card = this.getCardAtPosition(touch.clientX, touch.clientY);
        if (card) {
            this.currentCard = card;
            const rect = card.getBoundingClientRect();
            this.updateSliderPosition(rect);
            this.slider.style.opacity = '1';

            if (navigator.vibrate) {
                navigator.vibrate(6);
            }
        }
    }

    handleTouchMove(e) {
        const touch = e.touches[0];
        const deltaX = Math.abs(touch.clientX - this.startX);
        const deltaY = Math.abs(touch.clientY - this.startY);

        // Only start dragging if horizontal movement is dominant
        if (deltaX > deltaY && deltaX > 10) {
            this.isDragging = true;
            e.preventDefault(); // Only prevent scroll when actually dragging horizontally
        }

        if (!this.isDragging && this.currentCard) {
            // Vertical scroll detected, hide slider
            this.slider.style.opacity = '0';
            this.currentCard = null;
            return;
        }

        if (this.isDragging) {
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
                this.slider.style.opacity = '1';
            }
        }
    }

    handleTouchEnd(e) {
        if (this.isDragging && this.currentCard) {
            setTimeout(() => {
                this.currentCard.click();
            }, 60);

            if (navigator.vibrate) {
                navigator.vibrate([6, 30, 6]);
            }
        }

        this.isDragging = false;
        this.slider.style.opacity = '0';
        this.currentCard = null;
    }

    updateSliderPosition(rect) {
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
