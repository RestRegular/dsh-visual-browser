/**
 * BrowserManager owns exactly one Chrome process and one page target.
 *
 * The manager is the only place that knows about the DevTools Protocol; the
 * agent tools and the panel routes both drive this same object, so a click from
 * the model and a click from the user follow one code path.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { CdpConnection } from './cdp.js';
import { clipEnd } from './format.js';
import {
  buildLaunchArgs,
  detectBrowserVersion,
  headlessScreen,
  productName,
  windowedUserAgent,
} from './launch.js';
import {
  clickCommands,
  DEFAULT_DRAG_DURATION_MS,
  dragCommands,
  dragPoints,
  moveCommand,
  normalizePoint,
  stepDelay,
} from './gesture.js';
import {
  fileInputExpression,
  pageFactsExpression,
  prepareTypingExpression,
  readTextExpression,
  resolveExpression,
  selectOptionExpression,
  setNativeValueExpression,
  snapshotExpression,
} from './page-scripts.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Inputs whose picker is drawn by the browser, not by the page: an OS dialog or
 * a native popup window. Neither is part of the page's render surface, so the
 * numbered view cannot see them and CDP input never reaches them — their value
 * is written directly instead (see `setNativeValueExpression`).
 */
const NATIVE_VALUE_TYPES = new Set(['date', 'time', 'month', 'week', 'datetime-local', 'color', 'range']);

/** How long a click may take to open a file chooser before the dialog is dropped. */
const FILE_CHOOSER_WAIT_MS = 2000;
/** A plain click is not going to open a picker; only look for one briefly. */
const FILE_CHOOSER_PROBE_MS = 160;
const MAX_UPLOAD_FILES = 20;

export class BrowserError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'BrowserError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Turn the loose `files` argument of an upload into absolute paths that exist.
 * Relative paths resolve against the host process directory (the session
 * workspace), which is where an agent's generated files usually live.
 */
function normalizeUploadFiles(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const files = [];
  for (const item of list) {
    const text = String(item ?? '').trim();
    if (text === '') continue;
    const absolute = path.resolve(text);
    let stats = null;
    try {
      stats = statSync(absolute);
    } catch {
      throw new BrowserError('FILE_NOT_FOUND', `There is no file to upload at ${absolute}`);
    }
    if (!stats.isFile()) throw new BrowserError('FILE_NOT_FOUND', `${absolute} is not a file`);
    files.push(absolute);
    if (files.length >= MAX_UPLOAD_FILES) break;
  }
  return files;
}

/** One-line result of an upload, short enough for the operation log. */
function uploadSummary(files, placed) {
  const names = files.map((file) => path.basename(file));
  const shown = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  const how = placed?.mode === 'input' ? 'written straight into the file input' : 'file chooser filled';
  const trimmed =
    placed?.accepted !== undefined && placed.accepted.length < files.length ? ` (the control took ${placed.accepted.length})` : '';
  return `upload ${files.length} file${files.length === 1 ? '' : 's'} · ${shown} · ${how}${trimmed}`;
}

/** Appended to a click that turned out to want files. */
function fileChooserHint() {
  return ' · that click opened a file chooser, which is never shown here: pass files with action "upload" to pick files';
}

export const DEFAULT_CONFIG = {
  headless: true,
  /**
   * Off switches that make the page look automated: `navigator.webdriver`, the
   * `HeadlessChrome` User-Agent, a screen smaller than the window. Sites that
   * bind a login to the browser (doubao.com and other ByteDance properties)
   * sign such a session out seconds after it succeeds.
   */
  stealth: true,
  /** Explicit User-Agent; empty = the detected Chrome build's own. */
  userAgent: '',
  /** Extra Chrome switches, appended after the built-in ones. */
  extraArgs: [],
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
    stealth: source.stealth === undefined ? DEFAULT_CONFIG.stealth : source.stealth !== false,
    userAgent: typeof source.userAgent === 'string' ? source.userAgent.trim() : DEFAULT_CONFIG.userAgent,
    extraArgs: Array.isArray(source.extraArgs)
      ? source.extraArgs.filter((arg) => typeof arg === 'string' && arg.trim() !== '').map((arg) => arg.trim())
      : [],
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
  /** CDP session override while an isolated (background-tab) operation runs. */
  #opSessionId = null;
  /** The page an isolated operation is acting on (else null = active page). */
  #opPage = null;
  #targetId = null;
  /** Every page this Chrome has for us, keyed by CDP target id. */
  #pages = new Map();
  #activeTarget = null;
  #pageSeq = 0;
  #boundCdp = null;
  #starting = null;
  #running = false;
  #owned = false;
  #executable = '';
  /**
   * User-Agent to stamp on every target when the launch could not carry one
   * (the installed build was unknown). Removes the `Headless` marker only.
   */
  #fallbackUserAgent = '';
  #url = 'about:blank';
  #title = '';
  #actions = [];
  #actionSeq = 0;
  /** Browsing history: urls the user/Agent landed on, newest first. */
  #history = [];
  #historySeq = 0;
  /** Page console: the active page's own console output plus evaluated results. */
  #console = [];
  #consoleSeq = 0;
  #startedAt = 0;
  #lastRecordAt = new Map();
  #wheelTotal = 0;
  #wheelAt = 0;
  #typedBuffer = '';
  #typedAt = 0;
  #lastError = '';
  #tail = Promise.resolve();
  #disposed = false;
  /** Set when a browser action last touched input; new tabs adopt promptly after it. */
  #lastInputAt = 0;
  /** Wall clock of the newest main-frame navigation seen for the active session. */
  #navigationAt = 0;
  /** How many of our own targets are still being created and attached. */
  #creating = 0;
  #attaching = new Map();
  #discoveryCdp = null;
  /** Live picture subscribers; the screencast runs only while this is non-empty. */
  #frameListeners = new Set();
  #screencastSession = null;
  #screencastPending = null;
  /**
   * Agent activity subscribers: the panel draws the simulated pointer, click
   * ripple, scroll arrows, drag hand and the lock veil from these cues. Without
   * a subscriber every cue is a no-op, so a headless run pays nothing.
   */
  #activityListeners = new Set();
  #activityAcks = new Map();
  #activitySeq = 0;
  #activeActivity = null;

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

  /**
   * CDP session an operation should be routed to. While an isolated
   * (background-tab) operation is running `#opSessionId` points at that page's
   * own session; otherwise every operation targets the active page. The live
   * screencast, the event filters that guard it, and the active-page state
   * always keep using `#sessionId`, which is why the active view is untouched.
   */
  #effectiveSession() {
    return this.#opSessionId ?? this.#sessionId;
  }

  /**
   * Run an operation against a specific page without taking over the panel's
   * active view. `id` may be a page id or CDP target id; passing no id (or the
   * id of the already-active page) is a no-op that runs against the active
   * page exactly as before — the operator never tripped the screencast, so the
   * relaxed guard here keeps the active page session for those. Because nothing
   * here moves the foreground tab, switches the live picture or restarts the
   * screencast, an Agent operating on a background tab never disturbs what the
   * user is looking at.
   */
  async #isolatedOnPage(id, fn) {
    const page = id === undefined || id === null || id === '' ? null : this.#findPage(id);
    if (page === null || page.targetId === this.#activeTarget) return fn();
    this.#opSessionId = page.sessionId;
    this.#opPage = page;
    try {
      return await fn();
    } finally {
      this.#opSessionId = null;
      this.#opPage = null;
    }
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
        this.#pages.clear();
        this.#activeTarget = null;
        await this.#enableDiscovery(this.#cdp);
        await this.#resolveUserAgent(this.#cdp, { reused: true });
        await this.#openPage('about:blank');
        this.#running = true;
        this.#lastError = '';
        this.#startedAt = Date.now();
        if (this.#frameListeners.size > 0) void this.#restartScreencast();
        this.#record('start', userDataDir, 'attached to a running Chrome');
        this.#logger?.info?.('[visual-browser] attached to the Chrome that already owns this profile');
        return;
      }
    }
    const version = detectBrowserVersion(executable);
    const args = buildLaunchArgs({
      config: this.#config,
      userDataDir,
      version,
      platform: process.platform,
      product: productName(executable),
    });
    this.#logger?.info?.(
      `[visual-browser] launching ${executable} (headless=${this.#config.headless}, build=${version || 'unknown'}, stealth=${this.#config.stealth !== false})`,
    );

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
    await this.#resolveUserAgent(cdp);
    await this.#enableDiscovery(cdp);
    child.once('exit', () => {
      if (this.#proc === child) this.#proc = null;
      this.#running = false;
      this.#sessionId = null;
      this.#targetId = null;
      cdp.close();
    });
    this.#pages.clear();
    this.#activeTarget = null;
    await this.#openPage('about:blank');
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

  /**
   * Turn on target discovery so tabs the page opens itself (`target=_blank`,
   * `window.open`) are adopted instead of silently becoming invisible Chrome
   * tabs that keep the panel frozen on the old page.
   */
  async #enableDiscovery(cdp) {
    if (cdp === null || cdp === undefined || this.#discoveryCdp === cdp) return;
    this.#discoveryCdp = cdp;
    try {
      await cdp.send('Target.setDiscoverTargets', { discover: true });
    } catch (error) {
      this.#logger?.warn?.(`[visual-browser] target discovery unavailable: ${error?.message ?? error}`);
    }
  }

  /**
   * Learn the browser's own User-Agent and keep the windowed form, for launches
   * that could not carry a `--user-agent` switch (the installed build was
   * unknown). Without it such a page still sees `HeadlessChrome/<version>`.
   */
  async #resolveUserAgent(cdp, { reused = false } = {}) {
    this.#fallbackUserAgent = '';
    if (cdp === null || cdp === undefined || this.#config.stealth === false) return;
    try {
      const info = await cdp.send('Browser.getVersion');
      this.#fallbackUserAgent = windowedUserAgent(info?.userAgent);
    } catch {
      this.#fallbackUserAgent = '';
    }
    if (reused && this.#fallbackUserAgent !== '') {
      this.#logger?.warn?.(
        '[visual-browser] the Chrome we attached to still reports a headless User-Agent; close it once so the next start gets a clean identity',
      );
    }
  }

  /**
   * Create one page (CDP target) and make it the active page. Chrome keeps the
   * others alive; only the active page gets a screencast and input.
   */
  async #openPage(url = 'about:blank') {
    const cdp = this.#cdp;
    if (cdp === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    this.#creating += 1;
    try {
      const created = await cdp.send('Target.createTarget', { url });
      const targetId = created?.targetId;
      if (typeof targetId !== 'string') throw new BrowserError('ATTACH_FAILED', 'Chrome did not return a page target');
      // Discovery can win the race against this response; reuse the page it
      // already attached instead of attaching the same target twice.
      const page = this.#pages.get(targetId) ?? (await this.#attachTarget(targetId, { url }));
      await this.#setActive(page.targetId);
      this.#pushHistory(url, page.title);
      return page;
    } finally {
      this.#creating = Math.max(0, this.#creating - 1);
    }
  }

  /** Attach one target (ours or a tab the page opened) at most once. */
  async #attachTarget(targetId, info = {}) {
    const known = this.#pages.get(targetId);
    if (known !== undefined) return known;
    const pending = this.#attaching.get(targetId);
    if (pending !== undefined) return pending;
    const task = this.#attachTargetNow(targetId, info).finally(() => {
      this.#attaching.delete(targetId);
    });
    this.#attaching.set(targetId, task);
    return task;
  }

  async #attachTargetNow(targetId, info) {
    const cdp = this.#cdp;
    if (cdp === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached?.sessionId;
    if (typeof sessionId !== 'string') throw new BrowserError('ATTACH_FAILED', 'Chrome did not attach a flattened session');
    const page = {
      id: `p${++this.#pageSeq}`,
      targetId,
      sessionId,
      url: typeof info.url === 'string' ? info.url : '',
      title: typeof info.title === 'string' ? info.title : '',
    };
    this.#pages.set(targetId, page);
    this.#bindEvents(cdp);
    try {
      if (this.#fallbackUserAgent !== '') {
        // Best effort: a page that refuses the override is still usable, so a
        // failure here must not cost the tab.
        await cdp
          .send('Emulation.setUserAgentOverride', { userAgent: this.#fallbackUserAgent }, sessionId)
          .catch(() => undefined);
      }
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send(
        'Emulation.setDeviceMetricsOverride',
        {
          width: this.#config.viewportWidth,
          height: this.#config.viewportHeight,
          deviceScaleFactor: 1,
          mobile: false,
          // A headless screen that equals the window is itself a headless tell,
          // and Chrome's default headless screen (800x600) is smaller than it.
          ...(this.#config.headless ? headlessScreen(this.#config.viewportWidth, this.#config.viewportHeight) : {}),
        },
        sessionId,
      );
    } catch (error) {
      this.#pages.delete(targetId);
      throw error;
    }
    return page;
  }

  /** A page target appeared. Adopt tabs the page itself opened, then follow them. */
  #adoptTarget(info) {
    if (this.#disposed) return;
    if (!info || info.type !== 'page') return;
    const targetId = info.targetId;
    if (typeof targetId !== 'string' || targetId === '') return;
    if (this.#pages.has(targetId)) return;
    if (this.#creating > 0) {
      // Our own create/attach is still in flight; check again once it settles.
      const timer = setTimeout(() => {
        if (this.#disposed || this.#pages.has(targetId)) return;
        this.#adoptTarget(info);
      }, 120);
      timer.unref?.();
      return;
    }
    void this.#attachTarget(targetId, info)
      .then((page) => {
        this.#record('open', page.url || 'about:blank', 'new tab');
        // A tab opened while the user/Agent was just acting is the one Chrome
        // has brought to the foreground: watch it instead of the hidden opener.
        if (Date.now() - this.#lastInputAt < 2500 && !this.#disposed) {
          return this.#setActive(page.targetId).catch((error) => {
            this.#logger?.warn?.(`[visual-browser] could not follow the new tab: ${error?.message ?? error}`);
          });
        }
        // Not following this tab leaves the panel on the old page. Chrome may
        // still have pushed the new tab to the foreground, so put the page the
        // panel actually shows back in front: input to a background tab is
        // queued and would look frozen until some other tab closes.
        const active = this.#pages.get(this.#activeTarget);
        const cdp = this.#cdp;
        if (active !== undefined && cdp !== null && !cdp.closed) {
          void cdp.send('Page.bringToFront', {}, active.sessionId).catch(() => undefined);
        }
        return undefined;
      })
      .catch((error) => {
        this.#logger?.warn?.(`[visual-browser] could not attach a new tab: ${error?.message ?? error}`);
      });
  }

  /** A page target disappeared (closed, crashed, or navigated away). */
  #forgetTarget(targetId) {
    const page = this.#pages.get(targetId);
    if (page === undefined) return;
    this.#pages.delete(targetId);
    if (this.#activeTarget !== targetId) return;
    const next = [...this.#pages.values()][0];
    if (next === undefined) {
      this.#activeTarget = null;
      this.#targetId = null;
      this.#sessionId = null;
      this.#url = '';
      this.#title = '';
      return;
    }
    void this.#setActive(next.targetId).catch((error) => {
      this.#logger?.warn?.(`[visual-browser] could not switch after a tab closed: ${error?.message ?? error}`);
    });
  }

  /** Point the mirrors (session, url, title, screencast) at one page. */
  async #setActive(targetId) {
    const page = this.#pages.get(targetId);
    if (page === undefined) return null;
    const cdp = this.#cdp;
    const changed = this.#activeTarget !== targetId;
    // A console is the page's own: switching tabs starts a fresh one, the way
    // DevTools opens a new console for the page it follows.
    if (changed) this.#console = [];
    if (changed && this.#screencastSession !== null && cdp !== null && !cdp.closed) {
      const previous = this.#screencastSession;
      this.#screencastSession = null;
      try {
        await cdp.send('Page.stopScreencast', {}, previous);
      } catch {
        /* that page may already be gone */
      }
    }
    this.#activeTarget = targetId;
    this.#targetId = targetId;
    this.#opSessionId = null;
    this.#opPage = null;
    this.#sessionId = page.sessionId;
    this.#url = page.url;
    this.#title = page.title;
    if (cdp !== null && !cdp.closed) {
      // Selecting a page must also bring its Chrome tab to the foreground.
      // Input dispatched to a hidden tab is not delivered: Chrome queues it
      // until that tab becomes visible, which looked like the old page freezing
      // and then replaying every click the moment a newer tab was closed.
      try {
        await cdp.send('Page.bringToFront', {}, page.sessionId);
      } catch (error) {
        this.#logger?.warn?.(`[visual-browser] could not activate the page: ${error?.message ?? error}`);
      }
    }
    if (this.#frameListeners.size > 0) void this.#ensureScreencast();
    return page;
  }

  #mirrorActive() {
    const page = this.#pages.get(this.#activeTarget);
    if (page === undefined) return;
    page.url = this.#url;
    page.title = this.#title;
  }

  /** Protocol events fire for every session; only the active page is ours. */
  #bindEvents(cdp) {
    if (this.#boundCdp === cdp) return;
    this.#boundCdp = cdp;
    // Tabs Chrome opens for the page itself are real pages: attach them so the
    // panel never keeps showing a hidden opener while the browser sits on a
    // brand-new tab.
    cdp.on('Target.targetCreated', (params) => {
      this.#adoptTarget(params?.targetInfo);
    });
    cdp.on('Target.targetDestroyed', (params) => {
      this.#forgetTarget(params?.targetId);
    });
    cdp.on('Target.targetInfoChanged', (params) => {
      const info = params?.targetInfo;
      if (!info || info.type !== 'page') return;
      const page = this.#pages.get(info.targetId);
      if (page === undefined) return;
      if (typeof info.url === 'string' && info.url !== '') page.url = info.url;
      if (typeof info.title === 'string') page.title = info.title;
      if (this.#activeTarget === info.targetId) {
        if (typeof info.url === 'string' && info.url !== '') this.#url = info.url;
        if (typeof info.title === 'string') this.#title = info.title;
      }
    });
    // A blocking alert() would freeze every later snapshot; accept and log it.
    cdp.on('Page.javascriptDialogOpening', (params, sid) => {
      if (sid !== this.#sessionId) return;
      const message = String(params?.message ?? '');
      void cdp.send('Page.handleJavaScriptDialog', { accept: true }, sid).catch(() => undefined);
      this.#record('dialog', message.slice(0, 160), `dialog accepted: ${message.slice(0, 120)}`);
    });
    // The page's own console, shown in the panel's console dock. Only the
    // active page is followed; switching pages clears the dock in #setActive.
    cdp.on('Runtime.consoleAPICalled', (params, sid) => {
      if (sid !== this.#sessionId) return;
      const args = Array.isArray(params?.args) ? params.args : [];
      const text = args.map((arg) => consoleArgumentText(arg)).join(' ');
      this.#recordConsole(consoleLevelOf(params?.type), text, {
        ts: Date.now(),
        url: params?.stackTrace?.callFrames?.[0]?.url,
      });
    });
    cdp.on('Runtime.exceptionThrown', (params, sid) => {
      if (sid !== this.#sessionId) return;
      const details = params?.exceptionDetails;
      if (!details) return;
      const text = details.exception?.description || details.exception?.value || details.text || 'Uncaught exception';
      this.#recordConsole('error', text, {
        ts: Date.now(),
        url: details.url,
      });
    });
    cdp.on('Page.frameNavigated', (params, sid) => {
      if (sid !== this.#sessionId) return;
      const frame = params?.frame;
      if (!frame || frame.parentId) return;
      if (typeof frame.url !== 'string' || frame.url === '' || frame.url === 'about:blank') return;
      this.#navigationAt = Date.now();
      this.#url = frame.url;
      const page = this.#pages.get(this.#activeTarget);
      if (page !== undefined) page.url = frame.url;
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
    const pages = [...this.#pages.values()];
    this.#pages.clear();
    this.#activeTarget = null;
    this.#boundCdp = null;
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
    } else if (cdp !== null && pages.length > 0) {
      // Only our own tabs are ours to close: another host may still use the browser.
      await Promise.allSettled(
        pages.map((page) =>
          Promise.race([cdp.send('Target.closeTarget', { targetId: page.targetId }), sleep(1000)]).catch(() => undefined),
        ),
      );
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
    const sessionId = this.#effectiveSession();
    if (cdp === null || sessionId === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    const result = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, userGesture: false },
      sessionId,
    );
    if (result?.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluation failed';
      throw new BrowserError('PAGE_SCRIPT_FAILED', String(text).split('\n')[0]);
    }
    return result?.result?.value;
  }

  /** Full compact snapshot of the current page (or a specific page). */
  async snapshot(options = {}) {
    const page = this.#findPage(options.page) ?? this.#pages.get(this.#activeTarget) ?? null;
    const value = await this.#isolatedOnPage(
      options.page,
      () => this.#evaluate(
        snapshotExpression({
          maxElements: options.maxElements ?? this.#config.maxElements,
          maxTextChars: options.maxTextChars ?? this.#config.maxTextChars,
          maxNameChars: this.#config.maxNameChars,
        }),
      ),
    );
    if (value === null || typeof value !== 'object') {
      throw new BrowserError('SNAPSHOT_FAILED', 'The page returned no snapshot data');
    }
    this.#reflectPage(page, String(value.url ?? ''), String(value.title ?? ''));
    return value;
  }

  async facts() {
    const page = this.#pages.get(this.#activeTarget) ?? null;
    const value = await this.#evaluate(pageFactsExpression());
    if (value && typeof value === 'object') {
      this.#reflectPage(page, String(value.url ?? ''), String(value.title ?? ''));
    }
    return value ?? null;
  }

  /** Update a page's (or the active mirrors') url/title from a live read. */
  #reflectPage(page, url, title) {
    if (page !== null && page !== undefined) {
      if (url !== '') page.url = url;
      page.title = title;
    }
    if (page === null || page.targetId === this.#activeTarget) {
      if (url !== '') this.#url = url;
      if ((title ?? '') !== '') this.#title = title;
      this.#mirrorActive();
    }
  }

  /** Read text of one element (ref/selector) or of the whole page. */
  async readText(options = {}) {
    const value = await this.#isolatedOnPage(
      options.page,
      () => this.#evaluate(
        readTextExpression({
          ref: options.ref,
          selector: options.selector,
          maxChars: options.maxChars ?? 4000,
        }),
      ),
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
  async open(url, options = {}) {
    const target = normalizeUrl(url);
    await this.ensureStarted();
    return this.#serial(async () => {
      const activity =
        options?.source === 'agent' ? this.#beginActivity({ kind: 'open', detail: target }) : null;
      let ok = false;
      try {
        await this.#awaitActivity(activity);
        await this.#navigate(target);
        const snapshot = await this.snapshot();
        this.#mirrorActive();
        this.#record('open', target, snapshot.title || '');
        ok = true;
        return snapshot;
      } finally {
        this.#endActivity(activity, ok);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Pages (one Chrome tab each)
  // -------------------------------------------------------------------------

  /** Open one more Chrome page and make it the active page. */
  async newPage(url = '') {
    await this.ensureStarted();
    return this.#serial(async () => {
      await this.#openPage('about:blank');
      const target = typeof url === 'string' && url.trim() !== '' ? normalizeUrl(url) : '';
      if (target !== '') await this.#navigate(target);
      this.#mirrorActive();
      this.#record('open', target || 'about:blank', 'new page');
      return this.state();
    });
  }

  /** Reload one page, active or not; every other tab keeps its state. */
  async reloadPage(id) {
    await this.ensureStarted();
    return this.#serial(async () => {
      const page = this.#findPage(id);
      if (page === null) throw new BrowserError('TARGET_NOT_FOUND', `No page ${String(id)}`);
      const cdp = this.#cdp;
      if (cdp === null || cdp.closed) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
      await cdp.send('Page.reload', { ignoreCache: false }, page.sessionId);
      this.#record('reload', page.title || page.url, 'reloaded page');
      return this.state();
    });
  }

  /** Make an existing page active (the panel's tab strip). */
  async selectPage(id) {
    await this.ensureStarted();
    return this.#serial(async () => {
      const page = this.#findPage(id);
      if (page === null) throw new BrowserError('TARGET_NOT_FOUND', `No page ${String(id)}`);
      const changed = page.targetId !== this.#activeTarget;
      // Always activate, even when the panel already marks this page current:
      // Chrome's foreground tab can drift from the panel (a tab the page opened
      // itself, or a click on the already-marked tab), and clicking the tab is
      // the user's way to bring it back.
      await this.#setActive(page.targetId);
      if (changed) {
        try {
          const facts = await this.#evaluate(pageFactsExpression());
          if (facts && typeof facts === 'object') {
            if (typeof facts.url === 'string' && facts.url !== '') page.url = facts.url;
            if (typeof facts.title === 'string') page.title = facts.title;
            this.#url = page.url;
            this.#title = page.title;
          }
        } catch {
          /* a page that will not answer keeps its last known title */
        }
        this.#mirrorActive();
        this.#record('open', page.url, 'switched page');
      }
      return this.state();
    });
  }

  /** Close one page. The last page is kept: the panel always shows something. */
  async closePage(id) {
    await this.ensureStarted();
    return this.#serial(async () => {
      const page = this.#findPage(id);
      if (page === null) throw new BrowserError('TARGET_NOT_FOUND', `No page ${String(id)}`);
      const cdp = this.#cdp;
      const wasActive = page.targetId === this.#activeTarget;
      const last = this.#pages.size <= 1;
      this.#pages.delete(page.targetId);
      if (cdp !== null && !cdp.closed) {
        try {
          await Promise.race([cdp.send('Target.closeTarget', { targetId: page.targetId }), sleep(1000)]);
        } catch {
          /* the page may already be gone */
        }
      }
      if (last) {
        // Closing the last tab is allowed: replace it with one fresh blank tab
        // so the panel always has a page to show.
        const fresh = await this.#openPage('about:blank');
        await this.#setActive(fresh.targetId);
      } else if (wasActive) {
        const next = [...this.#pages.values()][0];
        await this.#setActive(next.targetId);
      }
      if (this.#frameListeners.size > 0) void this.#restartScreencast();
      this.#record('close', page.title || page.url, last ? 'closed last page; opened a blank tab' : 'closed page');
      return this.state();
    });
  }

  /**
   * Close every page and leave one fresh about:blank tab behind. Chrome keeps
   * running, so the panel never drops to "nothing to show" after a close-all.
   */
  async closeAllPages() {
    await this.ensureStarted();
    return this.#serial(async () => {
      const cdp = this.#cdp;
      const pages = [...this.#pages.values()];
      this.#pages.clear();
      this.#activeTarget = null;
      this.#targetId = null;
      this.#sessionId = null;
      this.#url = 'about:blank';
      this.#title = '';
      if (cdp !== null && !cdp.closed) {
        for (const page of pages) {
          try {
            await Promise.race([cdp.send('Target.closeTarget', { targetId: page.targetId }), sleep(1000)]);
          } catch {
            /* the page may already be gone */
          }
        }
      }
      await this.#openPage('about:blank');
      if (this.#frameListeners.size > 0) void this.#restartScreencast();
      this.#record('close', '', 'closed all pages');
      return this.state();
    });
  }

  /**
   * Reorder the panel's tabs without touching Chrome: the map order is the
   * strip order the panel polls, and the active page stays active.
   */
  async movePage(id, index) {
    await this.ensureStarted();
    return this.#serial(async () => {
      const page = this.#findPage(id);
      if (page === null) throw new BrowserError('TARGET_NOT_FOUND', `No page ${String(id)}`);
      const entries = [...this.#pages.entries()];
      const from = entries.findIndex(([, candidate]) => candidate.targetId === page.targetId);
      const requested = Number(index);
      const to = Number.isFinite(requested)
        ? Math.max(0, Math.min(entries.length - 1, Math.trunc(requested)))
        : from;
      if (from !== to) {
        const [moved] = entries.splice(from, 1);
        entries.splice(to, 0, moved);
        this.#pages = new Map(entries);
      }
      return this.state();
    });
  }

  #findPage(id) {
    const wanted = String(id ?? '');
    if (wanted === '') return null;
    for (const page of this.#pages.values()) {
      if (page.id === wanted || page.targetId === wanted) return page;
    }
    return null;
  }

  async #navigate(url) {
    const cdp = this.#cdp;
    if (cdp === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    const nav = await cdp.send('Page.navigate', { url }, this.#effectiveSession());
    if (nav?.errorText) throw new BrowserError('NAVIGATION_FAILED', `Could not open ${url}: ${nav.errorText}`);
    this.#url = url;
    this.#pushHistory(url, '');
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

  /**
   * Wait for a click-triggered navigation or a short quiet window.
   *
   * `startedAt` is when the action began: the navigation event often fires
   * between the click and this call, so listening only from here on used to
   * miss it. A page that never reaches "complete" (media, streaming, stalled
   * requests) is bounded instead of holding the serial queue for the whole
   * action timeout and making the panel look frozen.
   */
  async #settleAfterAction(startedAt = Date.now()) {
    const cdp = this.#cdp;
    if (cdp === null) return;
    let navigated = this.#navigationAt >= startedAt;
    const start = Date.now();
    const navigationGraceMs = Math.min(this.#config.actionTimeoutMs, 4500);
    const off = cdp.on('Page.frameNavigated', (params, sid) => {
      if (sid !== this.#sessionId && sid !== this.#opSessionId) return;
      if (params?.frame && !params.frame.parentId) navigated = true;
    });
    let quietSince = start;
    try {
      for (;;) {
        const now = Date.now();
        if (now - start >= this.#config.actionTimeoutMs) break;
        if (!navigated && now - start > 500) break;
        if (navigated && now - start > navigationGraceMs) break;
        let facts = null;
        try {
          facts = await this.#evaluate(pageFactsExpression());
        } catch {
          facts = null;
        }
        const after = Date.now();
        if (facts) {
          if (facts.url !== this.#url) {
            this.#url = String(facts.url);
            navigated = true;
            quietSince = after;
          }
          if (facts.readyState !== 'complete') {
            navigated = true;
            quietSince = after;
          }
        }
        if (navigated) {
          if (facts && facts.readyState === 'complete' && after - quietSince > 220) break;
        } else if (after - start > 500) {
          break;
        }
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
    this.#lastInputAt = Date.now();
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, ...extra }, this.#effectiveSession());
  }

  async #resolveTarget(target, options = {}) {
    const resolved = await this.#evaluate(resolveExpression(target));
    if (!resolved || resolved.ok !== true) {
      const reason = resolved?.reason ?? 'not-found';
      // A file input is often hidden on purpose: the visible control is a
      // styled label that opens a dialog, so an upload may target the input
      // itself and never click anything.
      if (options.allowHidden === true && (reason === 'not-visible' || reason === 'detached')) return null;
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

  /**
   * Fill a native file chooser instead of opening it. The dialog belongs to the
   * operating system (a headless Chrome has none at all), so the protocol
   * intercepts the request and hands the paths to the browser: the page sees
   * exactly what a human picking those files would produce. A control that only
   * hides an <input type="file"> and never asks for a dialog gets the files
   * written into that input instead.
   */
  async #placeFiles(target, at, files) {
    const cdp = this.#cdp;
    const sessionId = this.#effectiveSession();
    if (cdp === null || sessionId === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    let opened = null;
    const off = cdp.on('Page.fileChooserOpened', (params, sid) => {
      if (sid !== sessionId || opened !== null) return;
      opened = params;
    });
    let intercepting = false;
    try {
      if (at !== null) {
        await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId);
        intercepting = true;
        await this.#clickResolved(at);
        const deadline = Date.now() + FILE_CHOOSER_WAIT_MS;
        while (opened === null && Date.now() < deadline) await sleep(40);
        if (opened !== null) {
          await cdp.send('DOM.setFileInputFiles', { files, backendNodeId: opened.backendNodeId }, sessionId);
          const accepted = opened.mode === 'selectMultiple' ? files : files.slice(0, 1);
          return { mode: 'chooser', accepted };
        }
      }
      const objectId = await this.#evaluateNode(fileInputExpression(target));
      if (objectId !== null) {
        await cdp.send('DOM.setFileInputFiles', { files, objectId }, sessionId);
        return { mode: 'input', accepted: files };
      }
      throw new BrowserError(
        'NO_FILE_INPUT',
        at === null
          ? 'That element is hidden and the page has no <input type="file"> to fill.'
          : 'That control neither opened a file chooser nor hides an <input type="file">: this upload may only accept drag and drop.',
      );
    } finally {
      off();
      if (intercepting) {
        await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }, sessionId).catch(() => undefined);
      }
    }
  }

  /**
   * Click, and notice when that click wanted files. The chooser is intercepted
   * for the duration of the click, so instead of an OS dialog the panel cannot
   * touch, the result says which action would fill it.
   */
  async #clickWithChooserProbe(click) {
    const cdp = this.#cdp;
    const sessionId = this.#effectiveSession();
    if (cdp === null || sessionId === null) return false;
    // A page without a file input cannot open a chooser: skip the probe (and
    // its wait) so ordinary clicks stay as fast as they were.
    const mayWantFiles = await this.#evaluate(
      `(() => { try { return document.querySelectorAll('input[type="file"]').length > 0; } catch { return false; } })()`,
    ).catch(() => false);
    if (mayWantFiles !== true) {
      await click();
      return false;
    }
    let opened = false;
    const off = cdp.on('Page.fileChooserOpened', (_params, sid) => {
      if (sid === sessionId) opened = true;
    });
    let armed = false;
    try {
      try {
        await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId);
        armed = true;
      } catch {
        armed = false;
      }
      await click();
      if (armed) {
        const deadline = Date.now() + FILE_CHOOSER_PROBE_MS;
        while (!opened && Date.now() < deadline) await sleep(30);
      }
    } finally {
      off();
      if (armed) {
        await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }, sessionId).catch(() => undefined);
      }
    }
    return opened;
  }

  /** Evaluate an expression that must resolve to a live node (returns its object id). */
  async #evaluateNode(expression) {
    const cdp = this.#cdp;
    const sessionId = this.#effectiveSession();
    if (cdp === null || sessionId === null) return null;
    const result = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: false, awaitPromise: false, userGesture: false },
      sessionId,
    );
    if (result?.exceptionDetails) return null;
    return result?.result?.objectId ?? null;
  }

  /** The configured viewport, which is also the coordinate space of the picture. */
  #viewportSize() {
    return { width: this.#config.viewportWidth, height: this.#config.viewportHeight };
  }

  /**
   * A viewport point from loose `x`/`y` arguments, or null when they are absent.
   * Coordinates are the escape hatch for anything the element view cannot see —
   * canvas apps, and every widget living inside a cross-origin iframe, where
   * `querySelector` is blocked but the input domain still hits by position.
   */
  #pointOf(input) {
    const x = Number(input?.x);
    const y = Number(input?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return normalizePoint({ x, y }, this.#viewportSize());
  }

  async #sendMouseCommands(commands) {
    const cdp = this.#cdp;
    if (cdp === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    this.#lastInputAt = Date.now();
    for (const command of commands) {
      await cdp.send(command.method, command.params, this.#effectiveSession());
    }
  }

  /**
   * Play one drag path in real time. The pauses matter as much as the points:
   * a slider that only reads every other frame drops an instant teleport, and
   * a page that inspects `timeStamp` deltas sees a gesture no hand could make.
   */
  async #performDrag(points, options = {}) {
    const cdp = this.#cdp;
    if (cdp === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    this.#lastInputAt = Date.now();
    const commands = dragCommands(points, options);
    const press = commands[0];
    const release = commands[commands.length - 1];
    const moves = commands.slice(1, -1);
    const pressMs = Math.max(0, Math.min(1000, Number(options.pressMs ?? 45) || 0));
    const releaseMs = Math.max(0, Math.min(1000, Number(options.releaseMs ?? 35) || 0));
    const delay = stepDelay(options.durationMs, moves.length);
    const sessionId = this.#effectiveSession();
    await cdp.send(press.method, press.params, sessionId);
    if (pressMs > 0) await sleep(pressMs);
    for (const move of moves) {
      await cdp.send(move.method, move.params, sessionId);
      if (delay > 0) await sleep(delay);
    }
    if (releaseMs > 0) await sleep(releaseMs);
    await cdp.send(release.method, release.params, sessionId);
  }

  async #typeInto(target, text, mode, onPrepared) {
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
    // Let the panel move its pointer onto the field before any text lands.
    if (typeof onPrepared === 'function') await onPrepared(prepared);
    const type = String(prepared.type ?? '').toLowerCase();
    if (type === 'file') {
      throw new BrowserError(
        'BAD_ACTION',
        'That is a file field: a file chooser cannot be typed into. Use { action: "upload", ref: n, files: ["/absolute/path"] } and the dialog is filled for you.',
      );
    }
    if (NATIVE_VALUE_TYPES.has(type)) {
      // Native pickers never reach the page's render surface: write the value.
      const applied = await this.#evaluate(setNativeValueExpression({ ...target, value: String(text ?? '') }));
      if (!applied || applied.ok !== true) {
        throw new BrowserError(
          'INVALID_VALUE',
          `“${text ?? ''}” is not a valid ${type} value${applied?.expected ? `: expected ${applied.expected}` : ''}.`,
          applied ?? undefined,
        );
      }
      return { ...prepared, nativeValue: applied.value };
    }
    const value = String(text ?? '');
    if (value !== '') {
      const cdp = this.#cdp;
      await cdp.send('Input.insertText', { text: value }, this.#effectiveSession());
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
    const sessionId = this.#effectiveSession();
    if (cdp === null) throw new BrowserError('NOT_RUNNING', 'The browser is not running');
    this.#lastInputAt = Date.now();
    const base = {
      key: spec.key,
      code: spec.code || undefined,
      windowsVirtualKeyCode: spec.windowsVirtualKeyCode,
      nativeVirtualKeyCode: spec.windowsVirtualKeyCode,
      modifiers: spec.modifiers ?? 0,
    };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(spec.text ? { text: spec.text } : {}) }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
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
   *
   * `options.source === 'agent'` turns the action into a visual cue for the
   * panel (drawn pointer, click ripple, scroll arrows, drag hand, lock veil)
   * and holds the actual input until the panel's pointer animation has arrived.
   * Panel-initiated navigation passes no source and stays quiet.
   */
  async act(input = {}, options = {}) {
    const action = String(input.action ?? '').trim();
    if (action === '') throw new BrowserError('BAD_ACTION', 'An action is required');
    if (action === 'close') {
      await this.close();
      return { summary: 'browser closed', snapshot: null };
    }
    const agentDriven = options?.source === 'agent';
    const isolatedId = input.page ?? input.tab ?? input.targetId ?? undefined;
    await this.ensureStarted();
    return this.#serial(() =>
      this.#isolatedOnPage(isolatedId, async () => {
      const startedAt = Date.now();
      const target = {
        ref: input.ref === undefined || input.ref === null || input.ref === '' ? undefined : Number(input.ref),
        selector: typeof input.selector === 'string' && input.selector.trim() !== '' ? input.selector.trim() : undefined,
      };
      let summary = '';
      let label = target.ref !== undefined ? `[${target.ref}]` : (target.selector ?? '');
      let activity = null;
      const beginCue = (kind, spec = {}) => {
        if (!agentDriven) return;
        activity = this.#beginActivity({ kind, ...spec });
      };
      try {
        switch (action) {
          case 'click':
          case 'upload': {
            const files = normalizeUploadFiles(input.files ?? input.file);
            const uploading = action === 'upload' || files.length > 0;
            if (uploading && files.length === 0) {
              throw new BrowserError(
                'BAD_ACTION',
                'upload needs files: absolute paths of the files to hand to the file chooser, for example { action: "upload", ref: 3, files: ["/tmp/a.png"] }',
              );
            }
            const fileCount = `${files.length} file${files.length === 1 ? '' : 's'}`;
            const point = this.#pointOf(input);
            if (target.ref === undefined && target.selector === undefined) {
              if (point === null) {
                throw new BrowserError(
                  'BAD_ACTION',
                  uploading
                    ? 'upload needs a ref, a selector, or x/y coordinates for the control that opens the file chooser'
                    : 'click needs a ref (from the last snapshot), a selector, or x/y viewport coordinates',
                );
              }
              label = `${point.x}, ${point.y}`;
              if (uploading) {
                beginCue('upload', { x: point.x, y: point.y, detail: fileCount });
                await this.#awaitActivity(activity);
                const placed = await this.#placeFiles(target, point, files);
                summary = uploadSummary(files, placed);
                break;
              }
              beginCue('click', { x: point.x, y: point.y, detail: label });
              await this.#awaitActivity(activity);
              const opened = await this.#clickWithChooserProbe(() =>
                this.#sendMouseCommands(clickCommands(point, { button: input.button })),
              );
              summary = `click at ${point.x}, ${point.y}`;
              if (opened) summary += fileChooserHint();
              break;
            }
            const resolved = uploading
              ? await this.#resolveTarget(target, { allowHidden: true })
              : await this.#resolveTarget(target);
            if (uploading) {
              const at = resolved === null ? null : { x: resolved.x, y: resolved.y };
              beginCue('upload', {
                x: resolved?.x,
                y: resolved?.y,
                detail: `${resolved?.name || label} · ${fileCount}`,
              });
              await this.#awaitActivity(activity);
              const placed = await this.#placeFiles(target, at, files);
              summary = uploadSummary(files, placed);
              break;
            }
            beginCue('click', {
              x: resolved.x,
              y: resolved.y,
              detail: resolved.name || label,
            });
            await this.#awaitActivity(activity);
            const opened = await this.#clickWithChooserProbe(() => this.#clickResolved(resolved));
            summary = `click ${target.ref ? `[${target.ref}]` : target.selector}${resolved.name ? ` “${resolved.name}”` : ''}`;
            if (opened) summary += fileChooserHint();
            break;
          }
          case 'drag': {
            const toX = Number(input.to_x);
            const toY = Number(input.to_y);
            if (!Number.isFinite(toX) || !Number.isFinite(toY)) {
              throw new BrowserError('BAD_ACTION', 'drag needs to_x and to_y viewport coordinates to drag to');
            }
            const viewport = this.#viewportSize();
            let from = this.#pointOf(input);
            if (from === null) {
              if (target.ref === undefined && target.selector === undefined) {
                throw new BrowserError(
                  'BAD_ACTION',
                  'drag needs x/y viewport coordinates (or a ref/selector) to start from',
                );
              }
              const resolved = await this.#resolveTarget(target);
              from = { x: resolved.x, y: resolved.y };
            }
            const to = normalizePoint({ x: toX, y: toY }, viewport);
            const points = dragPoints(from, to, {
              steps: input.steps,
              viewport,
              easing: typeof input.easing === 'string' ? input.easing : undefined,
            });
            const rawDuration = Number(input.duration_ms ?? input.durationMs);
            const durationMs = Number.isFinite(rawDuration)
              ? Math.max(0, Math.min(20_000, rawDuration))
              : DEFAULT_DRAG_DURATION_MS;
            label = `${from.x}, ${from.y} → ${to.x}, ${to.y}`;
            beginCue('drag', {
              x: from.x,
              y: from.y,
              toX: to.x,
              toY: to.y,
              durationMs,
              detail: label,
            });
            await this.#awaitActivity(activity);
            await this.#performDrag(points, { button: input.button, durationMs });
            summary = `drag ${from.x}, ${from.y} → ${to.x}, ${to.y} · ${points.length - 1} steps in ${durationMs}ms`;
            break;
          }
          case 'type': {
            if (target.ref === undefined && target.selector === undefined) {
              throw new BrowserError('BAD_ACTION', 'type needs a ref (from the last snapshot) or a selector');
            }
            if (typeof input.text !== 'string') throw new BrowserError('BAD_ACTION', 'type needs text');
            const mode = input.clear === false ? 'append' : 'replace';
            const chars = `${input.text.length} chars${input.submit === true ? ' + Enter' : ''}`;
            const prepared = await this.#typeInto(
              target,
              input.text,
              mode,
              agentDriven
                ? async (facts) => {
                    beginCue('type', {
                      x: facts?.x,
                      y: facts?.y,
                      detail: facts?.name ? `${facts.name} · ${chars}` : chars,
                    });
                    await this.#awaitActivity(activity);
                  }
                : undefined,
            );
            summary = prepared.nativeValue === undefined
              ? `type ${target.ref ? `[${target.ref}]` : target.selector} · ${input.text.length} chars`
              : `set ${target.ref ? `[${target.ref}]` : target.selector} · ${prepared.type} → ${prepared.nativeValue}`;
            if (input.submit === true) {
              await this.#press('Enter');
              summary += ' + Enter';
            }
            break;
          }
          case 'key': {
            if (typeof input.key !== 'string' || input.key.trim() === '') throw new BrowserError('BAD_ACTION', 'key needs a key name such as Enter');
            beginCue('key', { detail: input.key.trim() });
            await this.#awaitActivity(activity);
            const spec = await this.#press(input.key);
            summary = `press ${spec.key}`;
            break;
          }
          case 'hover': {
            const point = this.#pointOf(input);
            if (point !== null && target.ref === undefined && target.selector === undefined) {
              label = `${point.x}, ${point.y}`;
              beginCue('hover', { x: point.x, y: point.y, detail: label });
              await this.#awaitActivity(activity);
              await this.#sendMouseCommands([moveCommand(point)]);
              summary = `hover ${point.x}, ${point.y}`;
              break;
            }
            const resolved = await this.#resolveTarget(target);
            beginCue('hover', { x: resolved.x, y: resolved.y, detail: resolved.name || label });
            await this.#awaitActivity(activity);
            await this.#mouse('mouseMoved', resolved.x, resolved.y);
            summary = `hover ${target.ref ? `[${target.ref}]` : target.selector}`;
            break;
          }
          case 'scroll': {
            const direction = String(input.direction ?? 'down');
            if (!['up', 'down', 'left', 'right'].includes(direction)) {
              throw new BrowserError('BAD_ACTION', 'scroll direction must be up, down, left, or right');
            }
            const viewport = this.#viewportSize();
            beginCue('scroll', {
              x: Math.round(viewport.width / 2),
              y: Math.round(viewport.height / 2),
              direction,
              detail: direction,
            });
            await this.#awaitActivity(activity);
            const moved = await this.#scrollBy(direction, input.amount);
            summary = `scroll ${direction} ${Math.abs(moved.deltaY || moved.deltaX)}px`;
            break;
          }
          case 'select': {
            const value = input.value ?? input.text;
            if (value === undefined) throw new BrowserError('BAD_ACTION', 'select needs a value');
            beginCue('select', { detail: String(value) });
            await this.#awaitActivity(activity);
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
            beginCue(action, { detail: action });
            await this.#awaitActivity(activity);
            await this.#evaluate(`history.${action}()`);
            await this.#waitReady(this.#config.navigationTimeoutMs);
            summary = action === 'back' ? 'back one page' : 'forward one page';
            break;
          }
          case 'reload': {
            beginCue('reload', { detail: 'reload' });
            await this.#awaitActivity(activity);
            const cdp = this.#cdp;
            await cdp.send('Page.reload', { ignoreCache: false }, this.#effectiveSession());
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
        await this.#settleAfterAction(startedAt);
        const snapshot = await this.snapshot(isolatedId === undefined ? undefined : { page: isolatedId });
        this.#record(action, label, summary.slice(0, 160));
        this.#endActivity(activity, true);
        return { summary, snapshot };
      } catch (error) {
        this.#endActivity(activity, false);
        throw error;
      }
      }));
  }

  /** Capture one screenshot to a file; returns the absolute path. */
  async screenshot(options = {}) {
    await this.ensureStarted();
    return this.#serial(() =>
      this.#isolatedOnPage(options?.page, async () => {
      const cdp = this.#cdp;
      const format = options.format === 'jpeg' ? 'jpeg' : 'png';
      const result = await this.#cdp.send(
        'Page.captureScreenshot',
        {
          format,
          fromSurface: true,
          captureBeyondViewport: false,
          ...(format === 'jpeg' ? { quality: 88 } : {}),
        },
        this.#effectiveSession(),
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
      })
    );
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
      const pending = this.#screencastPending;
      await pending.catch(() => false);
      // The creator usually clears this in its finally; clearing here as well
      // makes the retry below start a fresh screencast instead of awaiting the
      // same settled promise again.
      if (this.#screencastPending === pending) this.#screencastPending = null;
      if (this.#screencastSession === this.#sessionId) return true;
      // The pending start belonged to the page we just left. Stop it and try
      // again for the page that is active now; returning false here used to
      // leave the new tab with no screencast at all until something else
      // restarted the stream (for example closing a newer tab).
      await this.#stopScreencast();
      return this.#ensureScreencast();
    }
    if (this.#screencastSession !== null) {
      await this.#stopScreencast();
      if (this.#sessionId !== sessionId) return this.#ensureScreencast();
    }
    const current = this.#cdp;
    if (current === null || current.closed) return false;
    this.#screencastPending = (async () => {
      await current.send(
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
  // Agent activity cues
  // -------------------------------------------------------------------------

  /**
   * Subscribe to Agent operation cues: `{ phase: 'start' | 'end', kind, x, y,
   * toX, toY, direction, durationMs, detail }`. The panel answers a `start`
   * with `ackActivity(id)` when its pointer animation has reached the target,
   * which is what keeps the real click and the drawn cursor in step.
   * @param {(cue: object) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribeActivity(listener) {
    if (typeof listener !== 'function') return () => {};
    this.#activityListeners.add(listener);
    if (this.#activeActivity !== null) {
      try {
        listener(this.#cuePayload(this.#activeActivity, 'start'));
      } catch {
        /* a panel that cannot draw a cue must not block the action */
      }
    }
    return () => {
      this.#activityListeners.delete(listener);
    };
  }

  /** The panel finished its enter animation; release this cue's wait. */
  ackActivity(id) {
    const key = Number(id);
    const resolve = this.#activityAcks.get(key);
    if (resolve === undefined) return false;
    this.#activityAcks.delete(key);
    resolve(true);
    return true;
  }

  #cuePayload(activity, phase) {
    return {
      type: 'activity',
      phase,
      id: activity.id,
      kind: activity.kind,
      x: activity.x,
      y: activity.y,
      toX: activity.toX,
      toY: activity.toY,
      direction: activity.direction,
      durationMs: activity.durationMs,
      detail: activity.detail,
      ts: activity.ts,
    };
  }

  #emitActivity(payload) {
    for (const listener of this.#activityListeners) {
      try {
        listener(payload);
      } catch {
        /* one bad subscriber must not hide the operation */
      }
    }
  }

  /**
   * Announce an Agent operation before it is dispatched. The returned handle is
   * null-tolerant: with no panel attached it never waits.
   */
  #beginActivity(spec = {}) {
    const numberOrNull = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.round(number) : null;
    };
    const activity = {
      id: ++this.#activitySeq,
      kind: String(spec.kind ?? 'action'),
      x: numberOrNull(spec.x),
      y: numberOrNull(spec.y),
      toX: numberOrNull(spec.toX),
      toY: numberOrNull(spec.toY),
      direction: typeof spec.direction === 'string' ? spec.direction : '',
      durationMs: Number.isFinite(Number(spec.durationMs)) ? Math.max(0, Math.round(Number(spec.durationMs))) : null,
      detail: typeof spec.detail === 'string' ? spec.detail.slice(0, 120) : '',
      ts: Date.now(),
      acked: null,
    };
    if (this.#activityListeners.size === 0) return activity;
    this.#activeActivity = activity;
    activity.acked = new Promise((resolve) => {
      this.#activityAcks.set(activity.id, resolve);
    });
    this.#emitActivity(this.#cuePayload(activity, 'start'));
    return activity;
  }

  /** Wait for the panel to finish moving its pointer (or give up quickly). */
  async #awaitActivity(activity, waitMs = 900) {
    if (activity === null || activity.acked === null) return;
    let timer = 0;
    try {
      await Promise.race([
        activity.acked,
        new Promise((resolve) => {
          timer = setTimeout(resolve, waitMs);
        }),
      ]);
    } finally {
      if (timer !== 0) clearTimeout(timer);
    }
  }

  #endActivity(activity, ok = true) {
    if (activity === null || activity === undefined) return;
    const resolve = this.#activityAcks.get(activity.id);
    if (resolve !== undefined) {
      this.#activityAcks.delete(activity.id);
      resolve(false);
    }
    if (this.#activeActivity === activity) this.#activeActivity = null;
    this.#emitActivity({
      type: 'activity',
      phase: 'end',
      id: activity.id,
      kind: activity.kind,
      ok: ok !== false,
      ts: Date.now(),
    });
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
    if (!this.#running || this.#cdp === null) {
      // Starting Chrome may take seconds; never hold an input batch (and the
      // panel's single in-flight slot) for the whole launch.
      try {
        await Promise.race([this.ensureStarted(), sleep(1500)]);
      } catch (error) {
        this.noteError(error);
      }
    }
    const cdp = this.#cdp;
    const sessionId = this.#sessionId;
    if (cdp === null || sessionId === null) return { applied: 0, starting: true };
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
    if (applied > 0) this.#lastInputAt = Date.now();
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
        // A moved pointer keeps reporting the button it is holding: that is what
        // lets the page run a real drag (text selection, sliders, native DnD).
        const button = phase === 'move' ? heldButton(buttons) : mouseButton(event.button);
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
        return [{ method: 'Input.insertText', params: { text: clipEnd(text, 4000) } }];
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
      page: this.#currentPageId(),
    };
    this.#actions.unshift(entry);
    if (this.#actions.length > 80) this.#actions.length = 80;
    return entry;
  }

  /** The page id a record belongs to (the isolated target when one is set). */
  #currentPageId() {
    const page = this.#opPage ?? this.#pages.get(this.#activeTarget);
    return page === undefined || page === null ? '' : page.id;
  }

  /** Remember a url; keeps an in-memory browsing history for the URL bar. */
  #pushHistory(url, title = '') {
    const value = String(url ?? '').trim();
    if (value === '' || value === 'about:blank' || value.startsWith('devtools://')) return;
    const now = Date.now();
    const previous = this.#history[0];
    if (previous !== undefined && previous.url === value) {
      previous.title = String(title ?? '') || previous.title;
      previous.ts = now;
      return;
    }
    this.#history.unshift({ url: value, title: String(title ?? ''), ts: now });
    if (this.#history.length > 1000) this.#history.length = 1000;
    this.#historySeq += 1;
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

  /**
   * Empty the operation log. Sequence numbers keep counting up, so a row's key
   * never collides with a row that arrives after the clear.
   */
  clearActions() {
    this.#actions = [];
    this.#lastRecordAt.clear();
    return this.state();
  }

  /** Append one console line, bounded so a noisy page cannot grow the poll. */
  #recordConsole(level, text, extra = {}) {
    const body = String(text ?? '').replace(/\r\n?/gu, '\n').trimEnd();
    if (body === '') return null;
    const truncated = body.length > 4000 ? `${clipEnd(body, 4000)}…` : body;
    this.#consoleSeq += 1;
    const entry = {
      id: this.#consoleSeq,
      level: String(level || 'log'),
      text: truncated,
      ts: Number.isFinite(extra.ts) ? extra.ts : Date.now(),
      ...(typeof extra.url === 'string' && extra.url !== '' ? { url: extra.url } : {}),
    };
    this.#console.push(entry);
    if (this.#console.length > 300) this.#console.splice(0, this.#console.length - 300);
    // Keeps the state poll small even when a page logs large payloads: drop
    // the oldest lines until the retained text is back under ~24 KB.
    let total = 0;
    for (let index = this.#console.length - 1; index >= 0; index -= 1) {
      total += this.#console[index].text.length;
      if (total > 24000) {
        this.#console.splice(0, index + 1);
        break;
      }
    }
    return entry;
  }

  /** Empty the page console without resetting the sequence counter. */
  clearConsole() {
    this.#console = [];
    return this.state();
  }

  /**
   * Run one expression in the active page and append both the expression and
   * its answer to the page console. Awaiting the promise makes `fetch(...)`
   * and other async snippets show their settled value instead of a Promise.
   */
  async evaluateConsole(expression) {
    const code = String(expression ?? '').trim();
    if (code === '') return this.state();
    await this.ensureStarted();
    return this.#serial(async () => {
      const cdp = this.#cdp;
      if (cdp === null || cdp.closed || this.#sessionId === null) {
        throw new BrowserError('NOT_RUNNING', 'The browser is not running');
      }
      this.#recordConsole('input', code);
      try {
        let timer = null;
        const timeout = new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new BrowserError('CONSOLE_TIMEOUT', 'The script did not settle before the action timeout')),
            Math.max(1000, Math.min(15000, this.#config.actionTimeoutMs)),
          );
        });
        let result;
        try {
          result = await Promise.race([
            cdp.send(
              'Runtime.evaluate',
              {
                expression: code,
                awaitPromise: true,
                returnByValue: true,
                userGesture: true,
                includeCommandLineAPI: true,
              },
              this.#sessionId,
            ),
            timeout,
          ]);
        } finally {
          if (timer !== null) clearTimeout(timer);
        }
        if (result?.exceptionDetails) {
          const details = result.exceptionDetails;
          this.#recordConsole(
            'error',
            details.exception?.description || details.exception?.value || details.text || 'Uncaught exception',
          );
        } else {
          this.#recordConsole('result', consoleArgumentText(result?.result));
        }
      } catch (error) {
        this.#recordConsole('error', error instanceof Error ? error.message : String(error));
      }
      return this.state();
    });
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
      pages: [...this.#pages.values()].map((page) => ({
        id: page.id,
        url: page.url,
        title: page.title,
        active: page.targetId === this.#activeTarget,
      })),
      activePageId: (() => {
        const active = this.#pages.get(this.#activeTarget);
        return active === undefined ? '' : active.id;
      })(),
      actionSeq: this.#actionSeq,
      historySeq: this.#historySeq,
      history: this.#history.map((entry) => ({ url: entry.url, title: entry.title })),
      agentBusy: this.#activeActivity !== null,
      actions: this.#actions.map((action) => ({
        seq: action.seq,
        kind: action.kind,
        target: action.target,
        detail: action.detail,
        ok: action.ok,
        ts: action.ts,
        page: action.page ?? '',
      })),
      console: this.#console.map((entry) => ({
        id: entry.id,
        level: entry.level,
        text: entry.text,
        ts: entry.ts,
        ...(entry.url === undefined ? {} : { url: entry.url }),
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

/** One CDP RemoteObject (or a returned value) as console text. */
function consoleArgumentText(arg) {
  if (arg === null || arg === undefined) return String(arg);
  if (typeof arg !== 'object') return String(arg);
  if (Object.prototype.hasOwnProperty.call(arg, 'value')) {
    const value = arg.value;
    if (value === null) return 'null';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return arg.description || String(value);
      }
    }
    return String(value);
  }
  const type = String(arg.type || '');
  if (type === 'undefined') return 'undefined';
  if (type === 'string') return String(arg.value ?? '');
  if (type === 'symbol') return String(arg.description || 'Symbol()');
  if (type === 'function') return String(arg.description || 'function');
  if (arg.subtype === 'null') return 'null';
  if (arg.subtype === 'error') return String(arg.description || 'Error');
  const preview = arg.preview;
  if (preview && Array.isArray(preview.properties)) {
    const body = preview.properties
      .map((property) => `${property.name ? `${property.name}: ` : ''}${property.value ?? '…'}`)
      .join(', ');
    const head = String(arg.description || (arg.subtype === 'array' ? '[]' : '{}'));
    if (arg.subtype === 'array') return `${head}[${body}]`;
    return `${head} {${body}}`;
  }
  return String(arg.description || type || 'undefined');
}

function consoleLevelOf(type) {
  switch (type) {
    case 'error':
    case 'assert':
      return 'error';
    case 'warning':
      return 'warn';
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    default:
      return 'log';
  }
}

function clampNumber(value, limit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(-limit, Math.min(limit, number));
}

function heldButton(buttons) {
  if ((buttons & 1) !== 0) return 'left';
  if ((buttons & 4) !== 0) return 'middle';
  if ((buttons & 2) !== 0) return 'right';
  return 'none';
}

function mouseButton(value) {
  if (value === 2 || value === 'right') return 'right';
  if (value === 1 || value === 'middle') return 'middle';
  return 'left';
}
