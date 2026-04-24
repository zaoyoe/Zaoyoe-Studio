(function () {
    'use strict';

    const palettes = {
        cyan: {
            a: '14, 165, 233',
            b: '20, 184, 166',
            c: '37, 99, 235',
            soft: '0.18',
            label: '推荐效果：青蓝流光',
            hint: '建议接入值：\nray-1: rgba(37, 99, 235, 0.28)\nray-2: rgba(14, 165, 233, 0.32)\nray-3: rgba(20, 184, 166, 0.26)\nray-4: rgba(79, 70, 229, 0.16)'
        },
        indigo: {
            a: '79, 70, 229',
            b: '6, 182, 212',
            c: '51, 65, 85',
            soft: '0.16',
            label: '备选效果：冷靛蓝流光',
            hint: '建议接入值：\nray-1: rgba(51, 65, 85, 0.18)\nray-2: rgba(79, 70, 229, 0.28)\nray-3: rgba(6, 182, 212, 0.24)\nray-4: rgba(99, 102, 241, 0.16)'
        },
        green: {
            a: '16, 185, 129',
            b: '132, 204, 22',
            c: '4, 120, 87',
            soft: '0.15',
            label: '备选效果：翡翠绿流光',
            hint: '建议接入值：\nray-1: rgba(4, 120, 87, 0.2)\nray-2: rgba(16, 185, 129, 0.28)\nray-3: rgba(132, 204, 22, 0.18)\nray-4: rgba(20, 83, 45, 0.12)'
        },
        coral: {
            a: '249, 115, 22',
            b: '245, 158, 11',
            c: '225, 29, 72',
            soft: '0.14',
            label: '备选效果：珊瑚金流光',
            hint: '建议接入值：\nray-1: rgba(225, 29, 72, 0.18)\nray-2: rgba(249, 115, 22, 0.26)\nray-3: rgba(245, 158, 11, 0.22)\nray-4: rgba(190, 24, 93, 0.12)'
        }
    };

    const stage = document.querySelector('.preview-stage');
    const title = document.querySelector('.preview-card-title');
    const hint = document.querySelector('.code-hint');
    const buttons = Array.from(document.querySelectorAll('.palette-button'));

    function applyPalette(button) {
        const paletteName = button?.dataset?.palette || 'cyan';
        const palette = palettes[paletteName] || palettes.cyan;

        stage?.style.setProperty('--beam-a', palette.a);
        stage?.style.setProperty('--beam-b', palette.b);
        stage?.style.setProperty('--beam-c', palette.c);
        stage?.style.setProperty('--beam-soft', palette.soft);

        if (stage) stage.dataset.palette = paletteName;
        if (title) title.textContent = palette.label;
        if (hint) hint.textContent = palette.hint;

        buttons.forEach((item) => item.classList.toggle('is-active', item === button));
    }

    buttons.forEach((button) => {
        button.addEventListener('click', () => applyPalette(button));
    });
}());
