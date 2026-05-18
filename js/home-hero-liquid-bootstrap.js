(function () {
    'use strict';

    var root = document.documentElement;
    var script = document.currentScript;
    var section = script && script.closest ? script.closest('.hero-section') : document.getElementById('hero-section');
    var canvas = section ? section.querySelector('#heroLiquidCanvas') : null;
    var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    var previousRuntime = window.__homeHeroLiquidBootstrap;

    if (previousRuntime && typeof previousRuntime.stop === 'function') {
        previousRuntime.stop();
    }

    if (!section || !canvas || !ctx || typeof window.requestAnimationFrame !== 'function') {
        return;
    }

    var charset = ['0', '1', 'A', 'B', 'C', 'D', 'E', 'F'];
    var runtime = {
        active: false,
        frame: 0,
        height: 0,
        lastNow: 0,
        resizeObserver: null,
        themeObserver: null,
        time: 0,
        width: 0
    };

    function isDarkTheme() {
        return root.getAttribute('data-theme') === 'dark';
    }

    function fitCanvas() {
        if (!runtime.active) {
            return;
        }

        var dpr = window.devicePixelRatio || 1;
        var width = Math.max(1, Math.floor(section.clientWidth || canvas.clientWidth || window.innerWidth || 1));
        var height = Math.max(1, Math.floor(section.clientHeight || canvas.clientHeight || window.innerHeight || 1));
        var pixelWidth = Math.max(1, Math.floor(width * dpr));
        var pixelHeight = Math.max(1, Math.floor(height * dpr));

        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        runtime.width = width;
        runtime.height = height;
    }

    function drawFrame(dt) {
        if (!runtime.active || !isDarkTheme()) {
            return;
        }

        fitCanvas();

        var lw = runtime.width;
        var lh = runtime.height;
        if (!lw || !lh) {
            return;
        }

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, lw, lh);

        var cols = 60;
        var rows = 38;
        var spacing = 42;
        var cx = lw / 2;
        var cy = lh * 0.30;
        var fov = 400;
        var hueVal = 150;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (var y = 0; y < rows; y += 1) {
            for (var x = 0; x < cols; x += 1) {
                var wx = (x - (cols / 2)) * spacing;
                var zOff = (runtime.time * 1.0) % spacing;
                var wz = ((rows - y) * spacing) - zOff;
                var wy = 150
                    + Math.sin((wx * 0.02) + (runtime.time * 0.02)) * 40
                    + Math.cos((wz * 0.015) - (runtime.time * 0.03)) * 60
                    + Math.sin(((wx + wz) * 0.01) + (runtime.time * 0.04)) * 30;
                var scale = fov / (fov + wz);
                var px = cx + (wx * scale);
                var py = cy + (wy * scale);

                if (wz > 0 && scale > 0) {
                    var alpha = Math.max(0.2, 1 - (wz / (rows * spacing)));
                    var ch = '0';
                    if (wy < 140) ch = '1';
                    if (wy < 100) ch = charset[Math.floor((x + y + (runtime.time * 0.1)) % charset.length)];
                    var fs = Math.max(3, 14 * scale);
                    var light = Math.max(20, 90 - (wy - 50));
                    ctx.font = fs + 'px "Share Tech Mono", monospace';
                    ctx.fillStyle = 'hsla(' + hueVal + ', 100%, ' + light + '%, ' + alpha + ')';
                    ctx.fillText(ch, px, py);
                }
            }
        }

        runtime.time += dt * (4 / 9);
    }

    function tick(now) {
        if (!runtime.active) {
            return;
        }

        var dt = Math.min(2, (now - (runtime.lastNow || now)) / 16.6667) || 1;
        runtime.lastNow = now;
        drawFrame(dt);
        runtime.frame = window.requestAnimationFrame(tick);
    }

    function pause(clearCanvas) {
        runtime.active = false;
        if (runtime.frame) {
            window.cancelAnimationFrame(runtime.frame);
            runtime.frame = 0;
        }
        if (clearCanvas && runtime.width && runtime.height) {
            ctx.clearRect(0, 0, runtime.width, runtime.height);
        }
    }

    function start() {
        if (runtime.active || !isDarkTheme()) {
            return;
        }

        runtime.active = true;
        runtime.lastNow = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        drawFrame(1);
        runtime.frame = window.requestAnimationFrame(tick);
    }

    function syncTheme() {
        if (isDarkTheme()) {
            start();
        } else {
            pause(true);
        }
    }

    function stop() {
        pause(false);
        if (runtime.resizeObserver) {
            runtime.resizeObserver.disconnect();
            runtime.resizeObserver = null;
        }
        if (runtime.themeObserver) {
            runtime.themeObserver.disconnect();
            runtime.themeObserver = null;
        }
        window.removeEventListener('resize', fitCanvas);
        if (window.__homeHeroLiquidBootstrap === api) {
            window.__homeHeroLiquidBootstrap = null;
        }
    }

    var api = {
        start: start,
        stop: stop
    };

    window.__homeHeroLiquidBootstrap = api;

    if (typeof window.ResizeObserver === 'function') {
        runtime.resizeObserver = new ResizeObserver(fitCanvas);
        runtime.resizeObserver.observe(section);
    } else {
        window.addEventListener('resize', fitCanvas, { passive: true });
    }

    if (typeof window.MutationObserver === 'function') {
        runtime.themeObserver = new MutationObserver(syncTheme);
        runtime.themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    }

    start();
}());
