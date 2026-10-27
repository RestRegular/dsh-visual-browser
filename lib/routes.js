/**
 * Same-origin HTTP API behind the Visual Browser panel.
 *
 * Three jobs: a tiny `/state` JSON poll for the operation log, one long-lived
 * `/stream` response that carries Chrome's own screencast frames as a binary
 * frame stream, and `/input` batches that go straight to the DevTools input
 * domain. No screenshot per click, no per-frame request, no base64 hop.
 */

import { spawn } from 'node:child_process';
import { BrowserError } from './browser.js';

const BODY_LIMIT = 128 * 1024;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', String(body.length));
  res.end(body);
}

function sendEmpty(res, status) {
  res.statusCode = status;
  res.setHeader('cache-control', 'no-store');
  res.end();
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Request body must be JSON');
  }
}

function failure(res, error) {
  const status =
    error instanceof HttpError
      ? error.status
      : error instanceof BrowserError
        ? error.code === 'BAD_ACTION' || error.code === 'BAD_URL' || error.code === 'BAD_KEY'
          ? 400
          : error.code === 'TARGET_NOT_FOUND' || error.code === 'STALE_REF'
            ? 409
            : 500
        : 500;
  const code = error instanceof HttpError ? error.code : error instanceof BrowserError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, status, { ok: false, error: { code, message } });
}

/**
 * Hold the response open as one binary frame stream:
 *
 *   [uint32 LE payload length][uint32 LE sequence][JPEG bytes]...
 *
 * The panel reads it with `fetch` streaming and decodes each JPEG with
 * `createImageBitmap` onto a canvas. Parsing the framing ourselves keeps the
 * picture deterministic across browser builds and skips the base64 hop an
 * event stream would need.
 */
function openStream(manager, res) {
  if (typeof manager.subscribeFrames !== 'function') {
    sendEmpty(res, 503);
    return;
  }
  if (!manager.running) {
    sendEmpty(res, 204);
    return;
  }
  res.statusCode = 200;
  // A custom type stays out of every compressible mime table on purpose: the
  // host's gzip middleware must never buffer a live picture.
  res.setHeader('content-type', 'application/x-dsh-visual-browser-frames');
  // no-transform keeps the host's gzip middleware out of a live picture.
  res.setHeader('cache-control', 'no-store, no-transform');
  res.setHeader('pragma', 'no-cache');
  res.setHeader('x-accel-buffering', 'no');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  let paused = false;
  let unsubscribe = null;
  let sequence = 0;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      unsubscribe?.();
    } catch {
      /* the browser may be gone */
    }
    unsubscribe = null;
  };

  const writeFrame = (jpeg) => {
    if (closed || paused) return;
    try {
      const header = Buffer.allocUnsafe(8);
      header.writeUInt32LE(jpeg.length, 0);
      header.writeUInt32LE(++sequence, 4);
      const headOk = res.write(header);
      const bodyOk = res.write(jpeg);
      if (!headOk || !bodyOk) {
        // Slow consumer: drop frames until the socket drains instead of growing
        // an unbounded queue of stale pictures.
        paused = true;
        res.once('drain', () => {
          paused = false;
        });
      }
    } catch {
      cleanup();
    }
  };

  unsubscribe = manager.subscribeFrames(writeFrame);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

/**
 * Hold the response open as one newline-delimited JSON stream of Agent
 * activity cues. The panel draws the simulated pointer and the lock veil from
 * these, so they must travel immediately rather than on the 900 ms state poll.
 */
function openActivityStream(manager, res) {
  if (typeof manager.subscribeActivity !== 'function') {
    sendEmpty(res, 503);
    return;
  }
  if (!manager.running) {
    sendEmpty(res, 204);
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'application/x-dsh-visual-browser-events');
  res.setHeader('cache-control', 'no-store, no-transform');
  res.setHeader('pragma', 'no-cache');
  res.setHeader('x-accel-buffering', 'no');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  let unsubscribe = null;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      unsubscribe?.();
    } catch {
      /* the panel may already be gone */
    }
    unsubscribe = null;
  };
  unsubscribe = manager.subscribeActivity((cue) => {
    if (closed) return;
    try {
      res.write(`${JSON.stringify(cue)}\n`);
    } catch {
      cleanup();
    }
  });
  res.on('close', cleanup);
  res.on('error', cleanup);
}

/**
 * Hand one http(s) URL to the operating system's default browser.
 *
 * The panel drives its own Chrome, but "open this in my browser" means the
 * user's default handler, and that only exists outside this process: each
 * platform has exactly one opener command. No shell is involved, so a query
 * string full of `&` reaches the browser as one argument. The child is left
 * detached and never waited on — the opener usually outlives the request.
 */
export function openInDefaultBrowser(target, options = {}) {
  const raw = typeof target === 'string' ? target.trim() : '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'BAD_URL', 'url must be an absolute http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'BAD_URL', 'url must be an absolute http(s) URL');
  }
  const platform = options.platform ?? process.platform;
  // Windows: the protocol handler registered for http(s) is the default
  // browser; macOS and Linux each have one canonical opener.
  const spec =
    platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url.href]]
      : platform === 'darwin'
        ? ['open', [url.href]]
        : ['xdg-open', [url.href]];
  const spawnImpl = options.spawn ?? spawn;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(spec[0], spec[1], { stdio: 'ignore', detached: true, windowsHide: true });
    } catch (error) {
      reject(new Error(`could not start ${spec[0]}: ${error?.message ?? error}`));
      return;
    }
    let settled = false;
    child?.once?.('error', (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`could not start ${spec[0]}: ${error?.message ?? error}`));
    });
    child?.once?.('spawn', () => {
      if (settled) return;
      settled = true;
      // Detached: the panel's request must not keep the opener attached.
      child.unref?.();
      resolve(true);
    });
  });
}

/**
 * Handle one request under `prefix`. Exported so a smoke test can drive it with
 * a plain request/response pair and a stub manager.
 */
export async function handle(manager, prefix, req, res, options = {}) {
  const method = String(req.method ?? 'GET').toUpperCase();
  let url;
  try {
    url = new URL(String(req.url ?? '/'), 'http://127.0.0.1');
  } catch {
    sendJson(res, 400, { ok: false, error: { code: 'BAD_URL', message: 'Malformed request URL' } });
    return;
  }
  let route = url.pathname;
  if (route.startsWith(prefix)) route = route.slice(prefix.length);
  if (route === '') route = '/';

  try {
    if (method === 'GET' && route === '/') {
      sendJson(res, 200, { ok: true, name: 'dsh-visual-browser', state: manager.state() });
      return;
    }
    if (method === 'GET' && route === '/state') {
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'GET' && route === '/stream') {
      openStream(manager, res);
      return;
    }
    if (method === 'GET' && route === '/events') {
      openActivityStream(manager, res);
      return;
    }
    if (method === 'POST' && route === '/ack') {
      const body = await readJsonBody(req);
      const acked = typeof manager.ackActivity === 'function' ? manager.ackActivity(body.id) === true : false;
      sendJson(res, 200, { ok: true, acked });
      return;
    }
    if (method === 'POST' && route === '/actions') {
      const body = await readJsonBody(req);
      if (String(body.action ?? '') !== 'clear') {
        throw new HttpError(400, 'BAD_ACTION', 'action must be clear');
      }
      if (typeof manager.clearActions === 'function') manager.clearActions();
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/input') {
      const body = await readJsonBody(req);
      const events = Array.isArray(body.events) ? body.events : [];
      const result = await manager.dispatchInput(events);
      sendJson(res, 200, { ok: true, applied: result?.applied ?? 0, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/start') {
      const body = await readJsonBody(req);
      const target = typeof body.url === 'string' ? body.url.trim() : '';
      if (target !== '') await manager.open(target);
      else await manager.ensureStarted();
      manager.refreshLiveView?.();
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/external') {
      const body = await readJsonBody(req);
      const target = typeof body.url === 'string' ? body.url.trim() : '';
      const open = options.openExternal ?? openInDefaultBrowser;
      await open(target);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === 'POST' && route === '/page') {
      const body = await readJsonBody(req);
      const action = String(body.action ?? '');
      if (action === 'new') {
        await manager.newPage(typeof body.url === 'string' ? body.url : '');
      } else if (action === 'select') {
        await manager.selectPage(body.id);
      } else if (action === 'close') {
        await manager.closePage(body.id);
      } else if (action === 'reload') {
        await manager.reloadPage(body.id);
      } else if (action === 'close-all') {
        await manager.closeAllPages();
      } else if (action === 'move') {
        await manager.movePage(body.id, body.index);
      } else {
        throw new HttpError(400, 'BAD_ACTION', 'action must be new, select, close, reload, close-all, or move');
      }
      manager.refreshLiveView?.();
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/console') {
      const body = await readJsonBody(req);
      const action = String(body.action ?? '');
      if (action === 'eval') {
        if (typeof body.code !== 'string') throw new HttpError(400, 'BAD_ACTION', 'code must be a string');
        await manager.evaluateConsole(body.code);
      } else if (action === 'clear') {
        manager.clearConsole();
      } else {
        throw new HttpError(400, 'BAD_ACTION', 'action must be eval or clear');
      }
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/stop') {
      await manager.close();
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/nav') {
      const body = await readJsonBody(req);
      const action = String(body.action ?? '');
      if (!['back', 'forward', 'reload'].includes(action)) {
        throw new HttpError(400, 'BAD_ACTION', 'action must be back, forward, or reload');
      }
      await manager.act({ action });
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `No route for ${method} ${route}` } });
  } catch (error) {
    manager.noteError?.(error);
    if (res.headersSent) {
      // A stream that failed after its headers went out can only be torn down.
      try {
        res.end();
      } catch {
        /* already closed */
      }
      return;
    }
    failure(res, error);
  }
}

/** Mount the API on the host web server; a deployment without it keeps the tools. */
export function mountRoutes(ctx, manager, options = {}) {
  const prefix = typeof options.prefix === 'string' && options.prefix !== '' ? options.prefix : '/visual-browser/api';
  try {
    ctx.inject(['webServer'], (scoped) => {
      const webServer = scoped.get('webServer');
      if (webServer === undefined || typeof webServer.register !== 'function') {
        ctx.logger?.info?.('[visual-browser] webServer unavailable; panel API not mounted');
        return;
      }
      try {
        scoped.effect(
          () =>
            webServer.register({
              kind: 'prefix',
              path: prefix,
              handler: (req, res) =>
                handle(manager, prefix, req, res, options).catch((error) => {
                  try {
                    failure(res, error);
                  } catch {
                    /* response already sent */
                  }
                }),
            }),
          'dsh-visual-browser: api route',
        );
        ctx.logger?.info?.(`[visual-browser] panel API mounted at ${prefix}`);
      } catch (error) {
        ctx.logger?.warn?.(`[visual-browser] could not mount ${prefix}: ${error?.message ?? error}`);
      }
    });
  } catch (error) {
    ctx.logger?.warn?.(`[visual-browser] route mount failed: ${error?.message ?? error}`);
  }
}
