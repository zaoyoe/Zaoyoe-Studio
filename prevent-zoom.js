// 完全禁止移动端页面缩放 - TEMPORARILY DISABLED TO FIX SCROLL LOCK
document.addEventListener('DOMContentLoaded', function () {
    // ⚡ CRITICAL FIX: Disable all aggressive touch prevention
    console.log('🔓 Mobile zoom prevention disabled to restore scrolling');

    /* 
    // 阻止多指触摸缩放（但允许图片模态框内的缩放）
    document.addEventListener('touchstart', function (event) {
        // ...
    }, { passive: false });

    // 阻止缩放手势
    document.addEventListener('touchmove', function (event) {
        // ...
    }, { passive: false });

    // 阻止双击缩放
    document.addEventListener('touchend', function (event) {
        // ...
    }, false);
    */
}, false);
