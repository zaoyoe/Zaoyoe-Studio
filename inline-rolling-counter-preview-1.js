
      (() => {
        /* ── inlined from lab/spring ─────────────────────────
           One spring per column. Frames, not milliseconds: the
           damping is raised to dt so a dropped frame decays the
           same amount of energy as the frames it replaced. */
        const CELL = 46;
        const PX = 12;
        const PAD = 5;
        const PLACES = 5;
        const MAX = 10 ** PLACES - 1;
        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

        const root = document.querySelector(".rct");
        const number = root.querySelector(".rct-num");
        const buttons = [...root.querySelectorAll(".rct-btn")];
        const columns = [...root.querySelectorAll(".rct-col")].sort((a, b) => Number(a.dataset.place) - Number(b.dataset.place));
        const strips = columns.map((column) => {
          const strip = column.querySelector(".rct-strip");
          strip.replaceChildren(...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit) => {
            const cell = document.createElement("span");
            cell.textContent = digit;
            return cell;
          }));
          return strip;
        });

        let value = 95;
        let raf = 0;
        let fling = 0;
        let knobs = { bounce: 45, stagger: 45, blur: 50 };
        const cols = Array.from({ length: PLACES }, (_, place) => {
          const digitCount = Math.floor(value / 10 ** place);
          return { pos: digitCount, vel: 0, target: digitCount, due: [], next: [] };
        });

        const springOf = (tune) => ({
          /* stiffness: how hard it is pulled toward the target */
          k: 0.08 + (tune / 100) * 0.16,
          /* decay, per frame: how much of the velocity survives */
          d: 0.62 + (tune / 100) * 0.2,
        });

        const paint = () => {
          cols.forEach((column, place) => {
            const modulo = ((column.pos % 10) + 10) % 10;
            const smear = Math.min(3, Math.abs(column.vel) * 2.4) * (knobs.blur / 50);
            strips[place].style.transform = `translateY(${-modulo * CELL}px)`;
            strips[place].style.filter = smear > 0.15 ? `blur(${smear.toFixed(2)}px)` : "";
          });
        };

        const updateVisibleColumns = () => {
          const shown = Math.max(1, String(value).length);
          columns.forEach((column) => {
            column.toggleAttribute("data-on", Number(column.dataset.place) < shown);
          });
          root.querySelector(".rct-sep").toggleAttribute("data-on", shown > 3);
          number.setAttribute("aria-valuenow", String(value));
        };

        const run = () => {
          if (raf) return;
          let previous = 0;
          const tick = (time) => {
            const dt = previous ? clamp((time - previous) / 16.67, 0, 2.5) : 1;
            previous = time;
            const { k, d } = springOf(knobs.bounce);
            const now = performance.now();
            let busy = false;

            for (const column of cols) {
              /* Targets that have waited their turn. */
              while (column.due.length && column.due[0] <= now) {
                column.due.shift();
                column.target = column.next.shift();
              }
              if (column.due.length) busy = true;

              /* A far-away column jumps most of the way in whole
                 turns first, so a flick never spins the ones column
                 for a second. */
              const gap = column.target - column.pos;
              if (Math.abs(gap) > 24) column.pos += Math.round((gap - Math.sign(gap) * 24) / 10) * 10;
              column.vel += (column.target - column.pos) * k * dt;
              column.vel *= Math.pow(d, dt);
              column.pos += column.vel * dt;

              if (Math.abs(column.target - column.pos) < 0.004 && Math.abs(column.vel) < 0.004) {
                column.pos = column.target;
                column.vel = 0;
              } else {
                busy = true;
              }
            }

            paint();
            raf = busy ? requestAnimationFrame(tick) : 0;
          };
          raf = requestAnimationFrame(tick);
        };

        const bump = (amount) => {
          const next = clamp(value + amount, 0, MAX);
          if (next === value) return;
          value = next;
          updateVisibleColumns();
          const now = performance.now();

          cols.forEach((column, place) => {
            const target = Math.floor(value / 10 ** place);
            if (still) {
              column.pos = column.target = target;
              column.vel = 0;
              column.due = [];
              column.next = [];
              return;
            }
            column.due.push(now + place * knobs.stagger);
            column.next.push(target);
          });

          if (still) paint();
          else run();
        };

        /* ── holding a button ───────────────────────────────
           A press starts one step. Holding it repeats, then switches
           to tens after a second and a half. */
        const hold = { timer: 0, since: 0 };
        const release = () => {
          clearTimeout(hold.timer);
          hold.timer = 0;
        };
        const press = (direction) => {
          release();
          bump(direction);
          hold.since = performance.now();
          const repeat = () => {
            const elapsed = performance.now() - hold.since;
            bump(direction * (elapsed > 1500 ? 10 : 1));
            hold.timer = window.setTimeout(repeat, elapsed > 900 ? 55 : 90);
          };
          hold.timer = window.setTimeout(repeat, 380);
        };

        buttons.forEach((button) => {
          const direction = Number(button.dataset.dir);
          button.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            press(direction);
          });
          ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => button.addEventListener(eventName, release));
          button.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              bump(direction);
            }
          });
        });

        /* ── taking the number itself ────────────────────────
           Drag up for more, down for less. Release while moving
           and the accumulated velocity carries the number onward. */
        let drag = null;
        const steps = (accumulator) => {
          const stepCount = accumulator > 0 ? Math.floor(accumulator / PX) : Math.ceil(accumulator / PX);
          if (stepCount) bump(stepCount);
          return accumulator - stepCount * PX;
        };

        number.addEventListener("pointerdown", (event) => {
          cancelAnimationFrame(fling);
          try { number.setPointerCapture(event.pointerId); } catch { /* scripted pointer */ }
          drag = { y: event.clientY, acc: 0, velocity: 0, time: performance.now() };
        });

        number.addEventListener("pointermove", (event) => {
          if (!drag) return;
          const now = performance.now();
          const deltaY = drag.y - event.clientY;
          drag.y = event.clientY;
          const deltaTime = Math.max(1, now - drag.time);
          drag.time = now;
          drag.velocity = drag.velocity * 0.6 + (deltaY / deltaTime) * 0.4;
          drag.acc = steps(drag.acc + deltaY);
        });

        const endDrag = (event) => {
          const current = drag;
          drag = null;
          try { number.releasePointerCapture(event.pointerId); } catch { /* never captured */ }
          if (!current || still) return;
          let velocity = performance.now() - current.time > 90 ? 0 : current.velocity * 16.67;
          if (Math.abs(velocity) < 2) return;
          let accumulator = current.acc;
          const coast = () => {
            accumulator = steps(accumulator + velocity);
            velocity *= 0.94;
            if (Math.abs(velocity) > 0.4) fling = requestAnimationFrame(coast);
          };
          fling = requestAnimationFrame(coast);
        };

        number.addEventListener("pointerup", endDrag);
        number.addEventListener("pointercancel", endDrag);
        number.addEventListener("keydown", (event) => {
          if (event.key === "ArrowUp") { event.preventDefault(); bump(1); }
          if (event.key === "ArrowDown") { event.preventDefault(); bump(-1); }
        });

        /* The preview exposes the component's tuning knobs. */
        const controls = {
          bounce: document.querySelector("#bounce"),
          stagger: document.querySelector("#stagger"),
          blur: document.querySelector("#blur"),
        };
        const outputs = {
          bounce: document.querySelector("#bounce-output"),
          stagger: document.querySelector("#stagger-output"),
          blur: document.querySelector("#blur-output"),
        };
        Object.entries(controls).forEach(([name, input]) => {
          input.addEventListener("input", () => {
            knobs[name] = Number(input.value);
            outputs[name].textContent = name === "stagger" ? `${input.value} ms` : input.value;
            if (name === "blur") paint();
          });
        });

        document.querySelectorAll("[data-corner]").forEach((button) => {
          button.addEventListener("click", () => {
            const corner = Number(button.dataset.corner);
            root.style.setProperty("--rct-r", `${corner}px`);
            root.style.setProperty("--rct-in", `${Math.max(0, corner - PAD)}px`);
            document.querySelectorAll("[data-corner]").forEach((item) => {
              item.setAttribute("aria-pressed", String(item === button));
            });
          });
        });

        updateVisibleColumns();
        paint();
        window.addEventListener("pagehide", () => {
          release();
          cancelAnimationFrame(raf);
          cancelAnimationFrame(fling);
        });
      })();
