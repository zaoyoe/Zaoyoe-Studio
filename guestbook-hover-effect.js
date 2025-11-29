// Enhanced hover interaction for message cards with magnetic effect
document.addEventListener('DOMContentLoaded', function () {
    // Apply to both message cards and comment items
    const interactiveElements = document.querySelectorAll('.message-item, .comment-item');

    interactiveElements.forEach(element => {
        element.addEventListener('mousemove', function (e) {
            const rect = element.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;

            // Reduced magnetic strength for subtle effect
            const moveX = x * 0.01;
            const moveY = y * 0.01;

            // Very subtle lift and movement
            element.style.transform = `scale(1.01) translateY(-1px) translate(${moveX}px, ${moveY}px)`;
        });

        element.addEventListener('mouseleave', function () {
            element.style.transform = '';
        });
    });
});
