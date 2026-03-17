/**
 * Ambient Light System
 * Shared "living background" used by prompt-like pages.
 */
function initAmbientLight() {
    const canvas = document.getElementById('ambientCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationId;
    let blobs = [];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function getConfiguredColors() {
        const selector = canvas.dataset.colorSource;
        if (!selector) {
            return ['#9b5de5', '#8b5cf6', '#a78bfa'];
        }

        const sourceNodes = document.querySelectorAll(selector);
        const colors = [];
        const viewportHeight = window.innerHeight;

        sourceNodes.forEach((node) => {
            const rect = node.getBoundingClientRect();
            if (rect.top >= viewportHeight || rect.bottom <= 0) {
                return;
            }

            const dominantColors = node.dataset.dominantColors;
            if (!dominantColors) {
                return;
            }

            dominantColors
                .split(',')
                .map((color) => color.trim())
                .filter(Boolean)
                .slice(0, 2)
                .forEach((color) => colors.push(color));
        });

        return colors.length > 0 ? colors : ['#9b5de5', '#8b5cf6', '#a78bfa'];
    }

    // Blob class
    class Blob {
        constructor(color) {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.radius = 200 + Math.random() * 300;
            this.color = color;
            this.vx = (Math.random() - 0.5) * 0.3;
            this.vy = (Math.random() - 0.5) * 0.3;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;

            // Bounce off edges
            if (this.x < -this.radius || this.x > canvas.width + this.radius) this.vx *= -1;
            if (this.y < -this.radius || this.y > canvas.height + this.radius) this.vy *= -1;
        }

        draw() {
            const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
            gradient.addColorStop(0, this.hexToRgba(this.color, 0.3));
            gradient.addColorStop(1, this.hexToRgba(this.color, 0));
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }

        hexToRgba(hex, alpha) {
            if (hex.startsWith('rgb')) return hex.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
            const r = parseInt(hex.slice(1, 3), 16) || 155;
            const g = parseInt(hex.slice(3, 5), 16) || 93;
            const b = parseInt(hex.slice(5, 7), 16) || 229;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
    }

    function updateBlobColors() {
        const colors = getConfiguredColors();
        blobs.forEach((blob, index) => {
            blob.color = colors[index % colors.length] || blob.color;
        });
    }

    // Initialize blobs with the same palette used by prompts
    const initialColors = ['#9b5de5', '#8b5cf6', '#a78bfa', '#c4b5fd'];
    for (let i = 0; i < 4; i++) {
        blobs.push(new Blob(initialColors[i % initialColors.length]));
    }

    // Animation loop
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        blobs.forEach(blob => {
            blob.update();
            blob.draw();
        });

        animationId = requestAnimationFrame(animate);
    }

    animate();

    let scrollTimeout;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(updateBlobColors, 100);
    });

    // Allow pages to trigger recoloring after async content arrives.
    window.addEventListener('ambient-light:refresh', updateBlobColors);

    // Initial color update after layout settles.
    setTimeout(updateBlobColors, 1000);

    window.addEventListener('beforeunload', () => {
        if (animationId) {
            cancelAnimationFrame(animationId);
        }
    });
}

// Auto-init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAmbientLight);
} else {
    initAmbientLight();
}
