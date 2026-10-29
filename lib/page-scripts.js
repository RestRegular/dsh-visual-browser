/**
 * In-page scripts.
 *
 * Every function in this module is serialized with `Function.prototype.toString`
 * and evaluated inside the page, so each one must be completely self-contained:
 * no imports, no module-scope identifiers, no closures.
 *
 * The snapshot is the heart of the plugin. It returns a numbered list of the
 * interactive elements that are actually visible in the viewport plus a short
 * text excerpt — never the DOM, never the accessibility dump. That keeps an
 * agent step cheap while still being enough to decide the next action.
 */

/** Expression that reads the compact view. */
export function snapshotExpression(options = {}) {
  return `(${pageSnapshot.toString()})(${JSON.stringify(options)})`;
}

/** Expression that resolves a snapshot ref (or CSS selector) to a click point. */
export function resolveExpression(target = {}) {
  return `(${pageResolve.toString()})(${JSON.stringify(target)})`;
}

/** Expression that focuses an element and prepares a caret for typing. */
export function prepareTypingExpression(target = {}) {
  return `(${pagePrepareTyping.toString()})(${JSON.stringify(target)})`;
}

/** Expression that picks a native <select> option. */
export function selectOptionExpression(target = {}) {
  return `(${pageSelectOption.toString()})(${JSON.stringify(target)})`;
}

/**
 * Expression that writes a native control's value in the format the browser
 * itself expects (date, time, month, week, datetime-local, color, range).
 * Native pickers (the calendar popup, the colour dialog) live outside the
 * page's render surface: they never appear in the picture and CDP input cannot
 * reach them, so the value is written where every page and framework sees it.
 */
export function setNativeValueExpression(target = {}) {
  return `(${pageSetNativeValue.toString()})(${JSON.stringify(target)})`;
}

/** Expression that returns the file input a control may hide, or null. */
export function fileInputExpression(target = {}) {
  return `(${pageFindFileInput.toString()})(${JSON.stringify(target)})`;
}

/** Expression that reads text (element or page). */
export function readTextExpression(options = {}) {
  return `(${pageReadText.toString()})(${JSON.stringify(options)})`;
}

/** Expression that reads the current page facts without a full snapshot. */
export function pageFactsExpression() {
  return `(${pageFacts.toString()})()`;
}

// ---------------------------------------------------------------------------
// Page-side implementations (serialized; keep self-contained)
// ---------------------------------------------------------------------------

function pageSnapshot(options) {
  const maxElements = (options && options.maxElements) || 100;
  const maxNameChars = (options && options.maxNameChars) || 64;
  const maxTextChars = (options && options.maxTextChars) || 320;

  const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  // Never cut through a surrogate pair: half an emoji cannot be encoded as
  // UTF-8, and a model request carrying one is rejected outright (400).
  const cutAt = (text, end) => {
    if (end <= 0) return '';
    if (end >= text.length) return text;
    const last = text.charCodeAt(end - 1);
    return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
  };
  const clip = (value, max) => {
    const text = clean(value);
    return text.length > max ? `${cutAt(text, Math.max(0, max - 1))}…` : text;
  };

  const INTERACTIVE = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
    'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
    'slider', 'spinbutton', 'listbox', 'treeitem', 'gridcell', 'file',
  ]);

  const roleOf = (el) => {
    const explicit = clean(el.getAttribute('role')).toLowerCase();
    if (explicit) return INTERACTIVE.has(explicit) ? explicit : null;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'summary') return 'button';
    if (tag === 'input') {
      const type = clean(el.type || 'text').toLowerCase();
      if (type === 'hidden') return null;
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      if (type === 'file') return 'file';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return null;
  };

  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;

  const isVisible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      if (rect.bottom < -4 || rect.top > viewportHeight + 4 || rect.right < -4 || rect.left > viewportWidth + 4) return false;
      const style = window.getComputedStyle(el);
      if (!style || style.visibility === 'hidden' || style.display === 'none') return false;
      if (Number.parseFloat(style.opacity) === 0) return false;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
      return true;
    } catch {
      return false;
    }
  };

  const labelText = (el) => {
    try {
      if (el.labels && el.labels.length > 0) {
        const joined = clean(Array.from(el.labels).map((label) => label.innerText || label.textContent || '').join(' '));
        if (joined) return joined;
      }
    } catch {
      /* labels are a convenience, never a requirement */
    }
    return '';
  };

  const nameOf = (el, role) => {
    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const joined = clean(
        labelledBy
          .split(/\s+/)
          .map((id) => {
            const node = document.getElementById(id);
            return node ? node.innerText || node.textContent || '' : '';
          })
          .join(' '),
      );
      if (joined) return joined;
    }
    const label = labelText(el);
    if (label) return label;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = clean(el.type).toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'reset') {
        const value = clean(el.value);
        if (value) return value;
      }
    }
    const text = clean(el.innerText || el.textContent);
    if (text) return text;
    const placeholder = clean(el.getAttribute('placeholder'));
    if (placeholder) return placeholder;
    const alt = clean(el.getAttribute('alt'));
    if (alt) return alt;
    const title = clean(el.getAttribute('title'));
    if (title) return title;
    return clean(el.getAttribute('name'));
  };

  const valueOf = (el, role) => {
    const tag = el.tagName.toLowerCase();
    try {
      if (tag === 'select') {
        const option = el.selectedOptions && el.selectedOptions[0];
        return option ? clean(option.textContent) : '';
      }
      if (role === 'checkbox' || role === 'radio' || role === 'switch') return '';
      if (tag === 'input' || tag === 'textarea') {
        if (clean(el.type).toLowerCase() === 'password') return el.value ? '••••••' : '';
        return clean(el.value);
      }
    } catch {
      return '';
    }
    return '';
  };

  const flagsOf = (el, role) => {
    const flags = [];
    try {
      if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') flags.push('disabled');
      if (role === 'checkbox' || role === 'radio' || role === 'switch') {
        if (el.checked === true || el.getAttribute('aria-checked') === 'true') flags.push('checked');
      }
      if (el.required === true) flags.push('required');
      if (el.readOnly === true) flags.push('readonly');
      if (el.getAttribute('aria-expanded') === 'true') flags.push('expanded');
    } catch {
      /* states are best effort */
    }
    return flags;
  };

  // Clear refs from the previous snapshot so a stale ref can never resolve to
  // a different element than the one the model just saw.
  try {
    for (const marked of document.querySelectorAll('[data-dsh-vb-ref]')) marked.removeAttribute('data-dsh-vb-ref');
  } catch {
    /* nothing to clear */
  }

  const selector = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    '[role]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const elements = [];
  let total = 0;
  let nodeList;
  try {
    nodeList = document.querySelectorAll(selector);
  } catch {
    nodeList = [];
  }
  for (const el of nodeList) {
    const role = roleOf(el);
    if (role === null) continue;
    if (!isVisible(el)) continue;
    total += 1;
    if (elements.length >= maxElements) continue;
    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      continue;
    }
    if (!rect) continue;
    const ref = elements.length + 1;
    try {
      el.setAttribute('data-dsh-vb-ref', String(ref));
    } catch {
      /* attribute writes on exotic nodes may fail */
    }
    const entry = {
      ref,
      role,
      name: clip(nameOf(el, role), maxNameChars),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
    const value = valueOf(el, role);
    if (value) entry.value = clip(value, maxNameChars);
    const flags = flagsOf(el, role);
    if (flags.length > 0) entry.state = flags;
    if (role === 'link') {
      const href = clean(el.getAttribute('href'));
      if (href) entry.href = clip(href, 120);
    }
    elements.push(entry);
  }

  const headings = [];
  try {
    for (const heading of document.querySelectorAll('h1,h2,h3')) {
      if (headings.length >= 8) break;
      const text = clean(heading.innerText || heading.textContent);
      if (text) headings.push(clip(text, 60));
    }
  } catch {
    /* headings are optional */
  }

  let text = '';
  try {
    text = clip(document.body ? document.body.innerText : document.documentElement.innerText, maxTextChars);
  } catch {
    text = '';
  }

  let active = null;
  try {
    const el = document.activeElement;
    if (el && el !== document.body && el !== document.documentElement) {
      const role = roleOf(el);
      active = {
        ref: Number(el.getAttribute('data-dsh-vb-ref')) || 0,
        role: role || el.tagName.toLowerCase(),
        name: clip(nameOf(el, role || ''), maxNameChars),
      };
    }
  } catch {
    active = null;
  }

  let docHeight = 0;
  try {
    docHeight = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
    );
  } catch {
    docHeight = 0;
  }

  let frames = 0;
  try {
    frames = document.querySelectorAll('iframe').length;
  } catch {
    frames = 0;
  }

  return {
    url: location.href,
    title: clean(document.title),
    viewport: { width: viewportWidth, height: viewportHeight },
    scrollY: Math.round(window.scrollY || 0),
    docHeight: Math.round(docHeight),
    readyState: document.readyState,
    elements,
    total,
    truncated: total > elements.length,
    headings,
    text,
    active,
    frames,
  };
}

function pageResolve(target) {
  const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  let el = null;
  let reason = 'not-found';
  try {
    if (target && target.ref) {
      el = document.querySelector(`[data-dsh-vb-ref="${Number(target.ref)}"]`);
      if (!el) reason = 'stale-ref';
    } else if (target && target.selector) {
      el = document.querySelector(String(target.selector));
    }
  } catch (error) {
    return { ok: false, reason: 'bad-selector', detail: String(error && error.message ? error.message : error) };
  }
  if (!el) return { ok: false, reason };
  try {
    el.scrollIntoView({ block: 'center', inline: 'center' });
  } catch {
    /* scrolling is best effort */
  }
  let rect;
  try {
    rect = el.getBoundingClientRect();
  } catch {
    return { ok: false, reason: 'detached' };
  }
  const style = window.getComputedStyle(el);
  const hidden =
    !rect ||
    rect.width < 1 ||
    rect.height < 1 ||
    (style && (style.visibility === 'hidden' || style.display === 'none'));
  if (hidden) {
    return {
      ok: false,
      reason: 'not-visible',
      name: clean(el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''),
    };
  }
  return {
    ok: true,
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
    tag: el.tagName.toLowerCase(),
    type: clean(el.getAttribute('type')).toLowerCase(),
    name: clean(
      el.getAttribute('aria-label') ||
        el.innerText ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.value ||
        '',
    ).slice(0, 80),
    href: el.tagName.toLowerCase() === 'a' ? clean(el.getAttribute('href')).slice(0, 160) : '',
    rect: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
  };
}

function pagePrepareTyping(target) {
  const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  let el = null;
  try {
    if (target && target.ref) {
      el = document.querySelector(`[data-dsh-vb-ref="${Number(target.ref)}"]`);
    } else if (target && target.selector) {
      el = document.querySelector(String(target.selector));
    }
  } catch (error) {
    return { ok: false, reason: 'bad-selector', detail: String(error && error.message ? error.message : error) };
  }
  if (!el) return { ok: false, reason: target && target.ref ? 'stale-ref' : 'not-found' };
  try {
    el.scrollIntoView({ block: 'center', inline: 'center' });
  } catch {
    /* best effort */
  }
  let readonly = false;
  let disabled = false;
  try {
    readonly = el.readOnly === true || el.getAttribute('aria-readonly') === 'true';
    disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
  } catch {
    /* ignore */
  }
  if (disabled) return { ok: false, reason: 'disabled' };
  if (readonly) return { ok: false, reason: 'readonly' };
  try {
    el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {
      /* focus refused */
    }
  }
  const mode = (target && target.mode) || 'replace';
  try {
    if (typeof el.setSelectionRange === 'function' && typeof el.value === 'string') {
      const start = mode === 'append' ? el.value.length : 0;
      const end = mode === 'append' ? el.value.length : el.value.length;
      el.setSelectionRange(start, end);
    } else if (mode === 'replace' && el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } catch {
    /* caret positioning is best effort */
  }
  const rect = el.getBoundingClientRect();
  return {
    ok: true,
    tag: el.tagName.toLowerCase(),
    type: clean(el.getAttribute('type')).toLowerCase(),
    name: clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').slice(0, 80),
    valueBefore: typeof el.value === 'string' ? clean(el.value).slice(0, 120) : '',
    focused: document.activeElement === el,
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  };
}

function pageSelectOption(target) {
  let el = null;
  try {
    if (target && target.ref) el = document.querySelector(`[data-dsh-vb-ref="${Number(target.ref)}"]`);
    else if (target && target.selector) el = document.querySelector(String(target.selector));
  } catch (error) {
    return { ok: false, reason: 'bad-selector' };
  }
  if (!el) return { ok: false, reason: 'not-found' };
  if (el.tagName.toLowerCase() !== 'select') return { ok: false, reason: 'not-a-select', tag: el.tagName.toLowerCase() };
  const wanted = String(target && target.value != null ? target.value : '').trim();
  const options = Array.from(el.options || []).map((option) => ({
    value: option.value,
    text: String(option.textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  const match =
    options.find((option) => option.value === wanted) ||
    options.find((option) => option.text === wanted) ||
    options.find((option) => option.text.toLowerCase().includes(wanted.toLowerCase()) && wanted.length > 0);
  if (!match) return { ok: false, reason: 'option-not-found', options: options.slice(0, 20) };
  el.value = match.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, value: match.value, text: match.text };
}

function pageSetNativeValue(target) {
  const clean = (value) => String(value == null ? '' : value).trim();
  const pad = (number) => String(number).padStart(2, '0');
  const int = (value, max) => {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
  };
  const EXPECTED = {
    date: 'YYYY-MM-DD',
    time: 'HH:MM',
    month: 'YYYY-MM',
    week: 'YYYY-Www',
    'datetime-local': 'YYYY-MM-DDTHH:MM',
    color: '#rrggbb',
    range: 'a number between min and max',
  };

  let el = null;
  try {
    if (target && target.ref) el = document.querySelector(`[data-dsh-vb-ref="${Number(target.ref)}"]`);
    else if (target && target.selector) el = document.querySelector(String(target.selector));
  } catch (error) {
    return { ok: false, reason: 'bad-selector' };
  }
  if (!el) return { ok: false, reason: target && target.ref ? 'stale-ref' : 'not-found' };

  const attrType = typeof el.getAttribute === 'function' ? el.getAttribute('type') : '';
  const type = clean(attrType || el.type || '').toLowerCase();
  const expected = EXPECTED[type];
  if (!expected) return { ok: false, reason: 'not-native', type };

  const raw = clean(target && target.value);
  if (raw === '') return { ok: false, reason: 'no-value', type, expected };
  const bad = (detail) => ({ ok: false, reason: 'bad-value', type, expected, detail: detail || '' });

  const dayMatch = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(raw);
  const monthMatch = /(\d{4})\D+(\d{1,2})/.exec(raw);
  const weekMatch = /(\d{4})\D*[Ww]\D*(\d{1,2})/.exec(raw) || /^(\d{4})\D+(\d{1,2})$/.exec(raw);
  const timeMatch = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  const hhmm = () => {
    if (!timeMatch) return null;
    const hour = int(timeMatch[1], 23);
    const minute = int(timeMatch[2], 59);
    if (hour === null || minute === null) return null;
    const second = timeMatch[3] === undefined ? null : int(timeMatch[3], 59);
    return `${pad(hour)}:${pad(minute)}${second === null ? '' : `:${pad(second)}`}`;
  };
  const isoDate = () => {
    if (!dayMatch) return null;
    const month = int(dayMatch[2], 12);
    const day = int(dayMatch[3], 31);
    if (month === null || day === null || month < 1 || day < 1) return null;
    return `${dayMatch[1]}-${pad(month)}-${pad(day)}`;
  };

  let value = '';
  if (type === 'color') {
    let hex = raw.replace(/^#/, '').replace(/[^0-9a-fA-F]/g, '');
    if (hex.length === 3) hex = hex.split('').map((character) => character + character).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return bad('need six hex digits');
    value = `#${hex.toLowerCase()}`;
  } else if (type === 'range') {
    const number = Number(raw.replace(/[^0-9.+-]/g, ''));
    if (!Number.isFinite(number)) return bad();
    const min = Number.parseFloat(el.min);
    const max = Number.parseFloat(el.max);
    const step = Number.parseFloat(el.step);
    let next = number;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    if (Number.isFinite(min) && Number.isFinite(step) && step > 0) {
      next = min + Math.round((next - min) / step) * step;
    }
    value = String(Math.round(next * 1000) / 1000);
  } else if (type === 'date') {
    const date = isoDate();
    if (date === null) return bad();
    value = date;
  } else if (type === 'month') {
    const month = int(monthMatch && monthMatch[2], 12);
    if (!monthMatch || month === null || month < 1) return bad();
    value = `${monthMatch[1]}-${pad(month)}`;
  } else if (type === 'week') {
    const week = int(weekMatch && weekMatch[2], 53);
    if (!weekMatch || week === null || week < 1) return bad();
    value = `${weekMatch[1]}-W${pad(week)}`;
  } else if (type === 'time') {
    const time = hhmm();
    if (time === null) return bad();
    value = time;
  } else {
    // datetime-local: a date is required, the time defaults to midnight.
    const date = isoDate();
    if (date === null) return bad('need a date, for example 2026-10-26 08:30');
    value = `${date}T${hhmm() || '00:00'}`;
  }

  const previous = typeof el.value === 'string' ? el.value : '';
  let applied = false;
  try {
    // The prototype setter is what frameworks patch; writing through it keeps
    // React/Vue controlled inputs in sync with the value a user would pick.
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(el, value);
    else el.value = value;
    applied =
      String(el.value) === value || (type === 'range' && Number(el.value) === Number(value));
  } catch (error) {
    applied = false;
  }
  if (!applied) return bad('the browser rejected that value');
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (error) {
    /* the value is already in place; events are best effort */
  }
  return { ok: true, type, expected, previous, value };
}

function pageFindFileInput(target) {
  const walk = (root) => {
    if (!root || typeof root.querySelectorAll !== 'function') return null;
    let inputs = [];
    try {
      inputs = Array.from(root.querySelectorAll('input[type="file"], input[type=file]'));
    } catch (error) {
      return null;
    }
    for (const input of inputs) {
      if (!input || input.disabled === true) continue;
      return input;
    }
    return null;
  };
  let el = null;
  try {
    if (target && target.ref) el = document.querySelector(`[data-dsh-vb-ref="${Number(target.ref)}"]`);
    else if (target && target.selector) el = document.querySelector(String(target.selector));
  } catch (error) {
    return null;
  }
  try {
    if (el) {
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'input' && String(el.type || '').toLowerCase() === 'file' && el.disabled !== true) return el;
      const nested = walk(el);
      if (nested) return nested;
      if (el.labels) {
        for (const label of el.labels) {
          const found = walk(label);
          if (found) return found;
        }
      }
    }
    return walk(document);
  } catch (error) {
    return null;
  }
}

function pageReadText(options) {
  const clean = (value) => String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // Same guard as the snapshot clip: a half surrogate poisons every later
  // model request, so the cut always lands on a whole character.
  const cutAt = (text, end) => {
    if (end <= 0) return '';
    if (end >= text.length) return text;
    const last = text.charCodeAt(end - 1);
    return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
  };
  const maxChars = (options && options.maxChars) || 4000;
  let el = null;
  try {
    if (options && options.ref) el = document.querySelector(`[data-dsh-vb-ref="${Number(options.ref)}"]`);
    else if (options && options.selector) el = document.querySelector(String(options.selector));
  } catch (error) {
    return { ok: false, reason: 'bad-selector' };
  }
  if (options && (options.ref || options.selector) && !el) {
    return { ok: false, reason: options.ref ? 'stale-ref' : 'not-found' };
  }
  let raw = '';
  let kind = 'page';
  if (el) {
    kind = 'element';
    raw = el.innerText || el.textContent || '';
  } else {
    raw = document.body ? document.body.innerText : document.documentElement.innerText || '';
  }
  const text = clean(raw);
  const facts = {
    url: location.href,
    title: clean(document.title),
  };
  return {
    ok: true,
    kind,
    ...facts,
    length: text.length,
    truncated: text.length > maxChars,
    text: cutAt(text, maxChars),
    href: el && el.tagName && el.tagName.toLowerCase() === 'a' ? clean(el.getAttribute('href')) : '',
    value: el && typeof el.value === 'string' ? cutAt(clean(el.value), 500) : '',
  };
}

function pageFacts() {
  const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  let docHeight = 0;
  try {
    docHeight = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
    );
  } catch {
    docHeight = 0;
  }
  return {
    url: location.href,
    title: clean(document.title),
    readyState: document.readyState,
    scrollY: Math.round(window.scrollY || 0),
    docHeight,
    viewport: { width: window.innerWidth || 0, height: window.innerHeight || 0 },
  };
}
