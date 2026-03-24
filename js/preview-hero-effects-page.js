(function () {
    'use strict';

    let starAnimId = null;

    function showDemo(id, buttonEl = null) {
        document.querySelectorAll('.hero-demo').forEach((element) => element.classList.remove('active'));
        document.querySelectorAll('.preview-nav button').forEach((button) => button.classList.remove('active'));

        document.getElementById(`demo-${id}`)?.classList.add('active');
        if (buttonEl) {
            buttonEl.classList.add('active');
        }

        if (id === 'stars') {
            initStarfield();
        }
    }

    function bindDemoNavigation() {
        const nav = document.querySelector('.preview-nav');
        if (!nav || nav.dataset.demoNavBound === '1') {
            return;
        }

        nav.dataset.demoNavBound = '1';
        nav.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-demo-id]');
            if (!button) {
                return;
            }

            showDemo(button.dataset.demoId, button);
        });
    }

    function initStarfield() {
        const canvas = document.getElementById('starfieldCanvas');
        const section = document.getElementById('demo-stars');
        if (!canvas || !section || starAnimId) {
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = section.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const width = rect.width;
        const height = rect.height;
        const stars = Array(120).fill(null).map(() => ({
            x: Math.random() * width,
            y: Math.random() * height,
            r: 0.5 + Math.random() * 1.5,
            opacity: 0.1 + Math.random() * 0.6,
            twinkleSpeed: 0.002 + Math.random() * 0.008,
            twinklePhase: Math.random() * Math.PI * 2,
            color: Math.random() > 0.3
                ? `rgba(${150 + Math.random() * 105}, ${180 + Math.random() * 75}, 255`
                : `rgba(200, ${160 + Math.random() * 60}, 255`
        }));

        for (let index = 0; index < 8; index += 1) {
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                r: 1.5 + Math.random() * 2,
                opacity: 0.4 + Math.random() * 0.4,
                twinkleSpeed: 0.01 + Math.random() * 0.015,
                twinklePhase: Math.random() * Math.PI * 2,
                color: `rgba(255, 255, ${220 + Math.random() * 35}`,
                isBright: true
            });
        }

        function draw() {
            ctx.clearRect(0, 0, width, height);

            for (const star of stars) {
                star.twinklePhase += star.twinkleSpeed;
                const twinkle = 0.5 + 0.5 * Math.sin(star.twinklePhase);
                const alpha = star.opacity * twinkle;

                ctx.beginPath();
                ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
                ctx.fillStyle = `${star.color}, ${alpha})`;
                ctx.fill();

                if (star.isBright && alpha > 0.3) {
                    ctx.beginPath();
                    ctx.arc(star.x, star.y, star.r * 3, 0, Math.PI * 2);
                    const glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.r * 3);
                    glow.addColorStop(0, `${star.color}, ${alpha * 0.3})`);
                    glow.addColorStop(1, `${star.color}, 0)`);
                    ctx.fillStyle = glow;
                    ctx.fill();
                }
            }

            starAnimId = requestAnimationFrame(draw);
        }

        draw();
    }

    bindDemoNavigation();
}());
