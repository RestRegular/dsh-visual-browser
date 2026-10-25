/**
 * Manual, browser-dependent check: can the Agent drag something it cannot see?
 *
 * The widget lives inside a cross-origin iframe (second port), so the element
 * view returns nothing for it — `querySelector` is blocked. The DevTools input
 * domain still hits it by position, which is exactly the point of `drag` and of
 * coordinate clicks. A control run repeats the same path with `buttons: 0` to
 * prove the difference comes from the held-button bitmask and not from luck.
 *
 * Run: node test/manual-drag-iframe.mjs   (needs Chrome/Edge; not part of npm test)
 */

import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserManager, findBrowserExecutable, normalizeConfig } from '../lib/browser.js';

const SLIDER = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; background: #eef; font: 14px system-ui; }
  #track { position: absolute; left: 100px; top: 380px; width: 600px; height: 8px; background: #ccd; border-radius: 4px; }
  #knob { position: absolute; left: 0; top: -12px; width: 32px; height: 32px; border-radius: 50%; background: #39f; }
</style>
<div id="track"><div id="knob"></div></div>
<script>
  var knob = document.getElementById('knob');
  var dragging = false, startX = 0, startLeft = 0, moves = 0, left = 0;
  function report() { parent.postMessage({ left: Math.round(left), moves: moves }, '*'); }
  knob.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    dragging = true; startX = e.clientX; startLeft = left; moves = 0;
  });
  window.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    moves += 1;                                   // every event arrives...
    if (e.buttons === 0) { report(); return; }    // ...but only a held button drags
    left = Math.max(0, Math.min(568, startLeft + (e.clientX - startX)));
    knob.style.left = left + 'px';
    report();
  });
  window.addEventListener('pointerup', function () { dragging = false; report(); });
</script>`;

const PARENT = `<!doctype html><meta charset="utf-8">
<style>html, body { margin: 0; height: 100%; } iframe { display: block; border: 0; width: 100%; height: 100%; }</style>
<iframe src="http://127.0.0.1:__PORT__/slider"></iframe>
<script>
  window.addEventListener('message', function (event) {
    if (!event.data) return;
    document.title = 'knob=' + event.data.left + ' moves=' + event.data.moves;
  });
</script>`;

const listen = (body) =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` · ${detail}`}`);
};

const crossOrigin = await listen(SLIDER);
const port = crossOrigin.address().port;
const parent = await listen(PARENT.replace('__PORT__', String(port)));
const startUrl = `http://127.0.0.1:${parent.address().port}/`;

const executable = findBrowserExecutable(normalizeConfig({}));
check('found a browser executable', executable !== '', executable);

const manager = new BrowserManager({
  config: normalizeConfig({
    headless: true,
    reuseExisting: false,
    userDataDir: path.join(tmpdir(), `dvb-verify-${Date.now()}`),
  }),
  logger: console,
});

const title = async () => (await manager.snapshot()).title;
const settle = async () => {
  await sleep(200);
  return title();
};

try {
  const first = await manager.open(startUrl);
  check('page opened', first.url.startsWith(startUrl), first.url);
  check(
    'the cross-origin widget is invisible to the element view',
    Array.isArray(first.elements) && first.elements.length === 0,
    `${first.elements?.length ?? 0} elements · ${first.frames ?? 0} iframe(s)`,
  );

  // The knob sits at viewport 116,384 (track 100 + half knob, track y 380).
  const drag = await manager.act({ action: 'drag', x: 116, y: 384, to_x: 334, to_y: 384, steps: 18, duration_ms: 500 });
  const afterDrag = await settle();
  check('drag returned a summary', /^drag 116, 384 → 334, 384 · 18 steps in 500ms$/.test(drag.summary), drag.summary);
  const knobAfter = Number(/knob=(-?\d+)/.exec(afterDrag)?.[1] ?? NaN);
  const movesAfter = Number(/moves=(\d+)/.exec(afterDrag)?.[1] ?? NaN);
  check('the iframe reported the drag', Number.isFinite(movesAfter) && movesAfter >= 8, afterDrag);
  check('the slider followed the path', Math.abs(knobAfter - 218) <= 4, `knob=${knobAfter}px, expected ~218px`);

  // Control: identical path, but the moves do not report a held button.
  await manager.act({ action: 'reload' });
  await sleep(400);
  const nx = (116 / 1280).toFixed(4);
  const ny = (384 / 800).toFixed(4);
  const events = [{ t: 'pointer', type: 'down', x: Number(nx), y: Number(ny), button: 0, buttons: 1 }];
  for (let step = 1; step <= 18; step += 1) {
    const x = 116 + ((334 - 116) * step) / 18;
    events.push({ t: 'pointer', type: 'move', x: Number((x / 1280).toFixed(4)), y: Number(ny), buttons: 0 });
  }
  events.push({ t: 'pointer', type: 'up', x: Number((334 / 1280).toFixed(4)), y: Number(ny), buttons: 0, button: 0 });
  await manager.dispatchInput(events);
  const afterControl = await settle();
  const controlMoves = Number(/moves=(\d+)/.exec(afterControl)?.[1] ?? NaN);
  const controlKnob = Number(/knob=(-?\d+)/.exec(afterControl)?.[1] ?? NaN);
  check('control: the pointer moves still reached the iframe', controlMoves >= 8, afterControl);
  check('control: without a held button the slider never moved', controlKnob === 0, `knob=${controlKnob}px`);

  // Coordinate click, on a page whose body has no elements to resolve.
  const clicked = await manager.act({ action: 'click', x: 640, y: 400 });
  check('coordinate click works with no ref', clicked.summary === 'click at 640, 400', clicked.summary);
  const drags = manager.state().actions.filter((action) => action.kind === 'drag');
  check('the timeline records the drag', drags.length === 1 && drags[0].target === '116, 384 → 334, 384', JSON.stringify(drags[0] ?? null));
} finally {
  manager.dispose();
  parent.close();
  crossOrigin.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
