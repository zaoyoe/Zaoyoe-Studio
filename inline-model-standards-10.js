
        (function() {
            const filterInput = document.getElementById('modelFilterInput');
            const navTree = document.getElementById('standardsNavTree');
            const navItems = Array.from(document.querySelectorAll('.standards-nav-item'));
            const modelCards = Array.from(document.querySelectorAll('.model-card'));
            const navGroups = Array.from(document.querySelectorAll('.standards-nav-group'));
            const sidebarCount = document.getElementById('sidebarModelCount');

            // 1. Real-time Search Filter
            if (filterInput) {
                filterInput.addEventListener('input', function(e) {
                    const query = String(e.target.value || '').trim().toLowerCase();
                    let matchCount = 0;

                    modelCards.forEach(card => {
                        const text = (card.textContent || '').toLowerCase();
                        const isMatch = !query || text.includes(query);
                        card.style.display = isMatch ? '' : 'none';
                        if (isMatch) matchCount++;
                    });

                    navItems.forEach(item => {
                        const href = item.getAttribute('href') || '';
                        const cardId = href.replace(/^#/, '');
                        const card = document.getElementById(cardId);
                        const isMatch = !query || (card && card.style.display !== 'none') || (item.textContent || '').toLowerCase().includes(query);
                        item.classList.toggle('is-hidden', !isMatch);
                    });

                    navGroups.forEach(group => {
                        const visibleChildren = group.querySelectorAll('.standards-nav-item:not(.is-hidden)');
                        group.style.display = visibleChildren.length > 0 ? '' : 'none';
                    });

                    if (sidebarCount) {
                        sidebarCount.textContent = query ? `${matchCount} 个匹配` : `${modelCards.length} 款模型`;
                    }
                });
            }

            // 2. ScrollSpy for Active Sidebar Item
            if ('IntersectionObserver' in window && navItems.length) {
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const id = entry.target.id;
                            navItems.forEach(item => {
                                const active = item.getAttribute('href') === `#${id}`;
                                item.classList.toggle('active', active);
                            });
                        }
                    });
                }, {
                    rootMargin: '-100px 0px -60% 0px',
                    threshold: 0
                });

                modelCards.forEach(card => observer.observe(card));
            }
        })();
