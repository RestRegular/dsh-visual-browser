/**
 * Agent-facing tools.
 *
 * Five tools cover the loop: open, look, act, read, screenshot. Each one
 * returns the compact numbered view again, so a model never has to re-read a
 * page and never sees the DOM. Every action is also mirrored into the panel
 * timeline by the manager itself.
 */

import { BrowserError } from './browser.js';
import { formatSnapshot } from './format.js';

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render(_args, value) {
    return [{ type: 'text', text: String(value ?? '') }];
  },
};

function hintFor(error) {
  if (!(error instanceof BrowserError)) return error instanceof Error ? error.message : String(error);
  switch (error.code) {
    case 'BROWSER_NOT_FOUND':
      return `${error.message} Install Google Chrome or Microsoft Edge, or set \`executablePath\` in the dsh-visual-browser config in cordis.patch.yml.`;
    case 'STALE_REF':
      return error.message;
    case 'NOT_RUNNING':
      return `${error.message} Call browser_open first.`;
    default:
      return error.message;
  }
}

function snapshotText(snapshot, manager) {
  return formatSnapshot(snapshot, { maxElements: manager.config.maxElements });
}

export function browserTools(manager) {
  return [
    {
      name: 'browser_open',
      description:
        'Open a URL in the visual browser: a real Chrome that the user can watch in the Visual Browser panel. Launches the browser on first use and returns the page\'s numbered view (interactive elements, headings, a short text excerpt) instead of the DOM, so the result stays small. Use the [n] numbers with browser_act.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL, or a bare domain such as example.com (https is assumed).' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        try {
          const snapshot = await manager.open(String(args?.url ?? ''));
          return `OK: opened ${snapshot.url}\n${snapshotText(snapshot, manager)}`;
        } catch (error) {
          throw new Error(hintFor(error));
        }
      },
    },
    {
      name: 'browser_see',
      description:
        'Take a fresh numbered view of the current page: visible interactive elements with [n] numbers, headings and a short text excerpt. Element numbers are reassigned every time, so use numbers from the newest view only. Call this after the page changed on its own, or when an action result looked wrong.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: TEXT_OUTPUT,
      async execute() {
        try {
          const snapshot = await manager.snapshot();
          return snapshotText(snapshot, manager);
        } catch (error) {
          throw new Error(hintFor(error));
        }
      },
    },
    {
      name: 'browser_act',
      description:
        'Act on the current page, then return the new numbered view. Target an element with a [n] number from the newest view (preferred) or a CSS selector. Supported actions: click, type (ref + text, optional submit to press Enter), key, hover, scroll, select, back, forward, reload, wait, close. Every action is mirrored into the Visual Browser panel for the user.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['click', 'type', 'key', 'hover', 'scroll', 'select', 'back', 'forward', 'reload', 'wait', 'close'],
            description: 'What to do.',
          },
          ref: { type: 'number', description: 'Element number [n] from the newest view.' },
          selector: { type: 'string', description: 'CSS selector, for when no numbered view is available.' },
          text: { type: 'string', description: 'Text to type (type) or the option label/value (select).' },
          key: { type: 'string', description: 'Key for action=key, such as Enter, Tab, Escape, ArrowDown, Control+a.' },
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction (default down).' },
          amount: { type: 'number', description: 'Scroll amount in viewport heights (default 1).' },
          value: { type: 'string', description: 'Option value or label for action=select.' },
          ms: { type: 'number', description: 'Milliseconds for action=wait (default 800).' },
          clear: { type: 'boolean', description: 'type: replace the field content (default true); false appends.' },
          submit: { type: 'boolean', description: 'type: press Enter afterwards.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        try {
          const result = await manager.act(args ?? {});
          if (!result.snapshot) return `OK: ${result.summary}`;
          return `OK: ${result.summary}\n${snapshotText(result.snapshot, manager)}`;
        } catch (error) {
          throw new Error(hintFor(error));
        }
      },
    },
    {
      name: 'browser_text',
      description:
        'Read text instead of guessing: omit ref/selector for the whole visible page text, or pass a [n] number to read one element (for a link it also returns the href). Use max_chars to raise the cap when the default excerpt is cut.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'number', description: 'Element number [n] from the newest view.' },
          selector: { type: 'string', description: 'CSS selector instead of a number.' },
          max_chars: { type: 'number', description: 'Character cap (default 4000).' },
        },
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        try {
          const value = await manager.readText({
            ref: args?.ref,
            selector: args?.selector,
            maxChars: args?.max_chars,
          });
          const header = `URL: ${value.url}${value.title ? `\nTITLE: ${value.title}` : ''}\nKIND: ${value.kind} · ${value.length} chars${value.truncated ? ' (truncated)' : ''}`;
          const extra = [];
          if (value.href) extra.push(`HREF: ${value.href}`);
          if (value.value) extra.push(`VALUE: ${value.value}`);
          return [header, ...extra, '', value.text || '(empty)'].join('\n');
        } catch (error) {
          throw new Error(hintFor(error));
        }
      },
    },
    {
      name: 'browser_screenshot',
      description:
        'Save a screenshot of the current page to a file and return its absolute path. Use it when pixel detail matters (layout, images, visual verification) and then open the file with read_image. Defaults to a temp directory and png.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to write; defaults to a temp file.' },
          format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default png).' },
        },
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        try {
          const saved = await manager.screenshot({ path: args?.path, format: args?.format });
          return `Saved ${saved.format.toUpperCase()} screenshot (${Math.round(saved.bytes / 1024)} KiB): ${saved.path}\nOpen it with read_image when the visual detail matters.`;
        } catch (error) {
          throw new Error(hintFor(error));
        }
      },
    },
  ];
}
