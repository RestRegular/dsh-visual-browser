/** Real Chromium smoke. Run separately: node test/manual-annotations.mjs. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserManager } from '../lib/browser.js';
import { Annotations } from '../lib/annotations.js';

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>Annotation smoke</title><style>body{padding:30px;font:16px sans-serif}button{padding:20px}canvas{display:block;margin-top:40px;border:1px solid}</style><button id="danger">Delete example item</button><p id="count">0</p><canvas id="drawing" width="200" height="80"></canvas><script>window.clicks=0;document.querySelector('#danger').onclick=()=>{document.querySelector('#count').textContent=String(++window.clicks)};</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const directory = await mkdtemp(path.join(tmpdir(), 'dvb-annotation-browser-'));
const manager = new BrowserManager({ config: { headless: true, stealth: false, userDataDir: path.join(directory, 'chrome'), executablePath: process.env.CHROME_PATH || '' } });
const notes = new Annotations(manager, path.join(directory, 'annotations.json'));
const scope = 'workspace:acceptance';
let receivedRevision = 0;
let unsubscribeFrames;
const waitForFreshFrame = async () => {
  const expected = manager.state(scope).frameRevision;
  const deadline = Date.now() + 5000;
  while (receivedRevision !== expected && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(receivedRevision, expected, 'the live image must belong to the active document');
};
const evaluate = async expression => {
  const result = await manager.sendCdp({ method: 'Runtime.evaluate', params: { expression, returnByValue: true } }, { scope });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const pick = async selector => {
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const state = manager.state(scope);
  return notes.inspect(scope, 'session:a', { page: state.activePageId, url, revision: state.pages.find(page => page.active).revision, ...point });
};
try {
  await manager.open(url, { scope });
  unsubscribeFrames = manager.subscribeFrames(scope, (_jpeg, revision) => { receivedRevision = revision; });
  await waitForFreshFrame();
  const target = await pick('#danger');
  assert.equal(target.selector, '#danger');
  assert.equal(await evaluate('window.clicks'), 0, 'inspection must not click the destructive example button');
  const saved = await notes.update(scope, 'session:a', { action: 'save', target, comment: 'Ask before deleting an item' });
  assert.equal(saved[0].comment, 'Ask before deleting an item');
  assert.deepEqual(await notes.list(scope, 'session:b'), []);
  await assert.rejects(notes.update(scope, 'session:b', { action: 'validate', ids: [saved[0].id] }), { code: 'TARGET_NOT_FOUND' });
  await assert.rejects(notes.inspect('workspace:other', 'session:a', { page: target.page, url, x: 50, y: 50 }), { code: 'TARGET_NOT_FOUND' });
  const reopened = new Annotations(manager, notes.store.filename);
  assert.equal((await reopened.list(scope, 'session:a'))[0].comment, 'Ask before deleting an item');
  await reopened.update(scope, 'session:a', { action: 'validate', ids: [saved[0].id] });
  const canvas = await pick('#drawing');
  assert.equal(canvas.kind, 'region');
  assert.equal(canvas.selector, '');
  await evaluate("document.querySelector('#danger').replaceWith(document.querySelector('#danger').cloneNode(true))");
  await assert.rejects(notes.update(scope, 'session:a', { action: 'validate', ids: [saved[0].id] }), { code: 'STALE_REF' });
  const fresh = await pick('#danger');
  const second = await notes.update(scope, 'session:a', { action: 'save', target: fresh, comment: 'Keep this button' });
  await manager.reloadPage(fresh.page, { scope });
  await waitForFreshFrame();
  await assert.rejects(notes.update(scope, 'session:a', { action: 'validate', ids: [second.at(-1).id] }), { code: 'STALE_REF' });
  const point = await evaluate("(()=>{const r=document.querySelector('#danger').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await manager.sendCdp({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', button: 'left', clickCount: 1, ...point } }, { scope });
  await manager.sendCdp({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', button: 'left', clickCount: 1, ...point } }, { scope });
  assert.equal(await evaluate('window.clicks'), 1, 'the example control really is active when intentionally clicked');
  console.log(JSON.stringify({ passed: true, pickingDidNotClick: true, sameSelectorReplacementRejected: true, sameUrlReloadRejected: true, freshFramesAfterReload: true, sessionAndWorkspaceIsolated: true, persisted: true, regionHonest: true }));
} finally {
  unsubscribeFrames?.();
  await manager.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
