
      import { adapt, luma, pickInk, sampler, tintFloor } from "./vendor/glasswork/adapt.js";
      import { liquidGlass } from "./vendor/glasswork/lens.js";
      import { createRefraction } from "./vendor/glasswork/refract.js";

      (() => {
        const dock = document.querySelector(".gdock");
        const dockCluster = dock.closest(".dock-cluster");
        const stage = dock.closest(".stage");
        const sceneCanvas = stage.querySelector(".stage-scene");
        const refractCanvas = stage.querySelector(".gdock-refract-canvas");
        const glass = dock.querySelector(".gdock-glass");
        const sceneContext = sceneCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
        const wallpaperSampler = sampler();
        // CSS may parse SVG backdrop URLs without rendering their displacement.
        const useWebGLRefraction = true;
        const glassLens = liquidGlass(glass, {
          rim: 20,
          edge: 1.1,
          power: 2.6,
          dispersion: 0.12,
          enabled: !useWebGLRefraction,
        });
        let pixelRatio = 1;
        let refraction = null;
        let adaptiveInk = null;

        const reducedTransparency = window.matchMedia("(prefers-reduced-transparency: reduce)");
        const forcedColors = window.matchMedia("(forced-colors: active)");
        const isWebKit = /AppleWebKit/.test(navigator.userAgent) && !/(Chrome|Chromium|Edg|OPR)/.test(navigator.userAgent);
        if (isWebKit) stage.dataset.engine = "webkit";

        try {
          if (useWebGLRefraction || !glassLens.supported) {
            refraction = createRefraction(refractCanvas, {
              source: () => ({ el: sceneCanvas, moving: true, external: true }),
              surfaces: () => {
                const rect = glass.getBoundingClientRect();
                const stageRect = stage.getBoundingClientRect();
                const style = getComputedStyle(glass);
                const number = (property, fallback) => Number.parseFloat(style.getPropertyValue(property)) || fallback;
                return [{
                  x: rect.left - stageRect.left - stage.clientLeft,
                  y: rect.top - stageRect.top - stage.clientTop,
                  w: rect.width,
                  h: rect.height,
                  radius: rect.height / 2,
                  rim: useWebGLRefraction ? 28 : glassLens.bezel || 28,
                  edge: 1,
                  power: 2.2,
                  blur: number("--m-blur", 1.5),
                  saturate: number("--m-sat", 1.5),
                  contrast: number("--m-con", 1),
                  brightness: number("--m-bri", 1),
                  keep: number("--keep", 1),
                  dispersion: 0.2,
                }];
              },
            });
          }
        } catch {
          refraction = null;
        }

        const updateTransparencyMode = () => {
          const enabled = !reducedTransparency.matches && !forcedColors.matches;
          glassLens.update({ enabled: enabled && !useWebGLRefraction });
          const useRefraction = enabled && Boolean(refraction) && (useWebGLRefraction || !glassLens.supported);
          refractCanvas.hidden = !useRefraction;
          refraction?.setEnabled(useRefraction);
          if (useRefraction) stage.dataset.refract = "webgl";
          else delete stage.dataset.refract;
          if (enabled) {
            if (!useWebGLRefraction) glassLens.refresh();
            refraction?.wake();
          }
        };

        reducedTransparency.addEventListener("change", updateTransparencyMode);
        forcedColors.addEventListener("change", updateTransparencyMode);
        updateTransparencyMode();

        const drawScene = (width, height, time) => {
          pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
          const sceneWidth = Math.max(1, Math.round(width * pixelRatio));
          const sceneHeight = Math.max(1, Math.round(height * pixelRatio));
          if (sceneCanvas.width !== sceneWidth || sceneCanvas.height !== sceneHeight) {
            sceneCanvas.width = sceneWidth;
            sceneCanvas.height = sceneHeight;
          }
          sceneContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

          const base = sceneContext.createLinearGradient(0, 0, width, height);
          base.addColorStop(0, "#e78c70");
          base.addColorStop(0.24, "#aa668e");
          base.addColorStop(0.49, "#555e9c");
          base.addColorStop(0.73, "#287d8f");
          base.addColorStop(1, "#d0aa67");
          sceneContext.fillStyle = base;
          sceneContext.fillRect(0, 0, width, height);

          const glow = (x, y, radius, color) => {
            const gradient = sceneContext.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
            sceneContext.fillStyle = gradient;
            sceneContext.fillRect(x - radius, y - radius, radius * 2, radius * 2);
          };

          const phase = time * 0.00012;
          sceneContext.save();
          sceneContext.globalCompositeOperation = "screen";
          glow(width * (0.14 + 0.035 * Math.sin(phase)), height * 0.1, width * 0.5, "rgba(255, 207, 136, 0.3)");
          glow(width * 0.84, height * (0.3 + 0.04 * Math.cos(phase)), width * 0.34, "rgba(250, 139, 165, 0.25)");
          glow(width * 0.79, height * 0.88, width * 0.46, "rgba(78, 211, 201, 0.34)");
          glow(width * 0.3, height * 0.91, width * 0.32, "rgba(184, 158, 247, 0.2)");

          // Keep a few sharper color landmarks behind the Dock so the refraction remains legible.
          sceneContext.save();
          sceneContext.globalCompositeOperation = "screen";
          sceneContext.filter = "blur(5px)";
          const ribbon = (x, y, widthRatio, heightRatio, angle, color) => {
            sceneContext.save();
            sceneContext.translate(x, y);
            sceneContext.rotate(angle);
            sceneContext.fillStyle = color;
            sceneContext.beginPath();
            sceneContext.ellipse(0, 0, width * widthRatio, height * heightRatio, 0, 0, Math.PI * 2);
            sceneContext.fill();
            sceneContext.restore();
          };
          ribbon(width * 0.1, height * 0.82, 0.22, 0.07, -0.18, "rgba(255, 214, 139, 0.32)");
          ribbon(width * 0.56, height * 0.92, 0.3, 0.065, 0.08, "rgba(75, 227, 211, 0.38)");
          ribbon(width * 0.91, height * 0.77, 0.22, 0.08, -0.28, "rgba(249, 133, 169, 0.34)");
          sceneContext.restore();

          sceneContext.save();
          sceneContext.globalCompositeOperation = "screen";
          sceneContext.translate(width * (0.52 + 0.05 * Math.sin(phase * 0.8)), height * 0.78);
          sceneContext.rotate(-0.25 + 0.025 * Math.cos(phase));
          sceneContext.lineWidth = 2.5;
          sceneContext.strokeStyle = "rgba(255, 247, 228, 0.86)";
          sceneContext.beginPath();
          sceneContext.moveTo(-width * 0.7, 0);
          sceneContext.lineTo(width * 0.7, 0);
          sceneContext.stroke();
          sceneContext.lineWidth = 5;
          sceneContext.strokeStyle = "rgba(82, 224, 211, 0.4)";
          sceneContext.beginPath();
          sceneContext.moveTo(-width * 0.62, 11);
          sceneContext.lineTo(width * 0.62, 11);
          sceneContext.stroke();
          sceneContext.restore();

          const bandLength = Math.hypot(width, height) * 1.7;
          sceneContext.translate(
            width * (0.5 + 0.16 * Math.sin(phase)),
            height * (0.5 + 0.1 * Math.cos(phase * 0.8)),
          );
          sceneContext.rotate(-0.48 + 0.045 * Math.sin(phase * 0.7));
          const band = sceneContext.createLinearGradient(0, -112, 0, 112);
          band.addColorStop(0, "rgba(65, 220, 210, 0)");
          band.addColorStop(0.25, "rgba(76, 216, 204, 0.46)");
          band.addColorStop(0.39, "rgba(245, 198, 128, 0.48)");
          band.addColorStop(0.49, "rgba(255, 255, 255, 0.84)");
          band.addColorStop(0.59, "rgba(245, 132, 154, 0.58)");
          band.addColorStop(0.76, "rgba(162, 135, 232, 0.42)");
          band.addColorStop(1, "rgba(64, 193, 216, 0)");
          sceneContext.filter = "blur(20px)";
          sceneContext.fillStyle = band;
          sceneContext.fillRect(-bandLength / 2, -116, bandLength, 232);

          const glint = sceneContext.createLinearGradient(0, -5, 0, 5);
          glint.addColorStop(0, "rgba(255, 255, 255, 0)");
          glint.addColorStop(0.5, "rgba(255, 255, 255, 0.78)");
          glint.addColorStop(1, "rgba(255, 255, 255, 0)");
          sceneContext.filter = "blur(1px)";
          sceneContext.fillStyle = glint;
          sceneContext.fillRect(-bandLength / 2, -5, bandLength, 10);
          sceneContext.restore();
          sceneContext.globalCompositeOperation = "source-over";
          sceneContext.filter = "none";

        };

        const updateGlassMaterial = () => {
          const stageRect = stage.getBoundingClientRect();
          const rect = glass.getBoundingClientRect();
          if (!wallpaperSampler.capture(sceneCanvas, stage.clientWidth, stage.clientHeight)) return;
          const sample = wallpaperSampler.sample({
            x: rect.left - stageRect.left - stage.clientLeft,
            y: rect.top - stageRect.top - stage.clientTop,
            w: rect.width,
            h: rect.height,
          });
          if (!sample) return;

          const kind = glass.dataset.kind;
          const tintLevel = kind === "dark" ? luma([23, 29, 32]) : 1;
          const thin = kind === "dark" ? 0.12 : 0.035;
          const dense = kind === "dark" ? 0.32 : 0.2;
          const strength = kind === "dark" ? 0.86 : 0.82;
          const initialInk = kind === "dark" ? "light" : "dark";
          const estimate = adapt(sample, initialInk);
          const tintAlpha = Math.min(0.95, (thin + (dense - thin) * estimate.density) * strength);
          const underInkLuminance = sample.luminance + (tintLevel - sample.luminance) * tintAlpha;
          const ink = pickInk(underInkLuminance, adaptiveInk, 0.5, 0.055);
          const tone = adapt(sample, ink);
          const floor = tintFloor(sample.luminance, sample.texture, ink, tintLevel);
          const setGlassValue = (property, value) => {
            const text = String(value);
            if (glass.style.getPropertyValue(property) !== text) glass.style.setProperty(property, text);
          };

          setGlassValue("--density", tone.density.toFixed(3));
          setGlassValue("--keep", tone.saturate.toFixed(3));
          setGlassValue("--floor", floor.toFixed(3));
          dock.style.setProperty("--ink", ink === "light" ? "rgba(245, 245, 247, 0.94)" : "rgba(29, 29, 31, 0.86)");
          dock.dataset.ink = ink;
          adaptiveInk = ink;
        };

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let animationFrame = 0;
        let lastFrameAt = 0;

        const renderFrame = (time) => {
          if (time - lastFrameAt < 50 && lastFrameAt !== 0) {
            animationFrame = requestAnimationFrame(renderFrame);
            return;
          }
          lastFrameAt = time;
          const width = stage.clientWidth;
          const height = stage.clientHeight;
          if (!width || !height) return;
          drawScene(width, height, time);
          updateGlassMaterial();
          refraction?.frame();
          if (!reducedMotion) animationFrame = requestAnimationFrame(renderFrame);
        };

        const syncDockEffects = () => {
          if (animationFrame) cancelAnimationFrame(animationFrame);
          lastFrameAt = 0;
          renderFrame(performance.now());
        };

        syncDockEffects();
        window.addEventListener("resize", syncDockEffects, { passive: true });
        const resizeObserver = new ResizeObserver(syncDockEffects);
        resizeObserver.observe(stage);
        resizeObserver.observe(dockCluster);

        const items = [...dock.querySelectorAll(".gdock-item")];
        const tip = dock.querySelector(".gdock-tip");
        const tipWord = tip.querySelector("span");
        const selectedLabel = document.querySelector("#selected-label");
        const downPointer = { active: false, type: "" };
        const chimeNotes = [392, 440, 494, 523, 587];
        let audioContext = null;
        let pendingChime = null;
        let audioResumePending = false;
        let chimesEnabled = document.querySelector("#chimes-toggle").checked;
        let hoverIndex = null;
        let activeKey = "home";
        let magnify = 1.18;
        let lift = 7;
        let reach = 1;
        let labels = true;
        const hoverDeformation = {
          x: 0,
          y: 0,
          time: 0,
          velocityX: 0,
          velocityY: 0,
          releaseTimer: 0,
        };

        const at = (clientX) => {
          let best = 0;
          let gap = Infinity;
          items.forEach((item, index) => {
            const rect = item.getBoundingClientRect();
            const distance = Math.abs(clientX - (rect.left + rect.width / 2));
            if (distance < gap) {
              best = index;
              gap = distance;
            }
          });
          return best;
        };

        const unlockAudio = () => {
          if (!chimesEnabled) return;
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) return;
          if (!audioContext || audioContext.state === "closed") audioContext = new AudioContextClass();
          const flushPendingChime = () => {
            audioResumePending = false;
            if (audioContext.state !== "running" || pendingChime === null) return;
            const index = pendingChime;
            pendingChime = null;
            playChime(index);
          };
          if (audioContext.state === "running") {
            flushPendingChime();
            return;
          }
          audioResumePending = true;
          audioContext.resume().then(flushPendingChime).catch(() => {
            audioResumePending = false;
            if (hoverIndex === null) pendingChime = null;
          });
        };

        const playChime = (index) => {
          if (!chimesEnabled) return;
          if (!audioContext || audioContext.state !== "running") {
            pendingChime = index;
            unlockAudio();
            return;
          }
          const now = audioContext.currentTime;
          const frequency = chimeNotes[index % chimeNotes.length];
          const voice = audioContext.createOscillator();
          const overtone = audioContext.createOscillator();
          const voiceGain = audioContext.createGain();
          const overtoneGain = audioContext.createGain();
          voice.type = "sine";
          overtone.type = "sine";
          voice.frequency.setValueAtTime(frequency * 1.035, now);
          voice.frequency.exponentialRampToValueAtTime(frequency, now + 0.045);
          overtone.frequency.setValueAtTime(frequency * 2.01, now);
          voiceGain.gain.setValueAtTime(0.0001, now);
          voiceGain.gain.exponentialRampToValueAtTime(0.075, now + 0.009);
          voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
          overtoneGain.gain.setValueAtTime(0.0001, now);
          overtoneGain.gain.exponentialRampToValueAtTime(0.009, now + 0.008);
          overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
          voice.connect(voiceGain).connect(audioContext.destination);
          overtone.connect(overtoneGain).connect(audioContext.destination);
          voice.start(now);
          overtone.start(now);
          voice.stop(now + 0.18);
          overtone.stop(now + 0.07);
        };

        window.addEventListener("pointerdown", unlockAudio, { capture: true, passive: true });
        window.addEventListener("keydown", unlockAudio, { capture: true });
        unlockAudio();

        const setHover = (index, soundOnEnter = false) => {
          const previousIndex = hoverIndex;
          hoverIndex = index;
          if (index === null && !audioResumePending) pendingChime = null;
          if (soundOnEnter && index !== null && index !== previousIndex) playChime(index);
          items.forEach((item, itemIndex) => {
            const distance = index === null ? Infinity : Math.abs(itemIndex - index);
            const influence = distance > reach ? 0 : (1 + Math.cos((Math.PI * distance) / (reach + 1))) / 2;
            const scale = 1 + (magnify - 1) * influence;
            const glyph = item.querySelector(".gdock-glyph");
            const dot = item.querySelector(".gdock-dot");
            item.dataset.near = distance <= 1 ? String(distance) : "";
            glyph.style.transform = `translateY(${-lift * influence}px) scale(${scale})`;
            dot.dataset.on = String(item.dataset.key === activeKey);
          });
          updateTip();
        };

        const updateGlass = (event) => {
          const rect = dock.getBoundingClientRect();
          const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
          const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
          dock.style.setProperty("--glass-x", `${x}%`);
          dock.style.setProperty("--glass-y", `${y}%`);
          dock.dataset.interacting = "true";
          refraction?.wake();
        };

        const resetGlass = () => {
          dock.dataset.interacting = "false";
          dock.style.setProperty("--glass-x", "50%");
          dock.style.setProperty("--glass-y", "0%");
          refraction?.wake();
        };

        const resetDockDeformation = () => {
          if (hoverDeformation.releaseTimer) {
            window.clearTimeout(hoverDeformation.releaseTimer);
            hoverDeformation.releaseTimer = 0;
          }
          hoverDeformation.velocityX = 0;
          hoverDeformation.velocityY = 0;
          hoverDeformation.time = 0;
          dock.style.setProperty("--dock-scale-x", "1");
          dock.style.setProperty("--dock-scale-y", "1");
          dock.style.setProperty("--dock-shear-x", "0deg");
          dock.style.setProperty("--dock-shear-y", "0deg");
          dock.style.setProperty("--dock-shift-x", "0px");
          dock.style.setProperty("--dock-shift-y", "0px");
          refraction?.wake();
        };

        const updateDockDeformation = (event) => {
          if (event.pointerType !== "mouse" || downPointer.active) return;
          const now = performance.now();
          if (!hoverDeformation.time) {
            hoverDeformation.x = event.clientX;
            hoverDeformation.y = event.clientY;
            hoverDeformation.time = now;
            return;
          }

          const elapsed = Math.max(8, now - hoverDeformation.time);
          const deltaX = event.clientX - hoverDeformation.x;
          const deltaY = event.clientY - hoverDeformation.y;
          hoverDeformation.x = event.clientX;
          hoverDeformation.y = event.clientY;
          hoverDeformation.time = now;
          const instantVelocityX = Math.max(-1.6, Math.min(1.6, deltaX / elapsed));
          const instantVelocityY = Math.max(-1.6, Math.min(1.6, deltaY / elapsed));
          hoverDeformation.velocityX = hoverDeformation.velocityX * 0.58 + instantVelocityX * 0.42;
          hoverDeformation.velocityY = hoverDeformation.velocityY * 0.58 + instantVelocityY * 0.42;

          const velocityX = hoverDeformation.velocityX;
          const velocityY = hoverDeformation.velocityY;
          const speedX = Math.min(1, Math.abs(velocityX) / 1.15);
          const speedY = Math.min(1, Math.abs(velocityY) / 1.15);
          const stretchX = speedX * 0.018 + speedY * 0.003;
          const stretchY = speedY * 0.016 + speedX * 0.004;
          const squeezeX = speedY * 0.006;
          const squeezeY = speedX * 0.006;
          const shearX = Math.max(-0.45, Math.min(0.45, velocityY * 0.25));
          const shearY = Math.max(-0.35, Math.min(0.35, -velocityX * 0.2));
          const shiftX = Math.max(-0.35, Math.min(0.35, -velocityX * 0.22));
          const shiftY = Math.max(-0.35, Math.min(0.35, -velocityY * 0.22));
          dock.style.setProperty("--dock-scale-x", (1 + stretchX - squeezeX).toFixed(4));
          dock.style.setProperty("--dock-scale-y", (1 + stretchY - squeezeY).toFixed(4));
          dock.style.setProperty("--dock-shear-x", `${shearX.toFixed(3)}deg`);
          dock.style.setProperty("--dock-shear-y", `${shearY.toFixed(3)}deg`);
          dock.style.setProperty("--dock-shift-x", `${shiftX.toFixed(2)}px`);
          dock.style.setProperty("--dock-shift-y", `${shiftY.toFixed(2)}px`);
          if (hoverDeformation.releaseTimer) window.clearTimeout(hoverDeformation.releaseTimer);
          hoverDeformation.releaseTimer = window.setTimeout(resetDockDeformation, 120);
        };

        const updateTip = () => {
          if (!labels || hoverIndex === null) {
            tip.dataset.on = "false";
            return;
          }
          const item = items[hoverIndex];
          tipWord.textContent = item.getAttribute("aria-label");
          tip.style.width = `${Math.ceil(tipWord.scrollWidth) + 24}px`;
          const center = item.offsetLeft + item.offsetWidth / 2;
          tip.style.transform = `translateX(${center - parseFloat(tip.style.width) / 2}px)`;
          tip.dataset.on = "true";
        };

        const select = (item) => {
          activeKey = item.dataset.key;
          selectedLabel.textContent = item.getAttribute("aria-label");
          items.forEach((button) => {
            const active = button === item;
            button.dataset.active = String(active);
            if (active) button.setAttribute("aria-current", "page");
            else button.removeAttribute("aria-current");
            button.querySelector(".gdock-dot").dataset.on = String(active);
          });
        };

        const track = (event) => {
          if (event.pointerType !== "mouse" && !downPointer.active) return;
          updateGlass(event);
          updateDockDeformation(event);
          setHover(at(event.clientX), event.pointerType === "mouse" && !downPointer.active);
        };

        dock.addEventListener("pointerdown", (event) => {
          downPointer.active = true;
          downPointer.type = event.pointerType;
          if (event.pointerType !== "mouse") resetDockDeformation();
          updateGlass(event);
          setHover(at(event.clientX));
        }, true);

        dock.addEventListener("pointermove", track, true);

        dock.addEventListener("pointerup", (event) => {
          if (downPointer.active && event.pointerType !== "mouse") {
            select(items[at(event.clientX)]);
            setHover(null);
            resetGlass();
          }
          downPointer.active = false;
        }, true);

        dock.addEventListener("pointercancel", () => {
          downPointer.active = false;
          setHover(null);
          resetGlass();
          resetDockDeformation();
        }, true);

        dock.addEventListener("pointerleave", () => {
          if (!downPointer.active) {
            setHover(null);
            resetGlass();
            resetDockDeformation();
          }
        });

        window.addEventListener("pointerup", () => {
          if (downPointer.active) {
            downPointer.active = false;
            setHover(null);
            resetGlass();
            resetDockDeformation();
          }
        });

        window.addEventListener("pointercancel", () => {
          downPointer.active = false;
          setHover(null);
          resetGlass();
          resetDockDeformation();
        });

        items.forEach((item) => {
          item.addEventListener("click", (event) => {
            if (downPointer.type === "touch" && event.detail !== 0) return;
            select(item);
          });
          item.addEventListener("pointerdown", (event) => event.stopPropagation());
        });

        document.querySelectorAll("[data-setting]").forEach((button) => {
          button.addEventListener("click", () => {
            const { setting, value } = button.dataset;
            button.parentElement.querySelectorAll("[data-setting]").forEach((option) => {
              option.setAttribute("aria-pressed", String(option === button));
            });
            dock.dataset[setting] = value;
            dockCluster.dataset[setting] = value;
            if (setting === "fill") {
              glass.dataset.kind = value;
              dock.style.setProperty("--ink", value === "dark" ? "rgba(245, 245, 247, 0.94)" : "rgba(29, 29, 31, 0.86)");
              adaptiveInk = null;
              updateGlassMaterial();
              glassLens.refresh();
              refraction?.wake();
            } else {
              refraction?.wake();
            }
          });
        });

        document.querySelector("#labels-toggle").addEventListener("change", (event) => {
          labels = event.currentTarget.checked;
          updateTip();
        });

        document.querySelector("#chimes-toggle").addEventListener("change", (event) => {
          chimesEnabled = event.currentTarget.checked;
          if (chimesEnabled) unlockAudio();
        });

        const bindRange = (id, outputId, suffix, update) => {
          const input = document.getElementById(id);
          const output = document.getElementById(outputId);
          input.addEventListener("input", () => {
            output.value = `${input.value}${suffix}`;
            update(Number(input.value));
          });
        };

        bindRange("magnify-control", "magnify-value", "×", (value) => {
          magnify = value;
          if (hoverIndex !== null) setHover(hoverIndex);
        });
        bindRange("lift-control", "lift-value", "px", (value) => {
          lift = value;
          if (hoverIndex !== null) setHover(hoverIndex);
        });
        bindRange("reach-control", "reach-value", "", (value) => {
          reach = value;
          if (hoverIndex !== null) setHover(hoverIndex);
        });

        requestAnimationFrame(() => { tip.dataset.ready = "true"; });
      })();
