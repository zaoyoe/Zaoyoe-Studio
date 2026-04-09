(function () {
    'use strict';

    const notes = {
        desktop: '桌面构图：当留言板区域处于视窗中心时卡片归位，继续滚动会向左右两侧飞散。',
        compact: '紧凑桌面：保留同样的飞散逻辑，但整体横向占用更克制。',
        mobile: '移动预览：移动端先看静态错位双列，重点确认卡片气质和中心标题关系。'
    };

    const body = document.body;
    const note = document.getElementById('previewModeNote');
    const buttons = Array.from(document.querySelectorAll('[data-preview-mode-target]'));
    const frame = document.querySelector('.preview-frame');
    const particleField = document.getElementById('guestbookParticleField');
    const rootStyle = document.documentElement.style;
    let scheduled = false;
    let particlesInitialized = false;
    const particleState = [];
    let particleAnimationFrame = 0;
    let lastParticleFrameTime = 0;
    const particleResetRandom = createSeededRandom(9090909);

    function createSeededRandom(seed) {
        let state = seed >>> 0;
        return function next() {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state / 4294967296;
        };
    }

    function getParticleModeScale() {
        if (body.dataset.previewMode === 'mobile') {
            return 0.56;
        }

        if (body.dataset.previewMode === 'compact') {
            return 0.84;
        }

        return 1;
    }

    function createParticleDescriptor(random, index) {
        const streak = index >= 20;
        const angle = (random() * 360) - 180;
        const minDistance = streak
            ? 90 + (random() * 90)
            : 54 + (random() * 72);
        const maxDistance = streak
            ? 430 + (random() * 150)
            : 340 + (random() * 220);
        const startDistance = minDistance + ((maxDistance - minDistance) * random());

        return {
            angle,
            distance: startDistance,
            minDistance,
            maxDistance,
            speed: streak ? 14 + (random() * 16) : 9 + (random() * 12),
            drift: (random() - 0.5) * (streak ? 0.8 : 0.45),
            phase: random() * Math.PI * 2,
            pulseSpeed: 0.5 + (random() * 0.7),
            tilt: streak ? ((random() - 0.5) * 16) : ((random() - 0.5) * 8),
            opacityBase: streak ? 0.12 + (random() * 0.12) : 0.28 + (random() * 0.42),
            opacityRange: streak ? 0.04 + (random() * 0.04) : 0.06 + (random() * 0.08),
            size: streak ? 2 : 1.4 + (random() * 1.8),
            glow: streak ? 0 : 6 + (random() * 8),
            streak,
            length: streak ? 10 + (random() * 10) : 0,
            thickness: streak ? 1.2 + (random() * 0.9) : 0,
            color: streak
                ? (random() > 0.72 ? 'rgba(245,210,100,0.24)' : 'rgba(255,255,255,0.28)')
                : (random() > 0.82
                    ? 'rgba(245,210,100,0.5)'
                    : random() > 0.6
                        ? 'rgba(192,210,255,0.56)'
                        : 'rgba(255,255,255,0.68)')
        };
    }

    function renderParticle(particle, timeSeconds) {
        const scale = getParticleModeScale();
        const radius = particle.distance * scale;
        const progress = (particle.distance - particle.minDistance) / Math.max(1, particle.maxDistance - particle.minDistance);
        const fadeIn = Math.min(1, progress / 0.22);
        const fadeOut = Math.min(1, (1 - progress) / 0.28);
        const pulse = 0.92 + (Math.sin((timeSeconds * particle.pulseSpeed) + particle.phase) * 0.08);
        const opacity = Math.max(0.02, particle.opacityBase * fadeIn * fadeOut * pulse);
        const tilt = particle.tilt * (0.72 + (progress * 0.28));

        particle.element.style.opacity = opacity.toFixed(3);
        particle.element.style.transform = [
            'translate(-50%, -50%)',
            `rotate(${particle.angle.toFixed(3)}deg)`,
            `translateY(${-radius.toFixed(2)}px)`,
            `rotate(${tilt.toFixed(3)}deg)`
        ].join(' ');
    }

    function resetParticle(particle, random) {
        particle.distance = particle.minDistance + (random() * Math.min(22, particle.maxDistance - particle.minDistance));
        particle.angle += (random() - 0.5) * 26;
        particle.phase = random() * Math.PI * 2;
    }

    function animateParticles(now) {
        if (!particleState.length) {
            particleAnimationFrame = 0;
            return;
        }

        if (!lastParticleFrameTime) {
            lastParticleFrameTime = now;
        }

        const deltaSeconds = Math.min(0.05, (now - lastParticleFrameTime) / 1000);
        lastParticleFrameTime = now;
        const timeSeconds = now / 1000;

        particleState.forEach((particle) => {
            particle.distance += particle.speed * deltaSeconds;
            particle.angle += particle.drift * deltaSeconds * 18;

            if (particle.distance > particle.maxDistance) {
                resetParticle(particle, particleResetRandom);
            }

            renderParticle(particle, timeSeconds);
        });

        particleAnimationFrame = window.requestAnimationFrame(animateParticles);
    }

    function initParticles() {
        if (!particleField || particlesInitialized) {
            return;
        }
        const random = createSeededRandom(20260409);
        const count = 24;

        for (let index = 0; index < count; index += 1) {
            const seed = createParticleDescriptor(random, index);
            const particle = document.createElement('span');
            particle.className = seed.streak ? 'guestbook-particle guestbook-particle--streak' : 'guestbook-particle';
            particle.style.setProperty('--particle-size', String(seed.size || 2));
            particle.style.setProperty('--particle-color', seed.color || 'rgba(255,255,255,0.6)');
            particle.style.setProperty('--particle-glow', String(seed.glow || 10));

            if (seed.streak) {
                particle.style.setProperty('--particle-length', String(seed.length || 10));
                particle.style.setProperty('--particle-thickness', String(seed.thickness || 1.4));
            }

            particleField.appendChild(particle);
            particleState.push({
                ...seed,
                element: particle
            });
        }

        particlesInitialized = true;
        if (!particleAnimationFrame) {
            particleAnimationFrame = window.requestAnimationFrame(animateParticles);
        }
    }

    function applyMode(mode) {
        body.dataset.previewMode = mode;

        buttons.forEach((button) => {
            const active = button.dataset.previewModeTarget === mode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });

        if (note) {
            note.textContent = notes[mode] || notes.desktop;
        }

        updateScrollProgress();
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function updateScrollProgress() {
        if (!frame) {
            return;
        }

        if (body.dataset.previewMode === 'mobile') {
            rootStyle.setProperty('--guestbook-scroll-progress', '0');
            return;
        }

        const rect = frame.getBoundingClientRect();
        const viewportCenter = window.innerHeight / 2;
        const frameCenter = rect.top + (rect.height / 2);
        const distance = Math.abs(frameCenter - viewportCenter);
        const maxDistance = Math.max(window.innerHeight * 0.72, 1);
        const normalized = clamp(distance / maxDistance, 0, 1);
        const easedProgress = Math.pow(normalized, 1.08);
        rootStyle.setProperty('--guestbook-scroll-progress', easedProgress.toFixed(4));
    }

    function scheduleScrollUpdate() {
        if (scheduled) {
            return;
        }

        scheduled = true;
        window.requestAnimationFrame(() => {
            scheduled = false;
            updateScrollProgress();
        });
    }

    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            applyMode(button.dataset.previewModeTarget || 'desktop');
        });
    });

    window.addEventListener('scroll', scheduleScrollUpdate, { passive: true });
    window.addEventListener('resize', updateScrollProgress);

    initParticles();
    applyMode(body.dataset.previewMode || 'desktop');
}());
