import assert from 'node:assert/strict';
import { BrowserError } from '../lib/browser.js';
import { handle } from '../lib/routes.js';

const PREFIX = '/visual-browser/api';

function makeRes() {
  const handlers = new Map();
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    ended: false,
    flushed: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    flushHeaders() {
      this.flushed = true;
    },
    write(chunk) {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    end(data) {
      if (data !== undefined) this.chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
      this.ended = true;
      this.emit('close');
    },
    on(event, callback) {
      const bucket = handlers.get(event) ?? [];
      bucket.push(callback);
      handlers.set(event, bucket);
      return this;
    },
    once(event, callback) {
      return this.on(event, callback);
    },
    emit(event) {
      for (const callback of handlers.get(event) ?? []) callback();
    },
    get body() {
      return Buffer.concat(this.chunks).toString('utf8');
    },
    get json() {
      return JSON.parse(this.body);
    },
  };
}

function makeReq(method, url, body) {
  if (body === undefined) return { method, url };
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
}

function makeManager({ running = true } = {}) {
  const manager = {
    calls: {},
    running,
    state() {
      return { running, url: 'https://demo.test/', startedAt: 12, actionSeq: 3, actions: [] };
    },
    framesListener: null,
    subscribeFrames(listener) {
      this.framesListener = listener;
      this.calls.subscribed = (this.calls.subscribed ?? 0) + 1;
      return () => {
        this.framesListener = null;
        this.calls.unsubscribed = true;
      };
    },
    activityListener: null,
    subscribeActivity(listener) {
      this.activityListener = listener;
      this.calls.activitySubscribed = (this.calls.activitySubscribed ?? 0) + 1;
      return () => {
        this.activityListener = null;
        this.calls.activityUnsubscribed = true;
      };
    },
    ackActivity(id) {
      this.calls.acked = id;
      return true;
    },
    clearActions() {
      this.calls.cleared = true;
      return this.state();
    },
    refreshLiveView() {
      this.calls.refreshed = true;
    },
    async dispatchInput(events) {
      this.calls.input = events;
      return { applied: events.length };
    },
    async open(url) {
      this.calls.open = url;
    },
    async ensureStarted() {
      this.calls.started = true;
    },
    async close() {
      this.calls.closed = true;
    },
    async act(input) {
      this.calls.act = input;
    },
    async newPage(url) {
      this.calls.newPage = url;
    },
    async selectPage(id) {
      this.calls.selected = id;
    },
    async closePage(id) {
      this.calls.closedPage = id;
    },
    async reloadPage(id) {
      this.calls.reloadedPage = id;
    },
    async closeAllPages() {
      this.calls.closedAll = true;
    },
    async movePage(id, index) {
      this.calls.moved = { id, index };
    },
    async evaluateConsole(code) {
      this.calls.consoleCode = code;
    },
    clearConsole() {
      this.calls.consoleCleared = true;
    },
    noteError(error) {
      this.calls.error = error;
    },
  };
  return manager;
}

async function request(manager, method, path, body) {
  const res = makeRes();
  await handle(manager, PREFIX, makeReq(method, PREFIX + path, body), res);
  return res;
}

// state
{
  const manager = makeManager();
  const res = await request(manager, 'GET', '/state');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.json.ok, true);
  assert.equal(res.json.state.startedAt, 12);
}

// live picture stream: binary framing, then frames pushed through subscribeFrames
{
  const manager = makeManager();
  const res = makeRes();
  await handle(manager, PREFIX, makeReq('GET', PREFIX + '/stream'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/x-dsh-visual-browser-frames');
  assert.match(res.headers['cache-control'], /no-transform/, 'the host gzip middleware must stay out of a live picture');
  assert.equal(res.flushed, true);
  assert.equal(manager.calls.subscribed, 1);
  assert.equal(typeof manager.framesListener, 'function');

  manager.framesListener(Buffer.from('jpeg-bytes'));
  const body = Buffer.concat(res.chunks);
  assert.equal(body.length, 8 + 10);
  assert.equal(body.readUInt32LE(0), 10, 'frame length prefix');
  assert.equal(body.readUInt32LE(4), 1, 'frame sequence');
  assert.equal(body.subarray(8).toString('utf8'), 'jpeg-bytes');

  res.emit('close');
  assert.equal(manager.calls.unsubscribed, true, 'the stream releases its subscription when the panel goes away');
}

// no multipart: the panel parses frames itself
{
  const routes = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../lib/routes.js', import.meta.url), 'utf8'));
  assert.ok(!routes.includes('multipart/x-mixed-replace'), 'binary framing replaced MJPEG');
}

// stream without a running browser is an empty answer, not a hang
{
  const manager = makeManager({ running: false });
  const res = await request(manager, 'GET', '/stream');
  assert.equal(res.statusCode, 204);
  assert.equal(manager.calls.subscribed, undefined);

  const events = await request(manager, 'GET', '/events');
  assert.equal(events.statusCode, 204);
  assert.equal(manager.calls.activitySubscribed, undefined);
}

// agent activity cues are pushed immediately, not left on the state poll
{
  const manager = makeManager();
  const res = makeRes();
  await handle(manager, PREFIX, makeReq('GET', PREFIX + '/events'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/x-dsh-visual-browser-events');
  assert.match(res.headers['cache-control'], /no-transform/, 'the host gzip middleware must not buffer cues');
  assert.equal(res.flushed, true);
  assert.equal(manager.calls.activitySubscribed, 1);

  manager.activityListener({ type: 'activity', phase: 'start', kind: 'click', x: 40, y: 60 });
  assert.match(res.body, /"phase":"start"/);
  assert.match(res.body, /"kind":"click"/);
  assert.match(res.body, /"x":40/);
  assert.ok(res.body.endsWith('\n'), 'one JSON object per line');

  const acked = await request(manager, 'POST', '/ack', { id: 9 });
  assert.equal(acked.statusCode, 200);
  assert.equal(acked.json.acked, true);
  assert.equal(manager.calls.acked, 9);

  res.emit('close');
  assert.equal(manager.calls.activityUnsubscribed, true, 'a closed panel releases its cue subscription');
}

// clear the operation log
{
  const manager = makeManager();
  const cleared = await request(manager, 'POST', '/actions', { action: 'clear' });
  assert.equal(cleared.statusCode, 200);
  assert.equal(manager.calls.cleared, true);
  assert.ok(cleared.json.state, 'the fresh state comes back with the answer');

  const rejected = await request(manager, 'POST', '/actions', { action: 'teleport' });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json.error.code, 'BAD_ACTION');
}

// start with and without a URL
{
  const manager = makeManager();
  const started = await request(manager, 'POST', '/start', { url: 'example.com' });
  assert.equal(started.statusCode, 200);
  assert.equal(manager.calls.open, 'example.com');
  assert.equal(manager.calls.refreshed, true);

  const plain = await request(manager, 'POST', '/start', {});
  assert.equal(plain.statusCode, 200);
  assert.equal(manager.calls.started, true);
}

// one input batch, one round trip
{
  const manager = makeManager();
  const events = [
    { t: 'pointer', type: 'down', x: 0.5, y: 0.25, button: 0, buttons: 1 },
    { t: 'pointer', type: 'up', x: 0.5, y: 0.25, button: 0, buttons: 0 },
    { t: 'wheel', x: 0.5, y: 0.5, dx: 0, dy: 240 },
    { t: 'key', type: 'down', key: 'Enter', code: 'Enter', keyCode: 13 },
  ];
  const res = await request(manager, 'POST', '/input', { events });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.applied, 4);
  assert.deepEqual(manager.calls.input, events);

  const nav = await request(manager, 'POST', '/nav', { action: 'back' });
  assert.equal(nav.statusCode, 200);
  assert.deepEqual(manager.calls.act, { action: 'back' });

  const stop = await request(manager, 'POST', '/stop', {});
  assert.equal(stop.statusCode, 200);
  assert.equal(manager.calls.closed, true);
}

// page tab actions: reload, close all, reorder
{
  const manager = makeManager();
  const reload = await request(manager, 'POST', '/page', { action: 'reload', id: 'p2' });
  assert.equal(reload.statusCode, 200);
  assert.equal(manager.calls.reloadedPage, 'p2');
  assert.equal(manager.calls.refreshed, true);

  const closeAll = await request(manager, 'POST', '/page', { action: 'close-all' });
  assert.equal(closeAll.statusCode, 200);
  assert.equal(manager.calls.closedAll, true);

  const move = await request(manager, 'POST', '/page', { action: 'move', id: 'p3', index: 0 });
  assert.equal(move.statusCode, 200);
  assert.deepEqual(manager.calls.moved, { id: 'p3', index: 0 });

  const rejected = await request(manager, 'POST', '/page', { action: 'teleport' });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json.error.code, 'BAD_ACTION');
}

// page console: evaluate and clear
{
  const manager = makeManager();
  const evaluated = await request(manager, 'POST', '/console', { action: 'eval', code: '1 + 1' });
  assert.equal(evaluated.statusCode, 200);
  assert.equal(manager.calls.consoleCode, '1 + 1');
  assert.ok(evaluated.json.state, 'the fresh state comes back with the answer');

  const cleared = await request(manager, 'POST', '/console', { action: 'clear' });
  assert.equal(cleared.statusCode, 200);
  assert.equal(manager.calls.consoleCleared, true);

  const missing = await request(manager, 'POST', '/console', { action: 'eval' });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json.error.code, 'BAD_ACTION');

  const rejected = await request(manager, 'POST', '/console', { action: 'teleport' });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json.error.code, 'BAD_ACTION');
}

// failures
{
  const manager = makeManager();
  const badNav = await request(manager, 'POST', '/nav', { action: 'teleport' });
  assert.equal(badNav.statusCode, 400);
  assert.equal(badNav.json.error.code, 'BAD_ACTION');

  const unknown = await request(manager, 'GET', '/nope');
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json.error.code, 'NOT_FOUND');

  const res = makeRes();
  const badReq = {
    method: 'POST',
    url: PREFIX + '/input',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{not json');
    },
  };
  await handle(manager, PREFIX, badReq, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json.error.code, 'BAD_JSON');

  const toobig = makeRes();
  const huge = {
    method: 'POST',
    url: PREFIX + '/input',
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(200 * 1024, 0x20);
    },
  };
  await handle(manager, PREFIX, huge, toobig);
  assert.equal(toobig.statusCode, 413);
}

// manager failures keep their code and status
{
  const manager = makeManager();
  manager.act = async () => {
    throw new BrowserError('TARGET_NOT_FOUND', 'no such element');
  };
  const res = await request(manager, 'POST', '/nav', { action: 'reload' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json.error.code, 'TARGET_NOT_FOUND');
  assert.ok(manager.calls.error instanceof BrowserError, 'the failure is remembered for the panel');

  manager.act = async () => {
    throw new BrowserError('NOT_RUNNING', 'browser is not running');
  };
  const offline = await request(manager, 'POST', '/nav', { action: 'reload' });
  assert.equal(offline.statusCode, 500);
  assert.equal(offline.json.error.code, 'NOT_RUNNING');
}

console.log('routes.test.mjs ok');
