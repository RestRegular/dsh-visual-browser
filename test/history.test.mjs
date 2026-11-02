import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BrowserManager } from '../lib/browser.js';
import {
  defaultHistoryFile,
  HISTORY_LIMIT,
  HISTORY_SCOPES,
  isRecordableUrl,
  normalizeHistoryEntries,
  VisitHistoryStore,
} from '../lib/history.js';

const dir = mkdtempSync(path.join(tmpdir(), 'dvb-history-'));

// The default file sits in the plugin's data directory, beside the profile.
assert.match(defaultHistoryFile(), /[\\/]\.dsh[\\/]visual-browser[\\/]visit-history\.json$/);

// The blank start tab and the DevTools front end are never remembered.
assert.equal(isRecordableUrl('https://example.test/'), true);
assert.equal(isRecordableUrl('  https://example.test/  '), true);
assert.equal(isRecordableUrl(''), false);
assert.equal(isRecordableUrl('about:blank'), false);
assert.equal(isRecordableUrl('devtools://devtools/bundled/inspector.html'), false);
assert.equal(isRecordableUrl(null), false);

// Rows fold duplicates (newest first wins) and stop at the limit.
{
  const rows = normalizeHistoryEntries(
    [
      { url: 'https://a.test/', title: 'A' },
      { url: 'https://a.test/', title: 'A again' },
      { url: 'about:blank' },
      { url: 'https://b.test/', title: 'B' },
    ],
    2,
  );
  assert.deepEqual(
    rows.map((entry) => entry.url),
    ['https://a.test/', 'https://b.test/'],
  );
}

// A store round-trips rows, isolates scopes, and caps each scope at 50.
{
  const file = path.join(dir, 'nested', 'visit-history.json');
  const store = new VisitHistoryStore({ file });
  const rows = Array.from({ length: 60 }, (_, index) => ({
    url: `https://example.test/${index}`,
    title: `Page ${index}`,
    ts: 1000 + index,
  }));
  store.replace('workspace:one', rows);
  store.replace('workspace:two', [{ url: 'https://two.test/', title: 'Two' }]);
  store.flush();

  const document = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(document.version, 1);
  assert.equal(document.scopes['workspace:one'].entries.length, HISTORY_LIMIT);
  assert.equal(document.scopes['workspace:one'].entries[0].url, 'https://example.test/0');
  assert.equal(document.scopes['workspace:one'].entries.at(-1).url, `https://example.test/${HISTORY_LIMIT - 1}`);
  assert.equal(document.scopes['workspace:two'].entries.length, 1);

  // A fresh store (the next host run) reads the same rows back.
  const reopened = new VisitHistoryStore({ file });
  const loaded = reopened.entries('workspace:one');
  assert.equal(loaded.length, HISTORY_LIMIT);
  assert.deepEqual(loaded[0], { url: 'https://example.test/0', title: 'Page 0', ts: 1000 });
  assert.deepEqual(reopened.entries('workspace:two'), [{ url: 'https://two.test/', title: 'Two', ts: 0 }]);
  assert.deepEqual(reopened.entries('workspace:three'), []);
}

// Forgetting a scope's last row drops the scope from the document.
{
  const file = path.join(dir, 'removed.json');
  const store = new VisitHistoryStore({ file });
  store.replace('default', [{ url: 'https://only.test/' }]);
  store.flush();
  assert.equal(store.remove('default', 'https://only.test/'), true);
  assert.equal(store.remove('default', 'https://only.test/'), false);
  store.flush();
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).scopes), []);
}

// The file is bounded by scope count: the newest scopes survive.
{
  const file = path.join(dir, 'scopes.json');
  const store = new VisitHistoryStore({ file });
  for (let index = 0; index < HISTORY_SCOPES + 10; index += 1) {
    store.replace(`session:${index}`, [{ url: `https://s${index}.test/` }]);
  }
  store.flush();
  const document = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(Object.keys(document.scopes).length, HISTORY_SCOPES);
  assert.ok(Object.hasOwn(document.scopes, `session:${HISTORY_SCOPES + 9}`), 'the newest scope is kept');
  assert.ok(!Object.hasOwn(document.scopes, 'session:0'), 'the oldest scope is dropped');
}

// An unreadable document never breaks the browser: it is set aside, not lost.
{
  const file = path.join(dir, 'broken.json');
  writeFileSync(file, '{not json');
  const store = new VisitHistoryStore({ file });
  assert.deepEqual(store.entries('default'), []);
  assert.ok(existsSync(`${file}.broken`), 'the unreadable file is kept beside the new one');
}

// Reading without a change writes nothing.
{
  const file = path.join(dir, 'untouched.json');
  const store = new VisitHistoryStore({ file });
  store.entries('default');
  store.flush();
  assert.equal(existsSync(file), false);
}

// The manager hydrates a scope from the file and persists a forgotten row.
{
  const file = path.join(dir, 'manager.json');
  const seed = new VisitHistoryStore({ file });
  seed.replace('workspace:one', [
    { url: 'https://keep.test/', title: 'Keep' },
    { url: 'https://forget.test/', title: 'Forget' },
  ]);
  seed.flush();

  const manager = new BrowserManager({ config: { historyFile: file, historyLimit: 50 } });
  const state = manager.state('workspace:one');
  assert.deepEqual(
    state.history.map((entry) => entry.url),
    ['https://keep.test/', 'https://forget.test/'],
  );
  assert.equal(manager.removeHistory('https://absent.test/', { scope: 'workspace:one' }), false);
  assert.equal(manager.removeHistory('https://forget.test/', { scope: 'workspace:one' }), true);
  assert.deepEqual(
    manager.state('workspace:one').history.map((entry) => entry.url),
    ['https://keep.test/'],
  );
  manager.dispose();

  const reopened = new VisitHistoryStore({ file });
  assert.deepEqual(
    reopened.entries('workspace:one').map((entry) => entry.url),
    ['https://keep.test/'],
  );
}

// A custom limit is honoured and clamped.
{
  const file = path.join(dir, 'limit.json');
  const store = new VisitHistoryStore({ file, limit: 2 });
  store.replace('default', [
    { url: 'https://a.test/' },
    { url: 'https://b.test/' },
    { url: 'https://c.test/' },
  ]);
  assert.deepEqual(
    store.entries('default').map((entry) => entry.url),
    ['https://a.test/', 'https://b.test/'],
  );
  assert.equal(new VisitHistoryStore({ file, limit: 0 }).limit, 1);
}
