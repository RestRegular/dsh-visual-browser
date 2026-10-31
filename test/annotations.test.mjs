import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AnnotationStore } from '../lib/annotations.js';

test('session notes persist independently through edits, deletes and process reload', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dvb-notes-'));
  const filename = path.join(directory, 'annotations.json');
  try {
    const store = new AnnotationStore(filename);
    const a = JSON.stringify(['workspace:one', 'session:a']);
    const b = JSON.stringify(['workspace:one', 'session:b']);
    await store.change(a, notes => [...notes, { id: 'save-button', comment: 'Only enable after changes' }]);
    await store.change(b, notes => [...notes, { id: 'other-note', comment: 'Keep this separate' }]);
    await store.change(a, notes => notes.map(note => ({ ...note, comment: 'Disable until a field changes' })));
    const reopened = new AnnotationStore(filename);
    assert.deepEqual(await reopened.list(a), [{ id: 'save-button', comment: 'Disable until a field changes' }]);
    assert.deepEqual(await reopened.list(b), [{ id: 'other-note', comment: 'Keep this separate' }]);
    await reopened.change(a, notes => notes.filter(note => note.id !== 'save-button'));
    const final = new AnnotationStore(filename);
    assert.deepEqual(await final.list(a), []);
    assert.deepEqual(await final.list(b), [{ id: 'other-note', comment: 'Keep this separate' }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('simultaneous saves cannot lose another comment or session', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dvb-notes-'));
  try {
    const store = new AnnotationStore(path.join(directory, 'annotations.json'));
    await Promise.all([
      store.change('a', notes => [...notes, { id: 'first', comment: 'Move left' }]),
      store.change('a', notes => [...notes, { id: 'second', comment: 'Increase contrast' }]),
      store.change('b', notes => [...notes, { id: 'private', comment: 'Do not mix into a' }]),
    ]);
    const disk = new AnnotationStore(store.filename);
    assert.deepEqual((await disk.list('a')).map(note => note.id), ['first', 'second']);
    assert.deepEqual(await disk.list('b'), [{ id: 'private', comment: 'Do not mix into a' }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
