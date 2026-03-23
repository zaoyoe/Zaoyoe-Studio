/**
 * Announcement Loader - Standalone script for pages other than prompts.html
 * This script loads system announcements with full support for banners, modals, and toasts.
 * Version: 2026020301
 */

(function () {
    'use strict';

    let currentAnnouncementElement = null;
    let announcementOwnsScrollLock = false;
    let announcementOverflowRestore = null;

    function lockAnnouncementBackground(lockTarget) {
        if (announcementOwnsScrollLock) return;
        if (window.iOSScrollLock?.isLocked) return;

        announcementOwnsScrollLock = true;
        announcementOverflowRestore = {
            htmlOverflow: document.documentElement.style.overflow,
            bodyOverflow: document.body.style.overflow
        };

        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';

        if (window.iOSScrollLock) {
            window.iOSScrollLock.lockLight(lockTarget);
        }
    }

    function unlockAnnouncementBackground() {
        if (!announcementOwnsScrollLock) return;

        if (window.iOSScrollLock?.isLocked) {
            window.iOSScrollLock.unlock();
        }

        if (announcementOverflowRestore) {
            document.documentElement.style.overflow = announcementOverflowRestore.htmlOverflow;
            document.body.style.overflow = announcementOverflowRestore.bodyOverflow;
        } else {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
        }

        announcementOverflowRestore = null;
        announcementOwnsScrollLock = false;
    }

    function clearCurrentAnnouncement() {
        ParticleSystem.stop();

        if (currentAnnouncementElement) {
            currentAnnouncementElement.remove();
            currentAnnouncementElement = null;
        }

        unlockAnnouncementBackground();
    }

    function dismissAnnouncement(element, ackKey, acknowledged = true) {
        if (acknowledged && ackKey) {
            localStorage.setItem(ackKey, 'true');
        }

        ParticleSystem.stop();

        if (element === currentAnnouncementElement) {
            currentAnnouncementElement = null;
        }

        element.remove();
        unlockAnnouncementBackground();
    }

    // Get current page ID for announcement targeting
    function getCurrentPageId() {
        const path = window.location.pathname.toLowerCase();
        if (path.includes('prompts')) return 'prompts';
        if (path.includes('shop')) return 'shop';
        if (path.includes('verify')) return 'verify';
        if (path.includes('guestbook')) return 'guestbook';
        if (path === '/' || path.includes('index') || path.endsWith('/')) return 'index';
        return 'unknown';
    }

    // Main announcement loading function
    async function loadAnnouncement() {
        console.log('📢 [Loader] loadAnnouncement() 开始执行...');

        if (!window.supabaseClient) {
            console.warn('📢 [Loader] Supabase client 不可用, 等待初始化...');
            // Wait for Supabase to initialize
            setTimeout(loadAnnouncement, 500);
            return;
        }

        try {
            const { data, error } = await window.supabaseClient.rpc('get_system_config', { p_key: 'notifications' });

            if (error) {
                console.error('📢 [Loader] 获取配置出错:', error);
                return;
            }

            if (!data) {
                console.warn('📢 [Loader] notifications 配置不存在');
                return;
            }

            const config = data;

            // Check if current page is in target pages
            const targetPages = config.announcement_pages || ['all'];
            const currentPage = getCurrentPageId();
            console.log('📢 [Loader] 目标页面:', targetPages, '当前页面:', currentPage);

            if (!targetPages.includes('all') && !targetPages.includes(currentPage)) {
                console.log('📢 [Loader] 当前页面不在公告目标页面中，跳过显示');
                return;
            }

            if (config.announcement_enabled && config.announcement_content) {
                const type = config.announcement_type || 'banner';
                const color = config.announcement_color || 'purple';
                const size = config.announcement_size || 'medium';
                const content = config.announcement_content.replace(/\n/g, '<br>');

                // Generate unique ackKey using content hash + timestamp
                const contentForHash = (config.announcement_content || '') + '|' + (config.announcement_updated_at || '');
                let hash = 0;
                for (let i = 0; i < contentForHash.length; i++) {
                    const char = contentForHash.charCodeAt(i);
                    hash = ((hash << 5) - hash) + char;
                    hash = hash & hash;
                }
                const ackKey = 'announcement_acked_' + Math.abs(hash).toString(36);

                if (localStorage.getItem(ackKey)) {
                    console.log('📢 [Loader] 该公告已被用户确认');
                    return;
                }

                const decoration = config.announcement_decoration || 'none';
                showAnnouncement(type, color, size, content, ackKey, decoration);
                console.log('📢 [Loader] 公告已显示:', type, color, size);
            }
        } catch (err) {
            console.error('📢 [Loader] 加载公告失败:', err);
        }
    }

    function showAnnouncement(type, color, size, content, ackKey, decoration) {
        if (currentAnnouncementElement) {
            clearCurrentAnnouncement();
        }

        if (type === 'banner') {
            showBannerAnnouncement(color, size, content, ackKey, decoration);
        } else if (type === 'modal') {
            showModalAnnouncement(color, size, content, ackKey, decoration);
        } else if (type === 'toast') {
            showToastAnnouncement(color, size, content, ackKey, decoration);
        }
    }

    // Inject required CSS if not already present
    function injectAnnouncementStyles() {
        if (document.getElementById('announcement-loader-styles')) return;

        const style = document.createElement('style');
        style.id = 'announcement-loader-styles';
        style.textContent = `
            /* Announcement Modal */
            .announcement-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(8px);
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.3s ease;
            }
            
            .announcement-modal {
                /* 半透明背景，让粒子能透过 */
                background: rgba(30, 41, 59, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                width: 90%;
                max-width: 480px;
                box-shadow: 0 25px 60px rgba(0, 0, 0, 0.5);
                animation: modalPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
                overflow: hidden;
                position: relative;
            }
            
            .announcement-header {
                padding: 20px 24px 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                position: relative;
                z-index: 10;
            }
            
            .announcement-header i {
                font-size: 1.3rem;
                color: #6b9ece;
            }
            
            .announcement-title {
                font-size: 1.15rem;
                font-weight: 600;
                color: #fff;
            }
            
            .announcement-body {
                padding: 16px 24px 24px;
                position: relative;
                z-index: 10;
            }
            
            /* 磨砂玻璃效果 - 内容区域 */
            .announcement-text {
                background: rgba(30, 41, 59, 0.35);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 12px;
                padding: 16px;
                color: rgba(255, 255, 255, 0.9);
                font-size: 0.9rem;
                line-height: 1.6;
                max-height: 300px;
                overflow-y: auto;
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1);
            }
            
            .announcement-text a {
                color: #6b9ece;
                text-decoration: underline;
            }
            
            .announcement-footer {
                padding: 16px 24px 20px;
                display: flex;
                justify-content: center;
                position: relative;
                z-index: 10;
            }
            
            /* 磨砂玻璃按钮 */
            .announcement-ack-btn {
                padding: 10px 36px;
                background: rgba(255, 255, 255, 0.15);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.25);
                border-radius: 12px;
                color: #fff;
                font-size: 0.9rem;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.3s;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
            
            .announcement-ack-btn:hover {
                background: rgba(255, 255, 255, 0.25);
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }
            
            /* Banner Style */
            .announcement-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                /* 半透明背景，让粒子能透过 */
                background: rgba(30, 41, 59, 0.85);
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding: 12px 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 16px;
                z-index: 99998;
                animation: slideDown 0.4s ease;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                overflow: hidden;
            }
            
            .announcement-banner .announcement-text {
                color: rgba(255, 255, 255, 0.9);
                font-size: 0.9rem;
                position: relative;
                z-index: 10;
            }
            
            .announcement-banner .announcement-close {
                background: rgba(255, 255, 255, 0.1);
                border: none;
                color: #fff;
                padding: 6px 12px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.85rem;
                position: relative;
                z-index: 10;
            }
            
            /* Toast Style */
            .announcement-toast {
                position: fixed;
                bottom: 24px;
                right: 24px;
                /* 半透明背景，让粒子能透过 */
                background: rgba(30, 41, 59, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                width: 320px;
                max-width: calc(100vw - 48px);
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
                z-index: 99997;
                animation: slideUp 0.4s ease;
                overflow: hidden;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            @keyframes modalPop {
                from {
                    opacity: 0;
                    transform: scale(0.9) translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }
            
            @keyframes slideDown {
                from { transform: translateY(-100%); }
                to { transform: translateY(0); }
            }
            
            @keyframes slideUp {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @media (max-width: 768px) {
                .announcement-modal {
                    width: 95%;
                }

                .announcement-modal .announcement-header {
                    padding-top: 21px;
                    padding-bottom: 17px;
                }

                .announcement-modal .announcement-body {
                    padding-top: 17px;
                    padding-bottom: 25px;
                }

                .announcement-modal .announcement-text {
                    padding-top: 17px;
                    padding-bottom: 17px;
                    max-height: 317px;
                }

                .announcement-modal .announcement-footer {
                    padding-top: 17px;
                    padding-bottom: 21px;
                }

                .announcement-modal .announcement-ack-btn {
                    padding-top: 11px;
                    padding-bottom: 11px;
                }
            }
            
            /* ========================================
               Decoration Particles (from prompts-poetry.css)
               ======================================== */
            .decoration-particles {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
                z-index: 0;
                border-radius: inherit;
                pointer-events: none !important;
                user-select: none !important;
            }
            
            .decoration-particle {
                position: absolute;
                display: block;
                line-height: 1;
                pointer-events: none !important;
                animation-iteration-count: infinite;
                animation-timing-function: linear;
            }
            
            .decoration-particles.snow .decoration-particle {
                animation-name: particle-fall;
                animation-duration: 10s;
            }
            
            .decoration-particles.sakura .decoration-particle {
                animation-name: particle-fall-sway;
                animation-duration: 12s;
            }
            
            .decoration-particles.hearts .decoration-particle {
                animation-name: particle-float-up;
                animation-duration: 10s;
            }
            
            .decoration-particles.leaves .decoration-particle {
                animation-name: particle-fall-spin;
                animation-duration: 11s;
            }
            
            /* Rain streak effect */
            .decoration-particles.rain {
                background: linear-gradient(180deg, transparent 0%, rgba(70, 130, 180, 0.03) 100%);
            }
            
            .decoration-particles.rain .rain-streak {
                position: absolute;
                width: 2px;
                background: linear-gradient(to bottom, transparent, rgba(70, 130, 180, 0.6));
                border-radius: 0 0 2px 2px;
                pointer-events: none;
                animation: rain-fall linear infinite;
            }
            
            .decoration-particles.rain .rain-splash {
                position: absolute;
                bottom: 0;
                width: 4px;
                height: 4px;
                border-radius: 50%;
                background: rgba(70, 130, 180, 0.6);
                pointer-events: none;
                animation: rain-splash 0.4s ease-out forwards;
                opacity: 0;
            }
            
            @keyframes rain-fall {
                0% { 
                    transform: translateY(-100px);
                    opacity: 0;
                }
                5% {
                    opacity: 0.7;
                }
                95% {
                    opacity: 0.5;
                }
                100% { 
                    transform: translateY(500px);
                    opacity: 0;
                }
            }
            
            @keyframes rain-splash {
                0% {
                    transform: scale(1) translateY(0);
                    opacity: 0.8;
                }
                50% {
                    transform: scale(2) translateY(-8px);
                    opacity: 0.5;
                }
                100% {
                    transform: scale(3) translateY(-12px);
                    opacity: 0;
                }
            }
            
            .decoration-particles.rain .decoration-particle {
                animation-name: particle-fall-fast;
                animation-duration: 3s;
            }
            
            @keyframes particle-fall {
                0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
                10% { opacity: 0.8; }
                90% { opacity: 0.6; }
                100% { transform: translateY(450px) translateX(var(--drift-x, 0px)) rotate(360deg); opacity: 0; }
            }
            
            @keyframes particle-fall-sway {
                0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
                10% { opacity: 0.9; transform: translateY(30px) translateX(5px) rotate(10deg); }
                30% { transform: translateY(150px) translateX(-15px) rotate(45deg); opacity: 0.9; }
                50% { transform: translateY(280px) translateX(10px) rotate(90deg); opacity: 0.8; }
                70% { transform: translateY(400px) translateX(-10px) rotate(135deg); opacity: 0.7; }
                100% { transform: translateY(550px) translateX(var(--drift-x, 20px)) rotate(180deg); opacity: 0; }
            }
            
            @keyframes particle-float-up {
                0% { transform: translateY(400px) scale(0.5); opacity: 0; }
                10% { opacity: 0.9; }
                90% { opacity: 0.7; }
                100% { transform: translateY(-30px) translateX(var(--drift-x, 0px)) scale(1); opacity: 0; }
            }
            
            @keyframes particle-fall-spin {
                0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
                10% { opacity: 0.75; }
                90% { opacity: 0.4; }
                100% { transform: translateY(450px) translateX(var(--drift-x, -15px)) rotate(720deg); opacity: 0; }
            }
            
            @keyframes particle-fall-fast {
                0% { transform: translateY(-10px); opacity: 0; }
                10% { opacity: 0.7; }
                90% { opacity: 0.5; }
                100% { transform: translateY(450px); opacity: 0; }
            }
            
            /* Sunshine decoration - Tyndall Effect */
            .decoration-container.sunlight {
                /* Light Mode - Warm Gold */
                --sun-glow: rgba(255, 200, 120, 0.12);
                --sun-beam-1-color: 255, 210, 150;
                --sun-beam-2-color: 255, 225, 180;
                --dust-bg: rgba(255, 210, 120, 0.5);
                --dust-shadow: rgba(255, 200, 100, 0.15);
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
                overflow: hidden;
                z-index: 0;
                pointer-events: none;
                border-radius: inherit;
                background: linear-gradient(135deg, var(--sun-glow) 0%, transparent 60%);
            }
            
            /* Dark Mode - Cool White/Silver */
            [data-theme="dark"] .decoration-container.sunlight {
                --sun-glow: rgba(255, 255, 255, 0.05);
                --sun-beam-1-color: 220, 230, 255;
                --sun-beam-2-color: 200, 220, 255;
                --dust-bg: rgba(255, 255, 255, 0.4);
                --dust-shadow: rgba(200, 220, 255, 0.2);
            }
            
            .sunlight-glow {
                position: absolute;
                top: -25%; left: -25%;
                width: 120%; height: 120%;
                background: radial-gradient(circle at 25% 25%, var(--sun-glow) 0%, transparent 60%);
                animation: sunPulse 10s ease-in-out infinite alternate;
            }
            
            .sunlight-beam {
                position: absolute;
                top: -50%; left: -50%;
                width: 200%; height: 200%;
                filter: blur(3px);
                transform-origin: 40% 40%;
                will-change: transform, opacity;
            }
            
            .sunlight-beam.layer-1 {
                background: linear-gradient(115deg, transparent 25%, rgba(var(--sun-beam-1-color), 0.15) 30%, transparent 35%, rgba(var(--sun-beam-1-color), 0.25) 45%, transparent 50%, rgba(var(--sun-beam-1-color), 0.1) 60%, transparent 70%);
                background-size: 150% 150%;
                animation: sunRayPrimary 18s ease-in-out infinite alternate;
            }
            
            .sunlight-beam.layer-2 {
                background: linear-gradient(110deg, transparent 20%, rgba(var(--sun-beam-2-color), 0.08) 40%, transparent 60%, rgba(var(--sun-beam-2-color), 0.1) 75%, transparent 90%);
                background-size: 150% 150%;
                opacity: 0.7;
                animation: sunRaySecondary 22s ease-in-out infinite alternate-reverse;
            }
            
            .dust-mote {
                position: absolute;
                background: var(--dust-bg);
                box-shadow: 0 0 1px var(--dust-shadow);
                border-radius: 50%;
                animation-name: dustFloat;
                animation-timing-function: ease-in-out;
                animation-iteration-count: infinite;
                will-change: transform, opacity;
                pointer-events: none;
            }
            
            @keyframes sunPulse {
                0% { opacity: 0.8; transform: scale(1); }
                100% { opacity: 1; transform: scale(1.05); }
            }
            
            @keyframes sunRayPrimary {
                0% { 
                    transform: rotate(0deg) translateX(0); 
                    opacity: 0.8; 
                    background-position: 0% 50%;
                }
                100% { 
                    transform: rotate(3deg) translateX(10px); 
                    opacity: 1; 
                    background-position: 20% 50%;
                }
            }
            
            @keyframes sunRaySecondary {
                0% { 
                    transform: rotate(-2deg) translateX(-5px); 
                    opacity: 0.4; 
                    background-position: 10% 50%;
                }
                100% { 
                    transform: rotate(1deg) translateX(5px); 
                    opacity: 0.6; 
                    background-position: 0% 50%;
                }
            }
            
            @keyframes dustFloat {
                0% { transform: translate(0, 0); opacity: 0; }
                20% { opacity: 1; }
                70% { opacity: 1; }
                100% { transform: translate(var(--tx), var(--ty)); opacity: 0; }
            }
            
            /* Hearts decoration */
            .decoration-pulsing-bg {
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
                overflow: hidden;
                z-index: 1;
                pointer-events: none;
                border-radius: inherit;
            }
            
            .heart-container {
                position: absolute;
                will-change: top, left, opacity;
                transition: opacity 2s ease-in-out;
            }
            
            .heart-svg {
                width: 100%; height: 100%;
                filter: blur(16px);
                fill: currentColor;
                display: block;
            }
            
            .container-2 {
                width: 240px; height: 240px;
                top: 20%; left: 20%;
                color: rgba(255, 120, 160, 0.5);
                animation: gentleFloat 8s ease-in-out infinite;
            }
            
            .container-2 .heart-svg {
                animation: realHeartBeat 8s ease-in-out infinite;
            }
            
            .container-3 {
                width: 160px; height: 160px;
                top: 60%; left: 70%;
                color: rgba(255, 140, 180, 0.6);
                animation: gentleFloat 6s ease-in-out infinite reverse;
            }
            
            .container-3 .heart-svg {
                filter: blur(24px);
                animation: realHeartBeat 8s ease-in-out infinite;
                animation-delay: 2s;
            }
            
            @keyframes realHeartBeat {
                0%   { transform: scale(1) rotate(-5deg); opacity: 0.5; }
                5%   { transform: scale(1.08) rotate(0deg); opacity: 0.7; }
                10%  { transform: scale(1) rotate(-5deg); opacity: 0.5; }
                15%  { transform: scale(1.12) rotate(3deg); opacity: 0.8; }
                20%  { transform: scale(1) rotate(-5deg); opacity: 0.5; }
                100% { transform: scale(1) rotate(-5deg); opacity: 0.5; }
            }
            
            @keyframes gentleFloat {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-20px); }
            }
            
            /* Snow theme colors */
            .decoration-particles.snow {
                --snow-color: rgba(255, 255, 255, 0.9);
            }
        `;
        document.head.appendChild(style);
    }

    // Generate decoration HTML based on theme
    function generateDecorationHTML(theme) {
        if (!theme || theme === 'none') return '';

        // Sunshine/Sunlight theme - Tyndall effect with 50 dust motes
        if (theme === 'sunshine' || theme === 'sunlight') {
            let dustParticles = '';
            // Create 50 dust motes (matching prompts-poetry.js)
            for (let i = 0; i < 50; i++) {
                const left = Math.random() * 100;
                const top = Math.random() * 100;
                // Precision Tune: 1.0px to 2.6px (Visible but refined)
                const size = 1.0 + Math.random() * 1.6;
                const duration = 20 + Math.random() * 20;
                const delay = Math.random() * -20;
                const opacity = 0.2 + Math.random() * 0.3;
                // Random Trajectory vars
                const tx = Math.random() * 100 - 50; // -50px to +50px drift
                const ty = Math.random() * -70 - 30; // -30px to -100px rise
                dustParticles += `<div class="dust-mote" style="left:${left}%; top:${top}%; width:${size}px; height:${size}px; opacity:${opacity}; --tx:${tx}px; --ty:${ty}px; animation-duration:${duration}s; animation-delay:${delay}s"></div>`;
            }
            return `<div class="decoration-container sunlight">
                <div class="sunlight-glow"></div>
                <div class="sunlight-beam layer-1"></div>
                <div class="sunlight-beam layer-2"></div>
                ${dustParticles}
            </div>`;
        }

        // Hearts theme
        if (theme === 'hearts') {
            return `<div class="decoration-pulsing-bg">
                <div class="heart-container container-2">
                    <svg class="heart-svg" viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </div>
                <div class="heart-container container-3">
                    <svg class="heart-svg" viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </div>
            </div>`;
        }

        // Rain theme - empty container for physics particles
        if (theme === 'rain') {
            return `<div class="decoration-particles rain"></div>`;
        }

        // Fireworks theme - empty container for physics particles
        if (theme === 'fireworks') {
            return `<div class="decoration-particles fireworks"></div>`;
        }

        // Particle-based themes (snow, sakura, leaves)
        const particleCounts = { snow: 24, sakura: 24, leaves: 12 };
        const count = particleCounts[theme] || 20;

        let particles = '';
        for (let i = 0; i < count; i++) {
            const left = Math.random() * 100;
            const depth = Math.random();
            const baseDuration = theme === 'rain' ? 2 : theme === 'snow' ? 15 : 12;
            const duration = baseDuration + ((1 - depth) * 10) + (Math.random() * 4 - 2);
            const delay = -Math.random() * duration;
            const size = 0.3 + (depth * 0.9);
            const driftOffset = Math.random() * 80 - 40;
            const fontSize = theme === 'rain' ? 8 + Math.random() * 4 :
                theme === 'snow' ? 12 + Math.random() * 6 :
                    theme === 'leaves' ? 14 + Math.random() * 8 :
                        theme === 'sakura' ? 16 + Math.random() * 6 : 12;
            const finalFontSize = fontSize * size;
            const opacity = 0.4 + (depth * 0.6);
            const blur = (1 - depth) * 1.5;

            let content = '✨';

            // SVG content for specific themes
            if (theme === 'sakura') {
                const colors = ['#fecdd3', '#fca5a5', '#fda4af', '#f43f5e'];
                const color = colors[Math.floor(Math.random() * colors.length)];
                content = `<svg viewBox="0 0 100 100" fill="${color}" style="width:100%;height:100%;display:block;"><path d="M50 90 C50 90 20 60 20 40 C20 25 30 10 45 20 C48 22 50 25 50 25 C50 25 52 22 55 20 C70 10 80 25 80 40 C80 60 50 90 50 90 Z" opacity="0.8"/></svg>`;
            } else if (theme === 'leaves') {
                const colors = ['#e06c75', '#d19a66', '#e5c07b', '#c678dd', '#be5046'];
                const color = colors[Math.floor(Math.random() * colors.length)];
                content = `<svg viewBox="0 0 24 24" fill="${color}" style="width:100%;height:100%;display:block;"><path d="M12.5,2C12.5,2 12.8,4.5 11,6C9,7.5 7,6 7,6L6,8C6,8 3,7.5 2,9C1,10.5 4,11 4,11L3,13C3,13 1,12.5 0,14C-1,15.5 2,16 2,16L3,18C3,18 2,19.5 4,20.5C6,21.5 7,19.5 7,19.5L9,21C9,21 10,22 13,22C16,22 16,19 16,19L17,20.5C17,20.5 19,20.5 20,19C21,17.5 19,16 19,16L21,14.5C21,14.5 23,14 22,12C21,10 19,10.5 19,10.5L20,8C20,8 19,6 17,6C15,6 14.5,8 14.5,8L12.5,2Z"/></svg>`;
            } else if (theme === 'snow') {
                content = `<svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)" style="width:100%;height:100%;display:block;"><path d="M12,2L12,22 M2,12L22,12 M19.07,4.93L4.93,19.07 M19.07,19.07L4.93,4.93" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`;
            }

            particles += `<span class="decoration-particle" style="left:${left}%;animation-delay:${delay.toFixed(2)}s;animation-duration:${duration.toFixed(2)}s;--drift-x:${driftOffset}px;font-size:${finalFontSize.toFixed(0)}px;width:${finalFontSize.toFixed(0)}px;height:${finalFontSize.toFixed(0)}px;opacity:${opacity.toFixed(2)};filter:blur(${blur.toFixed(1)}px);">${content}</span>`;
        }

        return `<div class="decoration-particles ${theme}">${particles}</div>`;
    }

    function showBannerAnnouncement(color, size, content, ackKey, decoration) {
        injectAnnouncementStyles();

        const decorationHTML = generateDecorationHTML(decoration);
        const banner = document.createElement('div');
        banner.className = 'announcement-banner';
        banner.innerHTML = `
            ${decorationHTML}
            <i class="fas fa-bullhorn" style="position:relative;z-index:10;"></i>
            <span class="announcement-text">${content}</span>
            <button class="announcement-close" data-announcement-action="acknowledge">已读</button>
        `;
        banner.querySelector('[data-announcement-action="acknowledge"]')?.addEventListener('click', () => {
            dismissAnnouncement(banner, ackKey, true);
        });
        document.body.appendChild(banner);
        currentAnnouncementElement = banner;

        // Start physics particles for rain theme
        startParticlesIfNeeded(banner, decoration);
    }

    function showModalAnnouncement(color, size, content, ackKey, decoration) {
        injectAnnouncementStyles();

        const decorationHTML = generateDecorationHTML(decoration);
        const overlay = document.createElement('div');
        overlay.className = 'announcement-overlay';
        overlay.innerHTML = `
            <div class="announcement-modal">
                ${decorationHTML}
                <div class="announcement-header">
                    <i class="fas fa-bullhorn"></i>
                    <span class="announcement-title">站内公告</span>
                </div>
                <div class="announcement-body">
                    <div class="announcement-text">${content}</div>
                </div>
                <div class="announcement-footer">
                    <button class="announcement-ack-btn">已读</button>
                </div>
            </div>
        `;

        overlay.querySelector('.announcement-ack-btn').onclick = () => {
            dismissAnnouncement(overlay, ackKey, true);
        };
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                dismissAnnouncement(overlay, ackKey, true);
            }
        };

        document.body.appendChild(overlay);
        currentAnnouncementElement = overlay;
        lockAnnouncementBackground(overlay);

        // Start physics particles for rain theme
        const modal = overlay.querySelector('.announcement-modal');
        if (modal) {
            startParticlesIfNeeded(modal, decoration);
        }
    }

    function showToastAnnouncement(color, size, content, ackKey, decoration) {
        injectAnnouncementStyles();

        const decorationHTML = generateDecorationHTML(decoration);
        const toast = document.createElement('div');
        toast.className = 'announcement-toast';
        toast.innerHTML = `
            ${decorationHTML}
            <div class="announcement-header">
                <i class="fas fa-bullhorn"></i>
                <span class="announcement-title">站内公告</span>
            </div>
            <div class="announcement-body">
                <div class="announcement-text">${content}</div>
            </div>
            <div class="announcement-footer">
                <button class="announcement-ack-btn">已读</button>
            </div>
        `;

        toast.querySelector('.announcement-ack-btn').onclick = () => {
            dismissAnnouncement(toast, ackKey, true);
        };

        document.body.appendChild(toast);
        currentAnnouncementElement = toast;
        lockAnnouncementBackground(toast);

        // Start physics particles for rain theme
        startParticlesIfNeeded(toast, decoration);
    }

    // ========================================
    // ParticleSystem - 物理粒子系统 (from prompts-poetry.js)
    // ========================================
    const ParticleSystem = {
        timer: null,
        frameId: null,
        particles: [],
        container: null,
        theme: null,
        width: 0,
        height: 0,
        lastTime: 0,

        init(container, theme) {
            this.stop(); // 清理旧的
            if (!container || !theme || theme === 'none') return;

            this.container = container;
            this.theme = theme;
            this.particles = [];

            // 强制容器样式，确保动画环境稳定
            container.style.position = 'absolute';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.overflow = 'hidden';
            container.style.pointerEvents = 'none';
            container.style.zIndex = '1';

            // 更新尺寸
            this.updateDimensions();

            // 立即生成一批 (Pre-warm)
            let initialCount = 6;
            if (theme === 'rain') initialCount = 40;
            if (theme === 'fireworks') {
                // 烟花初始连发 3 个，错开时间
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => this.createParticle(), i * 400 + Math.random() * 200);
                }
                initialCount = 0;
            }

            this.spawnBatch(initialCount, true);

            // 启动循环
            this.frameId = requestAnimationFrame((t) => this.loop(t));

            // 定时生成
            this.scheduleSpawn();
        },

        stop() {
            if (this.timer) clearTimeout(this.timer);
            if (this.frameId) cancelAnimationFrame(this.frameId);
            if (this.container) {
                this.container.innerHTML = '';
            }
            this.particles = [];
            this.timer = null;
            this.frameId = null;
            this.container = null;
        },

        updateDimensions() {
            if (!this.container) return;
            this.width = this.container.clientWidth || 0;
            this.height = this.container.clientHeight || 0;
        },

        spawnBatch(count, preWarm = false) {
            for (let i = 0; i < count; i++) {
                let startY;
                if (preWarm && this.height > 0) {
                    startY = Math.random() * (this.height + 50) - 50;
                } else {
                    startY = -20 - Math.random() * 50;
                }
                this.createParticle(startY);
            }
        },

        scheduleSpawn() {
            let delay = 1800 + Math.random() * 1200;
            let maxParticles = 12;

            // 雨天模式：极速高密度
            if (this.theme === 'rain') {
                delay = 30 + Math.random() * 30;
                maxParticles = 80;
            }

            // 烟花模式：短间隔交错发射
            if (this.theme === 'fireworks') {
                delay = 300 + Math.random() * 500; // 0.3-0.8秒间隔（更密集）
                maxParticles = 150; // 允许更多粒子
            }

            this.timer = setTimeout(() => {
                if (this.container && this.particles.length < maxParticles) {
                    // 烟花连发逻辑：40% 概率触发连发
                    if (this.theme === 'fireworks' && Math.random() < 0.4) {
                        this.fireCombo();
                    } else {
                        this.createParticle();
                    }
                }
                this.scheduleSpawn();
            }, delay);
        },

        // 烟花连发
        fireCombo() {
            const count = 2 + Math.floor(Math.random() * 2); // 2-3个
            for (let i = 0; i < count; i++) {
                setTimeout(() => {
                    this.createParticle();
                }, i * 300 + Math.random() * 200);
            }
        },

        createParticle(startY = -30) {
            if (!this.container) return;

            // 防止宽度过小时堆积
            if (!this.width || this.width < 100) return;

            // --- 烟花火箭逻辑 ---
            if (this.theme === 'fireworks') {
                const el = document.createElement('div');
                el.textContent = '✦';
                el.style.position = 'absolute';
                el.style.left = '0';
                el.style.top = '0';
                el.style.fontSize = '8px';
                el.style.color = `hsl(${Math.random() * 360}, 100%, 70%)`;
                el.style.willChange = 'transform, opacity';
                el.style.pointerEvents = 'none';
                el.style.transform = `translate3d(0, 0, 0)`;

                this.container.appendChild(el);

                const p = {
                    el: el,
                    type: 'rocket',
                    subType: ['willow', 'peony', 'ring'][Math.floor(Math.random() * 3)],
                    x: 20 + Math.random() * (this.width - 40),
                    y: this.height,
                    targetY: this.height * 0.05 + Math.random() * (this.height * 0.25),
                    vx: (Math.random() - 0.5) * 1,
                    vy: -4 - Math.random() * 3,
                    state: 'rising',
                    opacity: 1,
                    color: el.style.color
                };
                this.particles.push(p);
                return;
            }

            // --- 雨滴逻辑 (CSS Streaks) ---
            if (this.theme === 'rain') {
                const el = document.createElement('div');
                el.style.position = 'absolute';
                el.style.width = (1 + Math.random()) + 'px';
                el.style.height = (60 + Math.random() * 60) + 'px';
                el.style.background = 'linear-gradient(to bottom, transparent, rgba(70, 130, 180, 0.6))';
                el.style.filter = 'blur(0.5px)';
                el.style.willChange = 'transform, opacity';
                el.style.pointerEvents = 'none';
                el.style.opacity = 0.4 + Math.random() * 0.4;

                this.container.appendChild(el);

                const p = {
                    el: el,
                    type: 'rain',
                    x: 20 + Math.random() * Math.max(0, this.width - 40),
                    y: startY < 0 ? startY : -150,
                    speed: 25 + Math.random() * 15,
                    state: 'falling',
                    landingY: this.height
                };
                this.particles.push(p);
                return;
            }
        },

        createSplash(x, y) {
            const splashCount = 3 + Math.floor(Math.random() * 4);
            for (let i = 0; i < splashCount; i++) {
                const el = document.createElement('div');
                el.style.position = 'absolute';
                el.style.width = '2px';
                el.style.height = '2px';
                el.style.borderRadius = '50%';
                el.style.backgroundColor = 'rgba(70, 130, 180, 0.8)';
                el.style.willChange = 'transform, opacity';
                el.style.pointerEvents = 'none';
                el.style.transform = `translate3d(${x}px, ${y}px, 0)`;

                this.container.appendChild(el);

                this.particles.push({
                    el: el,
                    type: 'splash',
                    x: x,
                    y: y,
                    vx: (Math.random() - 0.5) * 4,
                    vy: -3 - Math.random() * 3,
                    friction: 0.95,
                    gravity: 0.5,
                    opacity: 1,
                    state: 'fading'
                });
            }
        },

        // 烟花爆炸
        explode(rocket) {
            const type = rocket.subType || 'willow';

            if (type === 'willow') {
                const sparkCount = 30 + Math.random() * 20;
                for (let i = 0; i < sparkCount; i++) {
                    this.createSpark(rocket, {
                        speed: 1 + Math.random() * 3,
                        gravity: 0.02,
                        friction: 0.97,
                        decay: 0.003,
                        color: Math.random() > 0.5 ? '#FFD700' : '#E0E0E0'
                    });
                }
            } else if (type === 'peony') {
                const sparkCount = 40 + Math.random() * 20;
                const baseHue = Math.random() * 360;
                for (let i = 0; i < sparkCount; i++) {
                    this.createSpark(rocket, {
                        speed: 2 + Math.random() * 4,
                        gravity: 0.03,
                        friction: 0.95,
                        decay: 0.006,
                        color: `hsl(${baseHue + Math.random() * 40}, 100%, 70%)`
                    });
                }
            } else if (type === 'ring') {
                const sparkCount = 36;
                const ringSpeed = 3 + Math.random() * 1;
                const color = `hsl(${Math.random() * 360}, 100%, 75%)`;
                for (let i = 0; i < sparkCount; i++) {
                    const angle = (i / sparkCount) * Math.PI * 2;
                    this.createSpark(rocket, {
                        vx: Math.cos(angle) * ringSpeed,
                        vy: Math.sin(angle) * ringSpeed,
                        gravity: 0.025,
                        friction: 0.98,
                        decay: 0.004,
                        color: color,
                        fixedSpeed: true
                    });
                }
            }
        },

        createSpark(rocket, cfg) {
            const el = document.createElement('div');
            el.style.position = 'absolute';
            el.style.width = '4px';
            el.style.height = '4px';
            el.style.borderRadius = '50%';
            el.style.backgroundColor = cfg.color;
            el.style.boxShadow = `0 0 6px 1px ${cfg.color}`;
            el.style.pointerEvents = 'none';
            el.style.willChange = 'transform, opacity';

            this.container.appendChild(el);

            const angle = Math.random() * Math.PI * 2;
            const speed = cfg.speed || 2;

            this.particles.push({
                el: el,
                type: 'spark',
                x: rocket.x,
                y: rocket.y,
                vx: cfg.fixedSpeed ? cfg.vx : Math.cos(angle) * speed,
                vy: cfg.fixedSpeed ? cfg.vy : Math.sin(angle) * speed,
                gravity: cfg.gravity,
                friction: cfg.friction,
                opacity: 1,
                decay: cfg.decay
            });
        },

        loop(timestamp) {
            if (!this.container) return;

            if (!timestamp) timestamp = performance.now();

            if (!this.lastTime) this.lastTime = timestamp;
            const deltaTime = timestamp - this.lastTime;
            this.lastTime = timestamp;

            const timeScale = Math.min(deltaTime, 100) / 16.67;

            this.updateDimensions();

            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];

                // --- 雨滴物理 ---
                if (p.type === 'rain') {
                    let hzDampener = 1.0;
                    if (deltaTime < 10) hzDampener = 0.6;

                    p.y += p.speed * timeScale * hzDampener;
                    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;

                    if (p.y > this.height) {
                        this.createSplash(p.x, this.height);
                        this.particles.splice(i, 1);
                        p.el.remove();
                    }
                    continue;
                }

                // --- 烟花火箭物理 ---
                if (p.type === 'rocket') {
                    p.x += p.vx * timeScale;
                    p.y += p.vy * timeScale;
                    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;

                    if (p.y <= p.targetY) {
                        this.explode(p);
                        this.particles.splice(i, 1);
                        p.el.remove();
                    }
                    continue;
                }

                // --- 烟花火花物理 ---
                if (p.type === 'spark') {
                    p.vx *= Math.pow(p.friction, timeScale);
                    p.vy *= Math.pow(p.friction, timeScale);
                    p.vy += p.gravity * timeScale;
                    p.x += p.vx * timeScale;
                    p.y += p.vy * timeScale;
                    p.opacity -= p.decay * timeScale;

                    p.el.style.opacity = p.opacity;
                    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;

                    if (p.opacity <= 0) {
                        this.particles.splice(i, 1);
                        p.el.remove();
                    }
                    continue;
                }

                // --- 水花物理 ---
                if (p.type === 'splash') {
                    p.vy += 0.5 * timeScale;
                    p.x += p.vx * timeScale;
                    p.y += p.vy * timeScale;
                    p.opacity -= 0.05 * timeScale;

                    p.el.style.opacity = p.opacity;
                    p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;

                    if (p.opacity <= 0) {
                        this.particles.splice(i, 1);
                        p.el.remove();
                    }
                    continue;
                }
            }

            this.frameId = requestAnimationFrame((t) => this.loop(t));
        }
    };

    // Helper to start particles for active physics themes
    function startParticlesIfNeeded(element, decoration) {
        if (decoration === 'rain' || decoration === 'fireworks') {
            // 需要延迟一帧等待 DOM 渲染完成
            requestAnimationFrame(() => {
                const container = element.querySelector('.decoration-particles');
                if (container) {
                    ParticleSystem.init(container, decoration);
                }
            });
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(loadAnnouncement, 1000));
    } else {
        setTimeout(loadAnnouncement, 1000);
    }

    // Expose for debugging
    window.loadAnnouncementFromLoader = loadAnnouncement;
})();
