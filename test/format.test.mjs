import assert from 'node:assert/strict';
import { formatSnapshot, describeAction, scrollProgress, wellFormedText, clipEnd } from '../lib/format.js';

const snapshot = {
  url: 'https://demo.test/login',
  title: '登录 - Demo',
  viewport: { width: 1280, height: 800 },
  scrollY: 400,
  docHeight: 2400,
  elements: [
    { ref: 1, role: 'textbox', name: '手机号', value: '13800000000' },
    { ref: 2, role: 'textbox', name: '密码', value: '••••••' },
    { ref: 3, role: 'button', name: '登录', state: ['disabled'] },
    { ref: 4, role: 'link', name: '忘记密码', href: '/forgot' },
  ],
  total: 6,
  headings: ['用户登录', '没有账号?'],
  text: '用户登录 手机号 密码 登录 忘记密码',
  active: { ref: 2, role: 'textbox', name: '密码' },
  frames: 1,
};

const text = formatSnapshot(snapshot, { maxElements: 100 });
const lines = text.split('\n');
assert.equal(lines[0], 'URL: https://demo.test/login');
assert.equal(lines[1], 'TITLE: 登录 - Demo');
assert.equal(lines[2], 'VIEW: 1280x800 scroll 400/2400 · 4/6 interactive');
assert.ok(lines.includes('[1] textbox "手机号" value=13800000000'));
assert.ok(lines.includes('[3] button "登录" (disabled)'));
assert.ok(lines.includes('[4] link "忘记密码" → /forgot'));
assert.ok(text.includes('ELEMENTS') === false, 'elements exist, so no placeholder line');
assert.ok(text.includes('… 2 more interactive elements below the fold'), 'beyond-the-fold hint');
assert.ok(text.includes('HEADINGS: 用户登录 | 没有账号?'));
assert.ok(text.includes('TEXT: 用户登录 手机号 密码 登录 忘记密码'));
assert.ok(text.includes('ACTIVE: [2] textbox "密码"'));
assert.ok(text.includes('IFRAMES: 1'));

// Empty page
const empty = formatSnapshot({ url: 'about:blank', title: '', viewport: { width: 800, height: 600 }, elements: [], total: 0 });
assert.ok(empty.includes('ELEMENTS: none visible in the viewport'));

// maxElements clips and reports the remainder
const clipped = formatSnapshot(snapshot, { maxElements: 2 });
assert.equal(clipped.split('\n').filter((line) => line.startsWith('[')).length, 2);
assert.ok(clipped.includes('… 4 more interactive elements'));

// Guard against junk input
assert.equal(formatSnapshot(null), 'No page snapshot available.');
assert.ok(formatSnapshot({}).startsWith('URL: about:blank'));
assert.ok(formatSnapshot({ url: 'x' }).startsWith('URL: x'));

// Action descriptions for the timeline
assert.equal(describeAction({ kind: 'click', target: '[3]', detail: 'click [3] “登录”' }), 'click [3] “登录”');
assert.equal(describeAction({ kind: 'click', target: '[3]' }), 'click [3]');
assert.equal(describeAction('hello'), 'hello');
assert.equal(describeAction(null), '');

// Scroll progress
assert.equal(scrollProgress(snapshot), Math.round((400 / (2400 - 800)) * 100));
assert.equal(scrollProgress({ scrollY: 0, docHeight: 700, viewport: { height: 800 } }), 0);

// Truncation and the model boundary: half an emoji can never leave the plugin.
// It cannot be encoded as UTF-8, so the provider rejects the whole request.
assert.equal(clipEnd('1234😀', 6), '1234😀');
assert.equal(clipEnd('1234😀', 5), '1234');
assert.equal(clipEnd('abc', 0), '');
assert.equal(wellFormedText('本局 0 张 \ud83c…'), '本局 0 张 \uFFFD…');
assert.equal(wellFormedText('ok 😀'), 'ok 😀');
assert.equal(wellFormedText(null), '');
assert.equal(wellFormedText(undefined), '');
assert.equal(wellFormedText(String.fromCharCode(0xdc00) + 'x'), '\uFFFDx');

console.log('format.test.mjs ok');
