/**
 * dsh-visual-browser — Host half.
 *
 * Owns one Chrome process, the five browser tools the Agent drives, and the
 * same-origin API the panel reads. The panel itself is `client.js`.
 */

import { BrowserManager } from './lib/browser.js';
import { mountRoutes } from './lib/routes.js';
import { browserTools } from './lib/tools.js';

export const name = 'dsh-visual-browser';

export function apply(ctx, config = {}) {
  const logger = ctx.logger;
  const manager = new BrowserManager({ config, logger });

  // Chrome must never outlive the plugin: unload kills the process tree.
  ctx.effect(
    () => () => {
      manager.dispose();
    },
    'dsh-visual-browser: browser lifecycle',
  );

  // A workspace owns one tab strip: every Session in it resolves to the same
  // scope, while an ungrouped Session gets a scope of its own. The registry is
  // sampled through `inject` so a cold page boot cannot capture undefined.
  let workspaceRegistry = null;
  try {
    ctx.inject(['workspaceRegistry'], (scoped) => {
      const registry = scoped.get('workspaceRegistry');
      workspaceRegistry = registry;
      scoped.effect(
        () => () => {
          if (workspaceRegistry === registry) workspaceRegistry = null;
        },
        'dsh-visual-browser: workspace registry handle',
      );
    });
  } catch (error) {
    logger?.warn?.(`[visual-browser] workspace registry unavailable: ${error?.message ?? error}`);
  }

  const scopeOfSession = (sessionId) => {
    const id = String(sessionId ?? '').trim();
    if (id === '') return 'default';
    try {
      const list = workspaceRegistry?.list?.() ?? [];
      for (const workspace of list) {
        if (Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(id)) {
          return `workspace:${workspace.id}`;
        }
      }
    } catch {
      /* a registry that is still booting falls back to the session scope */
    }
    return `session:${id}`;
  };

  const tools = browserTools(manager, ctx, { scopeOf: scopeOfSession });
  try {
    ctx.inject(['tools'], (scoped) => {
      for (const definition of tools) {
        try {
          scoped.effect(() => scoped.tools.register(definition), `dsh-visual-browser: ${definition.name}`);
        } catch (error) {
          logger?.warn?.(`[visual-browser] could not register ${definition.name}: ${error?.message ?? error}`);
        }
      }
      logger?.info?.('[visual-browser] browser tools registered');
    });
  } catch (error) {
    logger?.warn?.(`[visual-browser] tool registration failed: ${error?.message ?? error}`);
  }

  mountRoutes(ctx, manager, { resolveScope: scopeOfSession });
}
