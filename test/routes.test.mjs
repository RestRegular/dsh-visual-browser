import assert from 'node:assert/strict';
import { BrowserError } from '../lib/browser.js';
import { handle } from '../lib/routes.js';

const PREFIX = '/visual-browser/api';

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    ended: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(data) {
      if (data !== undefined) this.chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
      this.ended = true;
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

function makeManager() {
  const manager = {
    calls: {},
    state() {
      return { running: true, url: 'https://demo.test/', frameSeq: 3, actions: [] };
    },
    frameFor(seq) {
      return Number(seq) === 3 ? { seq: 3, jpeg: Buffer.from('jpeg-bytes') } : null;
    },
    async refreshFrame() {
      return this.state();
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
    async clickAt(point) {
      this.calls.click = point;
    },
    async wheelAt(point) {
      this.calls.wheel = point;
    },
    async keyFromUser(key) {
      this.calls.key = key;
    },
    async act(input) {
      this.calls.act = input;
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
  assert.equal(res.json.state.frameSeq, 3);
}

// frame hit and miss
{
  const manager = makeManager();
  const hit = await request(manager, 'GET', '/frame?seq=3');
  assert.equal(hit.statusCode, 200);
  assert.equal(hit.headers['content-type'], 'image/jpeg');
  assert.equal(hit.body, 'jpeg-bytes');

  const miss = await request(manager, 'GET', '/frame?seq=2');
  assert.equal(miss.statusCode, 204);
  assert.equal(miss.chunks.length, 0);
}

// live capture
{
  const manager = makeManager();
  const res = await request(manager, 'GET', '/live');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'jpeg-bytes');
}

// start with and without a URL
{
  const manager = makeManager();
  const started = await request(manager, 'POST', '/start', { url: 'example.com' });
  assert.equal(started.statusCode, 200);
  assert.equal(manager.calls.open, 'example.com');

  const plain = await request(manager, 'POST', '/start', {});
  assert.equal(plain.statusCode, 200);
  assert.equal(manager.calls.started, true);
}

// user interactions
{
  const manager = makeManager();
  const click = await request(manager, 'POST', '/click', { x: 0.5, y: 0.25 });
  assert.equal(click.statusCode, 200);
  assert.deepEqual(manager.calls.click, { x: 0.5, y: 0.25 });

  const wheel = await request(manager, 'POST', '/wheel', { deltaY: 240 });
  assert.equal(wheel.statusCode, 200);
  assert.deepEqual(manager.calls.wheel, { deltaY: 240, deltaX: undefined });

  const key = await request(manager, 'POST', '/key', { key: 'Enter' });
  assert.equal(key.statusCode, 200);
  assert.equal(manager.calls.key, 'Enter');

  const nav = await request(manager, 'POST', '/nav', { action: 'back' });
  assert.equal(nav.statusCode, 200);
  assert.deepEqual(manager.calls.act, { action: 'back' });

  const stop = await request(manager, 'POST', '/stop', {});
  assert.equal(stop.statusCode, 200);
  assert.equal(manager.calls.closed, true);
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
    url: PREFIX + '/click',
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
    url: PREFIX + '/click',
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(70 * 1024, 0x20);
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
