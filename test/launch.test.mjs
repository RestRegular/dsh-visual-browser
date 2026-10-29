import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildLaunchArgs, browserUserAgent, detectBrowserVersion, headlessScreen, productName, windowedUserAgent } from '../lib/launch.js';

const config = {
  headless: true,
  stealth: true,
  userAgent: '',
  extraArgs: [],
  viewportWidth: 1280,
  viewportHeight: 800,
};
const build = (overrides = {}, extra = {}) =>
  buildLaunchArgs({
    config: { ...config, ...overrides },
    userDataDir: 'C:/tmp/profile',
    version: '155.0.8059.86',
    platform: 'win32',
    product: 'chrome',
    ...extra,
  });

// The page must not be able to tell it is driven.
const args = build();
assert.ok(args.includes('--headless=new'), 'headless flag still starts a headless browser');
assert.ok(args.includes('--disable-blink-features=AutomationControlled'), 'webdriver flag is off');
const userAgent = args.find((arg) => arg.startsWith('--user-agent='));
assert.equal(
  userAgent,
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  'the browser announces its real build, never HeadlessChrome',
);
assert.ok(!args.some((arg) => arg.startsWith('--user-agent=') && /Headless/i.test(arg)), 'the User-Agent never leaks the headless marker');
assert.equal(args.at(-1), 'about:blank');
assert.ok(args.includes('--disable-background-timer-throttling'), 'background tabs keep their timers');
assert.ok(args.includes('--window-size=1280,800'));

// Opting out restores the plain command line.
const plain = build({ stealth: false });
assert.ok(plain.includes('--headless=new'), 'the window mode is independent of stealth');
assert.ok(!plain.includes('--disable-blink-features=AutomationControlled'));
assert.ok(!plain.some((arg) => arg.startsWith('--user-agent=')));

// A visible window, and an explicitly configured User-Agent.
const windowed = build({ headless: false });
assert.ok(!windowed.includes('--headless=new'), 'headless flag is dropped for a windowed run');
const explicit = build({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Test/1.0' });
assert.ok(explicit.includes('--user-agent=Mozilla/5.0 (X11; Linux x86_64) Test/1.0'));

// Unknown build: no switch, and the connected browser supplies the identity.
const unknown = build({}, { version: '' });
assert.ok(!unknown.some((arg) => arg.startsWith('--user-agent=')));
assert.equal(windowedUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36'),
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36');
assert.equal(windowedUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'), '');
assert.equal(windowedUserAgent(undefined), '');

// Extra switches land after the built-in ones, so the user can override them.
const extra = build({ extraArgs: ['--lang=zh-CN', '--disable-gpu'] });
assert.deepEqual(extra.slice(-3), ['--lang=zh-CN', '--disable-gpu', 'about:blank']);

// User-Agents per platform, with Chrome's reduced version form.
assert.match(browserUserAgent('155.0.8059.86', 'darwin'), /Macintosh; Intel Mac OS X 10_15_7/);
assert.match(browserUserAgent('155.0.8059.86', 'linux'), /\(X11; Linux x86_64\)/);
assert.match(browserUserAgent('155.0.8059.86', 'win32'), /Chrome\/155\.0\.0\.0 Safari\/537\.36$/);
assert.match(browserUserAgent('155.0.8059.86', 'win32', 'msedge'), /Chrome\/155\.0\.0\.0 Safari\/537\.36 Edg\/155\.0\.0\.0$/);
assert.equal(browserUserAgent('', 'win32'), '');
assert.equal(productName('C:/Program Files/Microsoft/Edge/Application/msedge.exe'), 'msedge');
assert.equal(productName('/opt/google/chrome/chrome'), 'chrome');

// A headless screen is bigger than the window, like a real desktop.
const screen = headlessScreen(1280, 800);
assert.ok(screen.screenWidth > 1280 && screen.screenHeight > 800);
assert.deepEqual(headlessScreen(2560, 1440), { screenWidth: 2560, screenHeight: 1440 });

// The installed build is read without starting the browser.
const dir = mkdtempSync(join(tmpdir(), 'dvb-launch-test-'));
try {
  // Windows: the registry value wins over any directory listing.
  assert.equal(
    detectBrowserVersion('C:/Program Files/Google/Chrome/Application/chrome.exe', {
      platform: 'win32',
      registry: (key, hive) => (hive === 'HKCU' && key.includes('Chrome') ? '155.0.8059.86' : ''),
      runVersion: () => '',
    }),
    '155.0.8059.86',
  );
  assert.equal(
    detectBrowserVersion('C:/chrome.exe', { platform: 'win32', registry: () => '', runVersion: () => '' }),
    '',
    'an unknown build is reported as unknown instead of guessed',
  );
  // Linux: ask the binary.
  assert.equal(
    detectBrowserVersion('/usr/bin/google-chrome', {
      platform: 'linux',
      registry: () => '',
      runVersion: () => 'Google Chrome 155.0.8059.86',
    }),
    '155.0.8059.86',
  );
  // macOS: read the bundle.
  const contents = join(dir, 'Google Chrome.app', 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  await writeFile(
    join(contents, 'Info.plist'),
    '<plist><dict><key>CFBundleShortVersionString</key><string>155.0.8059.86</string></dict></plist>',
  );
  assert.equal(
    detectBrowserVersion(join(contents, 'MacOS', 'Google Chrome'), {
      platform: 'darwin',
      registry: () => '',
      runVersion: () => '',
    }),
    '155.0.8059.86',
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('launch.test.mjs: ok');
