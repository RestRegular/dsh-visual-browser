/**
 * How the browser is started in the eyes of the page.
 *
 * A plain `--remote-debugging-port` launch is already an automated browser:
 * Chrome reports `navigator.webdriver === true`, and in headless mode it also
 * advertises `HeadlessChrome/<version>` in the User-Agent and a 800x600 screen
 * that does not match the 1280x800 window. Sites that bind a login to the
 * browser they hand it to (doubao.com, and ByteDance sites generally) answer
 * that with a forced sign-out a few seconds after the login succeeds.
 *
 * This module builds launch arguments and the matching identity, so the page
 * sees an ordinary Chrome: no `webdriver` flag, the browser's own User-Agent
 * with the `Headless` marker removed, and a screen that is bigger than the
 * window instead of smaller.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Registry key that records the Chrome build that actually runs today. */
const BLBEACON = {
  chrome: ['Software\\Google\\Chrome\\BLBeacon', 'Software\\WOW6432Node\\Google\\Chrome\\BLBeacon'],
  msedge: ['Software\\Microsoft\\Edge\\BLBeacon', 'Software\\WOW6432Node\\Microsoft\\Edge\\BLBeacon'],
  brave: ['Software\\BraveSoftware\\Brave-Browser\\BLBeacon', 'Software\\WOW6432Node\\BraveSoftware\\Brave-Browser\\BLBeacon'],
  chromium: ['Software\\Chromium\\BLBeacon', 'Software\\WOW6432Node\\Chromium\\BLBeacon'],
};

/** The desktop part of a User-Agent, before the engine and version tokens. */
const PLATFORM_UA = {
  win32: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  darwin: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  linux: 'Mozilla/5.0 (X11; Linux x86_64)',
};

/** Which product the executable is, from its file name. */
function productFor(executable) {
  const name = path.basename(String(executable ?? '')).toLowerCase();
  if (name.startsWith('msedge')) return 'msedge';
  if (name.startsWith('brave')) return 'brave';
  if (name.startsWith('chromium')) return 'chromium';
  return 'chrome';
}

/** Run `reg query` and return the `version` value, or an empty string. */
function readWindowsVersion(key, hive = 'HKCU') {
  try {
    const out = execFileSync('reg', ['query', `${hive}\\${key}`, '/v', 'version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    });
    const match = /^\s*version\s+REG_SZ\s+(\S+)\s*$/m.exec(out);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

/** Ask the executable itself (Linux prints its version to stdout). */
function runVersionCommand(executable) {
  try {
    return execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  } catch {
    return '';
  }
}

/** Pull `155.0.8059.86` out of "Google Chrome 155.0.8059.86" (or return ""). */
function parseVersion(text) {
  const match = /\b(\d+\.\d+\.\d+\.\d+)\b/.exec(String(text ?? ''));
  return match ? match[1] : '';
}

/** Read `CFBundleShortVersionString` out of the .app bundle around the binary. */
function readMacVersion(executable) {
  try {
    const plist = path.join(path.resolve(path.dirname(executable), '..'), 'Info.plist');
    const text = readFileSync(plist, 'utf8');
    const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(text);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * The build the installed browser will run, or an empty string when it cannot
 * be learned without starting the browser (the caller then reads
 * `Browser.getVersion` after connecting instead).
 */
export function detectBrowserVersion(executable, options = {}) {
  const platform = options.platform ?? process.platform;
  const registry = options.registry ?? ((key, hive) => readWindowsVersion(key, hive));
  const runVersion = options.runVersion ?? runVersionCommand;
  try {
    if (platform === 'win32') {
      const keys = BLBEACON[productFor(executable)] ?? BLBEACON.chrome;
      for (const hive of ['HKCU', 'HKLM']) {
        for (const key of keys) {
          const version = registry(key, hive);
          if (version !== '') return version;
        }
      }
      return '';
    }
    if (platform === 'darwin') return readMacVersion(executable);
    return parseVersion(runVersion(executable));
  } catch {
    return '';
  }
}

/**
 * The User-Agent a real Chrome of this build sends. Chrome reduces its own
 * User-Agent to `<major>.0.0.0`, so a full `155.0.8059.86` here would itself be
 * a fingerprint: it never appears in a genuine one.
 */
export function browserUserAgent(version, platform = process.platform, product = 'chrome') {
  const major = /^(\d+)/.exec(String(version ?? '').trim());
  if (major === null) return '';
  const platformPart = PLATFORM_UA[platform] ?? PLATFORM_UA.linux;
  const ua = `${platformPart} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major[1]}.0.0.0 Safari/537.36`;
  return product === 'msedge' ? `${ua} Edg/${major[1]}.0.0.0` : ua;
}

/**
 * Turn the User-Agent a headless browser reports into the one the same browser
 * reports with a window: `HeadlessChrome/155.0.0.0` → `Chrome/155.0.0.0`.
 * Used when the launch could not set `--user-agent` up front.
 */
export function windowedUserAgent(reported) {
  const text = String(reported ?? '');
  if (!/Headless/i.test(text)) return '';
  return text.replace(/Headless/g, '');
}

/**
 * The complete command line. `version` is only used to build the User-Agent, so
 * an empty string simply leaves that part to `windowedUserAgent` after connect.
 */
export function buildLaunchArgs({ config, userDataDir, version = '', platform = process.platform, product = 'chrome' }) {
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
    // A backgrounded or occluded tab is throttled to 1 Hz, which stalls the
    // keep-alive timers long-lived sessions rely on.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    `--window-size=${config.viewportWidth},${config.viewportHeight}`,
  ];
  if (config.headless) args.unshift('--headless=new');
  if (config.stealth !== false) {
    // Without this Chrome answers `navigator.webdriver === true`, because a
    // remote debugging session counts as automation.
    args.push('--disable-blink-features=AutomationControlled');
    const userAgent = configUserAgent(config, version, platform, product);
    if (userAgent !== '') args.push(`--user-agent=${userAgent}`);
  }
  for (const extra of config.extraArgs ?? []) args.push(extra);
  args.push('about:blank');
  return args;
}

/** The explicit `userAgent` config wins, then the detected build, then nothing. */
function configUserAgent(config, version, platform, product) {
  const explicit = typeof config.userAgent === 'string' ? config.userAgent.trim() : '';
  if (explicit !== '') return explicit;
  return browserUserAgent(version, platform, product);
}

/** The build the executable belongs to, from its file name (`msedge` etc.). */
export function productName(executable) {
  return productFor(executable);
}

/** The screen a headless window should report. Headless Chrome makes the screen
 * equal to the window by default, which no real desktop looks like; the caller
 * only needs this to keep `screen` bigger than `innerWidth`/`innerHeight`.
 */
export function headlessScreen(viewportWidth, viewportHeight) {
  return {
    screenWidth: Math.max(1920, viewportWidth),
    screenHeight: Math.max(1080, viewportHeight),
  };
}
