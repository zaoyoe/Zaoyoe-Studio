console.log('Liquid Glass Script Loaded');

/**
 * Dynamic Glass Slider Effect - "Prismatic Liquid Glass"
 * 
 * Core Features:
 * 1. CSS-only rendering with "Prism" edge effects (Chromatic Aberration).
 * 2. High-viscosity physics for "heavy liquid" feel.
 * 3. Velocity-based distortion with extreme elasticity.
 * 4. Smart gesture locking.
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
            lerp: 0.08, // Slightly higher than 0.06 for better responsiveness but still "heavy"
            distortion: 0.25, // Extreme stretch (was 0.15)
            skew: 0.15 // Extreme tilt (was 0.08)
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
            
            /* 1. The Glass Body (Ultra Clear) */
            background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01));
            backdrop-filter: blur(15px) brightness(1.2);
            -webkit-backdrop-filter: blur(15px) brightness(1.2);
            
            /* 2. The Prism Edges (Chromatic Aberration) */
            /* This simulates the rainbow refraction seen in the reference */
            box-shadow: 
                /* Inner Volume Glow */
                inset 0 0 20px rgba(255, 255, 255, 0.3),
                inset 0 0 2px rgba(255, 255, 255, 0.5),
                
                /* Outer Prism Glow (Cyan/Magenta shift) */
                -2px 0 8px rgba(0, 255, 255, 0.15), /* Cyan Left */
                2px 0 8px rgba(255, 0, 255, 0.15),  /* Magenta Right */
                0 4px 20px rgba(0, 0, 0, 0.15);     /* Drop Shadow */
                
            /* 3. Glass Border */
            border: 1px solid rgba(255, 255, 255, 0.4);
            
            /* Blend Mode */
            mix-blend-mode: normal; /* Changed from plus-lighter to allow shadows to work better */

            /* Performance Optimization */
            will-change: transform, width, height, opacity;
            transform-origin: center center;
            opacity: 0;
        `;

        // Add a "Lens Reflection" element
        const lens = document.createElement('div');
        lens.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 24px;
            /* Specular Highlight */
            background: radial-gradient(circle at 50% 0%, rgba(255,255,255,0.4) 0%, transparent 60%);
            opacity: 0.6;
            mix-blend-mode: overlay;
            pointer-events: none;
        `;
        this.slider.appendChild(lens);

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

            // Reset state to target immediately on start
            this.currentState = { ...this.targetState, opacity: 0 };
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
            this.currentState.opacity = lerp(this.currentState.opacity, 1, 0.15);
        } else {
            this.currentState.opacity = lerp(this.currentState.opacity, 0, 0.15);
        }

        // Calculate velocity for distortion effect
        const vx = this.targetState.x - this.currentState.x;
        // const vy = this.targetState.y - this.currentState.y;

        // Apply transforms
        // Scale: Stretch based on velocity (Jelly effect)
        // Skew: Tilt based on velocity

        // Enhanced distortion calculation
        const velocityFactor = Math.abs(vx);
        const stretchX = 1 + velocityFactor * 0.006; // More stretch (was 0.004)
        const stretchY = 1 - velocityFactor * 0.003; // More squash (was 0.002)
        const skewX = vx * -0.15; // More tilt (was -0.1)

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
