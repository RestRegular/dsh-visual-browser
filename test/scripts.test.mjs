import assert from 'node:assert/strict';
import {
  fileInputExpression,
  prepareTypingExpression,
  readTextExpression,
  resolveExpression,
  selectOptionExpression,
  setNativeValueExpression,
  snapshotExpression,
} from '../lib/page-scripts.js';

// ---------------------------------------------------------------------------
// A deliberately small DOM double: enough of the browser surface that the
// serialized page scripts run for real and their output can be asserted.
// ---------------------------------------------------------------------------

function makeElement(options = {}) {
  const attributes = new Map(Object.entries(options.attrs || {}));
  const rect = { x: 0, y: 0, width: 120, height: 24, ...(options.rect || {}) };
  const element = {
    tagName: String(options.tag || 'div').toUpperCase(),
    type: options.type,
    value: options.value,
    min: options.min,
    max: options.max,
    step: options.step,
    checked: options.checked,
    disabled: options.disabled,
    readOnly: false,
    required: false,
    isContentEditable: options.editable === true,
    labels: [],
    innerText: options.text || '',
    textContent: options.text || '',
    options: options.options || [],
    selectedOptions: options.selectedOptions || [],
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    getBoundingClientRect() {
      return {
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
      };
    },
    checkVisibility() {
      return options.visible !== false;
    },
    scrollIntoView() {},
    focus() {
      document.activeElement = element;
    },
    setSelectionRange() {},
    dispatched: [],
    dispatchEvent(event) {
      element.dispatched.push(event.type);
      return true;
    },
  };
  return element;
}

const phone = makeElement({ tag: 'input', type: 'text', attrs: { placeholder: '手机号' }, value: '13800000000', rect: { x: 10, y: 10, width: 200, height: 32 } });
const password = makeElement({ tag: 'input', type: 'password', attrs: { 'aria-label': '密码' }, value: 'secret' });
const submit = makeElement({ tag: 'button', text: '登录', rect: { x: 10, y: 100, width: 80, height: 32 } });
const hiddenButton = makeElement({ tag: 'button', text: '隐藏按钮', visible: false });
const checkbox = makeElement({ tag: 'input', type: 'checkbox', checked: true, attrs: { 'aria-label': '记住我' } });
const select = makeElement({
  tag: 'select',
  options: [
    { value: 'a', text: '选项一', textContent: '选项一' },
    { value: 'b', text: '选项二', textContent: '选项二' },
  ],
  selectedOptions: [{ text: '选项一', textContent: '选项一' }],
});
const link = makeElement({ tag: 'a', text: '忘记密码', attrs: { href: '/forgot' } });

const heading = { tagName: 'H1', innerText: '用户登录', textContent: '用户登录' };
const elements = [phone, password, submit, hiddenButton, checkbox, select, link];

// Native pickers live outside the numbered view on purpose (their popup is a
// browser widget, not page content), so they resolve by selector only.
const fileInput = makeElement({ tag: 'input', type: 'file', attrs: { type: 'file' } });
const dateInput = makeElement({ tag: 'input', type: 'date', attrs: { type: 'date' }, value: '' });
const timeInput = makeElement({ tag: 'input', type: 'time', attrs: { type: 'time' }, value: '' });
const monthInput = makeElement({ tag: 'input', type: 'month', attrs: { type: 'month' }, value: '' });
const weekInput = makeElement({ tag: 'input', type: 'week', attrs: { type: 'week' }, value: '' });
const localInput = makeElement({ tag: 'input', type: 'datetime-local', attrs: { type: 'datetime-local' }, value: '' });
const colorInput = makeElement({ tag: 'input', type: 'color', attrs: { type: 'color' }, value: '' });
const rangeInput = makeElement({
  tag: 'input',
  type: 'range',
  attrs: { type: 'range' },
  value: '0',
  min: '0',
  max: '10',
  step: '2',
});
const bySelector = new Map([
  ['#file', fileInput],
  ['#date', dateInput],
  ['#time', timeInput],
  ['#month', monthInput],
  ['#week', weekInput],
  ['#local', localInput],
  ['#color', colorInput],
  ['#range', rangeInput],
]);

const document = {
  title: '登录 - Demo',
  readyState: 'complete',
  activeElement: null,
  body: { innerText: '用户登录 手机号 密码 登录 忘记密码', scrollHeight: 2400 },
  documentElement: { innerText: '用户登录 手机号 密码 登录 忘记密码', scrollHeight: 2400 },
  querySelectorAll(selector) {
    if (selector === '[data-dsh-vb-ref]') return elements.filter((element) => element.hasAttribute('data-dsh-vb-ref'));
    if (selector === 'h1,h2,h3') return [heading];
    if (selector === 'iframe') return [];
    if (selector.includes('input[type="file"]')) return [fileInput];
    return elements;
  },
  querySelector(selector) {
    if (bySelector.has(selector)) return bySelector.get(selector);
    const match = /^\[data-dsh-vb-ref="(\d+)"\]$/.exec(selector);
    if (match) return elements.find((element) => element.getAttribute('data-dsh-vb-ref') === match[1]) || null;
    return null;
  },
  getElementById() {
    return null;
  },
  querySelectorAllCount: 0,
};

const window = {
  innerWidth: 1280,
  innerHeight: 800,
  scrollY: 0,
  getComputedStyle() {
    return { visibility: 'visible', display: 'block', opacity: '1' };
  },
  getSelection() {
    return { removeAllRanges() {}, addRange() {} };
  },
};

const location = { href: 'https://demo.test/login' };

class FakeEvent {
  constructor(type, init) {
    this.type = type;
    this.bubbles = Boolean(init && init.bubbles);
  }
}

function run(expression, extra = {}) {
  const factory = new Function(
    'document',
    'window',
    'location',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'Event',
    `return ${expression}`,
  );
  return factory(document, window, location, { prototype: {} }, { prototype: {} }, FakeEvent, ...(extra.args || []));
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

const snapshot = run(snapshotExpression({ maxElements: 50, maxNameChars: 20, maxTextChars: 40 }));
assert.equal(snapshot.url, 'https://demo.test/login');
assert.equal(snapshot.title, '登录 - Demo');
assert.equal(snapshot.viewport.width, 1280);
assert.equal(snapshot.docHeight, 2400);
assert.equal(snapshot.readyState, 'complete');
assert.ok(!snapshot.elements.some((element) => element.name === '隐藏按钮'), 'invisible element excluded');
assert.equal(snapshot.total, 6);
assert.equal(snapshot.elements.length, 6);
assert.deepEqual(
  snapshot.elements.map((element) => element.role),
  ['textbox', 'textbox', 'button', 'checkbox', 'combobox', 'link'],
);
assert.equal(snapshot.elements[0].name, '手机号');
assert.equal(snapshot.elements[0].value, '13800000000');
assert.equal(snapshot.elements[1].value, '••••••', 'password value is masked');
assert.equal(snapshot.elements[2].ref, 3);
assert.deepEqual(snapshot.elements[3].state, ['checked']);
assert.equal(snapshot.elements[4].value, '选项一', 'select shows its selected option');
assert.equal(snapshot.elements[5].href, '/forgot');
assert.deepEqual(snapshot.headings, ['用户登录']);
assert.ok(snapshot.text.length <= 40);
assert.equal(snapshot.frames, 0);
assert.equal(snapshot.truncated, false);
assert.equal(phone.getAttribute('data-dsh-vb-ref'), '1');
assert.equal(link.getAttribute('data-dsh-vb-ref'), '6');

// A second snapshot clears old refs before renumbering.
const again = run(snapshotExpression({ maxElements: 2 }));
assert.equal(again.elements.length, 2);
assert.equal(again.truncated, true);
assert.equal(again.total, 6);
assert.equal(link.getAttribute('data-dsh-vb-ref'), null, 'stale refs are cleared');

// ---------------------------------------------------------------------------
// resolve / typing / select / text
// ---------------------------------------------------------------------------

// Restore a full numbered view: the clipped snapshot above cleared the refs.
run(snapshotExpression({ maxElements: 50 }));
const resolved = run(resolveExpression({ ref: 3 }));
assert.equal(resolved.ok, true);
assert.equal(resolved.name, '登录');
assert.equal(resolved.x, 50);
assert.equal(resolved.y, 116);

const stale = run(resolveExpression({ ref: 99 }));
assert.deepEqual(stale, { ok: false, reason: 'stale-ref' });

const focused = run(prepareTypingExpression({ ref: 3, mode: 'replace' }));
assert.equal(focused.ok, true);
assert.equal(focused.tag, 'button');
assert.equal(document.activeElement, submit);
assert.equal(focused.x, 50, 'the typing cue needs the field centre');
assert.equal(focused.y, 116);

const picked = run(selectOptionExpression({ ref: 5, value: 'b' }));
assert.equal(picked.ok, true);
assert.equal(picked.text, '选项二');
assert.equal(select.value, 'b');

const pageText = run(readTextExpression({ maxChars: 30 }));
assert.equal(pageText.ok, true);
assert.equal(pageText.kind, 'page');
assert.ok(pageText.text.length <= 30);
assert.equal(pageText.url, 'https://demo.test/login');

const linkText = run(readTextExpression({ ref: 6 }));
assert.equal(linkText.ok, true);
assert.equal(linkText.kind, 'element');
assert.equal(linkText.href, '/forgot');

const missing = run(readTextExpression({ ref: 42 }));
assert.deepEqual(missing, { ok: false, reason: 'stale-ref' });

// ---------------------------------------------------------------------------
// native pickers: written as values, normalised to what the browser accepts
// ---------------------------------------------------------------------------

const dateSet = run(setNativeValueExpression({ selector: '#date', value: '2026/10/6' }));
assert.equal(dateSet.ok, true);
assert.equal(dateSet.type, 'date');
assert.equal(dateSet.value, '2026-10-06');
assert.equal(dateInput.value, '2026-10-06');
assert.deepEqual(dateInput.dispatched, ['input', 'change'], 'frameworks see a real change');

const impossible = run(setNativeValueExpression({ selector: '#date', value: '2026-13-45' }));
assert.equal(impossible.ok, false);
assert.equal(impossible.reason, 'bad-value');
assert.equal(impossible.expected, 'YYYY-MM-DD');

const timeSet = run(setNativeValueExpression({ selector: '#time', value: '8:05' }));
assert.equal(timeSet.value, '08:05');
const monthSet = run(setNativeValueExpression({ selector: '#month', value: '2026年10月' }));
assert.equal(monthSet.value, '2026-10');
const weekSet = run(setNativeValueExpression({ selector: '#week', value: '2026-43' }));
assert.equal(weekSet.value, '2026-W43');
const localSet = run(setNativeValueExpression({ selector: '#local', value: '2026-10-26 07:53' }));
assert.equal(localSet.value, '2026-10-26T07:53');
const colorSet = run(setNativeValueExpression({ selector: '#color', value: '#1a2' }));
assert.equal(colorSet.value, '#11aa22');
const rangeSet = run(setNativeValueExpression({ selector: '#range', value: '7' }));
assert.equal(rangeSet.value, '8', 'the value snaps to the step');

const notANative = run(setNativeValueExpression({ selector: '#missing', value: 'x' }));
assert.equal(notANative.ok, false);
assert.equal(notANative.reason, 'not-found');
assert.equal(run(setNativeValueExpression({ selector: '#phone', value: 'x' })).reason, 'not-found');

// The hidden file input is what an upload falls back to.
assert.equal(run(fileInputExpression({})), fileInput);
assert.equal(run(fileInputExpression({ selector: '#date' })), fileInput, 'a page with a doomed selector still finds the input');
assert.equal(run(fileInputExpression({ selector: '#file' })), fileInput);

console.log('scripts.test.mjs ok');
