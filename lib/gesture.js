/**
 * Pointer choreography for the agent-driven mouse.
 *
 * A click on an element is easy: resolve its centre, press, release. A drag is
 * not, because the page watches the *path*, not just the endpoints: sliders,
 * canvas apps, sortable lists and every anti-bot widget measure the number of
 * intermediate moves, the pacing between them and whether the button stays
 * reported while moving. So the trajectory lives here as pure data, and
 * `browser.js` only turns it into DevTools input commands over time.
 *
 * Everything in this module is a pure function on purpose: the tests assert the
 * protocol invariants (a held `mouseMoved` must carry `button: 'left'` plus
 * `buttons: 1`) without a browser.
 */

export const DEFAULT_DRAG_STEPS = 16;
export const DEFAULT_DRAG_DURATION_MS = 420;
export const MAX_DRAG_STEPS = 120;

const EASINGS = {
  // Smoothstep: slow enough off the press that a slider's own threshold sees a
  // deliberate first pixel, fast in the middle, gentle into the drop.
  smooth: (t) => t * t * (3 - 2 * t),
  linear: (t) => t,
  easeOut: (t) => 1 - (1 - t) ** 2,
};

const BUTTON_BITS = { left: 1, right: 2, middle: 4 };

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Button name for anything the caller may pass (`2`, `'right'`, `undefined`). */
export function normalizeButton(value) {
  if (value === 2 || value === 'right') return 'right';
  if (value === 1 || value === 'middle') return 'middle';
  return 'left';
}

/** The protocol's `buttons` bitmask for a held button. */
export function buttonBits(button) {
  return BUTTON_BITS[normalizeButton(button)] ?? 1;
}

/**
 * One viewport point in CSS pixels, clamped into the configured viewport. The
 * numbers are the same scale as `browser_screenshot`, which is what makes
 * "look at the picture, then act on it" work at all.
 */
export function normalizePoint(point, viewport = {}) {
  const width = Math.max(1, toNumber(viewport.width, 1280));
  const height = Math.max(1, toNumber(viewport.height, 800));
  return {
    x: clampInt(toNumber(point?.x, 0), 0, width - 1),
    y: clampInt(toNumber(point?.y, 0), 0, height - 1),
  };
}

/**
 * Interpolate a drag path: `steps` segments, so `steps + 1` points, the last
 * one exactly the requested end point (no accumulated rounding drift).
 *
 * @param {{x: number, y: number}} start
 * @param {{x: number, y: number}} end
 * @param {{steps?: number, easing?: string, viewport?: {width: number, height: number}}} [options]
 */
export function dragPoints(start, end, options = {}) {
  const viewport = options.viewport ?? {};
  const from = normalizePoint(start, viewport);
  const to = normalizePoint(end, viewport);
  const steps = clampInt(toNumber(options.steps, DEFAULT_DRAG_STEPS), 2, MAX_DRAG_STEPS);
  const ease = EASINGS[options.easing] ?? EASINGS.smooth;
  const points = [{ x: from.x, y: from.y }];
  for (let index = 1; index < steps; index += 1) {
    const t = ease(index / steps);
    points.push({
      x: Math.round(from.x + (to.x - from.x) * t),
      y: Math.round(from.y + (to.y - from.y) * t),
    });
  }
  points.push({ x: to.x, y: to.y });
  return points;
}

/** Milliseconds per segment so the whole gesture lands near `durationMs`. */
export function stepDelay(durationMs, segments) {
  const duration = clampInt(toNumber(durationMs, DEFAULT_DRAG_DURATION_MS), 0, 20_000);
  const count = clampInt(toNumber(segments, 1), 1, MAX_DRAG_STEPS);
  return duration === 0 ? 0 : Math.max(0, Math.round(duration / count));
}

/**
 * Turn a path into the DevTools mouse commands that make the page believe a
 * real drag happened.
 *
 * The one rule that matters: every `mouseMoved` while the button is held must
 * report `button: 'left'` and `buttons: 1`. Chrome's input pipeline reads that
 * bitmask to decide "hover" vs "drag"; with `button: 'none'` the page still
 * gets `mousemove`/`mousedown` but native dragging (sliders, text selection,
 * DnD) never engages.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {{button?: string|number, clickCount?: number}} [options]
 */
export function dragCommands(points, options = {}) {
  const list = Array.isArray(points) ? points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)) : [];
  if (list.length < 2) throw new Error('dragCommands needs at least two points');
  const button = normalizeButton(options.button);
  const buttons = buttonBits(button);
  const clickCount = clampInt(toNumber(options.clickCount, 1), 1, 3);
  const command = (type, point, heldBit) => ({
    method: 'Input.dispatchMouseEvent',
    params: {
      type,
      x: Math.round(point.x),
      y: Math.round(point.y),
      button,
      buttons: heldBit,
      clickCount,
      pointerType: 'mouse',
    },
  });
  const last = list.length - 1;
  return list.map((point, index) => {
    if (index === 0) return command('mousePressed', point, buttons);
    if (index === last) return command('mouseReleased', point, 0);
    return command('mouseMoved', point, buttons);
  });
}

/** A press/release pair at one point, the coordinate-space equivalent of click. */
export function clickCommands(point, options = {}) {
  const button = normalizeButton(options.button);
  const buttons = buttonBits(button);
  const clickCount = clampInt(toNumber(options.clickCount, 1), 1, 3);
  const command = (type, heldBit) => ({
    method: 'Input.dispatchMouseEvent',
    params: {
      type,
      x: Math.round(point.x),
      y: Math.round(point.y),
      button,
      buttons: heldBit,
      clickCount,
      pointerType: 'mouse',
    },
  });
  return [command('mouseMoved', 0), command('mousePressed', buttons), command('mouseReleased', 0)];
}

/** A single hover move, used when the caller only wants the cursor there. */
export function moveCommand(point) {
  return {
    method: 'Input.dispatchMouseEvent',
    params: {
      type: 'mouseMoved',
      x: Math.round(point.x),
      y: Math.round(point.y),
      button: 'none',
      buttons: 0,
      pointerType: 'mouse',
    },
  };
}
