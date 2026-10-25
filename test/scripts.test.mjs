import assert from 'node:assert/strict';
import {
  prepareTypingExpression,
  readTextExpression,
  resolveExpression,
  selectOptionExpression,
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
    dispatchEvent() {
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
    return elements;
  },
  querySelector(selector) {
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
  return factory(document, window, location, { prototype: {} }, { prototype: {} }, function Event() {}, ...(extra.args || []));
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

console.log('scripts.test.mjs ok');
