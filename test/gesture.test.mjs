import assert from 'node:assert/strict';
import {
  buttonBits,
  clickCommands,
  DEFAULT_DRAG_STEPS,
  dragCommands,
  dragPoints,
  moveCommand,
  normalizeButton,
  normalizePoint,
  stepDelay,
} from '../lib/gesture.js';

const viewport = { width: 1280, height: 800 };

// Coordinates are CSS pixels, clamped into the viewport and rounded to ints.
assert.deepEqual(normalizePoint({ x: -5, y: 9999 }, viewport), { x: 0, y: 799 });
assert.deepEqual(normalizePoint({ x: 100.4, y: 200.6 }, viewport), { x: 100, y: 201 });
assert.deepEqual(normalizePoint({}, viewport), { x: 0, y: 0 });
assert.deepEqual(normalizePoint({ x: 50, y: 60 }), { x: 50, y: 60 });

// Buttons
assert.equal(normalizeButton('right'), 'right');
assert.equal(normalizeButton(2), 'right');
assert.equal(normalizeButton('middle'), 'middle');
assert.equal(normalizeButton(undefined), 'left');
assert.equal(buttonBits('left'), 1);
assert.equal(buttonBits('right'), 2);
assert.equal(buttonBits('middle'), 4);

// A drag path carries one point per segment plus both endpoints.
const path = dragPoints({ x: 100, y: 300 }, { x: 900, y: 300 }, { steps: 8, viewport });
assert.equal(path.length, 9);
assert.deepEqual(path[0], { x: 100, y: 300 }, 'the gesture starts exactly at the press point');
assert.deepEqual(path[path.length - 1], { x: 900, y: 300 }, 'and ends exactly at the drop point');
assert.ok(path.every((point) => Number.isInteger(point.x) && Number.isInteger(point.y)));
assert.ok(path.every((point) => point.y === 300));
for (let index = 1; index < path.length; index += 1) {
  assert.ok(path[index].x >= path[index - 1].x, 'x never goes backwards on a rightward drag');
}

// No accumulated rounding drift on an awkward distance.
const awkward = dragPoints({ x: 0, y: 0 }, { x: 1279, y: 799 }, { steps: 37, viewport });
assert.deepEqual(awkward[awkward.length - 1], { x: 1279, y: 799 });
assert.equal(awkward.length, 38);

// Step count stays in a sane band and the default is respected.
assert.equal(dragPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, { steps: 1 }).length, 3);
assert.equal(dragPoints({ x: 0, y: 0 }, { x: 10, y: 0 }).length, DEFAULT_DRAG_STEPS + 1);
assert.ok(dragPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, { steps: 9999 }).length <= 121);

// Protocol invariants: a held move must report the button, or Chrome treats it
// as a hover and native dragging (sliders, selection, DnD) never engages.
const commands = dragCommands(path);
assert.equal(commands.length, path.length);
assert.ok(commands.every((command) => command.method === 'Input.dispatchMouseEvent'));
assert.equal(commands[0].params.type, 'mousePressed');
assert.equal(commands[0].params.button, 'left');
assert.equal(commands[0].params.buttons, 1);
assert.equal(commands[commands.length - 1].params.type, 'mouseReleased');
assert.equal(commands[commands.length - 1].params.buttons, 0);
for (const command of commands.slice(1, -1)) {
  assert.equal(command.params.type, 'mouseMoved');
  assert.equal(command.params.button, 'left', 'a held mouseMoved must name the held button');
  assert.equal(command.params.buttons, 1, 'and must keep the pressed bit set');
}
for (let index = 0; index < path.length; index += 1) {
  assert.equal(commands[index].params.x, path[index].x);
  assert.equal(commands[index].params.y, path[index].y);
}
assert.equal(dragCommands(path, { button: 'right' })[0].params.buttons, 2);
assert.throws(() => dragCommands([{ x: 1, y: 1 }]), /at least two points/);
assert.throws(() => dragCommands(null), /at least two points/);

// Coordinate click: hover in, press, release.
const clicks = clickCommands({ x: 640, y: 400 });
assert.deepEqual(
  clicks.map((command) => command.params.type),
  ['mouseMoved', 'mousePressed', 'mouseReleased'],
);
assert.equal(clicks[0].params.buttons, 0);
assert.equal(clicks[1].params.buttons, 1);
assert.equal(clicks[2].params.buttons, 0);
assert.ok(clicks.every((command) => command.params.button === 'left'));
assert.equal(clicks[1].params.x, 640);

const hover = moveCommand({ x: 10, y: 20 });
assert.equal(hover.params.type, 'mouseMoved');
assert.equal(hover.params.button, 'none');
assert.equal(hover.params.buttons, 0);

// Pacing: the path takes roughly duration_ms in total.
assert.equal(stepDelay(420, 14), 30);
assert.equal(stepDelay(420, 0), 420);
assert.equal(stepDelay(0, 14), 0);
assert.equal(stepDelay(1_000_000, 1), 20_000);

console.log('gesture.test.mjs ok');
