/**
 * Text projection of a page snapshot.
 *
 * Pure functions only: the same snapshot object is rendered for the model (this
 * module) and for the panel (raw JSON over the route), so a formatting change
 * never needs a browser.
 */

const DEFAULT_MAX_ELEMENTS = 100;

/** Render one snapshot as the compact view a model reads. */
export function formatSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return 'No page snapshot available.';
  const maxElements = Number.isFinite(options.maxElements) ? options.maxElements : DEFAULT_MAX_ELEMENTS;
  const lines = [];
  const url = String(snapshot.url || 'about:blank');
  const title = String(snapshot.title || '').trim();
  lines.push(`URL: ${url}`);
  if (title) lines.push(`TITLE: ${title}`);

  const viewport = snapshot.viewport || { width: 0, height: 0 };
  const scrollY = Number(snapshot.scrollY) || 0;
  const docHeight = Number(snapshot.docHeight) || 0;
  const total = Number(snapshot.total) || (Array.isArray(snapshot.elements) ? snapshot.elements.length : 0);
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements.slice(0, maxElements) : [];
  const scroll = docHeight > viewport.height ? ` scroll ${scrollY}/${docHeight}` : '';
  lines.push(`VIEW: ${viewport.width}x${viewport.height}${scroll} · ${elements.length}/${total} interactive`);

  if (elements.length === 0) {
    lines.push('ELEMENTS: none visible in the viewport');
  } else {
    for (const element of elements) lines.push(formatElement(element));
    if (total > elements.length) {
      lines.push(`… ${total - elements.length} more interactive elements below the fold; scroll to reach them`);
    }
  }

  const headings = Array.isArray(snapshot.headings) ? snapshot.headings.filter(Boolean) : [];
  if (headings.length > 0) lines.push(`HEADINGS: ${headings.join(' | ')}`);

  const text = String(snapshot.text || '').trim();
  if (text) lines.push(`TEXT: ${text}`);

  const active = snapshot.active;
  if (active && (active.ref || active.name)) {
    const target = active.ref ? `[${active.ref}] ` : '';
    lines.push(`ACTIVE: ${target}${active.role}${active.name ? ` "${active.name}"` : ''}`);
  }
  if (Number(snapshot.frames) > 0) {
    lines.push(`IFRAMES: ${snapshot.frames} (cross-frame content is not inspected; use a direct URL when possible)`);
  }
  return lines.join('\n');
}

/** One numbered element line. */
export function formatElement(element) {
  const ref = element.ref;
  const role = element.role || 'element';
  const name = String(element.name || '').trim();
  let line = `[${ref}] ${role}`;
  if (name) line += ` "${name}"`;
  if (element.value !== undefined && element.value !== '') line += ` value=${element.value}`;
  if (Array.isArray(element.state) && element.state.length > 0) line += ` (${element.state.join(', ')})`;
  if (element.href) line += ` → ${element.href}`;
  return line;
}

/**
 * Cut a string at a code-unit boundary without leaving half a surrogate pair.
 * `end` is how many UTF-16 code units to keep.
 */
export function clipEnd(value, end) {
  const text = String(value ?? '');
  if (end >= text.length) return text;
  if (end <= 0) return '';
  const last = text.charCodeAt(end - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

/**
 * Replace unpaired UTF-16 surrogates with U+FFFD.
 *
 * Every string this plugin hands the model passes through here. Half an emoji
 * (from clipping page text, or from a page that holds a broken JS string)
 * cannot be encoded as UTF-8: the request body then carries an invalid escape,
 * the provider rejects it with 400 INVALID_REQUEST, and because the message is
 * already in the session log every later turn fails the same way. Truncation
 * itself stays surrogate-safe (clipEnd); this is the belt to that braces.
 */
export function wellFormedText(value) {
  const text = String(value ?? '');
  if (typeof text.toWellFormed === 'function') return text.toWellFormed();
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[index] + text[index + 1];
        index += 1;
      } else {
        out += '\uFFFD';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\uFFFD';
    } else {
      out += text[index];
    }
  }
  return out;
}

/** One timeline row label; also used by the panel when it renders raw state. */
export function describeAction(action) {
  if (action === null || action === undefined) return '';
  if (typeof action === 'string') return action;
  if (typeof action.detail === 'string' && action.detail.trim() !== '') return action.detail.trim();
  const kind = String(action.kind || 'action');
  const target = action.target ? ` ${action.target}` : '';
  return `${kind}${target}`.trim();
}

/** Percentage of the document scrolled, for compact state payloads. */
export function scrollProgress(snapshot) {
  if (!snapshot) return 0;
  const docHeight = Number(snapshot.docHeight) || 0;
  const viewport = Number(snapshot.viewport && snapshot.viewport.height) || 0;
  if (docHeight <= viewport || viewport <= 0) return 0;
  const max = docHeight - viewport;
  const value = Math.min(1, Math.max(0, (Number(snapshot.scrollY) || 0) / max));
  return Math.round(value * 100);
}
