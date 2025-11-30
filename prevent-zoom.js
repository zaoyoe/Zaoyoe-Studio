// 完全禁止移动端页面缩放
document.addEventListener('DOMContentLoaded', function () {
    // 阻止多指触摸缩放（但允许图片模态框内的缩放）
    document.addEventListener('touchstart', function (event) {
        // 如果是在图片模态框内，不阻止
        if (event.target.closest('#imageModal')) {
            return;
        }
        if (event.touches.length > 1) {
            event.preventDefault();
        }
    }, { passive: false });

    // 阻止缩放手势（但允许图片模态框内的缩放）
    document.addEventListener('touchmove', function (event) {
        // 如果是在图片模态框内，不阻止
        if (event.target.closest('#imageModal')) {
            return;
        }
        if (event.scale !== 1) {
            event.preventDefault();
        }
    }, { passive: false });

    // 阻止双击缩放（但允许图片模态框内的双击）
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function (event) {
        // 如果是在图片模态框内，不阻止
        if (event.target.closest('#imageModal')) {
            return;
        }
        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
            event.preventDefault();
        }
        lastTouchEnd = now;
    }, false);
}, false);
