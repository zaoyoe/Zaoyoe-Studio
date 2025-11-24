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

        // Touch Tracking
        this.enterTime = 0;
        this.currentCardEl = null;
        this.scrollStartY = 0;
        this.isScrolling = false;

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
        document.addEventListener('touchstart', (e) => this.handleGlobalStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.handleGlobalMove(e), { passive: false });
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

    handleGlobalStart(e) {
        const touch = e.touches[0];
        this.scrollStartY = touch.clientY;
        this.isScrolling = false;

        this.handleGlobalMove(e); // Trigger initial press
    }

    handleGlobalMove(e) {
        const touch = e.touches[0];

        // Check for vertical scrolling (movement > 20px)
        if (!this.isScrolling) {
            const dy = Math.abs(touch.clientY - this.scrollStartY);
            if (dy > 20) {
                this.isScrolling = true;

                // Cancel all presses immediately if scrolling starts
                this.cards.forEach(c => {
                    c.isPressed = false;
                    c.target = { scale: 1, rotateX: 0, rotateY: 0 };
                });
                return;
            }
        }

        // If scrolling, ignore everything
        if (this.isScrolling) return;

        // --- Sticky Logic Start ---
        // 1. Check if we are already pressing a card
        let activeCard = this.cards.find(c => c.isPressed);
        let cardEl = null;

        // 2. If we have an active card, check if we are still roughly over it (with margin)
        // This prevents the card from "running away" when it shrinks
        if (activeCard) {
            const rect = activeCard.el.getBoundingClientRect();
            const margin = 30; // 30px buffer zone
            const isOver =
                touch.clientX >= rect.left - margin &&
                touch.clientX <= rect.right + margin &&
                touch.clientY >= rect.top - margin &&
                touch.clientY <= rect.bottom + margin;

            if (isOver) {
                cardEl = activeCard.el; // Stick to this card
            }
        }

        // 3. If we lost the active card (moved too far), look for a new one
        if (!cardEl) {
            const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
            cardEl = targetEl ? targetEl.closest('.glass-box') : null;
        }
        // --- Sticky Logic End ---

        // Track entry time for "Time on Target" logic
        if (cardEl !== this.currentCardEl) {
            this.currentCardEl = cardEl;
            this.enterTime = Date.now();
        }

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
        // If we were scrolling, do nothing (don't trigger clicks)
        if (this.isScrolling) {
            this.isScrolling = false;
            return;
        }

        // Check if we are releasing over a pressed card
        this.cards.forEach(c => {
            if (c.isPressed) {
                // Time-based trigger: Only click if we've been on the card for > 150ms
                // Increased from 80ms to 150ms to prevent accidental triggers during scrolling
                const dwellTime = Date.now() - this.enterTime;

                if (dwellTime > 150) {
                    // Create and dispatch a click event
                    const clickEvent = new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    });
                    c.el.dispatchEvent(clickEvent);
                }
            }

            c.isPressed = false;
            c.target = { scale: 1, rotateX: 0, rotateY: 0 };
        });

        this.currentCardEl = null;
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
