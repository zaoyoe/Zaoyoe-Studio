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

/**
 * Dynamic Glass Slider Effect - "Liquid Glass" (CSS Physics Engine)
 * 
 * Core Features:
 * 1. CSS-only rendering (No SVG filters) to eliminate mobile artifacts.
 * 2. Spring physics (LERP) for fluid, organic movement.
 * 3. Velocity-based distortion (stretch/skew) for "jelly" feel.
 * 4. Smart gesture locking (allows vertical scroll, captures horizontal drag).
 */

class GlassSlider {
    constructor() {
        this.slider = null;
        this.cards = [];
        this.activeCard = null;
        this.isActive = false;

        // Physics state
        this.targetState = { x: 0, y: 0, w: 0, h: 0, opacity: 0 };
        this.currentState = { x: 0, y: 0, w: 0, h: 0, opacity: 0 };
        this.velocity = { x: 0, y: 0 };

        // Touch tracking
        this.touchStart = { x: 0, y: 0 };
        this.isDragging = false;
        this.isScrolling = false;

        // Configuration
        this.config = {
            lerp: 0.15, // Fluidity (lower = more sluggish/liquid)
            distortion: 0.05, // Amount of stretch when moving
            snapThreshold: 50 // Distance to snap to card
        };

        this.rafId = null;
        this.init();
    }

    init() {
        // Clean up any existing sliders
        const existing = document.querySelector('.liquid-glass-cursor');
        if (existing) existing.remove();

        this.createSlider();
        this.cards = Array.from(document.querySelectorAll('.glass-box'));

        const container = document.querySelector('.bento-container');
        if (container) {
            // Use passive: false to allow e.preventDefault()
            container.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
            container.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
            container.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });
        }

        // Start render loop
        this.animate();
    }

    createSlider() {
        this.slider = document.createElement('div');
        this.slider.className = 'liquid-glass-cursor';
        this.slider.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 999;
            border-radius: 24px;
            
            /* The "Liquid Glass" Material */
            background: linear-gradient(145deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05));
            backdrop-filter: blur(25px) saturate(180%) brightness(1.2);
            -webkit-backdrop-filter: blur(25px) saturate(180%) brightness(1.2);
            
            /* Glass Edges & Depth */
            border: 1px solid rgba(255, 255, 255, 0.3);
            box-shadow: 
                0 8px 32px rgba(0, 0, 0, 0.1),
                inset 0 0 0 1px rgba(255, 255, 255, 0.2),
                inset 0 0 20px rgba(255, 255, 255, 0.1);
                
            /* Performance Optimization */
            will-change: transform, width, height, opacity;
            transform-origin: center center;
            opacity: 0;
        `;

        // Add a "shine" element for extra realism
        const shine = document.createElement('div');
        shine.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 24px;
            background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.4) 50%, transparent 70%);
            opacity: 0.3;
            mix-blend-mode: overlay;
        `;
        this.slider.appendChild(shine);

        document.body.appendChild(this.slider);
    }

    onTouchStart(e) {
        const touch = e.touches[0];
        this.touchStart.x = touch.clientX;
        this.touchStart.y = touch.clientY;
        this.isDragging = false;
        this.isScrolling = false;

        // Check if we started on a card
        const card = this.getCardAt(touch.clientX, touch.clientY);
        if (card) {
            this.activeCard = card;
            this.isActive = true;
            this.updateTargetFromCard(card);

            // Immediate visual feedback (optional, but physics handles it better)
            // this.currentState = { ...this.targetState }; 
        }
    }

    onTouchMove(e) {
        if (this.isScrolling) return; // Let native scroll handle it

        const touch = e.touches[0];
        const dx = touch.clientX - this.touchStart.x;
        const dy = touch.clientY - this.touchStart.y;

        // Gesture Locking Logic
        if (!this.isDragging) {
            if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 5) {
                this.isScrolling = true;
                this.isActive = false; // Hide glass when scrolling
                return;
            }
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
                this.isDragging = true;
                e.preventDefault(); // Lock scroll
            }
        } else {
            e.preventDefault(); // Continue locking scroll
        }

        if (this.isDragging) {
            // Find card under finger
            const card = this.getCardAt(touch.clientX, touch.clientY);
            if (card) {
                this.activeCard = card;
                this.updateTargetFromCard(card);
                this.isActive = true;

                // Haptic feedback on card change
                if (this.lastHapticCard !== card) {
                    if (navigator.vibrate) navigator.vibrate(5);
                    this.lastHapticCard = card;
                }
            } else {
                // Finger is between cards - optional: stick to last card or fade out?
                // Let's stick to last card but maybe fade slightly? 
                // For now, keep active to prevent flickering
            }
        }
    }

    onTouchEnd(e) {
        if (this.isDragging && this.activeCard) {
            // Trigger click
            this.activeCard.click();
            if (navigator.vibrate) navigator.vibrate(10);
        }

        this.isActive = false;
        this.isDragging = false;
        this.isScrolling = false;
        this.lastHapticCard = null;
    }

    updateTargetFromCard(card) {
        const rect = card.getBoundingClientRect();
        this.targetState.x = rect.left;
        this.targetState.y = rect.top;
        this.targetState.w = rect.width;
        this.targetState.h = rect.height;
        this.targetState.opacity = 1;
    }

    getCardAt(x, y) {
        return this.cards.find(card => {
            const rect = card.getBoundingClientRect();
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        });
    }

    // Physics Loop
    animate() {
        // Linear Interpolation (LERP) for smooth following
        const lerp = (start, end, factor) => start + (end - start) * factor;

        if (this.isActive) {
            // Move current state towards target state
            this.currentState.x = lerp(this.currentState.x, this.targetState.x, this.config.lerp);
            this.currentState.y = lerp(this.currentState.y, this.targetState.y, this.config.lerp);
            this.currentState.w = lerp(this.currentState.w, this.targetState.w, this.config.lerp);
            this.currentState.h = lerp(this.currentState.h, this.targetState.h, this.config.lerp);
            this.currentState.opacity = lerp(this.currentState.opacity, 1, 0.2);
        } else {
            this.currentState.opacity = lerp(this.currentState.opacity, 0, 0.2);
        }

        // Calculate velocity for distortion effect
        const vx = this.targetState.x - this.currentState.x;
        const vy = this.targetState.y - this.currentState.y;

        // Apply transforms
        // Translate: Position
        // Scale: Stretch based on velocity (Jelly effect)
        // Skew: Tilt based on velocity

        const stretchX = 1 + Math.abs(vx) * 0.002;
        const stretchY = 1 - Math.abs(vx) * 0.001; // Squash Y when stretching X
        const skewX = vx * -0.05; // Tilt

        // Only render if visible
        if (this.currentState.opacity > 0.01) {
            this.slider.style.transform = `
                translate3d(${this.currentState.x}px, ${this.currentState.y}px, 0) 
                scale(${stretchX}, ${stretchY})
                skewX(${skewX}deg)
            `;
            this.slider.style.width = `${this.currentState.w}px`;
            this.slider.style.height = `${this.currentState.h}px`;
            this.slider.style.opacity = this.currentState.opacity;
        } else {
            this.slider.style.opacity = 0;
        }

        this.rafId = requestAnimationFrame(this.animate.bind(this));
    }
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new GlassSlider());
} else {
    new GlassSlider();
}
