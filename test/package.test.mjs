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
assert.ok(client.includes(`'sidebar.panellist'`), 'sidebar entry');
assert.ok(client.includes(`'main'`), 'main panel');
assert.ok(!/(^|\n)\s*(const|let)\s+[A-Za-z_$][\w$]*\s*=/.test(client.replace(/^\s*\/\/.*$/gm, '')) || client.trimStart().startsWith('(function'), 'client file is wrapped in an IIFE');

console.log('package.test.mjs ok');
