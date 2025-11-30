// Enhanced hover interaction for message cards with magnetic effect
document.addEventListener('DOMContentLoaded', function () {
    // Thread line highlight - only highlight current comment's own border
    const nestedComments = document.querySelectorAll('.comment-item--nested');

    nestedComments.forEach(comment => {
        comment.addEventListener('mouseover', function (e) {
            // Stop propagation so parents don't get the event
            e.stopPropagation();

            // Remove highlight from all other comments first to be safe
            document.querySelectorAll('.thread-highlight').forEach(el => {
                el.classList.remove('thread-highlight');
            });

            // Add highlight to this comment
            this.classList.add('thread-highlight');
        });

        comment.addEventListener('mouseout', function (e) {
            e.stopPropagation();
            this.classList.remove('thread-highlight');
        });
    });
});
