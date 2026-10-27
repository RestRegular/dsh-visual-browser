import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = async (name) => JSON.parse(await readFile(join(root, name), 'utf8'));

const pkg = await readJson('package.json');
assert.equal(pkg.name, '@restregular/dsh-visual-browser');
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.type, 'module');
assert.ok(pkg.description.length > 80, 'description explains the capability');
assert.equal(pkg.icon, './icon.svg');
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(pkg.dsh.client.platform, 'web');
assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0);
assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'), 'the right Sidebar must load first');
assert.deepEqual(pkg.exports['./client'], './client.js');
assert.ok(pkg.files.includes('client.js'));
assert.ok(pkg.files.includes('index.js'));
assert.ok(pkg.files.includes('lib/'));
assert.ok(pkg.files.includes('cordis.patch.yml'));
assert.ok(pkg.files.includes('icon.svg'));
assert.ok(pkg.files.includes('locale/*.json'));

const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
assert.ok(patch.includes(`name: '${pkg.name}'`), 'patch row name must equal the package name');
assert.ok(patch.includes('- insert:'));
assert.ok(patch.includes('id: dsh-visual-browser'));

for (const locale of ['en', 'zh']) {
  const dict = await readJson(`locale/${locale}.json`);
  assert.ok(dict.meta && dict.meta.title, `${locale} meta title`);
  assert.ok(dict.meta.description && dict.meta.description.length > 40, `${locale} meta description`);
}
assert.notEqual((await readJson('locale/en.json')).meta.title, (await readJson('locale/zh.json')).meta.title);

const icon = await readFile(join(root, 'icon.svg'), 'utf8');
assert.ok(icon.startsWith('<svg'), 'icon is an SVG');
assert.ok(icon.includes('viewBox="0 0 256 256"'));
assert.ok(icon.includes('</svg>'));

// The Host half must be importable and expose the Loader surface.
const host = await import(pathToFileURL(join(root, 'index.js')).href);
assert.equal(host.name, 'dsh-visual-browser');
assert.equal(typeof host.apply, 'function');

// The client bundle is not a module: it registers through the module loader.
const client = await readFile(join(root, 'client.js'), 'utf8');
assert.ok(client.includes('__ModuleLoader__.load'), 'client registers with the module loader');
assert.ok(client.includes(`id: MODULE_ID`));
assert.ok(client.includes(`'sidebar.right.pane.tab'`), 'right-sidebar tab body');
assert.ok(client.includes(`'sidebar.right.pane.tab.title'`), 'right-sidebar tab title');
assert.ok(client.includes(`'sidebar.right.tab.guide.entry'`), 'guide card seat');
assert.ok(client.includes('@deepseek-ai/dsh-client-ui-sidebar-browser'), 'extends the built-in browser guide card');
assert.ok(!client.includes(`'sidebar.panellist'`), 'the left sidebar entry is gone');
assert.ok(!client.includes(`'main'`), 'the left main panel page is gone');
assert.ok(client.includes(`ctx.inject(['sidebarRightTabs']`), 'the tab registry is waited for, not sampled');
assert.ok(!client.includes('data-ds-dark-theme'), 'theme switching comes from --dsw-alias-* tokens alone');
assert.ok(client.includes('createImageBitmap'), 'frames decode off the main thread');
assert.ok(client.includes('/stream?r='), 'the panel reads the binary frame stream');
assert.ok(!client.includes('previewSeq'), 'no frame replay is left in the panel');
assert.ok(client.includes("'dvb-log-body'"), 'the page console is a scroll container');
assert.ok(client.includes("role: 'separator'"), 'the console height has a drag handle');
assert.ok(client.includes('LOG_HEIGHT_KEY') && client.includes('localStorage'), 'the chosen split is remembered');
assert.ok(client.includes("'dvb-console-row'") && client.includes("'dvb-console-input-row'"), 'the console lists output and runs scripts');
assert.ok(!client.includes("className: 'dvb-hint'"), 'the bottom hint row is gone');
assert.ok(client.includes('cursor:none'), 'the native pointer hides over the picture');
assert.ok(client.includes("className: 'dvb-cursor'"), 'the panel draws its own pointer');
assert.ok(client.includes('--dvb-scale'), 'the drawn pointer and action graphics scale with the picture');
assert.ok(client.includes("className: 'dvb-cursor-hand'"), 'a drag swaps the pointer for a grabbing hand');
assert.ok(client.includes("className: 'dvb-scroll'"), 'scroll operations get their own arrows');
assert.ok(client.includes("className: 'dvb-lock'") && client.includes('data-on'), 'the Agent lock veil covers the picture');
assert.ok(client.includes("className: 'dvb-key'"), 'key presses and selects show a keycap');
assert.ok(client.includes('/events?r='), 'Agent operation cues arrive on their own stream');
assert.ok(client.includes('/ack') && client.includes('ackActivity'), 'the pointer animation tells the host when to click');
assert.ok(client.includes('console.clearTitle'), 'the page console can be cleared');
assert.ok(client.includes('/console'), 'clearing and evaluating go through the host console API');
assert.ok(client.includes("className: 'dvb-tab'") && client.includes('data-dragging'), 'tabs can be dragged');
assert.ok(client.includes('onContextMenu') && client.includes('tab.reference'), 'tabs have a right-click menu with reference');
assert.ok(client.includes('insertComposerText'), 'a tab can be referenced into the chat composer');
assert.ok(client.includes('lockedRef.current'), 'user input is refused while the Agent lock is up');
assert.match(await readFile(join(root, 'lib/browser.js'), 'utf8'), /subscribeActivity|#beginActivity/, 'the host emits Agent operation cues');
assert.match(await readFile(join(root, 'lib/browser.js'), 'utf8'), /Runtime\.consoleAPICalled/, 'the host captures the page console');
assert.match(await readFile(join(root, 'lib/browser.js'), 'utf8'), /evaluateConsole/, 'the host can run scripts in the active page');
assert.match(await readFile(join(root, 'lib/browser.js'), 'utf8'), /clearActions/, 'the host can still clear its internal action list');
assert.match(await readFile(join(root, 'lib/browser.js'), 'utf8'), /agentBusy/, 'the host reports that an Agent operation is running');
assert.ok(!client.includes('requestJson(') || client.includes('AbortController'), 'requests can time out');
assert.match(await readFile(join(root, 'lib/browser.js'), 'utf8'), /heldButton/, 'a held button is reported on moves so drags work');
assert.ok(client.includes("'dvb-tabs'") && client.includes("'dvb-tab-close'"), 'pages are tabs in the panel');
assert.match(await readFile(join(root, 'lib/browser.js'), 'utf8'), /async newPage/, 'the host can hold more than one page');
const browserSource = await readFile(join(root, 'lib/browser.js'), 'utf8');
assert.match(browserSource, /Target\.setDiscoverTargets/, 'tabs the page opens itself are discovered');
assert.match(browserSource, /#adoptTarget|Target\.targetCreated/, 'a new page target is adopted instead of left hidden');
assert.match(browserSource, /#forgetTarget|Target\.targetDestroyed/, 'a closed page target leaves the page list');
assert.match(browserSource, /navigationGraceMs/, 'a never-finishing navigation is bounded');
assert.match(browserSource, /Page\.bringToFront/, 'switching pages activates the Chrome tab so input is not queued');
assert.match(browserSource, /return this\.#ensureScreencast\(\)/, 'a screencast pending for the old page retries for the new one');
assert.ok(client.includes("key: 'stage'") && client.includes("key: 'log'"), 'root children keep stable keys so a tab change never remounts them');
assert.ok(client.includes('--dsw-alias-interactive-bg-hover'), 'hover uses the interactive token, not a surface token');
assert.ok(!/(^|\n)\s*(const|let)\s+[A-Za-z_$][\w$]*\s*=/.test(client.replace(/^\s*\/\/.*$/gm, '')) || client.trimStart().startsWith('(function'), 'client file is wrapped in an IIFE');

console.log('package.test.mjs ok');
