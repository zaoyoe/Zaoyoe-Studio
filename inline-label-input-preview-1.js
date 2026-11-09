
      (() => {
        const W = 280;
        const H = 52;
        const S = 0.78;
        /* Keep the stroke half inside the SVG edge so it is not clipped. */
        const IN = 0.75;
        const fields = [...document.querySelectorAll(".lbi")];
        let corner = 20;
        let flip = 0;

        function updateField(root) {
          const field = root.dataset.field;
          const label = root.querySelector(".lbi-label");
          const input = root.querySelector(".lbi-field");
          const box = root.querySelector(".lbi-box");
          const r = Math.min(H / 2, Math.max(0, corner));
          const up = root.dataset.focus === "true" || input.value.length > 0;
          const lx = Math.max(16, r + 6);
          const x0 = Math.max(r, lx - 5);
          /* Measure the untransformed label; getBoundingClientRect() already
             includes the lifted label's scale and would scale the notch twice. */
          const x1 = Math.min(W - r, Math.max(x0 + 10, Math.round(lx + label.offsetWidth * S + 5)));
          const a = Math.max(0, r - IN);
          const R = W - IN;
          const B = H - IN;
          const mid = Math.round(W / 2);
          const nm = Math.round((x0 + x1) / 2);

          root.dataset.up = String(up);
          root.dataset.filled = String(input.value.length > 0);
          box.style.borderRadius = `${r}px`;
          box.style.setProperty("--lbi-x", `${lx}px`);

          const right = r > 0
            ? `M${x1},${IN} ${x1 < W - r ? `L${W - r},${IN} ` : ''}A${a},${a} 0 0 1 ${R},${r} L${R},${H - r} A${a},${a} 0 0 1 ${W - r},${B} L${mid},${B}`
            : `M${x1},${IN} L${R},${IN} L${R},${B} L${mid},${B}`;
          const left = r > 0
            ? `M${x0},${IN} ${x0 > r ? `L${r},${IN} ` : ''}A${a},${a} 0 0 0 ${IN},${r} L${IN},${H - r} A${a},${a} 0 0 0 ${r},${B} L${mid},${B}`
            : `M${x0},${IN} L${IN},${IN} L${IN},${B} L${mid},${B}`;

          root.querySelector(".lbi-right").setAttribute("d", right);
          root.querySelector(".lbi-left").setAttribute("d", left);
          root.querySelector(".lbi-gap-left").setAttribute("d", `M${nm},${IN} L${x0},${IN}`);
          root.querySelector(".lbi-gap-right").setAttribute("d", `M${nm},${IN} L${x1},${IN}`);
          input.style.paddingRight = field === "Password" ? "48px" : `${lx}px`;

          if (field === "Password") {
            const eye = root.querySelector(".lbi-eye");
            const shown = eye.dataset.show === "true";
            input.style.webkitTextSecurity = shown ? "none" : "disc";
            eye.setAttribute("aria-label", shown ? "Hide password" : "Show password");
          }
        }

        fields.forEach((root) => {
          const input = root.querySelector(".lbi-field");
          const label = root.querySelector(".lbi-label");
          const word = root.dataset.field;
          label.htmlFor = `lbi-${word.toLowerCase()}`;
          input.id = label.htmlFor;
          label.querySelector("span").replaceWith(...[...word].map((character, index) => {
            const span = document.createElement("span");
            span.textContent = character;
            span.style.setProperty("--i", index);
            return span;
          }));

          input.addEventListener("focus", () => {
            root.dataset.focus = "true";
            updateField(root);
          });
          input.addEventListener("blur", () => {
            root.dataset.focus = "false";
            updateField(root);
          });
          input.addEventListener("input", () => updateField(root));
          root.querySelector(".lbi-box").addEventListener("click", (event) => {
            if (!event.target.closest("button")) input.focus();
          });
          root.querySelector(".lbi-label").addEventListener("click", () => input.focus());

          const eye = root.querySelector(".lbi-eye");
          if (eye) {
            eye.addEventListener("pointerdown", (event) => event.preventDefault());
            eye.addEventListener("click", () => {
              eye.dataset.show = String(eye.dataset.show !== "true");
              /* Alternate animation names so every toggle restarts the blur. */
              flip = 1 - flip;
              input.dataset.flip = String(flip);
              updateField(root);
            });
          }
          updateField(root);
        });

        document.querySelectorAll("[data-corner]").forEach((button) => {
          button.addEventListener("click", () => {
            corner = Number(button.dataset.corner);
            document.querySelectorAll("[data-corner]").forEach((item) => {
              item.setAttribute("aria-pressed", String(item === button));
            });
            fields.forEach(updateField);
          });
        });
      })();
