// Enhanced hover interaction for message cards with stable thread highlighting.
document.addEventListener('DOMContentLoaded', function () {
    document.addEventListener('pointerover', function (event) {
        const comment = event.target?.closest?.('.comment-item--nested');
        if (!comment) return;

        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && comment.contains(relatedTarget)) {
            return;
        }

        document.querySelectorAll('.thread-highlight').forEach(element => {
            if (element !== comment) {
                element.classList.remove('thread-highlight');
            }
        });

        comment.classList.add('thread-highlight');
    });

    document.addEventListener('pointerout', function (event) {
        const comment = event.target?.closest?.('.comment-item--nested');
        if (!comment) return;

        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && comment.contains(relatedTarget)) {
            return;
        }

        comment.classList.remove('thread-highlight');
    });
});
