/**
 * Tool-layer tests: the merged "act → shot → read" answer, the picture-free
 * fallback, and the raw CDP escape hatch. The browser itself is replaced by a
 * small stub, so this runs in a plain node process.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { browserTools } from '../lib/tools.js';

const shotFile = path.join(mkdtempSync(path.join(tmpdir(), 'dvb-tools-')), 'shot.jpg');
writeFileSync(shotFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

const SNAPSHOT = {
  url: 'https://demo.test/next',
  title: 'Next',
  viewport: { width: 1280, height: 800 },
  scrollY: 0,
  docHeight: 800,
  total: 1,
  elements: [{ ref: 1, role: 'button', name: 'Next' }],
  headings: [],
  text: '',
};

function makeManager(overrides = {}) {
  const calls = { act: [], shots: [], cdp: [] };
  const manager = {
    calls,
    config: { maxElements: 30 },
    async act(input, options) {
      calls.act.push({ input, options });
      return { summary: 'click [1] “Next”', snapshot: SNAPSHOT };
    },
    async screenshot(options) {
      calls.shots.push(options);
      return { path: shotFile, bytes: 4096, format: options?.format === 'png' ? 'png' : 'jpeg' };
    },
    async sendCdp(input) {
      calls.cdp.push(input);
      return { frameId: 'F1', loaderId: 'L1' };
    },
    ...overrides,
  };
  return manager;
}

function makeCtx({ supportsImage = true } = {}) {
  const saved = [];
  const ctx = {
    saved,
    get(name) {
      if (name === 'attachments') {
        return {
          async saveImage({ data, mediaType, name: fileName }) {
            saved.push({ bytes: data.length, mediaType, name: fileName });
            return { attachmentId: 'att-1', mediaType, bytes: data.length, width: 1280, height: 800, name: fileName };
          },
        };
      }
      if (name === 'llm') {
        return {
          async resolveModelInfo() {
            return { inputModalities: supportsImage ? ['text', 'image'] : ['text'] };
          },
        };
      }
      return undefined;
    },
  };
  return ctx;
}

const exec = {
  agent: {
    options: { provider: 'test', model: 'vision' },
    session: { requestHeader: () => ({ config: { provider: 'test', model: 'vision' } }) },
  },
};

function tool(tools, name) {
  const found = tools.find((entry) => entry.name === name);
  assert.ok(found, `tool ${name} is registered`);
  return found;
}

// A click answers with the numbered view AND the picture by default.
{
  const manager = makeManager();
  const ctx = makeCtx();
  const tools = browserTools(manager, ctx);
  const act = tool(tools, 'browser_act');
  const value = await act.execute({ action: 'click', ref: 1, delay_ms: 0 }, exec);
  assert.deepEqual(manager.calls.act[0].options, { source: 'agent', scope: 'default' });
  assert.equal(manager.calls.shots.length, 1, 'one picture per acting call');
  assert.equal(manager.calls.shots[0].format, 'jpeg', 'the merged shot is jpeg');
  assert.ok(value.text.startsWith('OK: click [1]'), 'the summary comes first');
  assert.ok(/URL: https:\/\/demo\.test\/next/.test(value.text), 'the numbered view is still there');
  assert.ok(/PICTURE: JPEG 4 KiB saved to/.test(value.text));
  assert.equal(value.image.attachmentId, 'att-1');
  assert.equal(value.image.mediaType, 'image/jpeg');
  assert.equal(ctx.saved.length, 1, 'the picture went through the attachment service');

  const blocks = act.output.render({}, value);
  assert.equal(blocks[0].type, 'text');
  assert.equal(blocks[1].type, 'image');
  assert.equal(blocks[1].attachment.attachmentId, 'att-1');
}

// read:false keeps only the file; screenshot:false drops the picture entirely.
{
  const manager = makeManager();
  const tools = browserTools(manager, makeCtx());
  const act = tool(tools, 'browser_act');

  const saved = await act.execute({ action: 'click', ref: 2, read: false, delay_ms: 0 }, exec);
  assert.equal(saved.image, null);
  assert.ok(/open it with read_image/.test(saved.text), 'the path fallback explains what to do');
  assert.equal(manager.calls.shots.length, 1);
  assert.deepEqual(act.output.render({}, saved).map((block) => block.type), ['text']);

  const skipped = await act.execute({ action: 'click', ref: 3, screenshot: false }, exec);
  assert.equal(skipped.image, null);
  assert.equal(manager.calls.shots.length, 1, 'screenshot:false takes no picture');
  assert.ok(!/PICTURE:/.test(skipped.text));
}

// A model without image input gets the path, not a broken attachment.
{
  const ctx = makeCtx({ supportsImage: false });
  const tools = browserTools(makeManager(), ctx);
  const value = await tool(tools, 'browser_act').execute({ action: 'click', ref: 1, delay_ms: 0 }, exec);
  assert.equal(value.image, null);
  assert.equal(ctx.saved.length, 0);
  assert.ok(/open it with read_image/.test(value.text));
}

// A wait answers like any other action; a failed capture never fails the action.
{
  const manager = makeManager();
  const tools = browserTools(manager, makeCtx());
  const act = tool(tools, 'browser_act');
  await act.execute({ action: 'wait', ms: 10, delay_ms: 0 }, exec);
  assert.equal(manager.calls.shots.length, 1, 'a wait still answers with a picture');

  const broken = makeManager({
    async screenshot() {
      throw new Error('no frames');
    },
  });
  const value = await tool(browserTools(broken, makeCtx()), 'browser_act').execute({ action: 'click', ref: 1, delay_ms: 0 }, exec);
  assert.ok(value.text.startsWith('OK: click'), 'the action result survives');
  assert.ok(/PICTURE: could not capture it \(no frames\)/.test(value.text));
  assert.equal(value.image, null);
}

// browser_screenshot hands the picture over by default, and can step back.
{
  const manager = makeManager();
  const tools = browserTools(manager, makeCtx());
  const shot = tool(tools, 'browser_screenshot');
  const value = await shot.execute({}, exec);
  assert.equal(value.image.attachmentId, 'att-1');
  assert.equal(manager.calls.shots[0].format, undefined, 'the default format is the manager default (png)');

  const plain = await shot.execute({ read: false }, exec);
  assert.equal(plain.image, null);
  assert.ok(/saved to/.test(plain.text));
}

// Raw CDP: routed through the manager, long blobs summarised, size capped.
{
  const manager = makeManager({
    async sendCdp() {
      return {
        ok: true,
        data: 'A'.repeat(4096),
        nodes: Array.from({ length: 4000 }, (_value, index) => ({ id: index })),
      };
    },
  });
  const tools = browserTools(manager, makeCtx());
  const cdp = tool(tools, 'browser_cdp');
  const text = await cdp.execute({ method: 'Page.captureScreenshot', page: 'p2' }, exec);
  assert.ok(text.startsWith('OK: Page.captureScreenshot\n'));
  assert.ok(/chars of base64 omitted/.test(text), 'base64 blobs do not reach the conversation');
  assert.ok(text.length < 16500, `the answer stays small (${text.length})`);
  assert.ok(/more characters omitted/.test(text));
}

{
  const manager = makeManager();
  const tools = browserTools(manager, makeCtx());
  await tool(tools, 'browser_cdp').execute({ method: 'Runtime.evaluate', params: { expression: '1+1' }, page: 'p2' }, exec);
  assert.deepEqual(manager.calls.cdp[0], {
    method: 'Runtime.evaluate',
    params: { expression: '1+1' },
    page: 'p2',
  });
}

// Errors keep their hints and never leak a stack.
{
  const manager = makeManager({
    async act() {
      const error = new Error('The browser is not running');
      error.code = 'NOT_RUNNING';
      throw error;
    },
  });
  const tools = browserTools(manager, makeCtx());
  await assert.rejects(
    () => tool(tools, 'browser_act').execute({ action: 'click', ref: 1 }, exec),
    /The browser is not running/,
  );
}

console.log('tools.test.mjs ok');
