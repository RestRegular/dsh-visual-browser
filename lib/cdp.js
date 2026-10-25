/**
 * Minimal Chrome DevTools Protocol client.
 *
 * The plugin ships without dependencies: Node.js 22+ provides a WHATWG
 * `WebSocket`, which is all a flattened CDP session needs. Every command is a
 * JSON message with an `id`; flattened target sessions add `sessionId` to the
 * command and echo it on the matching response.
 */

/** A CDP failure with a stable code so tools and routes can report a reason. */
export class CdpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CdpError';
    this.code = code;
  }
}

const OPEN_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 30_000;

export class CdpConnection {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();
  #closed = false;

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => this.#onMessage(event.data));
    socket.addEventListener('close', () => this.#failAll(new CdpError('CDP_CLOSED', 'the DevTools connection closed')));
    socket.addEventListener('error', () => {
      /* The close event carries the outcome; keep this listener quiet. */
    });
  }

  /** Connect to a browser-level or page-level WebSocket endpoint. */
  static async open(url, { timeoutMs = OPEN_TIMEOUT_MS } = {}) {
    const Socket = globalThis.WebSocket;
    if (typeof Socket !== 'function') {
      throw new CdpError('CDP_UNAVAILABLE', 'this Node.js runtime has no built-in WebSocket (Node 22 or newer is required)');
    }
    const socket = new Socket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        try {
          socket.close();
        } catch {
          /* already unusable */
        }
        reject(new CdpError('CDP_TIMEOUT', `timed out connecting to ${url}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new CdpError('CDP_CONNECT_FAILED', `could not connect to ${url}`));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
    return new CdpConnection(socket);
  }

  get closed() {
    return this.#closed;
  }

  /** Send one protocol command; `sessionId` targets a flattened session. */
  send(method, params = {}, sessionId) {
    if (this.#closed) return Promise.reject(new CdpError('CDP_CLOSED', 'the DevTools connection closed'));
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId !== undefined) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CdpError('CDP_COMMAND_TIMEOUT', `${method} did not answer within ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, method, timer });
      try {
        this.#socket.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new CdpError('CDP_SEND_FAILED', messageOf(error)));
      }
    });
  }

  /** Subscribe to one protocol event; the returned function unsubscribes. */
  on(method, listener) {
    const bucket = this.#listeners.get(method) ?? new Set();
    bucket.add(listener);
    this.#listeners.set(method, bucket);
    return () => {
      bucket.delete(listener);
      if (bucket.size === 0) this.#listeners.delete(method);
    };
  }

  /** Resolve on the next `method` event, or reject on timeout. */
  once(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new CdpError('CDP_EVENT_TIMEOUT', `waited ${timeoutMs}ms for ${method}`));
      }, timeoutMs);
      const off = this.on(method, (params, sessionId) => {
        clearTimeout(timer);
        off();
        resolve({ params, sessionId });
      });
    });
  }

  close() {
    if (this.#closed) return;
    this.#failAll(new CdpError('CDP_CLOSED', 'the DevTools connection closed'));
    try {
      this.#socket.close();
    } catch {
      /* already closed */
    }
  }

  #onMessage(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (message && typeof message.id === 'number') {
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new CdpError(
            `CDP_${String(message.error.code ?? 'ERROR')}`,
            `${pending.method}: ${message.error.message ?? 'protocol error'}`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (!message || typeof message.method !== 'string') return;
    const bucket = this.#listeners.get(message.method);
    if (bucket === undefined) return;
    for (const listener of [...bucket]) {
      try {
        listener(message.params, message.sessionId);
      } catch {
        /* a failing listener must not break the socket */
      }
    }
  }

  #failAll(error) {
    if (this.#closed) return;
    this.#closed = true;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(id);
      pending.reject(error);
    }
    this.#listeners.clear();
  }
}

export function messageOf(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
