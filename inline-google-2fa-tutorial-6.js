
        // Lightbox click-to-zoom logic
        document.addEventListener('DOMContentLoaded', () => {
            const lightbox = document.getElementById('tutorialLightbox');
            const lightboxImg = document.getElementById('tutorialLightboxImg');

            document.querySelectorAll('.tutorial-img').forEach(img => {
                img.addEventListener('click', () => {
                    lightboxImg.src = img.src;
                    lightbox.classList.add('active');
                });
            });

            lightbox.addEventListener('click', () => {
                lightbox.classList.remove('active');
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && lightbox.classList.contains('active')) {
                    lightbox.classList.remove('active');
                }
            });
        });
