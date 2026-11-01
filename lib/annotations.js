import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BrowserError, defaultUserDataDir } from './browser.js';
import { annotationExpression } from './annotation-scripts.js';

/** One small private JSON store; writes are serialized and committed after rename. */
export class AnnotationStore {
  constructor(filename) {
    this.filename = filename;
    this.data = {};
    this.ready = this.load();
    this.pending = Promise.resolve();
  }
  async load() {
    try { this.data = JSON.parse(await readFile(this.filename, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async list(key) {
    await this.ready;
    return this.data[key] || [];
  }
  change(key, change) {
    const result = this.pending.then(async () => {
      await this.ready;
      const next = { ...this.data, [key]: change(this.data[key] || []) };
      await mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
      const temporary = this.filename + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, this.filename);
      this.data = next;
      return next[key];
    });
    this.pending = result.catch(() => {});
    return result;
  }
}

export class Annotations {
  constructor(manager, filename = path.join(defaultUserDataDir(), 'annotations.json')) {
    this.manager = manager;
    this.store = new AnnotationStore(filename);
    this.picks = new Map();
  }
  key(scope, session) { return JSON.stringify([scope, session]); }
  async evaluate(scope, page, input) {
    const result = await this.manager.sendCdp({ page, method: 'Runtime.evaluate', params: {
      expression: annotationExpression(input), returnByValue: true, awaitPromise: false,
    } }, { scope });
    if (result.exceptionDetails) throw new BrowserError('STALE_REF', '页面已变化，请重新定位元素。');
    return result.result?.value;
  }
  async inspect(scope, session, body) {
    if (typeof body.page !== 'string' || !body.page || typeof body.url !== 'string' || !Number.isFinite(body.x) || !Number.isFinite(body.y)) {
      throw new BrowserError('BAD_ACTION', 'page, url and viewport x/y are required');
    }
    const state = this.manager.state(scope);
    const page = state.pages.find(page => page.id === body.page);
    if (!page) throw new BrowserError('TARGET_NOT_FOUND', '当前工作区没有这个页面。');
    if (body.revision !== undefined && body.revision !== page.revision) throw new BrowserError('STALE_REF', '页面已导航，请重新定位。');
    if (state.follow || state.agentBusy) throw new BrowserError('STALE_REF', 'Agent 正在操作，请先停止跟随后标注。');
    const value = await this.evaluate(scope, body.page, { action: 'inspect', url: body.url, x: body.x, y: body.y });
    if (!value || value.stale || value.empty) throw new BrowserError('STALE_REF', '页面已变化或当前位置没有元素，请重新定位。');
    if (this.manager.state(scope).pages.find(item => item.id === body.page)?.revision !== page.revision) {
      throw new BrowserError('STALE_REF', '页面正在导航，请重试。');
    }
    const identity = this.key(scope, session) + ':' + body.page + ':' + value.revision + ':' + value.node;
    let canonical = this.picks.get(identity);
    if (!canonical) {
      canonical = { ...value, page: body.page, navigationRevision: page.revision, token: randomUUID() };
      this.picks.set(identity, canonical);
    } else {
      canonical = { ...canonical, ...value };
      this.picks.set(identity, canonical);
    }
    return canonical;
  }
  async validate(scope, target) {
    const page = this.manager.state(scope).pages.find(page => page.id === target.page);
    if (!page || page.revision !== target.navigationRevision) throw new BrowserError('STALE_REF', '页面已导航，请重新定位批注。');
    const result = await this.evaluate(scope, target.page, { action: 'validate', target });
    if (!result?.valid) throw new BrowserError('STALE_REF', '批注对应的元素已变化，请删除旧批注并重新定位。');
    return target;
  }
  async list(scope, session) { return this.store.list(this.key(scope, session)); }
  async update(scope, session, body) {
    const key = this.key(scope, session);
    const records = await this.store.list(key);
    if (body.action === 'validate') {
      if (!Array.isArray(body.ids) || body.ids.length === 0) throw new BrowserError('BAD_ACTION', '请选择批注。');
      const selected = body.ids.map(id => {
        const record = records.find(note => note.id === id);
        if (!record) throw new BrowserError('TARGET_NOT_FOUND', '批注不存在于当前会话。');
        return record;
      });
      for (const record of selected) await this.validate(scope, record.target);
      return selected;
    }
    if (body.action === 'remove') {
      if (!records.some(note => note.id === body.id)) throw new BrowserError('TARGET_NOT_FOUND', '批注不存在于当前会话。');
      return this.store.change(key, notes => notes.filter(note => note.id !== body.id));
    }
    if (body.action !== 'save' || typeof body.comment !== 'string' || !body.comment.trim()) {
      throw new BrowserError('BAD_ACTION', '请输入批注内容。');
    }
    const existing = body.id ? records.find(note => note.id === body.id) : null;
    if (body.id && !existing) throw new BrowserError('TARGET_NOT_FOUND', '批注不存在于当前会话。');
    const picked = existing?.target || [...this.picks.entries()].find(([id, target]) => id.startsWith(key + ':') && target.token === body.target?.token)?.[1];
    if (!picked) throw new BrowserError('STALE_REF', '定位已过期，请重新选择元素。');
    await this.validate(scope, picked);
    const record = { id: existing?.id || randomUUID(), target: picked, comment: body.comment, createdAt: existing?.createdAt || new Date().toISOString() };
    return this.store.change(key, notes => existing ? notes.map(note => note.id === existing.id ? record : note) : [...notes, record]);
  }
}

const controllers = new WeakMap();
export function annotationsFor(manager, filename) {
  let controller = controllers.get(manager);
  if (!controller) { controller = new Annotations(manager, filename); controllers.set(manager, controller); }
  return controller;
}
