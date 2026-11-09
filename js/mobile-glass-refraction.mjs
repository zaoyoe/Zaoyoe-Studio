// Mobile-only source optics. Dense separable Gaussian blur, then rim displacement.
// The caller supplies a fresh frame synchronously; this renderer owns no RAF loop.
const MAX = 8;
// Paired linear samples cover a dense Gaussian kernel out to 3 sigma.
const BLUR_PAIRS = 9;
const WORK_SIGMA = 6;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uScale;
uniform vec4 uCover;
uniform int uCount;
uniform float uBlur;
uniform vec4 uRect[${MAX}];
uniform vec4 uShape[${MAX}];
uniform vec4 uTone[${MAX}];
uniform vec2 uMore[${MAX}];
out vec4 outColor;

// Signed distance to a rounded box (negative inside).
float box(vec2 p, vec2 hb, float r) {
  vec2 q = abs(p) - hb + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// The wallpaper at a point in CSS pixels, laid out as object-fit: cover.
vec3 scene(vec2 p) {
  return textureLod(uTex, clamp(p * uCover.xy + uCover.zw, 0.0, 1.0), 0.0).rgb;
}

vec3 saturateBy(vec3 c, float s) {
  return vec3(
    (0.213 + 0.787 * s) * c.r + (0.715 - 0.715 * s) * c.g + (0.072 - 0.072 * s) * c.b,
    (0.213 - 0.213 * s) * c.r + (0.715 + 0.285 * s) * c.g + (0.072 - 0.072 * s) * c.b,
    (0.213 - 0.213 * s) * c.r + (0.715 - 0.715 * s) * c.g + (0.072 + 0.928 * s) * c.b);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    vec4 rect = uRect[i];
    vec2 hb = rect.zw * 0.5;
    vec2 local = p - rect.xy - hb;
    float radius = min(uShape[i].x, min(hb.x, hb.y));
    float d = box(local, hb, radius);
    if (d > 0.75) continue;
    // Each blur group uses one shared texture. Preserve the first-surface
    // overlap rule, even when surfaces have different blur radii.
    if (uTone[i].x != uBlur) discard;
    // Inward, across the rim.
    float e = 0.5;
    vec2 grad = vec2(
      box(local + vec2(e, 0.0), hb, radius) - box(local - vec2(e, 0.0), hb, radius),
      box(local + vec2(0.0, e), hb, radius) - box(local - vec2(0.0, e), hb, radius));
    vec2 inward = -grad / max(length(grad), 1e-5);
    float rim = uShape[i].y;
    float depth = clamp(-d / rim, 0.0, 1.0);
    float amount = uShape[i].z * rim * pow(1.0 - depth, uShape[i].w);
    float split = uMore[i].y;
    vec4 tone = uTone[i];
    vec3 c;
    if (split > 0.0 && amount > 0.01) {
      c.r = scene(p + inward * amount * (1.0 + split)).r;
      c.g = scene(p + inward * amount).g;
      c.b = scene(p + inward * amount * (1.0 - split)).b;
    } else {
      c = scene(p + inward * amount);
    }
    c = saturateBy(c, tone.y);
    c = (c - 0.5) * tone.z + 0.5;
    c *= tone.w;
    c = saturateBy(c, uMore[i].x);
    float a = clamp(0.5 - d * uScale, 0.0, 1.0);
    outColor = vec4(clamp(c, 0.0, 1.0) * a, a);
    return;
  }
  discard;
}`;

// First map/downsample the wallpaper into a padded, viewport-sized texture.
// Source mipmaps prefilter small details before reducing the resolution.
const COPY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uMap;
in vec2 vUV;
out vec4 outColor;
void main() { outColor = texture(uTex, vUV * uMap.xy + uMap.zw); }`;

const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform vec2 uKernel[${BLUR_PAIRS + 1}];
in vec2 vUV;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV) * uKernel[0].y;
  for (int i = 1; i <= ${BLUR_PAIRS}; i++) {
    vec2 offset = uStep * uKernel[i].x;
    c += (texture(uTex, vUV + offset) + texture(uTex, vUV - offset)) * uKernel[i].y;
  }
  outColor = c;
}`;

function gaussianKernel(sigma) {
  const weights = Array.from({ length: BLUR_PAIRS * 2 + 1 }, (_, i) =>
    Math.exp(-0.5 * (i / Math.max(sigma, 0.001)) ** 2));
  const total = weights[0] + 2 * weights.slice(1).reduce((sum, w) => sum + w, 0);
  const pairs = new Float32Array((BLUR_PAIRS + 1) * 2);
  pairs[1] = weights[0] / total;
  for (let i = 1; i <= BLUR_PAIRS; i++) {
    const a = i * 2 - 1;
    const weight = weights[a] + weights[a + 1];
    pairs[i * 2] = a + (weight ? weights[a + 1] / weight : 0);
    pairs[i * 2 + 1] = weight / total;
  }
  return pairs;
}

export function createMobileRefraction(canvas, { source, surfaces, size, pixelRatio = 1.5 }) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;

  function programFor(fragment) {
    const program = gl.createProgram();
    const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((type, i) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, i ? fragment : VERT);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(message);
      }
      gl.attachShader(program, shader);
      return shader;
    });
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
    return program;
  }
  const program = programFor(FRAG);
  const copyProgram = programFor(COPY_FRAG);
  const blurProgram = programFor(BLUR_FRAG);
  const at = (name) => gl.getUniformLocation(program, name);
  const u = {
    res: at('uRes'), scale: at('uScale'), cover: at('uCover'), count: at('uCount'), blur: at('uBlur'),
    rect: at('uRect'), shape: at('uShape'), tone: at('uTone'), more: at('uMore'),
    map: gl.getUniformLocation(copyProgram, 'uMap'),
    step: gl.getUniformLocation(blurProgram, 'uStep'),
    kernel: gl.getUniformLocation(blurProgram, 'uKernel'),
  };

  const geometry = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, geometry);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);

  function makeTexture() {
    const texture = gl.createTexture();
    if (!texture) throw new Error('Unable to allocate the glass texture.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
  function release(target) {
    if (!target) return;
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
  }
  function sizeTarget(target, width, height) {
    if (target?.width === width && target?.height === height) return target;
    target ||= { texture: makeTexture(), framebuffer: gl.createFramebuffer() };
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
    if (!target.framebuffer || gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      release(target);
      throw new Error('Unable to allocate the glass blur framebuffer.');
    }
    return Object.assign(target, { width, height });
  }
  function pass(program, target, texture) {
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  const texture = makeTexture();
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const blurCache = new Map();
  let scratchA = null;
  let scratchB = null;
  let sourceVersion = 0;
  let mipVersion = -1;
  const rect = new Float32Array(MAX * 4);
  const shape = new Float32Array(MAX * 4);
  const tone = new Float32Array(MAX * 4);
  const more = new Float32Array(MAX * 2);

  let uploaded = null;
  let failed = false;
  let destroyed = false;

  // A still wallpaper uploads once. frame() explicitly supplies new pixels;
  // frame(false) redraws material changes without invalidating cached blur.
  function upload(el, fresh) {
    if (!fresh && uploaded === el) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Unable to upload the glass wallpaper.');
    uploaded = el;
    sourceVersion++;
  }

  function blurredScene(radius, cssWidth, cssHeight, cover) {
    let entry = blurCache.get(radius);
    if (entry?.version === sourceVersion && entry.cssWidth === cssWidth && entry.cssHeight === cssHeight) return entry;
    if (mipVersion !== sourceVersion) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      mipVersion = sourceVersion;
    }
    const level = Math.min(1, 2 ** Math.floor(Math.log2(WORK_SIGMA / radius)));
    const pad = Math.ceil(3 * WORK_SIGMA / level + 2);
    const paddedWidth = cssWidth + pad * 2;
    const paddedHeight = cssHeight + pad * 2;
    // Powers of two keep allocations stable while the blur slider moves.
    // Sigma stays <= 6 working texels; its Gaussian taps never spread apart.
    const scale = Math.min(level,
      maxTextureSize / paddedWidth, maxTextureSize / paddedHeight);
    const width = Math.max(1, Math.floor(paddedWidth * scale));
    const height = Math.max(1, Math.floor(paddedHeight * scale));
    scratchA = sizeTarget(scratchA, width, height);
    scratchB = sizeTarget(scratchB, width, height);
    entry ||= {};
    entry.target = sizeTarget(entry.target, width, height);
    blurCache.set(radius, entry);

    pass(copyProgram, scratchA, texture);
    gl.uniform4f(u.map, paddedWidth * cover[0], paddedHeight * cover[1],
      cover[2] - pad * cover[0], cover[3] - pad * cover[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    pass(blurProgram, scratchB, scratchA.texture);
    gl.uniform2f(u.step, 1 / width, 0);
    gl.uniform2fv(u.kernel, gaussianKernel(radius * width / paddedWidth));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    pass(blurProgram, entry.target, scratchB.texture);
    gl.uniform2f(u.step, 0, 1 / height);
    gl.uniform2fv(u.kernel, gaussianKernel(radius * height / paddedHeight));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return Object.assign(entry, { version: sourceVersion, cssWidth, cssHeight,
      cover: [1 / paddedWidth, 1 / paddedHeight, pad / paddedWidth, pad / paddedHeight] });
  }

  function fail() {
    failed = true;
    canvas.hidden = true;
  }

  function draw(fresh = false) {
    if (failed || destroyed) return false;
    const { el } = source() || {};
    const width = el && (el.videoWidth || el.naturalWidth || el.width);
    const height = el && (el.videoHeight || el.naturalHeight || el.height);
    if (!width || !height || (el.readyState !== undefined && el.readyState < 2)) return;
    const { width: cssWidth, height: cssHeight } = size();
    if (!cssWidth || !cssHeight) return;
    try {
      upload(el, fresh);
      const scale = Math.min(pixelRatio, 1.5);
      const w = Math.max(1, Math.round(cssWidth * scale));
      const h = Math.max(1, Math.round(cssHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const fit = Math.max(cssWidth / width, cssHeight / height);
      const dw = width * fit;
      const dh = height * fit;
      const cover = [1 / dw, 1 / dh, -(cssWidth - dw) / 2 / dw, -(cssHeight - dh) / 2 / dh];
      const list = surfaces().slice(0, MAX);
      const radii = new Set();
      list.forEach((s, i) => {
        const blur = Math.max(0, Number(s.blur) || 0);
        radii.add(blur);
        rect.set([s.x, s.y, s.w, s.h], i * 4);
        shape.set([s.radius, Math.max(s.rim, 0.001), s.edge, s.power], i * 4);
        tone.set([blur, s.saturate, s.contrast, s.brightness], i * 4);
        more.set([s.keep, s.dispersion], i * 2);
      });
      for (const [radius, entry] of blurCache) {
        if (!radii.has(radius)) {
          release(entry.target);
          blurCache.delete(radius);
        }
      }
      const groups = [...radii].map(radius => ({ radius,
        scene: radius > 0 ? blurredScene(radius, cssWidth, cssHeight, cover) : null }));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(u.res, w, h);
      gl.uniform1f(u.scale, scale);
      gl.uniform1i(u.count, list.length);
      gl.uniform4fv(u.rect, rect);
      gl.uniform4fv(u.shape, shape);
      gl.uniform4fv(u.tone, tone);
      gl.uniform2fv(u.more, more);
      for (const group of groups) {
        gl.bindTexture(gl.TEXTURE_2D, group.scene?.target.texture || texture);
        gl.uniform4fv(u.cover, group.scene?.cover || cover);
        gl.uniform1f(u.blur, group.radius);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      return true;
    } catch {
      // CORS, context loss or allocation failure: use the native material.
      fail();
      return false;
    }
  }

  canvas.addEventListener('webglcontextlost', fail);
  return {
    draw,
    get failed() { return failed; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      canvas.removeEventListener('webglcontextlost', fail);
      for (const entry of blurCache.values()) release(entry.target);
      blurCache.clear();
      release(scratchA);
      release(scratchB);
      gl.deleteTexture(texture);
      gl.deleteBuffer(geometry);
      for (const shaderProgram of [program, copyProgram, blurProgram]) gl.deleteProgram(shaderProgram);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.width = canvas.height = 1;
    },
  };
}
