/**
 * 自定义平滑滚动函数 (优雅的缓动效果)
 * @param {HTMLElement} element - 目标元素
 * @param {number} duration - 动画持续时间 (ms)
 */
function smoothScrollTo(element, duration = 1000) {
    return new Promise(resolve => {
        const elementPosition = element.getBoundingClientRect().top;
        const startPosition = window.pageYOffset;
        // 计算目标位置：元素顶部 + 当前滚动 - 视口一半 + 元素一半 (实现居中)
        const offsetPosition = elementPosition + startPosition - (window.innerHeight / 2) + (element.offsetHeight / 2);
        const distance = offsetPosition - startPosition;
        let startTime = null;

        function animation(currentTime) {
            if (startTime === null) startTime = currentTime;
            const timeElapsed = currentTime - startTime;

            // EaseInOutQuad 缓动算法
            const run = easeInOutQuad(timeElapsed, startPosition, distance, duration);

            window.scrollTo(0, run);

            if (timeElapsed < duration) {
                requestAnimationFrame(animation);
            } else {
                // 确保最终位置准确
                window.scrollTo(0, startPosition + distance);
                resolve();
            }
        }

        // t: current time, b: start value, c: change in value, d: duration
        function easeInOutQuad(t, b, c, d) {
            t /= d / 2;
            if (t < 1) return c / 2 * t * t + b;
            t--;
            return -c / 2 * (t * (t - 2) - 1) + b;
        }

        requestAnimationFrame(animation);
    });
}
