/** Runs inside the inspected page. No input events or application mutations. */
function inspectPage(input) {
  const nonce = () => [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-');
  const key = '__dshVisualAnnotationIdentity';
  let identity = globalThis[key];
  if (!identity) {
    identity = { revision: nonce(), ids: new WeakMap(), nodes: new Map() };
    Object.defineProperty(globalThis, key, { value: identity, configurable: true });
  }
  const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const selectorFor = (node) => {
    if (node.id) {
      const selector = '#' + CSS.escape(node.id);
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    for (const attribute of ['data-testid', 'data-test', 'name']) {
      const value = node.getAttribute(attribute);
      if (!value) continue;
      const selector = node.localName + '[' + attribute + '=' + JSON.stringify(value) + ']';
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const parts = [];
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      let part = current.localName;
      if (current.parentElement) {
        const siblings = [...current.parentElement.children].filter(other => other.localName === current.localName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      const selector = parts.join(' > ');
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    return parts.join(' > ');
  };
  if (input.action === 'validate') {
    const target = input.target;
    const node = identity.nodes.get(target.node)?.deref();
    if (identity.revision !== target.revision || location.href !== target.url || !node?.isConnected) return { valid: false };
    if (target.kind === 'element') {
      const matches = document.querySelectorAll(target.selector);
      if (matches.length !== 1 || matches[0] !== node) return { valid: false };
    }
    const rect = node.getBoundingClientRect();
    return { valid: true, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  }
  if (location.href !== input.url) return { stale: true };
  const node = document.elementFromPoint(input.x, input.y);
  if (!node) return { empty: true };
  let id = identity.ids.get(node);
  if (!id) {
    id = nonce();
    identity.ids.set(node, id);
    identity.nodes.set(id, new WeakRef(node));
  }
  const region = ['canvas', 'iframe', 'object', 'embed'].includes(node.localName);
  const rect = node.getBoundingClientRect();
  const selector = region ? '' : selectorFor(node);
  return {
    revision: identity.revision, node: id, url: location.href, title: document.title,
    kind: region ? 'region' : 'element', selector,
    matchCount: region ? 0 : document.querySelectorAll(selector).length,
    tag: node.localName, role: node.getAttribute('role') || '', text: label(node),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    point: { x: input.x, y: input.y },
    viewport: { width: innerWidth, height: innerHeight },
  };
}

export function annotationExpression(input) {
  return '(' + inspectPage.toString() + ')(' + JSON.stringify(input) + ')';
}
