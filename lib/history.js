/**
 * Persistent browsing history behind the address box.
 *
 * The URL box's rows used to live in memory only, so every host restart emptied
 * the dropdown. One small JSON file in the plugin's data directory
 * (`~/.dsh/visual-browser/visit-history.json`, beside the Chrome profile)
 * keeps them per workspace scope, so a Session that comes back finds the pages
 * it visited, not a blank suggestion list.
 *
 * The file is bounded twice: at most `HISTORY_LIMIT` (50) rows per scope — the
 * whole list the dropdown shows — and at most `HISTORY_SCOPES` scopes, newest
 * first, because an ungrouped Session gets a scope of its own and those
 * accumulate. It is replaced, never appended to: the new document is written to
 * a temporary file and renamed over the old one, so a crash mid-write cannot
 * leave half a JSON document behind. Writes are debounced (a navigation storm
 * costs one write) and flushed on host unload.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Rows kept per workspace scope: the dropdown's whole list. */
export const HISTORY_LIMIT = 50;

/** Scopes kept in the file, most recently touched first. */
export const HISTORY_SCOPES = 50;

/** Layout version of the document; only bumped on a breaking change. */
const HISTORY_VERSION = 1;

/** A burst of navigations settles into one write after this quiet gap. */
const WRITE_DELAY_MS = 150;

/** Default location: the plugin's data directory, next to the Chrome profile. */
export function defaultHistoryFile() {
  return path.join(homedir(), '.dsh', 'visual-browser', 'visit-history.json');
}

/**
 * A url the dropdown should remember: a real page, not the blank start tab or
 * the DevTools front end Chrome serves itself.
 */
export function isRecordableUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (url === '' || url === 'about:blank') return false;
  if (url.startsWith('devtools://')) return false;
  return true;
}

/** One row, or null when the stored value is not a usable page. */
function normalizeEntry(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!isRecordableUrl(url)) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 1024) : '';
  const stamp = Number(raw.ts);
  return { url, title, ts: Number.isFinite(stamp) && stamp > 0 ? stamp : 0 };
}

/**
 * Clean a list of rows: drop unusable urls, fold duplicates (the first one
 * wins, matching the newest-first order callers keep), cap at `limit`.
 */
export function normalizeHistoryEntries(list, limit = HISTORY_LIMIT) {
  const cap = normalizeLimit(limit);
  const entries = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const entry = normalizeEntry(raw);
    if (entry === null || seen.has(entry.url)) continue;
    seen.add(entry.url);
    entries.push(entry);
    if (entries.length >= cap) break;
  }
  return entries;
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return HISTORY_LIMIT;
  return Math.min(500, Math.max(1, Math.round(number)));
}

function scopeKey(scope) {
  return typeof scope === 'string' ? scope.trim() : '';
}

function cloneEntry(entry) {
  return { url: entry.url, title: entry.title, ts: entry.ts };
}

/**
 * One JSON file holding every scope's rows. Reads are synchronous (the file is
 * small and the first `/state` poll needs it before rendering); writes are
 * debounced and atomic.
 */
export class VisitHistoryStore {
  #file;
  #limit;
  #maxScopes;
  #logger;
  /** scope -> { entries: [...], updatedAt } */
  #scopes = new Map();
  #loaded = false;
  #dirty = false;
  #timer = null;
  /** Monotonic touched-at: scopes written in the same millisecond still order. */
  #lastStamp = 0;
  #warned = false;

  constructor({ file = defaultHistoryFile(), limit = HISTORY_LIMIT, scopes = HISTORY_SCOPES, logger = null } = {}) {
    const target = typeof file === 'string' ? file.trim() : '';
    this.#file = target === '' ? defaultHistoryFile() : target;
    this.#limit = normalizeLimit(limit);
    this.#maxScopes = Math.max(1, Math.round(Number(scopes) || HISTORY_SCOPES));
    this.#logger = logger ?? null;
  }

  get file() {
    return this.#file;
  }

  get limit() {
    return this.#limit;
  }

  /** One scope's rows, newest first. A copy: the caller owns the array. */
  entries(scope) {
    this.#load();
    const record = this.#scopes.get(scopeKey(scope));
    return record === undefined ? [] : record.entries.map(cloneEntry);
  }

  /** Replace one scope's rows and write the file shortly afterwards. */
  replace(scope, entries) {
    this.#load();
    const key = scopeKey(scope);
    if (key === '') return;
    const rows = normalizeHistoryEntries(entries, this.#limit);
    if (rows.length === 0) {
      if (!this.#scopes.delete(key)) return;
    } else {
      this.#scopes.set(key, { entries: rows, updatedAt: this.#stamp() });
    }
    this.#dirty = true;
    this.#schedule();
  }

  /** Forget one url of one scope; true when a row actually went away. */
  remove(scope, url) {
    this.#load();
    const key = scopeKey(scope);
    const value = typeof url === 'string' ? url.trim() : '';
    if (key === '' || value === '') return false;
    const record = this.#scopes.get(key);
    if (record === undefined) return false;
    const kept = record.entries.filter((entry) => entry.url !== value);
    if (kept.length === record.entries.length) return false;
    if (kept.length === 0) this.#scopes.delete(key);
    else record.entries = kept;
    record.updatedAt = this.#stamp();
    this.#dirty = true;
    this.#schedule();
    return true;
  }

  /** Write now when anything changed (host unload); never throws. */
  flush() {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (!this.#dirty) return;
    this.#write();
  }

  /** Drop the pending debounce without writing (tests, disposal after flush). */
  dispose() {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #schedule() {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#dirty) this.#write();
    }, WRITE_DELAY_MS);
    this.#timer.unref?.();
  }

  /** Strictly increasing touched-at, so equal milliseconds still have an order. */
  #stamp() {
    this.#lastStamp = Math.max(Date.now(), this.#lastStamp + 1);
    return this.#lastStamp;
  }

  #load() {
    if (this.#loaded) return;
    this.#loaded = true;
    let text;
    try {
      text = readFileSync(this.#file, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') this.#warn(`could not read ${this.#file}: ${error?.message ?? error}`);
      return;
    }
    let document;
    try {
      document = JSON.parse(text);
    } catch (error) {
      this.#warn(`ignoring an unreadable ${this.#file}: ${error?.message ?? error}`);
      try {
        renameSync(this.#file, `${this.#file}.broken`);
      } catch {
        /* the next write replaces it anyway */
      }
      return;
    }
    const scopes = document !== null && typeof document === 'object' ? document.scopes : null;
    if (scopes === null || typeof scopes !== 'object' || Array.isArray(scopes)) return;
    for (const [scope, value] of Object.entries(scopes)) {
      const key = scopeKey(scope);
      if (key === '') continue;
      const source = Array.isArray(value) ? value : value?.entries;
      const rows = normalizeHistoryEntries(source, this.#limit);
      if (rows.length === 0) continue;
      const stamp = Number(value?.updatedAt);
      const updatedAt = Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
      this.#scopes.set(key, { entries: rows, updatedAt });
      if (updatedAt > this.#lastStamp) this.#lastStamp = updatedAt;
    }
    this.#pruneScopes();
  }

  /** Keep the file bounded: the most recently touched scopes survive. */
  #pruneScopes() {
    if (this.#scopes.size <= this.#maxScopes) return;
    const ordered = [...this.#scopes.entries()].sort((left, right) => right[1].updatedAt - left[1].updatedAt);
    for (const [key] of ordered.slice(this.#maxScopes)) this.#scopes.delete(key);
  }

  #write() {
    this.#dirty = false;
    this.#pruneScopes();
    const scopes = {};
    for (const [key, record] of this.#scopes) {
      scopes[key] = {
        updatedAt: record.updatedAt,
        entries: record.entries.map(cloneEntry),
      };
    }
    const text = `${JSON.stringify({ version: HISTORY_VERSION, updatedAt: Date.now(), scopes })}\n`;
    try {
      mkdirSync(path.dirname(this.#file), { recursive: true });
      const temporary = `${this.#file}.${process.pid}.tmp`;
      writeFileSync(temporary, text, 'utf8');
      renameSync(temporary, this.#file);
      this.#warned = false;
    } catch (error) {
      // Keep the rows in memory and try again on the next change; history must
      // never take the browser down.
      this.#dirty = true;
      this.#warn(`could not write ${this.#file}: ${error?.message ?? error}`);
    }
  }

  #warn(message) {
    if (this.#warned) return;
    this.#warned = true;
    try {
      this.#logger?.warn?.(`[visual-browser] ${message}`);
    } catch {
      /* logging cannot fail the browser */
    }
  }
}
