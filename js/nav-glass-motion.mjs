// Only the full-width <-> capsule morph pauses glass. Hiding the navbar with a
// transform, or opening one of its children, must not disable its material.
const geometry = property => property === 'width' || property === 'border-radius' ||
  /^border-(top|bottom)-(left|right)-radius$/.test(property);
const capsule = classes => (classes || '').split(/\s+/).includes('scrolled');
const milliseconds = value => (parseFloat(value) || 0) * (value.trim().endsWith('ms') ? 1 : 1000);

export function pauseNavGlassDuringMotion(el, instance, win, onResume = () => {}) {
  let paused = false, stopped = false, frame = 0, timer = 0, revision = 0;

  function finish() {
    if (stopped || !paused) return;
    revision++;
    win.clearTimeout(timer);
    win.cancelAnimationFrame(frame);
    frame = timer = 0;
    paused = false;
    el.removeAttribute('data-desktop-glass-motion');
    instance.resume();
    onResume();
  }

  function inspect() {
    frame = 0;
    if (stopped || !paused) return;
    const mine = ++revision;
    const animations = el.getAnimations?.().filter(animation =>
      geometry(animation.transitionProperty) &&
      (animation.pending || animation.playState === 'running'));
    // This also handles transition:none, reduced motion and canceled morphs.
    if (animations && !animations.length) return finish();
    if (!timer) {
      const style = win.getComputedStyle(el);
      const properties = (style.transitionProperty || 'none').split(',').map(value => value.trim());
      const durations = (style.transitionDuration || '0s').split(',').map(milliseconds);
      const delays = (style.transitionDelay || '0s').split(',').map(milliseconds);
      const budget = Math.max(0, ...properties.map((property, i) =>
        property === 'all' || geometry(property)
          ? durations[i % durations.length] + delays[i % delays.length] : 0));
      // Safety net for missing events/older browsers, not the normal completion
      // signal. A reversal restarts this deadline with the new transition.
      timer = win.setTimeout(finish, budget + 80);
    }
    if (animations?.length) {
      Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(() => {
        if (!stopped && paused && revision === mine) scheduleInspection();
      });
    }
  }

  function scheduleInspection() {
    if (!frame && !stopped && paused) frame = win.requestAnimationFrame(inspect);
  }

  function begin() {
    if (stopped) return;
    revision++;
    win.clearTimeout(timer);
    timer = 0;
    if (!paused) {
      paused = true;
      el.setAttribute('data-desktop-glass-motion', '');
      instance.pause();
    }
    scheduleInspection();
  }

  function transition(event) {
    if (event.target !== el || event.pseudoElement || !geometry(event.propertyName)) return;
    if (event.type === 'transitionrun') begin();
    else scheduleInspection();
  }

  const observer = new win.MutationObserver(records => {
    if (records.some(record => capsule(record.oldValue) !== capsule(el.getAttribute('class')))) begin();
  });
  observer.observe(el, { attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
  const events = ['transitionrun', 'transitionend', 'transitioncancel'];
  events.forEach(type => el.addEventListener(type, transition));
  // A deferred module can bind after a morph has already started.
  if (el.getAnimations?.().some(animation => geometry(animation.transitionProperty) &&
      (animation.pending || animation.playState === 'running'))) begin();

  return {
    get paused() { return paused; },
    destroy() {
      stopped = true;
      paused = false;
      revision++;
      observer.disconnect();
      events.forEach(type => el.removeEventListener(type, transition));
      win.cancelAnimationFrame(frame);
      win.clearTimeout(timer);
      el.removeAttribute('data-desktop-glass-motion');
    },
  };
}
