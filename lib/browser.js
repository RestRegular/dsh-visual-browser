/**
 * BrowserManager owns exactly one Chrome process and one page target.
 *
 * The manager is the only place that knows about the DevTools Protocol; the
 * agent tools and the panel routes both drive this same object, so a click from
 * the model and a click from the user follow one code path.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { CdpConnection } from './cdp.js';
import {
  pageFactsExpression,
  prepareTypingExpression,
  readTextExpression,
  resolveExpression,
  selectOptionExpression,
  snapshotExpression,
} from './page-scripts.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BrowserError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'BrowserError';
    this.code = code;
    this.detail = detail;
  }
}

export const DEFAULT_CONFIG = {
  headless: true,
  executablePath: '',
  userDataDir: '',
  viewportWidth: 1280,
  viewportHeight: 800,
  maxElements: 100,
  maxTextChars: 320,
  maxNameChars: 64,
  streamQuality: 60,
  allowUserControl: true,
  reuseExisting: true,
  actionTimeoutMs: 12_000,
  navigationTimeoutMs: 30_000,
  startupTimeoutMs: 30_000,
};

/** Normalize the loose Loader row config into a complete settings object. */
export function normalizeConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {};
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  };
  return {
    ...DEFAULT_CONFIG,
    ...source,
    headless: source.headless === undefined ? DEFAULT_CONFIG.headless : source.headless !== false,
    executablePath: typeof source.executablePath === 'string' ? source.executablePath : '',
    userDataDir: typeof source.userDataDir === 'string' ? source.userDataDir : '',
    viewportWidth: clamp(viewport.width ?? source.viewportWidth, 320, 4096, DEFAULT_CONFIG.viewportWidth),
    viewportHeight: clamp(viewport.height ?? source.viewportHeight, 240, 4096, DEFAULT_CONFIG.viewportHeight),
    maxElements: clamp(source.maxElements, 10, 400, DEFAULT_CONFIG.maxElements),
    maxTextChars: clamp(source.maxTextChars, 40, 4000, DEFAULT_CONFIG.maxTextChars),
    maxNameChars: clamp(source.maxNameChars, 16, 200, DEFAULT_CONFIG.maxNameChars),
    streamQuality: clamp(source.streamQuality ?? source.frameQuality, 20, 95, DEFAULT_CONFIG.streamQuality),
    allowUserControl: source.allowUserControl === undefined ? DEFAULT_CONFIG.allowUserControl : source.allowUserControl !== false,
    reuseExisting: source.reuseExisting === undefined ? DEFAULT_CONFIG.reuseExisting : source.reuseExisting !== false,
    actionTimeoutMs: clamp(source.actionTimeoutMs, 500, 60_000, DEFAULT_CONFIG.actionTimeoutMs),
    navigationTimeoutMs: clamp(source.navigationTimeoutMs, 1000, 120_000, DEFAULT_CONFIG.navigationTimeoutMs),
    startupTimeoutMs: clamp(source.startupTimeoutMs, 2000, 120_000, DEFAULT_CONFIG.startupTimeoutMs),
  };
}

/** Where the persistent Chrome profile lives (cookies survive host restarts). */
export function defaultUserDataDir() {
  return path.join(homedir(), '.dsh', 'visual-browser', 'chrome-profile');
}

/** Candidate executables per platform, most preferred first. */
export function browserCandidates(platform = process.platform, env = process.env) {
  const fromEnv = [env.DSH_VISUAL_BROWSER_PATH, env.CHROME_PATH, env.EDGE_PATH].filter(
    (value) => typeof value === 'string' && value.trim() !== '',
  );
  if (platform === 'win32') {
    const programFiles = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const relative = [
      'Google/Chrome/Application/chrome.exe',
      'Microsoft/Edge/Application/msedge.exe',
      'Chromium/Application/chrome.exe',
      'BraveSoftware/Brave-Browser/Application/brave.exe',
    ];
    const found = [];
    for (const base of programFiles) {
      for (const tail of relative) found.push(path.join(base, tail));
    }
    return [...fromEnv, ...found];
  }
  if (platform === 'darwin') {
    return [
      ...fromEnv,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  }
  return [
    ...fromEnv,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ];
}

/** First existing browser executable, or an empty string. */
export function findBrowserExecutable(config, platform = process.platform, env = process.env) {
  const candidates = [];
  if (config && typeof config.executablePath === 'string' && config.executablePath.trim() !== '') {
    candidates.push(config.executablePath.trim());
  }
  candidates.push(...browserCandidates(platform, env));
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* unreadable candidate, keep looking */
    }
  }
  return '';
}

/** Accept `example.com/login`, `localhost:3000`, or a full URL. */
export function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (raw === '') throw new BrowserError('BAD_URL', 'A URL is required, for example https://example.com');
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(raw)) return `http://${raw}`;
  if (/^[\w-]+(\.[\w-]+)+(\/|$|:)/.test(raw)) return `https://${raw}`;
  throw new BrowserError('BAD_URL', `"${raw}" does not look like a URL; include the scheme or a domain such as example.com`);
}

const KEY_CODES = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, text: '\t' },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
};

const MODIFIERS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Command: 4, Shift: 8 };

/** Translate "Control+a" or "Enter" into one `Input.dispatchKeyEvent` spec. */
export function keySpec(combo) {
  const raw = String(combo ?? '').trim();
  if (raw === '') throw new BrowserError('BAD_KEY', 'A key is required, for example Enter');
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  let modifiers = 0;
  let name = '';
  for (const part of parts) {
    if (MODIFIERS[part] !== undefined && parts.length > 1) modifiers |= MODIFIERS[part];
    else name = part;
  }
  if (name === '') name = parts[parts.length - 1];
  const known = KEY_CODES[name] ?? KEY_CODES[name[0].toUpperCase() + name.slice(1)];
  if (known) {
    const spec = { ...known, modifiers };
    if (modifiers !== 0) delete spec.text;
    return spec;
  }
  if (name.length === 1) {
    const upper = name.toUpperCase();
    const isLetter = /[A-Z]/.test(upper);
    const isDigit = /[0-9]/.test(name);
    const windowsVirtualKeyCode = isLetter || isDigit ? upper.charCodeAt(0) : name.charCodeAt(0);
    const spec = {
      key: name,
      code: isLetter ? `Key${upper}` : isDigit ? `Digit${name}` : '',
      windowsVirtualKeyCode,
      modifiers,
    };
    if (modifiers === 0) spec.text = name;
    return spec;
  }
  throw new BrowserError('BAD_KEY', `Unsupported key "${raw}"`);
}

export class BrowserManager {
  #config;
  #logger;
  #proc = null;
  #cdp = null;
  #sessionId = null;
  #targetId = null;
  #starting = null;
  #running = false;
  #owned = false;
  #executable = '';
  #url = 'about:blank';
  #title = '';
  #actions = [];
  #actionSeq = 0;
  #startedAt = 0;
  #lastRecordAt = new Map();
  #wheelTotal = 0;
  #wheelAt = 0;
  #typedBuffer = '';
  #typedAt = 0;
  #lastError = '';
  #tail = Promise.resolve();
  #disposed = false;
  /** Live picture subscribers; the screencast runs only while this is non-empty. */
  #frameListeners = new Set();
  #screencastSession = null;
  #screencastPending = null;

  constructor({ config = {}, logger } = {}) {
    this.#config = normalizeConfig(config);
    this.#logger = logger;
  }

  get config() {
    return this.#config;
  }

  get running() {
    return this.#running;
  }

  /** Serialize every browser operation: one page, one action at a time. */
  #serial(fn) {
    const run = this.#tail.then(fn, fn);
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async ensureStarted() {
    if (this.#running && this.#cdp !== null && !this.#cdp.closed) return;
    if (this.#starting !== null) {
      await this.#starting;
      return;
    }
    this.#starting = this.#launch().finally(() => {
      this.#starting = null;
    });
    await this.#starting;
  }

  async #launch() {
    if (this.#disposed) throw new BrowserError('DISPOSED', 'The plugin is unloading');
    const executable = findBrowserExecutable(this.#config);
    if (executable === '') {
      throw new BrowserError(
        'BROWSER_NOT_FOUND',
        'No Chrome, Edge, or Chromium executable was found. Set `executablePath` in the plugin config, or install Chrome.',
      );
    }
    this.#executable = executable;
    const userDataDir = this.#config.userDataDir.trim() === '' ? defaultUserDataDir() : this.#config.userDataDir.trim();
    try {
      mkdirSync(userDataDir, { recursive: true });
    } catch (error) {
      throw new BrowserError('PROFILE_DIR_FAILED', `Could not create the browser profile directory ${userDataDir}: ${error.message}`);
    }
    if (this.#config.reuseExisting) {
      const reused = await this.#reuseProfile(userDataDir).catch((error) => {
        this.#logger?.info?.(`[visual-browser] reuse probe failed: ${error?.message ?? error}`);
        return false;
      });
      if (reused) {
        this.#owned = false;
        await this.#attach();
        this.#running = true;
        this.#lastError = '';
        this.#startedAt = Date.now();
        if (this.#frameListeners.size > 0) void this.#restartScreencast();
        this.#record('start', userDataDir, 'attached to a running Chrome');
        this.#logger?.info?.('[visual-browser] attached to the Chrome that already owns this profile');
        return;
      }
    }
    const args = [
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-extensions',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      '--metrics-recording-only',
      '--mute-audio',
      '--hide-scrollbars',
      `--window-size=${this.#config.viewportWidth},${this.#config.viewportHeight}`,
      'about:blank',
    ];
    if (this.#config.headless) args.unshift('--headless=new');
    this.#logger?.info?.(`[visual-browser] launching ${executable} (headless=${this.#config.headless})`);

    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.#proc = child;
    let stderr = '';
    let settled = false;
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        finish(new BrowserError('STARTUP_TIMEOUT', `Chrome did not expose a DevTools endpoint within ${this.#config.startupTimeoutMs}ms. ${stderr.slice(-600)}`));
      }, this.#config.startupTimeoutMs);
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stderr?.removeListener('data', onData);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        if (error) reject(error);
        else resolve(value);
      };
      const onData = (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
        const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);
        if (match) finish(null, match[1]);
      };
      const onExit = (code) => {
        const hint =
          stderr.trim() === '' && code === 0
            ? 'Chrome handed the launch to a browser that already owns this profile, but no DevTools endpoint answered. Close the leftover browser (the panel Stop button, or Task Manager) or set a different `userDataDir`.'
            : stderr.slice(-600);
        finish(new BrowserError('BROWSER_EXITED', `Chrome exited with code ${code} before it was ready. ${hint}`));
      };
      const onError = (error) => {
        finish(new BrowserError('SPAWN_FAILED', `Could not start ${executable}: ${error.message}`));
      };
      child.stderr?.on('data', onData);
      child.once('exit', onExit);
      child.once('error', onError);
    }).catch((error) => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      this.#proc = null;
      throw error;
    });

    const cdp = await CdpConnection.open(endpoint);
    this.#owned = true;
    this.#cdp = cdp;
    child.once('exit', () => {
      if (this.#proc === child) this.#proc = null;
      this.#running = false;
      this.#sessionId = null;
      this.#targetId = null;
      cdp.close();
    });
    await this.#attach();
    this.#running = true;
    this.#lastError = '';
    this.#startedAt = Date.now();
    if (this.#frameListeners.size > 0) void this.#restartScreencast();
    this.#record('start', '', `${this.#config.headless ? 'headless' : 'windowed'} Chrome started`);
  }

  /**
   * Chrome writes `<userDataDir>/DevToolsActivePort` when it starts with remote
   * debugging. A host restart, or a crashed host whose Chrome survived, can
   * therefore adopt the running browser instead of failing on the profile lock.
   */
  async #reuseProfile(userDataDir) {
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    let text = '';
    try {
      text = await readFile(portFile, 'utf8');
    } catch {
      return false;
    }
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const port = Number(lines[0]);
    const wsPath = lines[1] ?? '';
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return false;
    if (!wsPath.startsWith('/devtools/browser/')) return false;
    let cdp = null;
    try {
      cdp = await CdpConnection.open(`ws://127.0.0.1:${port}${wsPath}`, { timeoutMs: 3000 });
      await cdp.send('Browser.getVersion');
    } catch {
      try {
        cdp?.close();
      } catch {
        /* already closed */
      }
      return false;
    }
    this.#cdp = cdp;
    cdp.onClose(() => {
      if (this.#cdp === cdp) {
        this.#running = false;
        this.#sessionId = null;
        this.#targetId = null;
      }
    });
    return true;
  }

  async #attach() {
    const cdp = this.#cdp;
    if (cdp === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const targetId = created?.targetId;
    if (typeof targetId !== 'string') throw new BrowserError('ATTACH_FAILED', 'Chrome did not return a page target');
    const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached?.sessionId;
    if (typeof sessionId !== 'string') throw new BrowserError('ATTACH_FAILED', 'Chrome did not attach a flattened session');
    this.#targetId = targetId;
    this.#sessionId = sessionId;
    this.#screencastSession = null;
    this.#screencastPending = null;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: this.#config.viewportWidth,
        height: this.#config.viewportHeight,
        deviceScaleFactor: 1,
        mobile: false,
      },
      sessionId,
    );
    // A blocking alert() would freeze every later snapshot; accept and log it.
    cdp.on('Page.javascriptDialogOpening', (params, sid) => {
      if (sid !== this.#sessionId) return;
      const message = String(params?.message ?? '');
      void cdp.send('Page.handleJavaScriptDialog', { accept: true }, sid).catch(() => undefined);
      this.#record('dialog', message.slice(0, 160), `dialog accepted: ${message.slice(0, 120)}`);
    });
    cdp.on('Page.frameNavigated', (params, sid) => {
      if (sid !== this.#sessionId) return;
      const frame = params?.frame;
      if (!frame || frame.parentId) return;
      if (typeof frame.url === 'string' && frame.url !== '' && frame.url !== 'about:blank') this.#url = frame.url;
    });
    // Chrome pushes one JPEG per painted change while a screencast is running;
    // acking immediately keeps it flowing, and every subscriber gets the very
    // same buffer, so N panels never cost N captures.
    cdp.on('Page.screencastFrame', (params, sid) => {
      if (sid !== this.#sessionId) return;
      if (typeof params?.sessionId === 'number') {
        void cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }, sid).catch(() => undefined);
      }
      const data = params?.data;
      if (typeof data !== 'string' || data === '') return;
      if (this.#frameListeners.size === 0) return;
      const jpeg = Buffer.from(data, 'base64');
      if (jpeg.length === 0) return;
      for (const listener of [...this.#frameListeners]) {
        try {
          listener(jpeg);
        } catch {
          /* one broken subscriber must not stop the stream */
        }
      }
    });
  }

  /** Shut Chrome down (or just detach when this host did not spawn it). */
  async close() {
    const proc = this.#proc;
    const owned = this.#owned;
    const cdp = this.#cdp;
    const targetId = this.#targetId;
    this.#proc = null;
    this.#owned = false;
    this.#running = false;
    this.#startedAt = 0;
    this.#sessionId = null;
    this.#targetId = null;
    this.#screencastSession = null;
    this.#screencastPending = null;
    this.#cdp = null;
    if (owned) {
      cdp?.close();
    } else if (cdp !== null && targetId !== null) {
      // Only our own tab is ours to close: another host may still use the browser.
      try {
        await Promise.race([cdp.send('Target.closeTarget', { targetId }), sleep(1000)]);
      } catch {
        /* the browser may already be gone */
      }
      cdp.close();
    } else {
      cdp?.close();
    }
    if (owned && proc !== null) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        /* already gone */
      }
    }
    this.#record('close', '', 'browser closed');
  }

  dispose() {
    this.#disposed = true;
    void this.close().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Observation
  // -------------------------------------------------------------------------

  async #evaluate(expression) {
    const cdp = this.#cdp;
    if (cdp === null || this.#sessionId === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    const result = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, userGesture: false },
      this.#sessionId,
    );
    if (result?.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluation failed';
      throw new BrowserError('PAGE_SCRIPT_FAILED', String(text).split('\n')[0]);
    }
    return result?.result?.value;
  }

  /** Full compact snapshot of the current page. */
  async snapshot(options = {}) {
    const value = await this.#evaluate(
      snapshotExpression({
        maxElements: options.maxElements ?? this.#config.maxElements,
        maxTextChars: options.maxTextChars ?? this.#config.maxTextChars,
        maxNameChars: this.#config.maxNameChars,
      }),
    );
    if (value === null || typeof value !== 'object') {
      throw new BrowserError('SNAPSHOT_FAILED', 'The page returned no snapshot data');
    }
    this.#url = String(value.url ?? this.#url);
    this.#title = String(value.title ?? '');
    return value;
  }

  async facts() {
    const value = await this.#evaluate(pageFactsExpression());
    if (value && typeof value === 'object') {
      this.#url = String(value.url ?? this.#url);
      this.#title = String(value.title ?? this.#title);
    }
    return value ?? null;
  }

  /** Read text of one element (ref/selector) or of the whole page. */
  async readText(options = {}) {
    const value = await this.#evaluate(
      readTextExpression({
        ref: options.ref,
        selector: options.selector,
        maxChars: options.maxChars ?? 4000,
      }),
    );
    if (value && value.ok === false) {
      throw new BrowserError(
        value.reason === 'stale-ref' ? 'STALE_REF' : 'TARGET_NOT_FOUND',
        value.reason === 'stale-ref'
          ? 'That element number is stale: take a fresh snapshot and use the new numbers.'
          : `No element matched ${options.ref ? `[${options.ref}]` : options.selector}`,
      );
    }
    return value;
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /** Open a URL, waiting for the first load, and return a fresh snapshot. */
  async open(url) {
    const target = normalizeUrl(url);
    await this.ensureStarted();
    return this.#serial(async () => {
      await this.#navigate(target);
      const snapshot = await this.snapshot();
      this.#record('open', target, snapshot.title || '');
      return snapshot;
    });
  }

  async #navigate(url) {
    const cdp = this.#cdp;
    if (cdp === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    const nav = await cdp.send('Page.navigate', { url }, this.#sessionId);
    if (nav?.errorText) throw new BrowserError('NAVIGATION_FAILED', `Could not open ${url}: ${nav.errorText}`);
    this.#url = url;
    await this.#waitReady(this.#config.navigationTimeoutMs);
  }

  async #waitReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let stable = 0;
    while (Date.now() < deadline) {
      let facts = null;
      try {
        facts = await this.#evaluate(pageFactsExpression());
      } catch {
        facts = null;
      }
      if (facts && facts.readyState === 'complete') {
        stable += 1;
        if (stable >= 2) {
          await sleep(120);
          return facts;
        }
      } else {
        stable = 0;
      }
      await sleep(120);
    }
    return null;
  }

  /** Wait for a click-triggered navigation or a short quiet window. */
  async #settleAfterAction() {
    const cdp = this.#cdp;
    if (cdp === null) return;
    let navigated = false;
    const start = Date.now();
    const off = cdp.on('Page.frameNavigated', (params, sid) => {
      if (sid !== this.#sessionId) return;
      if (params?.frame && !params.frame.parentId) navigated = true;
    });
    let quietSince = start;
    try {
      while (Date.now() - start < this.#config.actionTimeoutMs) {
        let facts = null;
        try {
          facts = await this.#evaluate(pageFactsExpression());
        } catch {
          facts = null;
        }
        const now = Date.now();
        if (facts && facts.url !== this.#url) {
          this.#url = String(facts.url);
          quietSince = now;
        }
        if (facts && facts.readyState !== 'complete') quietSince = now;
        const idle = navigated ? now - quietSince > 250 : now - start > 500;
        if (idle && (!navigated || (facts && facts.readyState === 'complete'))) break;
        await sleep(100);
      }
    } finally {
      off();
    }
    await sleep(80);
  }

  async #mouse(type, x, y, extra = {}) {
    const cdp = this.#cdp;
    if (cdp === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, ...extra }, this.#sessionId);
  }

  async #resolveTarget(target) {
    const resolved = await this.#evaluate(resolveExpression(target));
    if (!resolved || resolved.ok !== true) {
      const reason = resolved?.reason ?? 'not-found';
      const messages = {
        'stale-ref': 'That element number is stale: take a fresh snapshot and use the new numbers.',
        'not-found': `No element matched ${target.ref ? `[${target.ref}]` : target.selector}`,
        'not-visible': `The element ${target.ref ? `[${target.ref}]` : target.selector} is not visible in the viewport; scroll it into view first.`,
        'bad-selector': `"${target.selector}" is not a valid CSS selector.`,
      };
      throw new BrowserError(
        reason === 'stale-ref' ? 'STALE_REF' : 'TARGET_NOT_FOUND',
        messages[reason] ?? `Could not resolve ${target.ref ? `[${target.ref}]` : target.selector}`,
        resolved ?? undefined,
      );
    }
    return resolved;
  }

  async #clickResolved(resolved) {
    await this.#mouse('mouseMoved', resolved.x, resolved.y);
    await this.#mouse('mousePressed', resolved.x, resolved.y, { button: 'left', clickCount: 1 });
    await this.#mouse('mouseReleased', resolved.x, resolved.y, { button: 'left', clickCount: 1 });
  }

  async #typeInto(target, text, mode) {
    const prepared = await this.#evaluate(prepareTypingExpression({ ...target, mode }));
    if (!prepared || prepared.ok !== true) {
      const reason = prepared?.reason ?? 'not-found';
      throw new BrowserError(
        reason === 'stale-ref' ? 'STALE_REF' : 'TARGET_NOT_FOUND',
        reason === 'stale-ref'
          ? 'That element number is stale: take a fresh snapshot and use the new numbers.'
          : reason === 'disabled'
            ? 'The field is disabled.'
            : reason === 'readonly'
              ? 'The field is read-only.'
              : `No typable element matched ${target.ref ? `[${target.ref}]` : target.selector}`,
      );
    }
    const value = String(text ?? '');
    if (value !== '') {
      const cdp = this.#cdp;
      await cdp.send('Input.insertText', { text: value }, this.#sessionId);
      const after = await this.#evaluate(
        `(() => { const el = document.activeElement; if (!el) return ''; if (typeof el.value === 'string') return el.value; return el.innerText || ''; })()`,
      );
      const expected = mode === 'append' ? `${prepared.valueBefore ?? ''}${value}` : value;
      if (typeof after === 'string' && after !== expected && !String(after).includes(value)) {
        // Some editors ignore synthetic text input; write through the native
        // setter and dispatch the events frameworks listen for.
        await this.#evaluate(`(() => {
          const el = document.activeElement;
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            'value',
          );
          if (setter && setter.set) setter.set.call(el, ${JSON.stringify(expected)});
          else el.textContent = ${JSON.stringify(expected)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
      }
    }
    return prepared;
  }

  async #press(combo) {
    const spec = keySpec(combo);
    const cdp = this.#cdp;
    if (cdp === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    const base = {
      key: spec.key,
      code: spec.code || undefined,
      windowsVirtualKeyCode: spec.windowsVirtualKeyCode,
      nativeVirtualKeyCode: spec.windowsVirtualKeyCode,
      modifiers: spec.modifiers ?? 0,
    };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(spec.text ? { text: spec.text } : {}) }, this.#sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, this.#sessionId);
    return spec;
  }

  async #scrollBy(direction, amount) {
    const viewportHeight = this.#config.viewportHeight;
    const viewportWidth = this.#config.viewportWidth;
    const step = Math.max(120, Math.round(viewportHeight * 0.85)) * Math.max(1, Number(amount) || 1);
    const deltaY = direction === 'up' ? -step : direction === 'down' ? step : 0;
    const deltaX = direction === 'left' ? -step : direction === 'right' ? step : 0;
    await this.#mouse('mouseWheel', Math.round(viewportWidth / 2), Math.round(viewportHeight / 2), {
      deltaX,
      deltaY,
      pointerType: 'mouse',
    });
    return { deltaX, deltaY };
  }

  /**
   * One entry point for every page action. Returns `{ summary, snapshot }`.
   * The caller (tool or route) decides how much of the snapshot to show.
   */
  async act(input = {}) {
    const action = String(input.action ?? '').trim();
    if (action === '') throw new BrowserError('BAD_ACTION', 'An action is required');
    if (action === 'close') {
      await this.close();
      return { summary: 'browser closed', snapshot: null };
    }
    await this.ensureStarted();
    return this.#serial(async () => {
      const target = {
        ref: input.ref === undefined || input.ref === null || input.ref === '' ? undefined : Number(input.ref),
        selector: typeof input.selector === 'string' && input.selector.trim() !== '' ? input.selector.trim() : undefined,
      };
      let summary = '';
      switch (action) {
        case 'click': {
          if (target.ref === undefined && target.selector === undefined) {
            throw new BrowserError('BAD_ACTION', 'click needs a ref (from the last snapshot) or a selector');
          }
          const resolved = await this.#resolveTarget(target);
          await this.#clickResolved(resolved);
          summary = `click ${target.ref ? `[${target.ref}]` : target.selector}${resolved.name ? ` “${resolved.name}”` : ''}`;
          break;
        }
        case 'type': {
          if (target.ref === undefined && target.selector === undefined) {
            throw new BrowserError('BAD_ACTION', 'type needs a ref (from the last snapshot) or a selector');
          }
          if (typeof input.text !== 'string') throw new BrowserError('BAD_ACTION', 'type needs text');
          const prepared = await this.#typeInto(target, input.text, input.clear === false ? 'append' : 'replace');
          summary = `type ${target.ref ? `[${target.ref}]` : target.selector} · ${input.text.length} chars`;
          if (input.submit === true) {
            await this.#press('Enter');
            summary += ' + Enter';
          }
          break;
        }
        case 'key': {
          if (typeof input.key !== 'string' || input.key.trim() === '') throw new BrowserError('BAD_ACTION', 'key needs a key name such as Enter');
          const spec = await this.#press(input.key);
          summary = `press ${spec.key}`;
          break;
        }
        case 'hover': {
          const resolved = await this.#resolveTarget(target);
          await this.#mouse('mouseMoved', resolved.x, resolved.y);
          summary = `hover ${target.ref ? `[${target.ref}]` : target.selector}`;
          break;
        }
        case 'scroll': {
          const direction = String(input.direction ?? 'down');
          if (!['up', 'down', 'left', 'right'].includes(direction)) {
            throw new BrowserError('BAD_ACTION', 'scroll direction must be up, down, left, or right');
          }
          const moved = await this.#scrollBy(direction, input.amount);
          summary = `scroll ${direction} ${Math.abs(moved.deltaY || moved.deltaX)}px`;
          break;
        }
        case 'select': {
          const value = input.value ?? input.text;
          if (value === undefined) throw new BrowserError('BAD_ACTION', 'select needs a value');
          const picked = await this.#evaluate(selectOptionExpression({ ...target, value }));
          if (!picked || picked.ok !== true) {
            throw new BrowserError(
              'TARGET_NOT_FOUND',
              picked?.reason === 'not-a-select'
                ? 'That element is not a native <select>.'
                : `The option "${value}" was not found.`,
              picked ?? undefined,
            );
          }
          summary = `select “${picked.text}”`;
          break;
        }
        case 'back':
        case 'forward': {
          await this.#evaluate(`history.${action}()`);
          await this.#waitReady(this.#config.navigationTimeoutMs);
          summary = action === 'back' ? 'back one page' : 'forward one page';
          break;
        }
        case 'reload': {
          const cdp = this.#cdp;
          await cdp.send('Page.reload', { ignoreCache: false }, this.#sessionId);
          await this.#waitReady(this.#config.navigationTimeoutMs);
          summary = 'reload page';
          break;
        }
        case 'wait': {
          const ms = Math.min(30_000, Math.max(0, Number(input.ms) || 800));
          await sleep(ms);
          summary = `wait ${ms}ms`;
          break;
        }
        case 'snapshot': {
          summary = 'read page';
          break;
        }
        default:
          throw new BrowserError('BAD_ACTION', `Unknown action "${action}"`);
      }
      await this.#settleAfterAction();
      const snapshot = await this.snapshot();
      this.#record(action, target.ref !== undefined ? `[${target.ref}]` : (target.selector ?? ''), summary.slice(0, 160));
      return { summary, snapshot };
    });
  }

  /** Capture one screenshot to a file; returns the absolute path. */
  async screenshot(options = {}) {
    await this.ensureStarted();
    return this.#serial(async () => {
      const format = options.format === 'jpeg' ? 'jpeg' : 'png';
      const result = await this.#cdp.send(
        'Page.captureScreenshot',
        {
          format,
          fromSurface: true,
          captureBeyondViewport: false,
          ...(format === 'jpeg' ? { quality: 88 } : {}),
        },
        this.#sessionId,
      );
      const bytes = Buffer.from(String(result?.data ?? ''), 'base64');
      if (bytes.length === 0) throw new BrowserError('SCREENSHOT_FAILED', 'Chrome returned an empty screenshot');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const requested = typeof options.path === 'string' && options.path.trim() !== '' ? options.path.trim() : '';
      const filePath = requested !== '' ? path.resolve(requested) : path.join(tmpdir(), 'dsh-visual-browser', `page-${timestamp}.${format}`);
      mkdirSync(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes);
      this.#record('screenshot', path.basename(filePath), `saved ${format} screenshot`);
      return { path: filePath, bytes: bytes.length, format };
    });
  }

  // -------------------------------------------------------------------------
  // Live picture (CDP screencast -> MJPEG)
  // -------------------------------------------------------------------------

  /**
   * Start Chrome's own screencast: it pushes one JPEG per painted frame instead
   * of the panel asking for screenshots, so the picture follows clicks, drags
   * and scrolling at paint speed without a request per frame.
   */
  async #ensureScreencast() {
    const cdp = this.#cdp;
    const sessionId = this.#sessionId;
    if (!this.#running || cdp === null || sessionId === null) return false;
    if (this.#screencastSession === sessionId) return true;
    if (this.#screencastPending !== null) {
      await this.#screencastPending.catch(() => false);
      return this.#screencastSession === this.#sessionId;
    }
    this.#screencastPending = (async () => {
      await cdp.send(
        'Page.startScreencast',
        {
          format: 'jpeg',
          quality: this.#config.streamQuality,
          maxWidth: this.#config.viewportWidth,
          maxHeight: this.#config.viewportHeight,
          everyNthFrame: 1,
        },
        sessionId,
      );
      this.#screencastSession = sessionId;
      return true;
    })();
    try {
      return await this.#screencastPending;
    } catch (error) {
      this.#logger?.warn?.(`[visual-browser] screencast unavailable: ${error?.message ?? error}`);
      return false;
    } finally {
      this.#screencastPending = null;
    }
  }

  async #stopScreencast() {
    const cdp = this.#cdp;
    const sessionId = this.#screencastSession;
    this.#screencastSession = null;
    if (cdp === null || sessionId === null || cdp.closed) return;
    try {
      await cdp.send('Page.stopScreencast', {}, sessionId);
    } catch {
      /* the target may already be gone */
    }
  }

  /**
   * Subscribe to live JPEG frames. The first subscriber restarts the
   * screencast, because Chrome only pushes a frame when the page paints: a
   * fresh start is what makes a still page appear immediately.
   * @param {(jpeg: Buffer) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribeFrames(listener) {
    if (typeof listener !== 'function') return () => {};
    const first = this.#frameListeners.size === 0;
    this.#frameListeners.add(listener);
    if (first) void this.#restartScreencast();
    else void this.#ensureScreencast();
    return () => {
      if (!this.#frameListeners.delete(listener)) return;
      if (this.#frameListeners.size === 0) void this.#stopScreencast();
    };
  }

  async #restartScreencast() {
    await this.#stopScreencast();
    if (this.#frameListeners.size === 0) return;
    await this.#ensureScreencast();
  }

  /** Ask for a picture even when nothing is painted (used when a panel opens). */
  refreshLiveView() {
    if (!this.#running) return;
    if (this.#frameListeners.size > 0) void this.#restartScreencast();
    else void this.#ensureScreencast();
  }

  // -------------------------------------------------------------------------
  // User input from the panel
  // -------------------------------------------------------------------------

  /**
   * Dispatch a batch of panel input events straight to Chrome. Nothing here
   * waits for a snapshot or a capture: input latency is one round trip.
   * @param {Array<object>} events
   */
  async dispatchInput(events) {
    if (!Array.isArray(events) || events.length === 0) return { applied: 0 };
    if (!this.#config.allowUserControl) {
      throw new BrowserError('USER_CONTROL_DISABLED', 'User input is disabled in this plugin config');
    }
    await this.ensureStarted();
    const cdp = this.#cdp;
    const sessionId = this.#sessionId;
    if (cdp === null || sessionId === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    const width = this.#config.viewportWidth;
    const height = this.#config.viewportHeight;
    const pending = [];
    let applied = 0;
    for (const event of events.slice(0, 160)) {
      if (event === null || typeof event !== 'object') continue;
      try {
        const commands = this.#inputCommands(event, width, height);
        for (const command of commands) {
          pending.push(cdp.send(command.method, command.params, sessionId));
          applied += 1;
        }
      } catch (error) {
        this.noteError(error);
      }
    }
    // The socket preserves order, so awaiting is only about surfacing failures.
    Promise.allSettled(pending).then((settled) => {
      for (const result of settled) {
        if (result.status === 'rejected') this.noteError(result.reason);
      }
    });
    return { applied };
  }

  /** Translate one panel event into CDP commands and its timeline record. */
  #inputCommands(event, width, height) {
    const type = String(event.t ?? '');
    const modifiers = Number.isFinite(Number(event.modifiers)) ? Number(event.modifiers) : 0;
    switch (type) {
      case 'pointer': {
        const x = Math.round(clamp01(event.x) * width);
        const y = Math.round(clamp01(event.y) * height);
        const phase = String(event.type ?? 'move');
        const buttons = Number.isFinite(Number(event.buttons)) ? Number(event.buttons) : phase === 'down' ? 1 : 0;
        const button = phase === 'move' ? 'none' : mouseButton(event.button);
        if (phase === 'up') {
          const drag = event.drag === true;
          this.#recordUser(
            drag ? 'user-drag' : 'user-click',
            `${Math.round(clamp01(event.x) * 100)}%,${Math.round(clamp01(event.y) * 100)}%`,
            drag ? `you dragged to ${Math.round(x)}, ${Math.round(y)}` : `you clicked ${Math.round(x)}, ${Math.round(y)}`,
            0,
          );
        }
        return [
          {
            method: 'Input.dispatchMouseEvent',
            params: {
              type: phase === 'down' ? 'mousePressed' : phase === 'up' ? 'mouseReleased' : 'mouseMoved',
              x,
              y,
              button,
              buttons,
              clickCount: Math.max(1, Math.min(3, Number(event.clicks) || 1)),
              modifiers,
              pointerType: 'mouse',
            },
          },
        ];
      }
      case 'wheel': {
        const x = Math.round(clamp01(event.x) * width);
        const y = Math.round(clamp01(event.y) * height);
        const deltaX = clampNumber(event.dx, 4000);
        const deltaY = clampNumber(event.dy, 4000);
        if (deltaX === 0 && deltaY === 0) return [];
        const now = Date.now();
        if (now - this.#wheelAt > 900) this.#wheelTotal = 0;
        this.#wheelAt = now;
        this.#wheelTotal += Math.max(Math.abs(deltaX), Math.abs(deltaY));
        this.#recordUser(
          'user-scroll',
          `${Math.round(deltaX)},${Math.round(deltaY)}`,
          `you scrolled ${Math.round(this.#wheelTotal)}px`,
          700,
        );
        return [
          {
            method: 'Input.dispatchMouseEvent',
            params: { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers, pointerType: 'mouse' },
          },
        ];
      }
      case 'key': {
        const phase = String(event.type ?? 'down');
        const key = String(event.key ?? '');
        if (key === '') return [];
        const keyCode = Number.isFinite(Number(event.keyCode)) ? Number(event.keyCode) : 0;
        const params = {
          key,
          code: typeof event.code === 'string' ? event.code : undefined,
          windowsVirtualKeyCode: keyCode || undefined,
          nativeVirtualKeyCode: keyCode || undefined,
          modifiers,
        };
        const text = typeof event.text === 'string' ? event.text : '';
        if (phase === 'up') return [{ method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...params } }];
        if (event.repeat === true) params.autoRepeat = true;
        if (text === '') {
          this.#recordUser('user-key', key, `you pressed ${key}`, 0);
        } else {
          const now = Date.now();
          if (now - this.#typedAt > 1400) this.#typedBuffer = '';
          this.#typedAt = now;
          this.#typedBuffer = (this.#typedBuffer + text).slice(-40);
          this.#recordUser('user-type', text, `you typed "${this.#typedBuffer}"`, 600);
        }
        return [
          {
            method: 'Input.dispatchKeyEvent',
            params: text === '' ? { type: 'rawKeyDown', ...params } : { type: 'keyDown', ...params, text },
          },
        ];
      }
      case 'text': {
        const text = typeof event.text === 'string' ? event.text : '';
        if (text === '') return [];
        const now = Date.now();
        if (now - this.#typedAt > 1400) this.#typedBuffer = '';
        this.#typedAt = now;
        this.#typedBuffer = (this.#typedBuffer + text).slice(-40);
        this.#recordUser('user-type', text.slice(0, 40), `you typed "${this.#typedBuffer}"`, 600);
        return [{ method: 'Input.insertText', params: { text: text.slice(0, 4000) } }];
      }
      default:
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // Timeline
  // -------------------------------------------------------------------------

  #record(kind, target, detail, ok = true) {
    const entry = {
      seq: ++this.#actionSeq,
      kind,
      target: String(target ?? ''),
      detail: String(detail ?? ''),
      ok: ok !== false,
      ts: Date.now(),
    };
    this.#actions.unshift(entry);
    if (this.#actions.length > 80) this.#actions.length = 80;
    return entry;
  }

  /**
   * Record a user gesture, folding rapid repeats (typing, scrolling) into the
   * newest row instead of flooding the log with a row per event.
   */
  #recordUser(kind, target, detail, minIntervalMs) {
    const now = Date.now();
    const last = this.#lastRecordAt.get(kind) ?? 0;
    if (minIntervalMs > 0 && now - last < minIntervalMs) {
      const newest = this.#actions[0];
      if (newest !== undefined && newest.kind === kind) {
        newest.ts = now;
        newest.target = String(target ?? newest.target);
        newest.detail = String(detail ?? newest.detail);
        return newest;
      }
    }
    this.#lastRecordAt.set(kind, now);
    return this.#record(kind, target, detail);
  }

  /** JSON payload the panel polls; pictures travel on their own stream. */
  state() {
    return {
      running: this.#running,
      starting: this.#starting !== null,
      executable: this.#executable,
      headless: this.#config.headless,
      managed: this.#owned,
      url: this.#url,
      title: this.#title,
      viewport: { width: this.#config.viewportWidth, height: this.#config.viewportHeight },
      startedAt: this.#startedAt,
      actionSeq: this.#actionSeq,
      actions: this.#actions.map((action) => ({
        seq: action.seq,
        kind: action.kind,
        target: action.target,
        detail: action.detail,
        ok: action.ok,
        ts: action.ts,
      })),
      allowUserControl: this.#config.allowUserControl,
      lastError: this.#lastError,
    };
  }

  noteError(error) {
    this.#lastError = error instanceof Error ? error.message : String(error);
  }
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function clampNumber(value, limit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(-limit, Math.min(limit, number));
}

function mouseButton(value) {
  if (value === 2 || value === 'right') return 'right';
  if (value === 1 || value === 'middle') return 'middle';
  return 'left';
}
