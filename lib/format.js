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
