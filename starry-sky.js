/**
 * Starry Sky Animation System
 * Extracted from prompts-poetry.js for shared use across pages
 * Only renders in dark mode via CSS visibility
 */

// ========================================
// STARRY SKY (Dark Mode Embellishment)
// ========================================
function initStarrySky() {
    const canvas = document.getElementById('starryCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let stars = [];
    let shootingStars = [];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        initStars();
    }

    class Star {
        constructor() {
            this.reset();
        }

        reset() {
            // Random position - concentrated at top
            if (Math.random() < 0.75) {
                this.y = Math.random() * (canvas.height * 0.35);
            } else {
                this.y = Math.random() * canvas.height * 0.6;
            }
            this.x = Math.random() * canvas.width;

            // Size
            this.size = Math.random() * 1.2 + 0.4;

            // Lifecycle: each star fades in, stays, fades out, then waits
            this.maxAlpha = Math.random() * 0.5 + 0.3;
            this.currentAlpha = 0;
            this.phase = 'waiting'; // waiting, fadingIn, visible, fadingOut
            this.waitTime = Math.random() * 8000 + 2000; // 2-10 seconds wait
            this.fadeSpeed = Math.random() * 0.008 + 0.003;
            this.visibleDuration = Math.random() * 4000 + 2000; // 2-6 seconds visible
            this.timer = 0;
            this.lastTime = performance.now();
        }

        update() {
            const now = performance.now();
            const delta = now - this.lastTime;
            this.lastTime = now;
            this.timer += delta;

            switch (this.phase) {
                case 'waiting':
                    if (this.timer >= this.waitTime) {
                        this.phase = 'fadingIn';
                        this.timer = 0;
                    }
                    break;
                case 'fadingIn':
                    this.currentAlpha += this.fadeSpeed;
                    if (this.currentAlpha >= this.maxAlpha) {
                        this.currentAlpha = this.maxAlpha;
                        this.phase = 'visible';
                        this.timer = 0;
                    }
                    break;
                case 'visible':
                    // Slight twinkle while visible
                    this.currentAlpha = this.maxAlpha * (0.85 + Math.sin(this.timer * 0.002) * 0.15);
                    if (this.timer >= this.visibleDuration) {
                        this.phase = 'fadingOut';
                    }
                    break;
                case 'fadingOut':
                    this.currentAlpha -= this.fadeSpeed;
                    if (this.currentAlpha <= 0) {
                        this.currentAlpha = 0;
                        this.reset(); // Relocate and restart cycle
                    }
                    break;
            }
        }

        draw() {
            if (this.currentAlpha <= 0) return;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${this.currentAlpha})`;
            ctx.fill();
        }
    }

    class ShootingStar {
        constructor() {
            this.reset();
        }

        reset() {
            this.active = false;
            this.x = 0;
            this.y = 0;
            this.length = 0;
            this.speed = 0;
            this.angle = 0;
            this.alpha = 0;
        }

        spawn() {
            this.active = true;
            this.x = Math.random() * canvas.width * 0.8;
            this.y = Math.random() * canvas.height * 0.3;
            this.length = Math.random() * 80 + 40;
            this.speed = Math.random() * 8 + 6;
            this.angle = Math.PI / 4 + (Math.random() - 0.5) * 0.3; // ~45 degrees with variation
            this.alpha = 1;
        }

        update() {
            if (!this.active) return;
            this.x += Math.cos(this.angle) * this.speed;
            this.y += Math.sin(this.angle) * this.speed;
            this.alpha -= 0.015;
            if (this.alpha <= 0 || this.x > canvas.width || this.y > canvas.height) {
                this.reset();
            }
        }

        draw() {
            if (!this.active || this.alpha <= 0) return;
            const tailX = this.x - Math.cos(this.angle) * this.length;
            const tailY = this.y - Math.sin(this.angle) * this.length;

            const gradient = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
            gradient.addColorStop(0, `rgba(255, 255, 255, 0)`);
            gradient.addColorStop(1, `rgba(255, 255, 255, ${this.alpha})`);

            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(this.x, this.y);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    function initStars() {
        stars = [];
        // Fewer stars - around 30-50 total
        const starCount = Math.floor((canvas.width * canvas.height) / 40000) + 15;
        for (let i = 0; i < starCount; i++) {
            const star = new Star();
            // Stagger initial timers so they don't all sync up
            star.timer = Math.random() * star.waitTime;
            stars.push(star);
        }

        shootingStars = [new ShootingStar(), new ShootingStar()];
    }

    // Spawn shooting star occasionally
    function maybeSpawnShootingStar() {
        if (Math.random() < 0.0008) { // ~1 every 20 seconds at 60fps
            const inactive = shootingStars.find(s => !s.active);
            if (inactive) inactive.spawn();
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        stars.forEach(star => {
            star.update();
            star.draw();
        });

        maybeSpawnShootingStar();
        shootingStars.forEach(ss => {
            ss.update();
            ss.draw();
        });

        requestAnimationFrame(animate);
    }

    window.addEventListener('resize', resize);
    resize();
    animate();
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStarrySky);
} else {
    initStarrySky();
}
