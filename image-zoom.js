// 图片缩放功能 - 完全独立的实现
(function () {
    console.log('🔍 Image zoom script loaded');

    const IMAGE_ZOOM_ENABLED_CLASS = 'image-zoom-enabled';
    const IMAGE_ZOOM_ANIMATING_CLASS = 'image-zoom-animating';
    const IMAGE_ZOOM_STYLE_KEY = 'style';

    function initImageZoom() {
        const observer = new MutationObserver(() => {
            const modal = document.getElementById('imageModal');
            if (modal && modal.classList.contains('active')) {
                const img = modal.querySelector('img');
                if (img && !img.dataset.zoomInit) {
                    console.log('✅ Setting up zoom for image');
                    setupImageZoom(img);
                    img.dataset.zoomInit = 'true';
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    function setupImageZoom(img) {
        let state = {
            scale: 1,
            translateX: 0,
            translateY: 0,
            isPinching: false,
            isDragging: false,
            lastScale: 1,
            startDistance: 0,
            startX: 0,
            startY: 0,
            touchStarted: false,
            touchMoved: false
        };

        img.classList.add(IMAGE_ZOOM_ENABLED_CLASS);

        function setZoomTransform() {
            const styleDecl = Reflect.get(img, IMAGE_ZOOM_STYLE_KEY);
            if (!styleDecl) return;
            styleDecl.setProperty('--image-zoom-translate-x', `${state.translateX}px`);
            styleDecl.setProperty('--image-zoom-translate-y', `${state.translateY}px`);
            styleDecl.setProperty('--image-zoom-scale', String(state.scale));
        }

        function updateTransform() {
            setZoomTransform();
            console.log(`Transform: scale=${state.scale.toFixed(2)}, x=${state.translateX.toFixed(0)}, y=${state.translateY.toFixed(0)}`);
        }

        function getDistance(touches) {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function resetZoom() {
            console.log('🔄 Resetting zoom');
            state.scale = 1;
            state.translateX = 0;
            state.translateY = 0;
            img.classList.add(IMAGE_ZOOM_ANIMATING_CLASS);
            updateTransform();
            setTimeout(() => {
                img.classList.remove(IMAGE_ZOOM_ANIMATING_CLASS);
            }, 300);
        }

        // Touchstart
        img.addEventListener('touchstart', function (e) {
            console.log(`Touchstart: ${e.touches.length} fingers`);
            state.touchStarted = true;
            state.touchMoved = false;

            if (e.touches.length === 2) {
                // 双指缩放开始
                e.preventDefault();
                e.stopPropagation();
                state.isPinching = true;
                state.isDragging = false;
                state.startDistance = getDistance(e.touches);
                state.lastScale = state.scale;
                console.log('📍 Pinch start');
            } else if (e.touches.length === 1 && state.scale > 1.1) {
                // 单指拖动开始（只在已放大时）
                e.preventDefault();
                e.stopPropagation();
                state.isDragging = true;
                state.startX = e.touches[0].clientX - state.translateX;
                state.startY = e.touches[0].clientY - state.translateY;
                console.log('📍 Drag start');
            }
        }, { passive: false });

        // Touchmove
        img.addEventListener('touchmove', function (e) {
            state.touchMoved = true;

            if (state.isPinching && e.touches.length === 2) {
                // 双指缩放中
                e.preventDefault();
                e.stopPropagation();

                const currentDistance = getDistance(e.touches);
                const newScale = state.lastScale * (currentDistance / state.startDistance);
                state.scale = Math.min(Math.max(1, newScale), 4);

                updateTransform();
            } else if (state.isDragging && e.touches.length === 1 && state.scale > 1.1) {
                // 单指拖动中
                e.preventDefault();
                e.stopPropagation();

                state.translateX = e.touches[0].clientX - state.startX;
                state.translateY = e.touches[0].clientY - state.startY;

                updateTransform();
            }
        }, { passive: false });

        // Touchend
        img.addEventListener('touchend', function (e) {
            console.log(`Touchend: ${e.touches.length} fingers remaining, moved: ${state.touchMoved}`);

            // 关键：只在所有手指都离开时才处理
            if (e.touches.length === 0) {
                console.log(`🏁 All fingers lifted. Scale: ${state.scale}, touchMoved: ${state.touchMoved}`);

                // 如果是单击（没有移动，且未放大）
                if (state.touchStarted && !state.touchMoved && state.scale <= 1.1) {
                    console.log('👆 Single tap detected - resetting zoom (if zoomed)');
                    // 单击：如果已放大则重置，否则不做任何操作（让背景关闭模态框）
                    if (state.scale > 1.1) {
                        e.preventDefault();
                        e.stopPropagation();
                        resetZoom();
                    }
                } else if (state.touchStarted && !state.touchMoved && state.scale > 1.1) {
                    // 已放大状态下的单击：重置缩放
                    console.log('👆 Tap on zoomed image - resetting');
                    e.preventDefault();
                    e.stopPropagation();
                    resetZoom();
                } else if (state.scale < 1.1 && state.isPinching) {
                    // 用户手动缩小到接近1，才重置
                    console.log('🔄 Resetting to scale 1');
                    resetZoom();
                }

                state.isPinching = false;
                state.isDragging = false;
                state.touchStarted = false;
            }
        }, { passive: false });

        // 双击放大功能（可选）
        let lastTapTime = 0;
        img.addEventListener('touchend', function (e) {
            if (e.touches.length === 0 && !state.touchMoved) {
                const now = Date.now();
                const timeSinceLastTap = now - lastTapTime;

                if (timeSinceLastTap < 300 && timeSinceLastTap > 50) {
                    console.log('👆👆 Double tap detected');
                    e.preventDefault();
                    e.stopPropagation();

                    if (state.scale > 1.5) {
                        // 重置
                        resetZoom();
                    } else {
                        // 放大到2.5倍
                        state.scale = 2.5;
                        state.translateX = 0;
                        state.translateY = 0;
                        img.classList.add(IMAGE_ZOOM_ANIMATING_CLASS);
                        updateTransform();
                        setTimeout(() => {
                            img.classList.remove(IMAGE_ZOOM_ANIMATING_CLASS);
                        }, 300);
                    }

                    lastTapTime = 0;
                } else {
                    lastTapTime = now;
                }
            }
        }, { passive: false });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initImageZoom);
    } else {
        initImageZoom();
    }
})();
