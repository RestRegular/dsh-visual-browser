/**
 * Manual, browser-dependent check: the controls whose picker is native.
 *
 * Two kinds of control never reach the page's render surface:
 *   · the file chooser — an OS dialog (headless Chrome has none), and
 *   · the date/time/colour pickers — browser popup windows.
 * CDP input cannot reach either, so the plugin fills them instead: it
 * intercepts the file chooser and hands the browser real paths, and it writes
 * the value a `type` action asks for. This script proves both against a real
 * Chrome, and proves that a plain click still reports the chooser it opened.
 *
 * Run: node test/manual-native-inputs.mjs   (needs Chrome/Edge; not part of npm test)
 */

import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserManager, findBrowserExecutable, normalizeConfig } from '../lib/browser.js';

const PAGE = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; padding: 24px; font: 14px system-ui; }
  input { display: block; margin: 6px 0; }
  #dialog, #direct { display: none; }
</style>
<button id="pick" type="button">选择文件</button>
<input id="dialog" type="file">
<input id="direct" type="file">
<input id="date" type="date">
<input id="time" type="time">
<input id="color" type="color">
<input id="range" type="range" min="0" max="10" step="1">
<script>
  var log = {};
  var report = function () { document.title = JSON.stringify(log); };
  var names = function (input) {
    return Array.prototype.map.call(input.files || [], function (file) { return file.name + ':' + file.size; });
  };
  var pick = document.getElementById('pick');
  var dialog = document.getElementById('dialog');
  var direct = document.getElementById('direct');
  pick.addEventListener('click', function () { dialog.click(); });
  dialog.addEventListener('change', function () { log.dialog = names(dialog); report(); });
  direct.addEventListener('change', function () { log.direct = names(direct); report(); });
  ['date', 'time', 'color', 'range'].forEach(function (id) {
    var field = document.getElementById(id);
    field.addEventListener('input', function () { log[id + 'Inputs'] = (log[id + 'Inputs'] || 0) + 1; });
    field.addEventListener('change', function () { log[id] = field.value; report(); });
  });
</script>`;

const server = await new Promise((resolve) => {
  const node = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGE);
  });
  node.listen(0, '127.0.0.1', () => resolve(node));
});
const startUrl = `http://127.0.0.1:${server.address().port}/`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` · ${detail}`}`);
};

const dir = await mkdtemp(path.join(tmpdir(), 'dvb-files-'));
const png = path.join(dir, 'picked.png');
const txt = path.join(dir, 'notes.txt');
await writeFile(png, Buffer.from('89504e470d0a1a0a', 'hex'));
await writeFile(txt, 'hello from the upload test\n');

const executable = findBrowserExecutable(normalizeConfig({}));
check('found a browser executable', executable !== '', executable);

// A sandbox that refuses `spawn` can still run the check: start Chrome from a
// shell with this profile and let the manager attach to it instead of spawning.
const borrowed = (process.env.DVB_CHROME_PROFILE || '').trim();
const manager = new BrowserManager({
  config: normalizeConfig({
    headless: true,
    reuseExisting: borrowed !== '',
    userDataDir: borrowed !== '' ? borrowed : path.join(tmpdir(), `dvb-native-${Date.now()}`),
  }),
  logger: console,
});

const title = async () => (await manager.snapshot()).title;
const pageLog = async () => {
  await sleep(150);
  try {
    return JSON.parse(await title());
  } catch {
    return {};
  }
};

try {
  await manager.open(startUrl);

  // 1. A visible button that opens the file chooser for a hidden input.
  const uploaded = await manager.act({ action: 'upload', selector: '#pick', files: [png] });
  check('upload reports filling the chooser', /file chooser filled/.test(uploaded.summary), uploaded.summary);
  const afterUpload = await pageLog();
  check(
    'the page received the file through its own input',
    Array.isArray(afterUpload.dialog) && afterUpload.dialog[0] === 'picked.png:8',
    JSON.stringify(afterUpload.dialog),
  );

  // 2. A hidden input with no dialog at all: the files go straight in.
  const direct = await manager.act({ action: 'upload', selector: '#direct', files: [txt] });
  check('a hidden input is filled directly', /written straight into the file input/.test(direct.summary), direct.summary);
  const afterDirect = await pageLog();
  check(
    'the hidden input got the second file',
    Array.isArray(afterDirect.direct) && afterDirect.direct[0] === `notes.txt:${'hello from the upload test\n'.length}`,
    JSON.stringify(afterDirect.direct),
  );

  // 3. A plain click must not hang on the dialog: it reports the chooser.
  const clicked = await manager.act({ action: 'click', selector: '#pick' });
  check('a plain click reports the chooser it wanted', /opened a file chooser/.test(clicked.summary), clicked.summary);

  // 4. Native pickers: the value is written, the page sees input and change.
  const date = await manager.act({ action: 'type', selector: '#date', text: '2026/10/6' });
  check('date is written in the browser format', /date → 2026-10-06$/.test(date.summary), date.summary);
  const afterDate = await pageLog();
  check('the page saw the date', afterDate.date === '2026-10-06' && afterDate.dateInputs >= 1, JSON.stringify(afterDate));

  const time = await manager.act({ action: 'type', selector: '#time', text: '8:30' });
  check('time accepts a loose value', /time → 08:30$/.test(time.summary), time.summary);

  const color = await manager.act({ action: 'type', selector: '#color', text: '#1A2' });
  check('colour expands a short hex', /color → #11aa22$/.test(color.summary), color.summary);

  const range = await manager.act({ action: 'type', selector: '#range', text: '7' });
  check('range takes a number', /range → 7$/.test(range.summary), range.summary);
  const afterRange = await pageLog();
  check('the page saw every native value', afterRange.time === '08:30' && afterRange.color === '#11aa22' && afterRange.range === '7', JSON.stringify(afterRange));

  // 5. Refusals say what to do instead.
  let invalid = '';
  try {
    await manager.act({ action: 'type', selector: '#date', text: '2026-13-45' });
  } catch (error) {
    invalid = error.message;
  }
  check('an impossible date is refused', /not a valid date value/.test(invalid), invalid);

  let fileTyped = '';
  try {
    await manager.act({ action: 'type', selector: '#direct', text: 'x' });
  } catch (error) {
    fileTyped = error.message;
  }
  check('typing into a file input points at upload', /action: "upload"/.test(fileTyped), fileTyped);

  let missing = '';
  try {
    await manager.act({ action: 'upload', selector: '#pick', files: [path.join(dir, 'nope.png')] });
  } catch (error) {
    missing = error.message;
  }
  check('a missing file is refused before any click', /no file to upload/i.test(missing), missing);
} finally {
  manager.dispose();
  server.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
