/**
 * Same-origin HTTP API behind the Visual Browser panel.
 *
 * The panel polls `/state` for the timeline and pulls `/frame?seq=` for the
 * picture; user clicks, wheel events and keys go back through the same
 * BrowserManager methods the agent tools use. Frames stay on the host, so a
 * 1 Hz picture never costs a session token.
 */

import { BrowserError } from './browser.js';

const BODY_LIMIT = 64 * 1024;

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

function sendFrame(res, frame) {
  if (frame === null || frame === undefined) {
    res.statusCode = 204;
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'image/jpeg');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', String(frame.jpeg.length));
  res.end(frame.jpeg);
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
 * Handle one request under `prefix`. Exported so a smoke test can drive it with
 * a plain request/response pair and a stub manager.
 */
export async function handle(manager, prefix, req, res) {
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
  if (route === '' || route === '/') route = '/';

  try {
    if (method === 'GET' && route === '/') {
      sendJson(res, 200, { ok: true, name: 'dsh-visual-browser', state: manager.state() });
      return;
    }
    if (method === 'GET' && route === '/state') {
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'GET' && route === '/frame') {
      const seq = Number(url.searchParams.get('seq') ?? '0');
      sendFrame(res, manager.frameFor(seq));
      return;
    }
    if (method === 'GET' && route === '/live') {
      const state = await manager.refreshFrame();
      const frame = manager.frameFor(state.frameSeq);
      sendFrame(res, frame);
      return;
    }
    if (method === 'POST' && route === '/start') {
      const body = await readJsonBody(req);
      const target = typeof body.url === 'string' ? body.url.trim() : '';
      if (target !== '') await manager.open(target);
      else await manager.ensureStarted();
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/stop') {
      await manager.close();
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/capture') {
      const state = await manager.refreshFrame();
      sendJson(res, 200, { ok: true, state });
      return;
    }
    if (method === 'POST' && route === '/click') {
      const body = await readJsonBody(req);
      await manager.clickAt({ x: body.x, y: body.y });
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/wheel') {
      const body = await readJsonBody(req);
      await manager.wheelAt({ deltaY: body.deltaY, deltaX: body.deltaX });
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/key') {
      const body = await readJsonBody(req);
      await manager.keyFromUser(String(body.key ?? 'Enter'));
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    if (method === 'POST' && route === '/nav') {
      const body = await readJsonBody(req);
      const action = String(body.action ?? '');
      if (!['back', 'forward', 'reload'].includes(action)) throw new HttpError(400, 'BAD_ACTION', 'action must be back, forward, or reload');
      await manager.act({ action });
      sendJson(res, 200, { ok: true, state: manager.state() });
      return;
    }
    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `No route for ${method} ${route}` } });
  } catch (error) {
    manager.noteError?.(error);
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
                handle(manager, prefix, req, res).catch((error) => {
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
