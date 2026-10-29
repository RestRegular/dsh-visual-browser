/**
 * Agent-facing tools.
 *
 * The loop is open, look, act, read, screenshot — and every acting tool can hand
 * the model the picture in the same answer, so the usual "click, then
 * screenshot, then read_image" becomes one call.
 *
 * Each one returns the compact numbered view again, so a model never has to
 * re-read a page and never sees the DOM. Every action is also mirrored into the
 * panel timeline by the manager itself.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { BrowserError } from './browser.js';
import { formatSnapshot, wellFormedText } from './format.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a merged click waits for the page to settle before the shot. */
const DEFAULT_SHOT_DELAY_MS = 300;
const MAX_SHOT_DELAY_MS = 15000;
/** Raw CDP answers are cut here so one command cannot flood the conversation. */
const MAX_CDP_CHARS = 16000;

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render(_args, value) {
    return [{ type: 'text', text: wellFormedText(value) }];
  },
};

/** Text plus, when the model can take one, the picture itself. */
const VIEW_OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render(_args, value) {
    const blocks = [{ type: 'text', text: wellFormedText(String(value?.text ?? '')) }];
    if (value && value.image) blocks.push({ type: 'image', attachment: value.image });
    return blocks;
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
    case 'FILE_NOT_FOUND':
      return `${error.message} Paths resolve against the session workspace; pass an absolute path when the file lives elsewhere.`;
    default:
      return error.message;
  }
}

function snapshotText(snapshot, manager) {
  return formatSnapshot(snapshot, { maxElements: manager.config.maxElements });
}

/** Provider/model the requesting agent is routed to (best effort). */
function routeOf(exec) {
  let routed = null;
  try {
    routed = exec?.agent?.session?.requestHeader?.()?.config ?? null;
  } catch {
    routed = null;
  }
  return {
    provider: routed?.provider ?? exec?.agent?.options?.provider,
    model: routed?.model ?? exec?.agent?.options?.model,
  };
}

/**
 * Persist a saved screenshot through the attachment service and return the
 * attachment the model can see. Returns null when this model cannot take
 * pictures (or the service is unavailable), so callers fall back to the path.
 */
async function attachShot(ctx, exec, saved) {
  const attachments = ctx?.get?.('attachments');
  const llm = ctx?.get?.('llm');
  if (!attachments || typeof attachments.saveImage !== 'function') return null;
  if (!llm || typeof llm.resolveModelInfo !== 'function') return null;
  const { provider, model } = routeOf(exec);
  if (!provider || !model) return null;
  try {
    const info = await llm.resolveModelInfo(provider, model, exec?.signal);
    const modalities = Array.isArray(info?.inputModalities) ? info.inputModalities : [];
    if (!modalities.includes('image')) return null;
  } catch {
    return null;
  }
  try {
    const data = await readFile(saved.path);
    const mediaType = saved.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const stored = await attachments.saveImage({ data, mediaType, name: path.basename(saved.path) });
    if (!stored || typeof stored.attachmentId !== 'string') return null;
    return {
      attachmentId: stored.attachmentId,
      mediaType: stored.mediaType ?? mediaType,
      bytes: Number.isFinite(stored.bytes) ? stored.bytes : data.length,
      ...(Number.isFinite(stored.width) ? { width: stored.width } : {}),
      ...(Number.isFinite(stored.height) ? { height: stored.height } : {}),
      ...(stored.name ? { name: stored.name } : {}),
      ...(stored.originalDimensions
        ? {
            originalDimensions: {
              width: stored.originalDimensions.width,
              height: stored.originalDimensions.height,
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Wait, capture, and optionally attach: the merged `click → shot → read`. */
async function captureShot(ctx, exec, manager, options = {}) {
  if (options.screenshot === false) return null;
  const requested = Number(options.delayMs);
  const delay = Number.isFinite(requested) ? Math.min(MAX_SHOT_DELAY_MS, Math.max(0, Math.round(requested))) : DEFAULT_SHOT_DELAY_MS;
  if (delay > 0) await sleep(delay);
  const saved = await manager.screenshot({
    scope: options.scope,
    page: options.page,
    format: options.format === 'png' ? 'png' : 'jpeg',
  });
  const image = options.read === false ? null : await attachShot(ctx, exec, saved);
  return { saved, image };
}

/** Picture line that works whether or not the model got the image itself. */
function shotLine(shot) {
  if (shot === null) return '';
  const { saved, image } = shot;
  const size = `${Math.max(1, Math.round(saved.bytes / 1024))} KiB`;
  const head = `PICTURE: ${saved.format.toUpperCase()} ${size} saved to ${saved.path}`;
  return image
    ? head
    : `${head}\n(Picture not attached to this answer; open it with read_image when the visual detail matters.)`;
}

/** JSON for a raw CDP answer: long blobs out, then a hard character cap. */
function cdpText(value) {
  let text = '';
  try {
    text = JSON.stringify(value ?? null) ?? 'null';
  } catch (error) {
    return `unserializable result: ${error instanceof Error ? error.message : String(error)}`;
  }
  text = text.replace(
    /"(data|metadata|base64)":"([A-Za-z0-9+/=]{512,})"/gu,
    (_match, key, blob) => `"${key}":"<${blob.length} chars of base64 omitted; use browser_screenshot for pictures>"`,
  );
  if (text.length <= MAX_CDP_CHARS) return text;
  return `${text.slice(0, MAX_CDP_CHARS)}… (${text.length - MAX_CDP_CHARS} more characters omitted)`;
}

/** The workspace scope of the Agent call (ungrouped sessions isolate by id). */
function scopeOfExecution(options, exec) {
  try {
    const sessionId = exec?.agent?.session?.id;
    const scope = typeof options?.scopeOf === 'function' ? options.scopeOf(sessionId) : undefined;
    return typeof scope === 'string' && scope !== '' ? scope : 'default';
  } catch {
    return 'default';
  }
}

export function browserTools(manager, ctx, options = {}) {
  return [
    {
      name: 'browser_open',
      description:
        'Open a URL in the visual browser, in a new tab of this workspace: a real Chrome that the user can watch in the Visual Browser panel. Launches the browser on first use and returns the page\'s numbered view (interactive elements, headings, a short text excerpt) instead of the DOM, so the result stays small. Use the [n] numbers with browser_act.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL, or a bare domain such as example.com (https is assumed).' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        try {
          const scope = scopeOfExecution(options, exec);
          const snapshot = await manager.open(String(args?.url ?? ''), { source: 'agent', scope, newTab: true });
          return `OK: opened ${snapshot.url}\n${snapshotText(snapshot, manager)}`;
        } catch (error) {
          throw new Error(wellFormedText(hintFor(error)));
        }
      },
    },
    {
      name: 'browser_see',
      description:
        'Take a fresh numbered view of a page: visible interactive elements with [n] numbers, headings and a short text excerpt. Element numbers are reassigned every time, so use numbers from the newest view only. Call this after the page changed on its own, or when an action result looked wrong. Pass `page` to inspect a specific tab without switching the panel to it.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            description: 'Optional tab to read: a page id or CDP target id. Omit to read the active/visible tab. Reading a background tab does not switch the panel to it.',
          },
        },
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        try {
          const scope = scopeOfExecution(options, exec);
          const snapshot = await manager.snapshot({ scope, page: args?.page });
          return snapshotText(snapshot, manager);
        } catch (error) {
          throw new Error(wellFormedText(hintFor(error)));
        }
      },
    },
    {
      name: 'browser_act',
      description:
        'Act on a page, then return the new numbered view and — by default — a fresh picture of the result, so one call replaces the old "click, screenshot, read_image" round trips. Target an element with a [n] number from the newest view (preferred) or a CSS selector, or pass viewport coordinates x/y (CSS pixels, the same scale as browser_screenshot) when the thing you need is not in the element view — canvas apps, maps, and everything inside a cross-origin iframe, where element queries are blocked but input still lands by position. Supported actions: click, upload (ref/selector plus files: the native file dialog is intercepted and filled, never shown), drag (x/y → to_x/to_y, an ordinary mouse press, gradual move and release: sliders, text selection, canvas drawing, sortable lists), type (ref + text, optional submit to press Enter; date, time, month, week, datetime-local, color and range inputs get a real value instead of keystrokes, because their pickers are native popups the picture cannot show), key, hover, scroll, select, back, forward, reload, wait, close. Pass `screenshot: false` when only the numbered view matters, `read: false` when the picture should just be saved, and `delay_ms` to let an animation finish first. Every action is mirrored into the Visual Browser panel for the user. By default the action runs on the tab the user is currently viewing; pass `page` to operate a specific tab (with the panel in follow mode that tab also becomes the picture).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'click',
              'upload',
              'drag',
              'type',
              'key',
              'hover',
              'scroll',
              'select',
              'back',
              'forward',
              'reload',
              'wait',
              'close',
            ],
            description: 'What to do.',
          },
          page: {
            type: 'string',
            description: 'Optional tab to act on: a page id or CDP target id. Omit to act on the tab the user is currently viewing. In follow mode (panel taken over) this tab also becomes the live picture.',
          },
          ref: { type: 'number', description: 'Element number [n] from the newest view.' },
          selector: { type: 'string', description: 'CSS selector, for when no numbered view is available.' },
          x: { type: 'number', description: 'Viewport x in CSS pixels (click/drag/hover start); pairs with y.' },
          y: { type: 'number', description: 'Viewport y in CSS pixels (click/drag/hover start); pairs with x.' },
          to_x: { type: 'number', description: 'drag: viewport x to end at.' },
          to_y: { type: 'number', description: 'drag: viewport y to end at.' },
          steps: { type: 'number', description: 'drag: intermediate moves between press and release (default 16).' },
          duration_ms: {
            type: 'number',
            description: 'drag: total time for the path in milliseconds (default 420). Too fast and sliders drop the gesture.',
          },
          button: {
            type: 'string',
            enum: ['left', 'right', 'middle'],
            description: 'Mouse button for click/drag (default left).',
          },
          text: { type: 'string', description: 'Text to type (type) or the option label/value (select). For a date or time field this is the value itself, e.g. "2026-10-26" or "08:30".' },
          key: { type: 'string', description: 'Key for action=key, such as Enter, Tab, Escape, ArrowDown, Control+a.' },
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction (default down).' },
          amount: { type: 'number', description: 'Scroll amount in viewport heights (default 1).' },
          value: { type: 'string', description: 'Option value or label for action=select.' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'upload: absolute paths (relative paths resolve against the workspace) of the files to hand to the native file dialog. The dialog is intercepted, so nothing is shown to the user.',
          },
          ms: { type: 'number', description: 'Milliseconds for action=wait (default 800).' },
          clear: { type: 'boolean', description: 'type: replace the field content (default true); false appends.' },
          submit: { type: 'boolean', description: 'type: press Enter afterwards.' },
          screenshot: {
            type: 'boolean',
            description: 'Capture a picture after the action (default true). The answer then carries the image itself, so no separate screenshot + read_image is needed.',
          },
          read: {
            type: 'boolean',
            description: 'Return that picture to the model (default true). false only saves the file and returns its path — use it when this step does not need to see the page.',
          },
          delay_ms: {
            type: 'number',
            description: `Milliseconds to wait after the action before the picture is taken (default ${DEFAULT_SHOT_DELAY_MS}, max ${MAX_SHOT_DELAY_MS}); raise it for animations or slow pages.`,
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: VIEW_OUTPUT,
      timeoutMs: 120000,
      async execute(args, exec) {
        try {
          const scope = scopeOfExecution(options, exec);
          const result = await manager.act(args ?? {}, { source: 'agent', scope });
          const parts = [`OK: ${result.summary}`];
          if (result.snapshot) parts.push(snapshotText(result.snapshot, manager));
          // The common loop is click → look. One shot per acting call, taken
          // after the page settled (plus the caller's own delay). Closing the
          // browser is the only action without a page left to photograph.
          let shot = null;
          if (args?.action !== 'close') {
            try {
              shot = await captureShot(ctx, exec, manager, {
                scope,
                screenshot: args?.screenshot,
                read: args?.read,
                delayMs: args?.delay_ms,
                page: args?.page,
              });
            } catch (error) {
              // An action that worked must not fail because the picture did not.
              parts.push(`PICTURE: could not capture it (${error instanceof Error ? error.message : String(error)})`);
            }
          }
          if (shot !== null) parts.push(shotLine(shot));
          return { text: parts.join('\n'), image: shot === null ? null : shot.image };
        } catch (error) {
          throw new Error(wellFormedText(hintFor(error)));
        }
      },
    },
    {
      name: 'browser_text',
      description:
        'Read text instead of guessing: omit ref/selector for the whole visible page text, or pass a [n] number to read one element (for a link it also returns the href). Use max_chars to raise the cap when the default excerpt is cut. Pass `page` to read a specific tab without switching the panel to it.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            description: 'Optional tab to read: a page id or CDP target id. Omit to read the active/visible tab. Reading a background tab does not switch the panel to it.',
          },
          ref: { type: 'number', description: 'Element number [n] from the newest view.' },
          selector: { type: 'string', description: 'CSS selector instead of a number.' },
          max_chars: { type: 'number', description: 'Character cap (default 4000).' },
        },
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        try {
          const scope = scopeOfExecution(options, exec);
          const value = await manager.readText({
            scope,
            page: args?.page,
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
          throw new Error(wellFormedText(hintFor(error)));
        }
      },
    },
    {
      name: 'browser_screenshot',
      description:
        'Capture a picture of a page. By default the image itself comes back in this answer, so it is ready to look at without a read_image round trip; pass `read: false` to only save the file and get its path. Use it when pixel detail matters (layout, images, visual verification). Defaults to a temp directory and png. Pass `page` to capture a specific tab (with the panel in follow mode that tab also becomes the picture).',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            description: 'Optional tab to capture: a page id or CDP target id. Omit to capture the active/visible tab.',
          },
          path: { type: 'string', description: 'Absolute path to write; defaults to a temp file.' },
          format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default png).' },
          read: { type: 'boolean', description: 'Return the picture to the model (default true). false saves it and returns only the path.' },
          delay_ms: { type: 'number', description: 'Milliseconds to wait before capturing (default 0); useful after a change that is still animating.' },
        },
        additionalProperties: false,
      },
      output: VIEW_OUTPUT,
      timeoutMs: 120000,
      async execute(args, exec) {
        try {
          const scope = scopeOfExecution(options, exec);
          const requested = Number(args?.delay_ms);
          if (Number.isFinite(requested) && requested > 0) await sleep(Math.min(MAX_SHOT_DELAY_MS, Math.round(requested)));
          const saved = await manager.screenshot({ scope, page: args?.page, path: args?.path, format: args?.format });
          const image = args?.read === false ? null : await attachShot(ctx, exec, saved);
          const text = shotLine({ saved, image });
          return { text, image };
        } catch (error) {
          throw new Error(wellFormedText(hintFor(error)));
        }
      },
    },
    {
      name: 'browser_cdp',
      description:
        'Send one raw Chrome DevTools Protocol command to the page. This is the escape hatch for what the numbered-view tools cannot express (Runtime.evaluate to inspect the page from script, Network.* conditions, Emulation.* overrides, Page.* captures), and it is also how a page can be driven when a click must not go through the numbered view. Prefer browser_act for ordinary clicking and typing. Pass `page` (a tab id or CDP target id) so the manager knows which tab the command belongs to: the action log records it, and with the panel in follow mode the picture switches to that tab. Commands that move the page (Page.navigate, Page.reload, Page.navigateToHistoryEntry) refresh the panel URL and the browsing history afterwards.',
      parameters: {
        type: 'object',
        properties: {
          method: { type: 'string', description: 'CDP method, for example Page.navigate, Runtime.evaluate, Network.enable.' },
          params: {
            type: 'object',
            additionalProperties: true,
            description: 'Parameters object for the method (CDP naming: camelCase, for example { expression: "document.title", returnByValue: true }).',
          },
          page: {
            type: 'string',
            description: 'Optional tab the command runs on: a page id or CDP target id. Omit for the tab the user is watching. In follow mode the panel switches to this tab.',
          },
        },
        required: ['method'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      timeoutMs: 120000,
      async execute(args, exec) {
        try {
          const scope = scopeOfExecution(options, exec);
          const method = String(args?.method ?? '');
          const result = await manager.sendCdp({ method, params: args?.params, page: args?.page }, { scope });
          return `OK: ${method}\n${cdpText(result)}`;
        } catch (error) {
          throw new Error(wellFormedText(hintFor(error)));
        }
      },
    },
  ];
}
