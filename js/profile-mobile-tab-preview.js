(function () {
    'use strict';

    const moreButton = document.getElementById('moreBtn');
    const moreBlock = document.getElementById('moreBlock');
    let expanded = false;

    moreButton?.addEventListener('click', () => {
        expanded = !expanded;
        moreBlock?.classList.toggle('show', expanded);
        moreButton.textContent = expanded ? '收起更多资料' : '展开更多资料';
    });
}());
