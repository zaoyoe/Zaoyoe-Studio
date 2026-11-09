(function () {
    'use strict';

    var root = document.documentElement;
    var script = document.currentScript;
    var section = script && script.closest ? script.closest('.hero-section') : document.getElementById('hero-section');
    var canvas = section ? section.querySelector('#heroLiquidCanvas') : null;
    var previousRuntime = window.__homeHeroLiquidBootstrap;

    function bindEarlyHeroEntryClicks() {
        if (root.dataset.homeHeroEarlyEntryClickBound === '1') {
            return;
        }

        root.dataset.homeHeroEarlyEntryClickBound = '1';
        document.addEventListener('click', function (event) {
            if (
                event.defaultPrevented
                || event.button !== 0
                || event.metaKey
                || event.ctrlKey
                || event.shiftKey
                || event.altKey
            ) {
                return;
            }

            var target = event.target && event.target.closest
                ? event.target
                : event.target && event.target.parentElement;
            var card = target && target.closest
                ? target.closest('.hero-carousel .entry-card')
                : null;
            var carousel = card && card.closest ? card.closest('.hero-carousel') : null;
            var hero = carousel && carousel.closest ? carousel.closest('.hero-section') : null;

            if (!card || !carousel || !hero || hero.dataset.homeHeroEntryRuntimeReady === '1') {
                return;
            }

            if (card.getAttribute('data-action') && card.getAttribute('data-home-open-guestbook') !== '1') {
                return;
            }

            var cardRect = card.getBoundingClientRect();
            var carouselRect = carousel.getBoundingClientRect();
            var cardCenter = cardRect.left + (cardRect.width / 2);
            var viewportCenter = carouselRect.left + (carouselRect.width / 2);
            var distanceFromCenter = Math.abs(cardCenter - viewportCenter);

            if (distanceFromCenter <= 50) {
                return;
            }

            var cards = carousel.querySelectorAll('.entry-card');
            var requestedIndex = Array.prototype.indexOf.call(cards, card);
            Array.prototype.forEach.call(cards, function (entry) {
                entry.removeAttribute('data-home-early-center-requested');
            });
            card.setAttribute('data-home-early-center-requested', '1');
            hero.dataset.homeHeroEarlyEntryIndex = String(Math.max(0, requestedIndex));
            hero.dataset.homeHeroEarlyEntryHref = card.getAttribute('href') || '';

            event.preventDefault();
            event.stopPropagation();
            carousel.scrollTo({
                left: carousel.scrollLeft + (cardCenter - viewportCenter),
                behavior: 'smooth'
            });
        }, true);
    }

    if (previousRuntime && typeof previousRuntime.stop === 'function') {
        previousRuntime.stop();
    }

    bindEarlyHeroEntryClicks();

    if (!section || !canvas || typeof canvas.getContext !== 'function' || typeof window.requestAnimationFrame !== 'function') {
        return;
    }

    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var rawPalette = Number(section && (section.dataset.streamColor || section.dataset.palette));
    var selectedPalette = (rawPalette >= 1 && rawPalette <= 3) ? rawPalette : 3; // 1: Blue, 2: Emerald Green, 3: Orange / Copper (Default)
    var paletteMix = selectedPalette - 1.0;
    var paletteTarget = selectedPalette - 1.0;
    var INITIAL_TIME_OFFSET = 30.0; // Start at ~30s flowing state to reveal rich ribbons immediately

    var runtime = {
        active: false,
        frame: 0,
        width: 0,
        height: 0,
        resizeObserver: null
    };

    var gl = null;
    try {
        gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' })
            || canvas.getContext('experimental-webgl');
    } catch (_) {
        gl = null;
    }

    var vertexSource = [
        'attribute vec2 a_position;',
        'void main() { gl_Position = vec4(a_position, 0.0, 1.0); }'
    ].join('\n');

    var fragmentSource = [
        'precision highp float;',
        'uniform vec2 u_resolution;',
        'uniform float u_time;',
        'uniform float u_palette;',
        'float hash(vec2 p) {',
        '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
        '}',
        'float noise(vec2 p) {',
        '  vec2 i = floor(p);',
        '  vec2 f = fract(p);',
        '  f = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),',
        '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);',
        '}',
        'float fbm(vec2 p) {',
        '  float value = 0.0;',
        '  float amplitude = 0.5;',
        '  for (int i = 0; i < 4; i++) {',
        '    value += amplitude * noise(p);',
        '    p = p * 2.03 + vec2(11.7, 8.3);',
        '    amplitude *= 0.5;',
        '  }',
        '  return value;',
        '}',
        'void main() {',
        '  vec2 uv = gl_FragCoord.xy / u_resolution.xy;',
        '  vec2 p = (gl_FragCoord.xy - .5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);',
        '  float t = u_time * .045;',
        '  float warp = fbm(p * 1.75 + vec2(t, -t * .7));',
        '  float field = fbm(p * 2.15 + warp * 1.8 + vec2(-t * .48, t * .3));',
        '  float ribbons = sin((p.x * 1.8 + p.y * 1.25 + field * 3.7) * 3.5 + t * 2.0);',
        '  float liquid = field + ribbons * .08;',
        '  vec3 graphite = vec3(.004, .006, .012);',
        '  vec3 deepIndigo = vec3(.018, .036, .092);',
        '  vec3 midnightBlue = vec3(.035, .085, .22);',
        '  vec3 electricBlue = vec3(.075, .21, .50);',
        '  vec3 iceCyan = vec3(.19, .44, .58);',
        '  vec3 deepEmerald = vec3(.012, .045, .032);',
        '  vec3 jade = vec3(.024, .12, .08);',
        '  vec3 ionGreen = vec3(.10, .30, .20);',
        '  vec3 mint = vec3(.40, .62, .49);',
        '  vec3 deepOxide = vec3(.055, .018, .014);',
        '  vec3 darkCopper = vec3(.15, .045, .024);',
        '  vec3 copper = vec3(.35, .11, .045);',
        '  vec3 amber = vec3(.66, .30, .12);',
        '  float blueToGreen = clamp(u_palette, 0.0, 1.0);',
        '  float greenToCopper = clamp(u_palette - 1.0, 0.0, 1.0);',
        '  deepIndigo = mix(mix(deepIndigo, deepEmerald, blueToGreen), deepOxide, greenToCopper);',
        '  midnightBlue = mix(mix(midnightBlue, jade, blueToGreen), darkCopper, greenToCopper);',
        '  electricBlue = mix(mix(electricBlue, ionGreen, blueToGreen), copper, greenToCopper);',
        '  iceCyan = mix(mix(iceCyan, mint, blueToGreen), amber, greenToCopper);',
        '  vec3 color = mix(graphite, deepIndigo, smoothstep(.22, .49, field));',
        '  color = mix(color, midnightBlue, smoothstep(.40, .62, field));',
        '  color = mix(color, electricBlue, smoothstep(.56, .78, field));',
        '  color = mix(color, iceCyan, smoothstep(.76, .94, field));',
        '  float volumeLight = smoothstep(.28, .76, warp);',
        '  color *= 1.01 + volumeLight * .33;',
        '  float sheen = pow(max(0.0, 1.0 - abs(sin(liquid * 18.0 + warp * 5.0))), 20.0) * smoothstep(.50, .64, field);',
        '  float violetGlimmer = sheen * smoothstep(.36, .52, field) * (1.0 - smoothstep(.62, .76, field));',
        '  vec3 coolSheen = mix(vec3(.58, .76, .94), vec3(.72, .92, .72), blueToGreen);',
        '  vec3 warmSheen = vec3(1.0, .72, .46);',
        '  vec3 coolGlimmer = mix(vec3(.43, .39, .74), vec3(.84, .38, .52), blueToGreen);',
        '  vec3 warmGlimmer = vec3(.95, .42, .31);',
        '  color += mix(coolSheen, warmSheen, greenToCopper) * sheen * .085;',
        '  color += mix(coolGlimmer, warmGlimmer, greenToCopper) * violetGlimmer * .045;',
        '  float vignette = 1.0 - smoothstep(.15, 1.18, length(p * vec2(.78, 1.0)));',
        '  color *= mix(.64, 1.0, vignette);',
        '  color += (hash(gl_FragCoord.xy + u_time) - .5) * .001;',
        '  gl_FragColor = vec4(color, 1.0);',
        '}'
    ].join('\n');

    function compileShader(glCtx, type, source) {
        var shader = glCtx.createShader(type);
        glCtx.shaderSource(shader, source);
        glCtx.compileShader(shader);
        if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
            glCtx.deleteShader(shader);
            return null;
        }
        return shader;
    }

    var program = null;
    var resolutionLoc = null;
    var timeLoc = null;
    var paletteLoc = null;
    var positionBuffer = null;

    if (gl) {
        var vShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
        var fShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
        if (vShader && fShader) {
            program = gl.createProgram();
            gl.attachShader(program, vShader);
            gl.attachShader(program, fShader);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                program = null;
            }
        }
        if (program) {
            positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
            gl.useProgram(program);
            var posLoc = gl.getAttribLocation(program, 'a_position');
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
            resolutionLoc = gl.getUniformLocation(program, 'u_resolution');
            timeLoc = gl.getUniformLocation(program, 'u_time');
            paletteLoc = gl.getUniformLocation(program, 'u_palette');
        }
    }

    function selectPalette(p) {
        var num = Number(p);
        if (num < 1 || num > 3) num = 3;
        selectedPalette = num;
        paletteTarget = num - 1;
        if (reducedMotion) {
            paletteMix = paletteTarget;
        }
        var buttons = section.querySelectorAll('[data-palette]');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].setAttribute('aria-pressed', String(Number(buttons[i].getAttribute('data-palette')) === num));
        }
    }

    function bindPaletteButtons() {
        var buttons = section.querySelectorAll('[data-palette]');
        for (var i = 0; i < buttons.length; i++) {
            (function (btn) {
                if (btn.__paletteBound) return;
                btn.__paletteBound = true;
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    var p = Number(btn.getAttribute('data-palette'));
                    if (p >= 1 && p <= 3) {
                        selectPalette(p);
                    }
                });
            }(buttons[i]));
        }
    }

    function drawScene(timestamp) {
        if (!runtime.active) return;

        var rect = section.getBoundingClientRect ? section.getBoundingClientRect() : { width: section.clientWidth, height: section.clientHeight };
        var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        var width = Math.max(1, Math.floor((rect.width || section.clientWidth || window.innerWidth || 1) * pixelRatio));
        var height = Math.max(1, Math.floor((rect.height || section.clientHeight || window.innerHeight || 1) * pixelRatio));

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            gl.viewport(0, 0, width, height);
        }

        gl.uniform2f(resolutionLoc, width, height);
        gl.uniform1f(timeLoc, INITIAL_TIME_OFFSET + (reducedMotion ? 0 : timestamp * 0.001));
        if (!reducedMotion) {
            paletteMix += (paletteTarget - paletteMix) * 0.045;
        }
        gl.uniform1f(paletteLoc, paletteMix);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        // Optional mobile subscriber copies before the WebGL buffer is discarded.
        canvas.__mobileGlassFrame?.();

        if (!reducedMotion) {
            runtime.frame = window.requestAnimationFrame(drawScene);
        }
    }

    function runFallback2D() {
        var ctx2d = canvas.getContext ? canvas.getContext('2d') : null;
        if (!ctx2d) return;

        function paint2D() {
            if (!runtime.active) return;
            var w = canvas.width;
            var h = canvas.height;
            ctx2d.fillStyle = '#0b0e19';
            ctx2d.fillRect(0, 0, w, h);
            var spots = selectedPalette === 1
                ? [
                    [w * 0.24, h * 0.38, w * 0.29, 'rgba(29, 57, 125, .71)'],
                    [w * 0.59, h * 0.57, w * 0.26, 'rgba(31, 119, 150, .62)'],
                    [w * 0.80, h * 0.3, w * 0.28, 'rgba(78, 76, 160, .53)'],
                    [w * 0.49, h * 0.34, w * 0.10, 'rgba(137, 188, 215, .34)']
                ]
                : selectedPalette === 2
                ? [
                    [w * 0.24, h * 0.38, w * 0.29, 'rgba(14, 64, 44, .76)'],
                    [w * 0.59, h * 0.57, w * 0.26, 'rgba(34, 132, 91, .64)'],
                    [w * 0.80, h * 0.3, w * 0.28, 'rgba(76, 116, 71, .54)'],
                    [w * 0.49, h * 0.34, w * 0.10, 'rgba(178, 222, 157, .38)']
                ]
                : [
                    [w * 0.24, h * 0.38, w * 0.29, 'rgba(73, 32, 24, .76)'],
                    [w * 0.59, h * 0.57, w * 0.26, 'rgba(157, 73, 41, .65)'],
                    [w * 0.80, h * 0.3, w * 0.28, 'rgba(161, 88, 47, .56)'],
                    [w * 0.49, h * 0.34, w * 0.10, 'rgba(238, 183, 112, .40)']
                ];
            ctx2d.globalCompositeOperation = 'screen';
            var now = performance.now() + INITIAL_TIME_OFFSET * 1000;
            for (var i = 0; i < spots.length; i++) {
                var s = spots[i];
                var dx = reducedMotion ? 0 : Math.sin(now * 0.00013 + i * 2) * w * 0.035;
                var dy = reducedMotion ? 0 : Math.cos(now * 0.00011 + i) * h * 0.04;
                var grad = ctx2d.createRadialGradient(s[0] + dx, s[1] + dy, 0, s[0] + dx, s[1] + dy, s[2]);
                grad.addColorStop(0, s[3]);
                grad.addColorStop(1, 'rgba(11,14,25,0)');
                ctx2d.fillStyle = grad;
                ctx2d.fillRect(0, 0, w, h);
            }
            ctx2d.globalCompositeOperation = 'source-over';
            canvas.__mobileGlassFrame?.();
            if (!reducedMotion) {
                runtime.frame = window.requestAnimationFrame(paint2D);
            }
        }
        paint2D();
    }

    function fitCanvas() {
        if (!runtime.active) return;
        var rect = section.getBoundingClientRect ? section.getBoundingClientRect() : { width: section.clientWidth, height: section.clientHeight };
        var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        var width = Math.max(1, Math.floor((rect.width || section.clientWidth || window.innerWidth || 1) * pixelRatio));
        var height = Math.max(1, Math.floor((rect.height || section.clientHeight || window.innerHeight || 1) * pixelRatio));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            if (gl) {
                gl.viewport(0, 0, width, height);
            }
        }
        runtime.width = width;
        runtime.height = height;
    }

    function start() {
        if (runtime.active) return;
        runtime.active = true;
        bindPaletteButtons();
        fitCanvas();
        if (program && gl) {
            runtime.frame = window.requestAnimationFrame(drawScene);
        } else {
            runFallback2D();
        }
    }

    function pause() {
        runtime.active = false;
        if (runtime.frame) {
            window.cancelAnimationFrame(runtime.frame);
            runtime.frame = 0;
        }
    }

    function stop() {
        pause();
        if (runtime.resizeObserver) {
            runtime.resizeObserver.disconnect();
            runtime.resizeObserver = null;
        }
        window.removeEventListener('resize', fitCanvas);
        if (window.__homeHeroLiquidBootstrap === api) {
            window.__homeHeroLiquidBootstrap = null;
        }
    }

    var api = {
        start: start,
        stop: stop,
        selectPalette: selectPalette,
        bindPaletteButtons: bindPaletteButtons,
        isRunning: function () { return runtime.active; }
    };

    window.__homeHeroLiquidBootstrap = api;

    if (typeof window.ResizeObserver === 'function') {
        runtime.resizeObserver = new ResizeObserver(fitCanvas);
        runtime.resizeObserver.observe(section);
    } else {
        window.addEventListener('resize', fitCanvas, { passive: true });
    }

    start();
}());
