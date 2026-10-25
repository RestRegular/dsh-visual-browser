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

  const tools = browserTools(manager);
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

  mountRoutes(ctx, manager);
}
