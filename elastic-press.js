/**
 * Elastic Press Effect - "Fluid Spring Physics"
 * 
 * Implements a spring-mass system for organic, fluid card interactions.
 * Replaces the linear CSS transitions with real-time physics.
 * 
 * UPDATED: Supports "slide-over" interaction (touchmove triggers press).
 */

class ElasticPress {
    constructor() {
        this.cards = [];
        this.activeCard = null;
        this.rafId = null;

        // Physics Configuration (Spring System)
        this.config = {
            stiffness: 0.15, // Spring tension (higher = snappier)
            damping: 0.8,    // Friction (lower = more wobble)
            mass: 1.0,       // Weight
            scaleTarget: 0.95, // How much to shrink on press
            tiltMax: 5       // Max tilt angle in degrees
        };

        this.init();
    }

    init() {
        // Map all cards
        this.cards = Array.from(document.querySelectorAll('.glass-box')).map(el => ({
            el: el,
            // Physics State
            current: { scale: 1, rotateX: 0, rotateY: 0 },
            target: { scale: 1, rotateX: 0, rotateY: 0 },
            velocity: { scale: 0, rotateX: 0, rotateY: 0 },
            // Interaction State
            isPressed: false
        }));

        // Global Touch Events (to handle sliding between cards)
        document.addEventListener('touchstart', (e) => this.handleGlobalTouch(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.handleGlobalTouch(e), { passive: false });
        document.addEventListener('touchend', (e) => this.handleGlobalEnd(e), { passive: false });
        document.addEventListener('touchcancel', (e) => this.handleGlobalEnd(e), { passive: false });

        // Mouse events (keep local for simplicity on desktop)
        this.cards.forEach(card => {
            card.el.addEventListener('mousedown', (e) => this.handleStart(e, card));
            card.el.addEventListener('mousemove', (e) => this.handleMove(e, card));
            card.el.addEventListener('mouseup', (e) => this.handleEnd(e, card));
            card.el.addEventListener('mouseleave', (e) => this.handleEnd(e, card));
        });

        // Start Physics Loop
        this.animate();
    }

    // --- Global Touch Logic ---

    handleGlobalTouch(e) {
        // Find which card is under the finger
        const touch = e.touches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);

        // Find closest .glass-box parent
        const cardEl = targetEl ? targetEl.closest('.glass-box') : null;

        // Reset all cards first (if we moved off a card)
        this.cards.forEach(c => {
            if (c.el !== cardEl) {
                c.isPressed = false;
                c.target = { scale: 1, rotateX: 0, rotateY: 0 };
            }
        });

        // If we are over a card, trigger its press state
        if (cardEl) {
            const card = this.cards.find(c => c.el === cardEl);
            if (card) {
                card.isPressed = true;
                this.updateTarget(touch, card); // Pass touch object directly
            }
        }
    }

    handleGlobalEnd(e) {
        // Release all cards
        this.cards.forEach(c => {
            c.isPressed = false;
            c.target = { scale: 1, rotateX: 0, rotateY: 0 };
        });
    }

    // --- Mouse Logic (Legacy/Desktop) ---

    handleStart(e, card) {
        card.isPressed = true;
        this.updateTarget(e, card);
    }

    handleMove(e, card) {
        if (!card.isPressed) return;
        this.updateTarget(e, card);
    }

    handleEnd(e, card) {
        card.isPressed = false;
        card.target = { scale: 1, rotateX: 0, rotateY: 0 };
    }

    // --- Physics Core ---

    updateTarget(input, card) {
        // input can be Event or Touch object
        const clientX = input.clientX;
        const clientY = input.clientY;

        const rect = card.el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Calculate distance from center (-1 to 1)
        const percentX = (clientX - centerX) / (rect.width / 2);
        const percentY = (clientY - centerY) / (rect.height / 2);

        // Clamp values
        const clamp = (num, min, max) => Math.min(Math.max(num, min), max);
        const pX = clamp(percentX, -1, 1);
        const pY = clamp(percentY, -1, 1);

        card.target.scale = this.config.scaleTarget;
        card.target.rotateX = -pY * this.config.tiltMax; // Invert Y for correct tilt
        card.target.rotateY = pX * this.config.tiltMax;
    }

    // Spring Solver
    spring(current, target, velocity) {
        const force = (target - current) * this.config.stiffness;
        const acceleration = force / this.config.mass;
        velocity = (velocity + acceleration) * this.config.damping;
        current += velocity;
        return { current, velocity };
    }

    animate() {
        let isAnimating = false;

        this.cards.forEach(card => {
            // Apply spring physics to each property
            const s = this.spring(card.current.scale, card.target.scale, card.velocity.scale);
            card.current.scale = s.current;
            card.velocity.scale = s.velocity;

            const rx = this.spring(card.current.rotateX, card.target.rotateX, card.velocity.rotateX);
            card.current.rotateX = rx.current;
            card.velocity.rotateX = rx.velocity;

            const ry = this.spring(card.current.rotateY, card.target.rotateY, card.velocity.rotateY);
            card.current.rotateY = ry.current;
            card.velocity.rotateY = ry.velocity;

            // Check if we need to continue animating (threshold check)
            if (
                Math.abs(card.target.scale - card.current.scale) > 0.001 ||
                Math.abs(card.velocity.scale) > 0.001 ||
                card.isPressed
            ) {
                isAnimating = true;

                // Apply transform
                card.el.style.transform = `
                    perspective(1000px)
                    scale(${card.current.scale})
                    rotateX(${card.current.rotateX}deg)
                    rotateY(${card.current.rotateY}deg)
                `;
            }
        });

        // Always run loop to catch interactions
        this.rafId = requestAnimationFrame(this.animate.bind(this));
    }
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new ElasticPress());
} else {
    new ElasticPress();
}
