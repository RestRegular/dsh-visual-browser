/**
 * Client half of dsh-visual-browser.
 *
 * A tab type for the right Sidebar: a live picture of the page Chrome is
 * showing, a guide card under the built-in Browser entry that opens it, and a
 * collapsible operation log. Pictures arrive as one long MJPEG response that the
 * <img> element decodes natively; pointer, wheel and keyboard events go out in
 * animation-frame batches, so a click costs one round trip instead of a
 * screenshot. The whole file is an IIFE because every client bundle shares one
 * global lexical scope inside the page.
 */
(function () {
  'use strict';

  var MODULE_ID = '@restregular/dsh-visual-browser';
  var API = '/visual-browser/api';
  var NS = 'dsh-visual-browser';
  var KIND = 'visual-browser';
  var BROWSER_TYPE_ID = '@deepseek-ai/dsh-client-ui-sidebar-browser';
  var BROWSER_KIND = 'browser';

  // Chromium refuses `keepalive` on a non-http(s) scheme: inside Electron the
  // panel runs on dsh-app://, where such a request fails before it reaches the
  // network. Plain POSTs work there, so the flag is only used where it is safe.
  var KEEPALIVE_OK = typeof location !== 'undefined' && /^https?:$/i.test(String(location.protocol));

  var DICT = {
    zh: {
      'panel.title': '可视化浏览器',
      'panel.subtitle': '实时操作 Chrome',
      'guide.title': '可视化浏览器',
      'guide.description': '在这里实时操作 Chrome',
      'guide.open': '在可视化浏览器中打开',
      'state.running': '运行中',
      'state.starting': '启动中',
      'state.stopped': '未启动',
      'state.offline': '宿主未连接',
      'action.start': '启动',
      'action.stop': '关闭',
      'action.back': '后退',
      'action.forward': '前进',
      'action.reload': '刷新页面',
      'action.open': '打开',
      'action.reconnect': '重新连接画面',
      'tab.new': '新建页面',
      'tab.close': '关闭这个页面',
      'tab.untitled': '新页面',
      'url.placeholder': '输入网址，例如 example.com',
      'hint.interactive': '直接用鼠标操作画面；点一下画面后可用键盘输入',
      'hint.headless': '无头浏览器：窗口不可见，画面只在这里',
      'empty.title': '浏览器还没启动',
      'empty.desc': '在上方输入网址打开，或者让 Agent 用 browser_open 打开一个页面；之后每次操作都会在这里实时显示。',
      'connecting': '正在连接画面…',
      'timeline.title': '操作记录',
      'timeline.empty': '还没有操作。Agent 的点击、输入与你自己的操作都会记录在这里。',
      'timeline.count': '条',
      'timeline.expand': '展开操作记录',
      'timeline.resize': '上下拖动调整操作记录高度，双击复位',
      'timeline.collapse': '折叠操作记录',
      'error.offline': '连不上宿主路由（/visual-browser/api），请确认插件已启用且宿主仍在运行。',
      'error.frame': '画面流中断，正在重连…',
      'error.input': '输入没能送到浏览器：',
      'kind.start': '启动',
      'kind.close': '关闭',
      'kind.open': '打开',
      'kind.click': '点击',
      'kind.type': '输入',
      'kind.key': '按键',
      'kind.hover': '悬停',
      'kind.scroll': '滚动',
      'kind.select': '选择',
      'kind.back': '后退',
      'kind.forward': '前进',
      'kind.reload': '刷新',
      'kind.wait': '等待',
      'kind.snapshot': '读取',
      'kind.screenshot': '截图',
      'kind.dialog': '对话框',
      'kind.user-click': '你点击',
      'kind.user-drag': '你拖动',
      'kind.user-scroll': '你滚动',
      'kind.user-key': '你按键',
      'kind.user-type': '你输入',
      'busy': '处理中…',
    },
    en: {
      'panel.title': 'Visual Browser',
      'panel.subtitle': 'Drive Chrome live',
      'guide.title': 'Visual Browser',
      'guide.description': 'Drive Chrome here, live',
      'guide.open': 'Open in the Visual Browser',
      'state.running': 'Running',
      'state.starting': 'Starting',
      'state.stopped': 'Stopped',
      'state.offline': 'Host offline',
      'action.start': 'Start',
      'action.stop': 'Stop',
      'action.back': 'Back',
      'action.forward': 'Forward',
      'action.reload': 'Reload page',
      'action.open': 'Open',
      'action.reconnect': 'Reconnect the picture',
      'tab.new': 'New page',
      'tab.close': 'Close this page',
      'tab.untitled': 'New page',
      'url.placeholder': 'Enter a URL, for example example.com',
      'hint.interactive': 'Click straight into the picture; click once to type with the keyboard',
      'hint.headless': 'Headless browser: no window to watch, the picture here is the browser',
      'empty.title': 'The browser is not running yet',
      'empty.desc': 'Open a URL above, or let the Agent call browser_open. Everything that happens then shows up here live.',
      'connecting': 'Connecting the picture…',
      'timeline.title': 'Actions',
      'timeline.empty': 'No actions yet. Agent clicks, typing, and your own gestures are listed here.',
      'timeline.count': 'items',
      'timeline.expand': 'Expand the action log',
      'timeline.resize': 'Drag up or down to resize the action log; double-click to reset',
      'timeline.collapse': 'Collapse the action log',
      'error.offline': 'Cannot reach the host route (/visual-browser/api). Check that the plugin is enabled and the host is running.',
      'error.frame': 'The picture stream dropped; reconnecting…',
      'error.input': 'Input never reached the browser:',
      'kind.start': 'start',
      'kind.close': 'close',
      'kind.open': 'open',
      'kind.click': 'click',
      'kind.type': 'type',
      'kind.key': 'key',
      'kind.hover': 'hover',
      'kind.scroll': 'scroll',
      'kind.select': 'select',
      'kind.back': 'back',
      'kind.forward': 'forward',
      'kind.reload': 'reload',
      'kind.wait': 'wait',
      'kind.snapshot': 'read',
      'kind.screenshot': 'shot',
      'kind.dialog': 'dialog',
      'kind.user-click': 'you clicked',
      'kind.user-drag': 'you dragged',
      'kind.user-scroll': 'you scrolled',
      'kind.user-key': 'you pressed',
      'kind.user-type': 'you typed',
      'busy': 'Working…',
    },
  };

  var CSS = [
    // ---- tab body -------------------------------------------------------
    '.dvb-root{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
    '.dvb-bar{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px 6px;min-width:0}',
    '.dvb-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary,var(--dsw-alias-border-l3))}',
    '.dvb-dot[data-on="true"]{background:var(--dsw-alias-state-success-primary)}',
    '.dvb-dot[data-error="true"]{background:var(--dsw-alias-state-error-primary)}',
    '.dvb-spacer{flex:1 1 auto;min-width:6px}',
    '.dvb-status{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dvb-title{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.dvb-tools{display:flex;align-items:center;gap:2px;flex:none}',
    '.dvb-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;min-width:26px;padding:0 7px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px}',
    '.dvb-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
    '.dvb-btn:disabled{opacity:.4;cursor:default}',
    '.dvb-btn[data-variant="primary"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);padding:0 10px}',
    '.dvb-btn[data-variant="primary"]:hover:not(:disabled){background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);filter:brightness(1.06)}',
    '.dvb-tabs{flex:none;display:flex;gap:4px;padding:2px 8px 6px;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}',
    '.dvb-tab{flex:none;display:flex;align-items:center;gap:2px;height:24px;padding:0 3px 0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;max-width:180px;min-width:0}',
    '.dvb-tab[data-current="true"]{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
    '.dvb-tab-label{display:block;max-width:140px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0}',
    '.dvb-tab-close{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;cursor:pointer;padding:0}',
    '.dvb-tab-close:hover{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}',
    '.dvb-addr{flex:none;display:flex;align-items:center;gap:6px;padding:0 10px 8px;min-width:0}',
    '.dvb-input{flex:1 1 auto;min-width:0;height:28px;padding:0 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
    '.dvb-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
    '.dvb-input:focus{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px}',
    // ---- stage ----------------------------------------------------------
    '.dvb-stage{position:relative;flex:1 1 auto;min-height:120px;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:8px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);outline:none}',
    '.dvb-stage[data-focus="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dvb-live{display:block;max-width:100%;max-height:100%;width:auto;height:auto;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);touch-action:none;user-select:none;-webkit-user-drag:none;cursor:none}',
    '.dvb-live[data-busy="true"]{cursor:progress}',
    '.dvb-cursor{position:absolute;left:0;top:0;width:18px;height:22px;margin:-1px 0 0 -2px;pointer-events:none;opacity:0;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}',
    '.dvb-cursor[data-visible="true"]{opacity:1}',
    '.dvb-ripple{position:absolute;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:var(--dsw-alias-brand-primary);opacity:0;pointer-events:none;will-change:transform,opacity}',
    '.dvb-veil{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent);pointer-events:none}',
    '.dvb-retry{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 11px;border-radius:13px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;white-space:nowrap;cursor:pointer;pointer-events:auto}',
    '.dvb-retry:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dvb-inputerr{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);max-width:calc(100% - 24px);padding:4px 10px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1.35;text-align:center;pointer-events:none}',
    '.dvb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:20px 24px;color:var(--dsw-alias-label-secondary)}',
    '.dvb-empty-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}',
    '.dvb-empty-desc{max-width:340px;font-size:12px}',
    '.dvb-hint{padding:5px 10px 7px;font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;gap:8px;flex-wrap:wrap;flex:none}',
    // ---- log ------------------------------------------------------------
    '.dvb-log{flex:0 0 auto;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base)}',
    '.dvb-log-head{display:flex;align-items:center;gap:6px;width:100%;padding:7px 10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}',
    '.dvb-log-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dvb-log-chevron{display:inline-flex;transition:transform .16s ease}',
    '.dvb-log[data-open="true"] .dvb-log-chevron{transform:rotate(90deg)}',
    '.dvb-log-title{font-weight:600;color:var(--dsw-alias-label-secondary)}',
    '.dvb-log-count{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}',
    '.dvb-log-body{overflow-y:auto;overscroll-behavior:contain;max-height:min(44vh,320px);min-height:0;padding:0 6px 8px;display:flex;flex-direction:column;gap:1px}',
'.dvb-log[data-sized="true"] .dvb-log-body{max-height:none;height:var(--dvb-log-h,200px)}',
'.dvb-split{flex:none;display:flex;align-items:center;justify-content:center;height:11px;margin:-1px 0;padding:0;border:0;background:transparent;cursor:ns-resize;touch-action:none}',
'.dvb-split::before{content:"";width:36px;height:3px;border-radius:2px;background:var(--dsw-alias-border-l2);transition:background .12s ease}',
'.dvb-split:hover::before,.dvb-split[data-active="true"]::before{background:var(--dsw-alias-brand-primary)}',
'.dvb-split:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-3px;border-radius:6px}',
    '.dvb-log-empty{padding:3px 6px 10px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
    '.dvb-row{display:flex;align-items:baseline;gap:6px;padding:4px 6px;border-radius:6px;font-size:12px;min-width:0}',
    '.dvb-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dvb-row-time{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);flex:none;width:52px;font-size:11px}',
    '.dvb-row-kind{flex:none;padding:0 5px;border-radius:4px;border:.5px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.6;white-space:nowrap}',
    '.dvb-row-kind[data-kind^="user"]{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}',
    '.dvb-row-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
    '.dvb-row-text[data-error="true"]{color:var(--dsw-alias-state-error-primary)}',
    '.dvb-error{margin:0 10px 8px;padding:6px 9px;border-radius:7px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:11.5px}',
    // ---- guide cards ----------------------------------------------------
    '.dvb-guide{display:flex;flex-direction:column;width:100%;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xl,16px);background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
    '.dvb-guide-card,.dvb-guide-extra{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;padding:12px 16px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}',
    '.dvb-guide-card{padding-bottom:10px}',
    '.dvb-guide-extra{padding-top:10px;padding-bottom:11px}',
    '.dvb-guide-card:hover,.dvb-guide-extra:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dvb-guide-glyph{display:flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;color:var(--dsw-alias-label-secondary)}',
    '.dvb-guide-extra-glyph{display:flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border-radius:7px;background:var(--dsw-alias-state-business-tertiary,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}',
    '.dvb-guide-text{display:flex;flex-direction:column;flex:1;min-width:0;gap:2px}',
    '.dvb-guide-title{font-size:13.5px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dvb-guide-desc{font-size:10.5px;line-height:1.35;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dvb-guide-sep{height:1px;margin:0 14px;background:var(--dsw-alias-border-l3)}',
    '.dvb-guide-card>svg,.dvb-guide-extra>svg{color:var(--dsw-alias-label-tertiary);flex:none}',
  ].join('\n');

  window.__ModuleLoader__.load({
    id: MODULE_ID,
    factory(require) {
      var React = require('react');
      var h = React.createElement;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useRef = React.useRef;
      var useCallback = React.useCallback;
      var useMemo = React.useMemo;

      var translateCurrent = function (key) {
        var table = DICT.zh;
        return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
      };

      function bindLocale(ctx) {
        var locale = ctx.get('locale');
        if (!locale || typeof locale.register !== 'function') return;
        try {
          var dispose = locale.register(NS, DICT);
          if (typeof locale.bind === 'function') {
            translateCurrent = locale.bind(NS);
          } else {
            translateCurrent = function (key) {
              var table = DICT.zh;
              return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
            };
          }
          ctx.effect(
            function () {
              return function () {
                translateCurrent = function (key) {
                  return key;
                };
                try {
                  if (typeof dispose === 'function') dispose();
                } catch {
                  /* removing a dictionary must never break unload */
                }
              };
            },
            'dsh-visual-browser: dictionaries',
          );
        } catch (error) {
          console.warn('[dsh-visual-browser] locale registration failed:', error && error.message ? error.message : error);
        }
      }

      function installStyles(ctx) {
        ctx.effect(function () {
          var style = document.createElement('style');
          style.setAttribute('data-plugin', MODULE_ID);
          style.textContent = CSS;
          document.head.appendChild(style);
          return function () {
            try {
              style.remove();
            } catch {
              /* already gone */
            }
          };
        }, 'dsh-visual-browser: styles');
      }

      // -------------------------------------------------------------------
      // Host API
      // -------------------------------------------------------------------

      // Every request settles: a socket that a sleep/resume or a host restart
      // black-holed used to leave the caller waiting forever, which froze the
      // panel until a page refresh.
      var REQUEST_TIMEOUT_MS = 8000;
      // The poll is a tiny local JSON read: a slow answer means a dead socket,
      // not a slow host, so it gives up sooner than the action requests.
      var POLL_TIMEOUT_MS = 3500;

      async function requestJson(path, options) {
        var init = { method: (options && options.method) || 'GET', headers: {} };
        if (options && options.body !== undefined) {
          init.headers['content-type'] = 'application/json';
          init.body = JSON.stringify(options.body);
        }
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        if (controller !== null) init.signal = controller.signal;
        var timer = window.setTimeout(function () {
          if (controller !== null) {
            try {
              controller.abort();
            } catch {
              /* already finished */
            }
          }
        }, (options && options.timeoutMs) || REQUEST_TIMEOUT_MS);
        try {
          var response = await fetch(API + path, init);
          var text = await response.text();
          var data = null;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = null;
            }
          }
          if (!response.ok) {
            var message = data && data.error && data.error.message ? data.error.message : 'HTTP ' + response.status;
            throw new Error(message);
          }
          return data || {};
        } finally {
          window.clearTimeout(timer);
        }
      }

      function pad(value) {
        return value < 10 ? '0' + value : String(value);
      }

      function clock(ts) {
        var date = new Date(ts || Date.now());
        return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
      }

      function shortUrl(value) {
        return String(value || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      }

      /**
       * Input batches: everything the user does is queued and flushed once per
       * animation frame as a single ordered POST. Moves and wheel deltas are
       * folded together, so a fast flick is one request instead of thirty.
       */
      function createSender(options) {
        var onFailure = options && typeof options.onFailure === 'function' ? options.onFailure : null;
        var onSuccess = options && typeof options.onSuccess === 'function' ? options.onSuccess : null;
        var queue = [];
        var inFlight = false;
        var frame = 0;
        var disposed = false;

        var compact = function (events) {
          var kept = [];
          for (var index = 0; index < events.length; index += 1) {
            var event = events[index];
            var last = kept.length > 0 ? kept[kept.length - 1] : null;
            if (last !== null && event.t === 'pointer' && event.type === 'move' && last.t === 'pointer' && last.type === 'move') {
              kept[kept.length - 1] = event;
              continue;
            }
            if (last !== null && event.t === 'wheel' && last.t === 'wheel') {
              last.dx = (last.dx || 0) + (event.dx || 0);
              last.dy = (last.dy || 0) + (event.dy || 0);
              last.x = event.x;
              last.y = event.y;
              continue;
            }
            kept.push(event);
          }
          return kept.slice(0, 120);
        };

        var inFlightTimeout = 8000;
        // A batch that has been in flight this long is on a dead socket: give up
        // on it rather than hold every later click behind it.
        var staleAfter = 1200;
        var activeRequest = 0;
        var inFlightSince = 0;

        var flush = function () {
          frame = 0;
          if (disposed) return;
          if (inFlight && Date.now() - inFlightSince > staleAfter) {
            activeRequest = 0;
            inFlight = false;
          }
          if (inFlight) return;
          if (queue.length === 0) return;
          var batch = compact(queue);
          queue = [];
          if (batch.length === 0) return;
          var requestId = ++activeRequest;
          inFlight = true;
          inFlightSince = Date.now();
          var controller = typeof AbortController === 'function' ? new AbortController() : null;
          var settled = false;
          var done = function (failure) {
            if (settled) return;
            settled = true;
            if (requestId !== activeRequest) return;
            window.clearTimeout(watchdog);
            inFlight = false;
            // A silently dropped batch is the worst outcome: the pointer shows a
            // press, the record shows nothing, and the panel looks dead. Say so.
            if (failure && onFailure !== null) onFailure(failure);
            if (!failure && onSuccess !== null) onSuccess();
            if (disposed) return;
            if (queue.length > 0 && frame === 0) frame = window.requestAnimationFrame(flush);
          };
          // A request that never answers must not wedge every later click.
          var watchdog = window.setTimeout(function () {
            try {
              if (controller !== null) controller.abort();
            } catch {
              /* already settled */
            }
            done('timed out');
          }, inFlightTimeout);
          var payload = JSON.stringify({ events: batch });
          var post = function (keepalive) {
            return fetch(API + '/input', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: payload,
              ...(keepalive ? { keepalive: true } : {}),
              ...(controller !== null ? { signal: controller.signal } : {}),
            });
          };
          // keepalive only buys "still delivered while the page unloads"; a
          // scheme that rejects it would cost every click instead, so the plain
          // POST is the fallback rather than the other way round.
          var request = KEEPALIVE_OK
            ? post(true).catch(function () {
                return post(false);
              })
            : post(false);
          request
            .then(
              function (response) {
                if (response.ok) return undefined;
                return response.text().then(
                  function (text) {
                    var detail = '';
                    try {
                      var parsed = JSON.parse(text);
                      detail = parsed && parsed.error && parsed.error.message ? parsed.error.message : '';
                    } catch {
                      /* not JSON: the status alone has to do */
                    }
                    throw new Error(detail || 'HTTP ' + response.status);
                  },
                  function () {
                    throw new Error('HTTP ' + response.status);
                  },
                );
              },
              function (error) {
                throw error instanceof Error ? error : new Error(String(error));
              },
            )
            .then(
              function () {
                done(null);
              },
              function (error) {
                done(error && error.message ? error.message : String(error));
              },
            );
        };

        return {
          send: function (event) {
            if (disposed) return;
            queue.push(event);
            // Never let a stalled connection grow an unbounded backlog: drop the
            // oldest moves and wheel ticks, which are only positions and deltas.
            for (var index = 0; index < queue.length && queue.length > 480; index += 1) {
              if (queue[index].t === 'wheel' || (queue[index].t === 'pointer' && queue[index].type === 'move')) {
                queue.splice(index, 1);
                index -= 1;
              }
            }
            if (frame !== 0) return;
            frame = window.requestAnimationFrame(flush);
          },
          flushNow: function () {
            if (frame !== 0) {
              window.cancelAnimationFrame(frame);
              frame = 0;
            }
            flush();
          },
          dispose: function () {
            disposed = true;
            queue = [];
            if (frame !== 0) window.cancelAnimationFrame(frame);
            frame = 0;
          },
        };
      }

      // -------------------------------------------------------------------
      // Icons
      // -------------------------------------------------------------------

      function svg(props, paths) {
        return h(
          'svg',
          {
            width: props.size || 16,
            height: props.size || 16,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: props.strokeWidth || 1.9,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            focusable: false,
          },
          paths,
        );
      }

      function icon(name, size) {
        switch (name) {
          case 'play':
            return svg({ size: size }, [h('path', { key: 'a', d: 'M8 5.5v13l11-6.5-11-6.5Z', fill: 'currentColor', stroke: 'none' })]);
          case 'stop':
            return svg({ size: size }, [h('rect', { key: 'a', x: 6, y: 6, width: 12, height: 12, rx: 2.5, fill: 'currentColor', stroke: 'none' })]);
          case 'back':
            return svg({ size: size }, [h('path', { key: 'a', d: 'M14.5 6.5 8 12l6.5 5.5' })]);
          case 'forward':
            return svg({ size: size }, [h('path', { key: 'a', d: 'M9.5 6.5 16 12l-6.5 5.5' })]);
          case 'reload':
            return svg({ size: size }, [
              h('path', { key: 'a', d: 'M19 12a7 7 0 1 1-2.1-5' }),
              h('path', { key: 'b', d: 'M19 4.5V9h-4.5' }),
            ]);
          case 'plus':
            return svg({ size: size }, [
              h('path', { key: 'a', d: 'M12 5.5v13' }),
              h('path', { key: 'b', d: 'M5.5 12h13' }),
            ]);
          case 'chevron':
            return svg({ size: size || 12 }, [h('path', { key: 'a', d: 'M9.5 6l6 6-6 6' })]);
          case 'globe':
            return svg({ size: size || 24, strokeWidth: 1.6 }, [
              h('circle', { key: 'a', cx: 12, cy: 12, r: 8.5 }),
              h('path', { key: 'b', d: 'M3.5 12h17' }),
              h('path', { key: 'c', d: 'M12 3.5c2.6 2.4 4 5.4 4 8.5s-1.4 6.1-4 8.5c-2.6-2.4-4-5.4-4-8.5s1.4-6.1 4-8.5Z' }),
            ]);
          default:
            return svg({ size: size }, []);
        }
      }

      function BrowserGlyph(props) {
        return svg({ size: (props && props.size) || 18, strokeWidth: 1.8 }, [
          h('rect', { key: 'a', x: 3, y: 4.5, width: 18, height: 15, rx: 2.6 }),
          h('path', { key: 'b', d: 'M3 8.5h18' }),
          h('circle', { key: 'c', cx: 12, cy: 13.6, r: 2.2, fill: 'currentColor', stroke: 'none' }),
        ]);
      }

      // -------------------------------------------------------------------
      // Guide cards
      // -------------------------------------------------------------------

      /** The right-Sidebar controller, kept in step by `apply` for guide cards. */
      var sidebarRightOpen = null;

      function openTabFrom(info, kind) {
        if (info && info.tab && info.tab.actions && typeof info.tab.actions.openTab === 'function') {
          try {
            info.tab.actions.openTab(kind, { replaceTab: true });
            return;
          } catch (error) {
            console.warn('[dsh-visual-browser] tab.actions.openTab failed:', error && error.message ? error.message : error);
          }
        }
        if (typeof sidebarRightOpen === 'function') {
          try {
            sidebarRightOpen(kind, { replaceTab: true });
            return;
          } catch (error) {
            console.warn('[dsh-visual-browser] sidebarRight.openTab failed:', error && error.message ? error.message : error);
            return;
          }
        }
        console.warn('[dsh-visual-browser] no way to open tab', kind);
      }

      /** The card that carries our own entry when the built-in Browser is absent. */
      function VisualBrowserGuideCard(props) {
        var t = props.t || translateCurrent;
        var info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null;
        return h(
          'div',
          { className: 'dvb-guide', 'data-dvb-guide': 'own' },
          h(
            'button',
            {
              type: 'button',
              className: 'dvb-guide-card',
              'data-sidebar-right-guide-entry': props.kind || KIND,
              onClick: function () {
                openTabFrom(info, props.kind || KIND);
              },
            },
            h('span', { className: 'dvb-guide-glyph' }, h(BrowserGlyph, { size: 24 })),
            h(
              'span',
              { className: 'dvb-guide-text' },
              h('span', { className: 'dvb-guide-title' }, props.title || t('guide.title')),
              h('span', { className: 'dvb-guide-desc' }, props.description || t('guide.description')),
            ),
            icon('chevron', 14),
          ),
        );
      }

      /**
       * The built-in Browser card, with one extra row under it: this is what
       * puts a door to the Visual Browser directly beneath the system browser.
       */
      function BrowserExtraGuideCard(props) {
        var t = props.t || translateCurrent;
        var info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null;
        return h(
          'div',
          { className: 'dvb-guide', 'data-dvb-guide': 'browser' },
          h(
            'button',
            {
              type: 'button',
              className: 'dvb-guide-card',
              'data-sidebar-right-guide-entry': props.kind || BROWSER_KIND,
              onClick: function () {
                openTabFrom(info, props.kind || BROWSER_KIND);
              },
            },
            h('span', { className: 'dvb-guide-glyph' }, icon('globe', 24)),
            h(
              'span',
              { className: 'dvb-guide-text' },
              h('span', { className: 'dvb-guide-title' }, props.title || t('panel.title')),
              props.description ? h('span', { className: 'dvb-guide-desc' }, props.description) : null,
            ),
            icon('chevron', 14),
          ),
          h('div', { className: 'dvb-guide-sep', role: 'none' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dvb-guide-extra',
              title: t('guide.open'),
              onClick: function () {
                openTabFrom(info, KIND);
              },
            },
            h('span', { className: 'dvb-guide-extra-glyph' }, h(BrowserGlyph, { size: 16 })),
            h(
              'span',
              { className: 'dvb-guide-text' },
              h('span', { className: 'dvb-guide-title' }, t('guide.title')),
              h('span', { className: 'dvb-guide-desc' }, t('guide.description')),
            ),
            icon('chevron', 14),
          ),
        );
      }

      // -------------------------------------------------------------------
      // Tab body
      // -------------------------------------------------------------------

      /**
       * Height of the resizable action log. The panel keeps the choice in
       * localStorage so a chosen split survives reopening the tab.
       */
      var LOG_HEIGHT_KEY = 'dsh.visual-browser.log-height.v1';
      var LOG_MIN_HEIGHT = 96;
      var LOG_STAGE_RESERVE = 220;

      function readStoredLogHeight() {
        try {
          var raw = window.localStorage.getItem(LOG_HEIGHT_KEY);
          var value = Number(raw);
          if (!Number.isFinite(value) || value < LOG_MIN_HEIGHT) return null;
          return Math.round(value);
        } catch {
          return null;
        }
      }

      function storeLogHeight(value) {
        try {
          if (value === null) window.localStorage.removeItem(LOG_HEIGHT_KEY);
          else window.localStorage.setItem(LOG_HEIGHT_KEY, String(Math.round(value)));
        } catch {
          /* storage can be unavailable; the choice just does not persist */
        }
      }

      var EMPTY_STATE = {
        running: false,
        starting: false,
        url: '',
        title: '',
        viewport: { width: 1280, height: 800 },
        startedAt: 0,
        actionSeq: 0,
        actions: [],
        allowUserControl: true,
        lastError: '',
      };

      var MODIFIER_MASK = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

      function modifierMask(event) {
        var mask = 0;
        if (event.altKey) mask |= MODIFIER_MASK.Alt;
        if (event.ctrlKey) mask |= MODIFIER_MASK.Control;
        if (event.metaKey) mask |= MODIFIER_MASK.Meta;
        if (event.shiftKey) mask |= MODIFIER_MASK.Shift;
        return mask;
      }

      function typedText(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return '';
        if (typeof event.key !== 'string' || event.key.length !== 1) return '';
        return event.key;
      }

      function BrowserTab(props) {
        var ctx = props.ctx;
        var t = props.t || translateCurrent;
        var [tick, setTick] = useState(0);
        var [state, setState] = useState(EMPTY_STATE);
        var [reachable, setReachable] = useState(true);
        var [busy, setBusy] = useState('');
        var [error, setError] = useState('');
        var [draft, setDraft] = useState('');
        var [dirty, setDirty] = useState(false);
        var [logOpen, setLogOpen] = useState(true);
        var [logHeight, setLogHeight] = useState(readStoredLogHeight);
        var [resizing, setResizing] = useState(false);
        var [live, setLive] = useState(false);
        var [streamRetry, setStreamRetry] = useState(0);
        var [retrying, setRetrying] = useState(false);
        var [focused, setFocused] = useState(false);

        var rootRef = useRef(null);
        var logRef = useRef(null);
        var logBodyRef = useRef(null);
        var splitRef = useRef(null);
        var tabsRef = useRef(null);
        var addrRef = useRef(null);
        var stageRef = useRef(null);
        var canvasRef = useRef(null);
        var liveRef = useRef(false);
        var lastFrameAtRef = useRef(0);
        var cursorRef = useRef(null);
        var rippleRef = useRef(null);
        var pointerRef = useRef({ down: false, id: 0, x: 0, y: 0, moved: 0, clicks: 1, lastUpAt: 0, lastUpX: 0, lastUpY: 0, button: 0 });
        var pointerUpRef = useRef(null);
        var stateJsonRef = useRef('');
        // Input trouble is shown as an absolutely positioned pill inside the
        // picture, never as a new row: a row would reflow the layout under the
        // pointer, and a click that was already aimed would land somewhere else.
        var [inputError, setInputError] = useState('');
        var inputErrorTimerRef = useRef(0);
        var tRef = useRef(t);
        tRef.current = t;
        var sender = useMemo(function () {
          return createSender({
            onFailure: function (message) {
              setInputError(tRef.current('error.input') + ' ' + message);
              if (inputErrorTimerRef.current !== 0) window.clearTimeout(inputErrorTimerRef.current);
              inputErrorTimerRef.current = window.setTimeout(function () {
                inputErrorTimerRef.current = 0;
                setInputError('');
              }, 8000);
            },
            onSuccess: function () {
              if (inputErrorTimerRef.current !== 0) {
                window.clearTimeout(inputErrorTimerRef.current);
                inputErrorTimerRef.current = 0;
                setInputError('');
              }
            },
          });
        }, []);

        useEffect(
          function () {
            return function () {
              if (inputErrorTimerRef.current !== 0) window.clearTimeout(inputErrorTimerRef.current);
            };
          },
          [],
        );

        useEffect(function () {
          return function () {
            sender.dispose();
          };
        }, [sender]);

        // Re-render on language change only.
        useEffect(function () {
          var locale = ctx.get('locale');
          if (!locale || typeof locale.subscribe !== 'function') return undefined;
          return locale.subscribe(function () {
            setTick(function (value) {
              return value + 1;
            });
          });
        }, [ctx]);

        // State poll: identity-compare the JSON so an idle panel never re-renders.
        // A failed or stalled round always schedules the next one, so the panel
        // can never freeze on a dead connection.
        useEffect(
          function () {
            var cancelled = false;
            var timer = null;
            var misses = 0;
            var poll = async function () {
              try {
                var data = await requestJson('/state', { timeoutMs: POLL_TIMEOUT_MS });
                if (cancelled) return;
                misses = 0;
                setReachable(true);
                if (data.state) {
                  var next = JSON.stringify(data.state);
                  if (next !== stateJsonRef.current) {
                    stateJsonRef.current = next;
                    setState(data.state);
                  }
                }
              } catch {
                if (cancelled) return;
                misses += 1;
                setReachable(false);
              }
              if (cancelled) return;
              var delay = document.visibilityState === 'hidden' ? 4000 : misses === 0 ? 900 : Math.min(5000, 600 * misses);
              timer = window.setTimeout(poll, delay);
            };
            poll();
            return function () {
              cancelled = true;
              if (timer) window.clearTimeout(timer);
            };
          },
          [],
        );

        useEffect(
          function () {
            if (!dirty) setDraft(state.url && state.url !== 'about:blank' ? state.url : '');
          },
          [state.url, dirty],
        );

        // A new browser incarnation means a new stream.
        useEffect(
          function () {
            liveRef.current = false;
            setLive(false);
            setRetrying(false);
          },
          [state.startedAt, state.running],
        );

        /**
         * The live picture: one long binary response, each frame a length-
         * prefixed JPEG decoded off the main thread and painted on a canvas.
         * Decoding keeps at most one frame queued, so a burst never builds a
         * backlog of stale pictures.
         */
        useEffect(
          function () {
            if (!state.running) return undefined;
            var cancelled = false;
            var controller = new AbortController();
            var reader = null;
            var buffer = new Uint8Array(0);
            var pendingFrame = null;
            var decoding = false;
            // If the response never yields a frame (a host that went away mid
            // handshake, a proxy that black-holes the socket), reconnect instead
            // of showing "connecting" forever.
            var connectTimer = window.setTimeout(function () {
              connectTimer = 0;
              if (cancelled || liveRef.current) return;
              try {
                controller.abort();
              } catch {
                /* already done */
              }
            }, 9000);

            var draw = async function (jpeg) {
              var bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }));
              var canvas = canvasRef.current;
              if (canvas !== null) {
                if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                }
                var context = canvas.getContext('2d');
                if (context) context.drawImage(bitmap, 0, 0);
                lastFrameAtRef.current = Date.now();
                if (connectTimer !== 0) {
                  window.clearTimeout(connectTimer);
                  connectTimer = 0;
                }
                if (!liveRef.current) {
                  liveRef.current = true;
                  setLive(true);
                  setRetrying(false);
                }
              }
              bitmap.close();
            };

            var drain = async function () {
              if (decoding) return;
              decoding = true;
              try {
                while (!cancelled && pendingFrame !== null) {
                  var jpeg = pendingFrame;
                  pendingFrame = null;
                  try {
                    await draw(jpeg);
                  } catch {
                    /* a frame that will not decode is skipped */
                  }
                }
              } finally {
                decoding = false;
              }
            };

            var pump = async function () {
              var response = await fetch(API + '/stream?r=' + streamRetry, {
                signal: controller.signal,
                cache: 'no-store',
              });
              if (!response.ok || !response.body) throw new Error('stream ' + response.status);
              reader = response.body.getReader();
              for (;;) {
                var step = await reader.read();
                if (step.done) break;
                var chunk = step.value;
                var joined = new Uint8Array(buffer.length + chunk.length);
                joined.set(buffer, 0);
                joined.set(chunk, buffer.length);
                buffer = joined;
                while (buffer.length >= 8) {
                  var view = new DataView(buffer.buffer, buffer.byteOffset, 8);
                  var length = view.getUint32(0, true);
                  if (length === 0 || length > 8 * 1024 * 1024) {
                    buffer = new Uint8Array(0);
                    break;
                  }
                  if (buffer.length < 8 + length) break;
                  pendingFrame = buffer.slice(8, 8 + length);
                  buffer = buffer.slice(8 + length);
                  void drain();
                }
              }
              throw new Error('stream ended');
            };

            pump().catch(function () {
              if (cancelled) return;
              liveRef.current = false;
              setLive(false);
              setRetrying(true);
              window.setTimeout(function () {
                if (!cancelled) {
                  setStreamRetry(function (value) {
                    return value + 1;
                  });
                }
              }, Math.min(4000, 600 + streamRetry * 400));
            });

            return function () {
              cancelled = true;
              if (connectTimer !== 0) window.clearTimeout(connectTimer);
              controller.abort();
              try {
                if (reader) void reader.cancel();
              } catch {
                /* already closed */
              }
            };
          },
          [state.running, state.startedAt, streamRetry],
        );

        var refreshState = useCallback(async function () {
          try {
            var data = await requestJson('/state');
            setReachable(true);
            if (data.state) {
              stateJsonRef.current = JSON.stringify(data.state);
              setState(data.state);
            }
          } catch {
            setReachable(false);
          }
        }, []);

        var run = useCallback(
          async function (label, path, body) {
            setBusy(label);
            setError('');
            try {
              var data = await requestJson(path, { method: 'POST', body: body || {} });
              if (data && data.state) {
                stateJsonRef.current = JSON.stringify(data.state);
                setState(data.state);
                setReachable(true);
              }
            } catch (failure) {
              setError(failure && failure.message ? failure.message : String(failure));
            } finally {
              setBusy('');
            }
          },
          [],
        );

        // Geometry of the picture in CSS pixels, read on demand (never cached).
        var frameRect = function () {
          var canvas = canvasRef.current;
          if (!canvas) return null;
          var rect = canvas.getBoundingClientRect();
          if (!rect || rect.width < 2 || rect.height < 2) return null;
          return rect;
        };

        var toNormalized = function (event) {
          var rect = frameRect();
          if (!rect) return null;
          var x = (event.clientX - rect.left) / rect.width;
          var y = (event.clientY - rect.top) / rect.height;
          if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) return null;
          return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
        };

        var placeCursor = function (event) {
          var stage = stageRef.current;
          var ring = cursorRef.current;
          if (!stage || !ring) return;
          var stageRect = stage.getBoundingClientRect();
          var x = event.clientX - stageRect.left;
          var y = event.clientY - stageRect.top;
          ring.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
          ring.setAttribute('data-visible', 'true');
        };

        var hideCursor = function () {
          var ring = cursorRef.current;
          if (ring) ring.setAttribute('data-visible', 'false');
        };

        var ripple = function (event) {
          var stage = stageRef.current;
          var mark = rippleRef.current;
          if (!stage || !mark || typeof mark.animate !== 'function') return;
          var stageRect = stage.getBoundingClientRect();
          var x = event.clientX - stageRect.left;
          var y = event.clientY - stageRect.top;
          try {
            mark.animate(
              [
                { transform: 'translate3d(' + x + 'px,' + y + 'px,0) scale(.35)', opacity: 0.5 },
                { transform: 'translate3d(' + x + 'px,' + y + 'px,0) scale(2.1)', opacity: 0 },
              ],
              { duration: 340, easing: 'ease-out' },
            );
          } catch {
            /* older engines simply skip the ripple */
          }
        };

        var clickCountFor = function (point) {
          var pointer = pointerRef.current;
          var now = Date.now();
          var rect = frameRect();
          var width = rect ? rect.width : 1;
          var height = rect ? rect.height : 1;
          var near =
            Math.abs(point.x - pointer.lastUpX) * width < 6 && Math.abs(point.y - pointer.lastUpY) * height < 6;
          var count = now - pointer.lastUpAt < 420 && near ? 2 : 1;
          pointer.lastUpAt = now;
          pointer.lastUpX = point.x;
          pointer.lastUpY = point.y;
          return count;
        };

        var sendFlush = function () {
          // Gesture boundaries are worth an immediate flush; a held-down drag is not.
          sender.flushNow();
          window.setTimeout(function () {
            void refreshState();
          }, 220);
        };

        var onPointerDown = function (event) {
          if (!state.running || !state.allowUserControl) return;
          if (event.button !== 0 && event.button !== 2 && event.button !== 1) return;
          var point = toNormalized(event);
          if (!point) return;
          event.preventDefault();
          var stage = stageRef.current;
          if (stage && typeof stage.focus === 'function') {
            try {
              stage.focus({ preventScroll: true });
            } catch {
              /* focus on an old engine */
            }
          }
          var pointer = pointerRef.current;
          if (pointer.down) {
            // The previous gesture never saw its release (pointer left the
            // window, capture was lost): close it before starting this one.
            closeGesture({ clientX: event.clientX, clientY: event.clientY, currentTarget: event.currentTarget, pointerId: pointer.id, buttons: 0 });
          }
          pointer.down = true;
          pointer.id = event.pointerId;
          pointer.x = point.x;
          pointer.y = point.y;
          pointer.moved = 0;
          pointer.button = event.button;
          pointer.clicks = pointer.button === 0 ? clickCountFor(point) : 1;
          try {
            if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* capture is a nicety, not a requirement */
          }
          placeCursor(event);
          ripple(event);
          var masked = modifierMask(event);
          sender.send({ t: 'pointer', type: 'move', x: point.x, y: point.y, buttons: event.buttons || 0, modifiers: masked });
          sender.send({
            t: 'pointer',
            type: 'down',
            x: point.x,
            y: point.y,
            button: event.button,
            buttons: event.buttons || 1,
            clicks: pointer.clicks,
            modifiers: masked,
          });
        };

        var onPointerMove = function (event) {
          if (!state.running || !state.allowUserControl) return;
          placeCursor(event);
          var point = toNormalized(event);
          if (!point) return;
          var pointer = pointerRef.current;
          if (!pointer.down) {
            // Hover matters for menus and tooltips; folding happens in the sender.
            sender.send({ t: 'pointer', type: 'move', x: point.x, y: point.y, buttons: 0, modifiers: modifierMask(event) });
            return;
          }
          var rect = frameRect();
          if (rect) {
            var dx = (point.x - pointer.x) * rect.width;
            var dy = (point.y - pointer.y) * rect.height;
            pointer.moved = Math.max(pointer.moved, Math.sqrt(dx * dx + dy * dy));
          }
          sender.send({ t: 'pointer', type: 'move', x: point.x, y: point.y, buttons: event.buttons || 0, modifiers: modifierMask(event) });
        };

        // One place closes a gesture; the canvas handler, the window fallback and
        // a new press all use it, so a released-outside or a lost capture can
        // never leave the page stuck mid-drag.
        var closeGesture = function (event) {
          var pointer = pointerRef.current;
          if (!pointer.down) return;
          if (!state.running || !state.allowUserControl) {
            pointer.down = false;
            return;
          }
          pointer.down = false;
          try {
            if (event.currentTarget.releasePointerCapture) event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            /* already released */
          }
          var point = toNormalized(event) || { x: pointer.x, y: pointer.y };
          var masked = modifierMask(event);
          var viewportWidth = state.viewport && state.viewport.width ? state.viewport.width : 1280;
          var viewportHeight = state.viewport && state.viewport.height ? state.viewport.height : 800;
          var travel = Math.sqrt(
            Math.pow((point.x - pointer.x) * viewportWidth, 2) + Math.pow((point.y - pointer.y) * viewportHeight, 2),
          );
          var drag = Math.max(pointer.moved, travel) > 4;
          sender.send({ t: 'pointer', type: 'move', x: point.x, y: point.y, buttons: 0, modifiers: masked });
          sender.send({
            t: 'pointer',
            type: 'up',
            x: point.x,
            y: point.y,
            button: pointer.button,
            buttons: 0,
            clicks: pointer.clicks || 1,
            drag: drag,
            modifiers: masked,
          });
          sendFlush();
        };

        var onPointerUp = function (event) {
          closeGesture(event);
        };
        pointerUpRef.current = closeGesture;

        // Pointer capture is a nicety: if it is unavailable (or lost), the
        // release can land anywhere, so close the gesture from the window too.
        useEffect(
          function () {
            var onWindowUp = function (event) {
              if (!pointerRef.current.down) return;
              if (typeof pointerUpRef.current === 'function') pointerUpRef.current(event);
            };
            window.addEventListener('pointerup', onWindowUp, true);
            window.addEventListener('pointercancel', onWindowUp, true);
            return function () {
              window.removeEventListener('pointerup', onWindowUp, true);
              window.removeEventListener('pointercancel', onWindowUp, true);
            };
          },
          [],
        );

        // Native wheel listener: React's is passive in places, and the picture
        // must never scroll the sidebar around it.
        useEffect(
          function () {
            var canvas = canvasRef.current;
            if (!canvas) return undefined;
            var onWheel = function (event) {
              if (!state.running || !state.allowUserControl) return;
              event.preventDefault();
              var rect = frameRect();
              if (!rect) return;
              var x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
              var y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
              var scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
              sender.send({
                t: 'wheel',
                x: x,
                y: y,
                dx: Math.round(event.deltaX * scale),
                dy: Math.round(event.deltaY * scale),
                modifiers: modifierMask(event),
              });
            };
            canvas.addEventListener('wheel', onWheel, { passive: false });
            return function () {
              canvas.removeEventListener('wheel', onWheel);
            };
          },
          [sender, state.running, state.allowUserControl, live],
        );

        var onKeyDown = function (event) {
          if (!state.running || !state.allowUserControl) return;
          var text = typedText(event);
          if (text === '' && (event.ctrlKey || event.metaKey) && event.key === 'v') {
            return; // paste is handled by onPaste with real clipboard text
          }
          event.preventDefault();
          sender.send({
            t: 'key',
            type: 'down',
            key: event.key,
            code: event.code,
            keyCode: event.keyCode,
            text: text,
            repeat: event.repeat === true,
            modifiers: modifierMask(event),
          });
          sender.flushNow();
        };

        var onKeyUp = function (event) {
          if (!state.running || !state.allowUserControl) return;
          event.preventDefault();
          sender.send({
            t: 'key',
            type: 'up',
            key: event.key,
            code: event.code,
            keyCode: event.keyCode,
            modifiers: modifierMask(event),
          });
          sender.flushNow();
        };

        var onPaste = function (event) {
          if (!state.running || !state.allowUserControl) return;
          var data = event.clipboardData;
          var text = data ? data.getData('text/plain') : '';
          if (!text) return;
          event.preventDefault();
          sender.send({ t: 'text', text: text });
          sender.flushNow();
        };

        var openOrStart = function () {
          void run('open', '/start', { url: draft.trim() });
          setDirty(false);
        };

        var retryStream = function () {
          setRetrying(true);
          setStreamRetry(function (value) {
            return value + 1;
          });
        };

        useEffect(
          function () {
            var strip = tabsRef.current;
            if (!strip) return;
            var current = strip.querySelector('[data-current="true"]');
            if (current && typeof current.scrollIntoView === 'function') {
              current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
          },
          [state.activePageId],
        );

        // Coming back from a hidden tab or a sleeping laptop: a socket that died
        // meanwhile reads as "no frames", so ask for a fresh stream.
        useEffect(
          function () {
            var onVisibility = function () {
              if (document.visibilityState !== 'visible' || !state.running) return;
              if (Date.now() - lastFrameAtRef.current > 15000) {
                setStreamRetry(function (value) {
                  return value + 1;
                });
              }
            };
            document.addEventListener('visibilitychange', onVisibility);
            return function () {
              document.removeEventListener('visibilitychange', onVisibility);
            };
          },
          [state.running],
        );

        // Keeps a stored split inside the panel: the picture always keeps its
        // reserve, however the pane is resized later.
        useEffect(
          function () {
            if (logHeight === null) return undefined;
            var root = rootRef.current;
            if (!root) return undefined;
            var clampToPanel = function () {
              var limit = Math.max(LOG_MIN_HEIGHT, root.clientHeight - LOG_STAGE_RESERVE);
              if (logHeight > limit) {
                setLogHeight(limit);
                storeLogHeight(limit);
              }
            };
            clampToPanel();
            if (typeof ResizeObserver !== 'function') return undefined;
            var observer = new ResizeObserver(clampToPanel);
            observer.observe(root);
            return function () {
              observer.disconnect();
            };
          },
          [logHeight, logOpen],
        );

        var applyLogHeight = function (value) {
          var log = logRef.current;
          if (!log) return;
          if (value === null) {
            log.removeAttribute('data-sized');
            log.style.removeProperty('--dvb-log-h');
          } else {
            log.setAttribute('data-sized', 'true');
            log.style.setProperty('--dvb-log-h', Math.round(value) + 'px');
          }
        };

        var commitLogHeight = function (value) {
          setLogHeight(value);
          storeLogHeight(value);
          applyLogHeight(value);
        };

        // The CSS `height` is a content-box height; measuring the same box keeps
        // a drag from jumping by the body's padding on the first pixel.
        var currentLogHeight = function () {
          var body = logBodyRef.current;
          if (!body) return LOG_MIN_HEIGHT;
          var computed = window.getComputedStyle(body).height;
          var value = Number(String(computed).replace('px', ''));
          return Number.isFinite(value) && value > 0 ? value : body.getBoundingClientRect().height;
        };

        var logHeightLimit = function () {
          var root = rootRef.current;
          if (!root) return 420;
          return Math.max(LOG_MIN_HEIGHT, root.clientHeight - LOG_STAGE_RESERVE);
        };

        // Drag the divider between the picture and the log.
        var onSplitDown = function (event) {
          if (event.button !== undefined && event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          var startHeight = currentLogHeight();
          var startY = event.clientY;
          var pointerId = event.pointerId;
          var handle = event.currentTarget;
          var active = true;
          setResizing(true);
          try {
            if (handle.setPointerCapture) handle.setPointerCapture(pointerId);
          } catch {
            /* capture is a nicety */
          }

          var move = function (moveEvent) {
            if (!active) return;
            var limit = logHeightLimit();
            var next = Math.min(limit, Math.max(LOG_MIN_HEIGHT, Math.round(startHeight + (startY - moveEvent.clientY))));
            applyLogHeight(next);
          };
          var finish = function () {
            if (!active) return;
            active = false;
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', finish);
            handle.removeEventListener('pointercancel', finish);
            try {
              if (handle.releasePointerCapture) handle.releasePointerCapture(pointerId);
            } catch {
              /* already released */
            }
            setResizing(false);
            var log = logRef.current;
            var value = log ? Number(String(log.style.getPropertyValue('--dvb-log-h')).replace('px', '')) : NaN;
            if (Number.isFinite(value) && value > 0) commitLogHeight(Math.round(value));
            else commitLogHeight(null);
          };

          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', finish);
          handle.addEventListener('pointercancel', finish);
        };

        var onSplitKeyDown = function (event) {
          var step = event.shiftKey ? 64 : 24;
          var current = currentLogHeight();
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            commitLogHeight(Math.min(logHeightLimit(), Math.round(current + step)));
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            commitLogHeight(Math.max(LOG_MIN_HEIGHT, Math.round(current - step)));
          } else if (event.key === 'Home') {
            event.preventDefault();
            commitLogHeight(LOG_MIN_HEIGHT);
          } else if (event.key === 'End') {
            event.preventDefault();
            commitLogHeight(logHeightLimit());
          }
        };

        var resetLogHeight = function () {
          commitLogHeight(null);
        };

        var pages = Array.isArray(state.pages) ? state.pages : [];
        var tabLabel = function (page) {
          if (page.title) return page.title;
          var short = shortUrl(page.url);
          return short === '' || page.url === 'about:blank' ? t('tab.untitled') : short;
        };

        var openNewPage = function () {
          void run('new-page', '/page', { action: 'new' }).then(function () {
            window.setTimeout(function () {
              var input = addrRef.current;
              if (input) {
                input.focus();
                input.select();
              }
            }, 80);
          });
        };

        var kindLabel = function (kind) {
          var key = 'kind.' + kind;
          var text = t(key);
          return text === key ? kind : text;
        };

        var statusText = !reachable
          ? t('state.offline')
          : state.starting
            ? t('state.starting')
            : state.running
              ? t('state.running')
              : t('state.stopped');

        var actions = state.actions || [];

        return h(
          'div',
          { className: 'dvb-root', ref: rootRef },
          h(
            'div',
            { key: 'bar', className: 'dvb-bar' },
            h('span', {
              className: 'dvb-dot',
              'data-on': String(state.running),
              'data-error': String(!reachable),
              title: statusText + (state.headless ? ' · headless' : ''),
            }),
            h(
              'span',
              { className: 'dvb-title', title: state.title || state.url || t('panel.title') },
              state.title || shortUrl(state.url) || t('panel.title'),
            ),
            h('span', { className: 'dvb-spacer' }),
            busy ? h('span', { className: 'dvb-status' }, t('busy')) : null,
            h(
              'div',
              { className: 'dvb-tools' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  title: t('action.back'),
                  'aria-label': t('action.back'),
                  disabled: !state.running || Boolean(busy),
                  onClick: function () {
                    void run('back', '/nav', { action: 'back' });
                  },
                },
                icon('back', 16),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  title: t('action.forward'),
                  'aria-label': t('action.forward'),
                  disabled: !state.running || Boolean(busy),
                  onClick: function () {
                    void run('forward', '/nav', { action: 'forward' });
                  },
                },
                icon('forward', 16),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  title: t('action.reload'),
                  'aria-label': t('action.reload'),
                  disabled: !state.running || Boolean(busy),
                  onClick: function () {
                    void run('reload', '/nav', { action: 'reload' });
                  },
                },
                icon('reload', 16),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  title: t('tab.new'),
                  'aria-label': t('tab.new'),
                  disabled: !state.running || Boolean(busy),
                  onClick: openNewPage,
                },
                icon('plus', 16),
              ),
              state.running
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn',
                      title: t('action.stop'),
                      'aria-label': t('action.stop'),
                      disabled: Boolean(busy),
                      onClick: function () {
                        void run('stop', '/stop', {});
                      },
                    },
                    icon('stop', 16),
                  )
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn',
                      'data-variant': 'primary',
                      disabled: Boolean(busy),
                      onClick: openOrStart,
                    },
                    icon('play', 14),
                    t('action.start'),
                  ),
            ),
          ),
          pages.length > 1
            ? h(
                'div',
                { key: 'tabs', className: 'dvb-tabs', ref: tabsRef, role: 'tablist', 'aria-label': t('tab.new') },
                pages.map(function (page) {
                  return h(
                    'div',
                    { key: page.id, className: 'dvb-tab', 'data-current': String(page.active === true) },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-tab-label',
                        title: page.title || page.url || page.id,
                        role: 'tab',
                        'aria-selected': String(page.active === true),
                        onClick: function () {
                          if (page.active !== true) void run('select-page', '/page', { action: 'select', id: page.id });
                        },
                      },
                      tabLabel(page),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-tab-close',
                        title: t('tab.close'),
                        'aria-label': t('tab.close'),
                        onClick: function () {
                          void run('close-page', '/page', { action: 'close', id: page.id });
                        },
                      },
                      '×',
                    ),
                  );
                }),
              )
            : null,
          h(
            'div',
            { key: 'addr', className: 'dvb-addr' },
            h('input', {
              ref: addrRef,
              className: 'dvb-input',
              type: 'text',
              spellCheck: false,
              placeholder: t('url.placeholder'),
              value: draft,
              onChange: function (event) {
                setDirty(true);
                setDraft(event.target.value);
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  openOrStart();
                }
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                disabled: Boolean(busy) || draft.trim() === '',
                onClick: openOrStart,
              },
              t('action.open'),
            ),
          ),
          error ? h('div', { key: 'error', className: 'dvb-error' }, error) : null,
          !reachable ? h('div', { key: 'offline', className: 'dvb-error' }, t('error.offline')) : null,
          h(
            'div',
            {
              key: 'stage',
              className: 'dvb-stage',
              ref: stageRef,
              tabIndex: 0,
              'data-focus': String(focused),
              onFocus: function () {
                setFocused(true);
              },
              onBlur: function () {
                setFocused(false);
              },
              onKeyDown: onKeyDown,
              onKeyUp: onKeyUp,
              onPaste: onPaste,
              onContextMenu: function (event) {
                event.preventDefault();
              },
            },
            state.running
              ? h('canvas', {
                  ref: canvasRef,
                  className: 'dvb-live',
                  width: state.viewport && state.viewport.width ? state.viewport.width : 1280,
                  height: state.viewport && state.viewport.height ? state.viewport.height : 800,
                  role: 'img',
                  'aria-label': state.title || state.url || t('panel.title'),
                  'data-busy': String(!live),
                  onPointerDown: onPointerDown,
                  onPointerMove: onPointerMove,
                  onPointerUp: onPointerUp,
                  onPointerCancel: onPointerUp,
                  onPointerLeave: hideCursor,
                  onContextMenu: function (event) {
                    event.preventDefault();
                  },
                  onDragStart: function (event) {
                    event.preventDefault();
                  },
                })
              : h(
                  'div',
                  { className: 'dvb-empty' },
                  h(BrowserGlyph, { size: 44 }),
                  h('div', { className: 'dvb-empty-title' }, t('empty.title')),
                  h('div', { className: 'dvb-empty-desc' }, t('empty.desc')),
                ),
            state.running && !live ? h('div', { className: 'dvb-veil' }, t(retrying ? 'error.frame' : 'connecting')) : null,
            // Out of the flow on purpose: it must never reflow the picture under
            // a pointer that is already aiming at something.
            inputError !== ''
              ? h(
                  'div',
                  { key: 'input-error', className: 'dvb-inputerr', role: 'status', 'aria-live': 'polite' },
                  inputError,
                )
              : null,
            // The picture recovering must never block the page: the veil is
            // click-through and only this pill takes the pointer.
            state.running && retrying
              ? h(
                  'button',
                  { type: 'button', className: 'dvb-retry', title: t('action.reconnect'), onClick: retryStream },
                  icon('reload', 13),
                  t('action.reconnect'),
                )
              : null,
            h(
              'span',
              { className: 'dvb-cursor', ref: cursorRef, 'data-visible': 'false', 'aria-hidden': 'true' },
              // The pointer shape, not a ring: the page's own cursor is not part
              // of the screencast, so this is the only cursor the user sees.
              h(
                'svg',
                { width: 18, height: 22, viewBox: '0 0 18 22', fill: 'none', 'aria-hidden': true, focusable: false },
                h('path', {
                  d: 'M2 1.5 2 17.2 6.3 13.3 9 19.6 12 18.3 9.3 12.1 15.4 12.1 Z',
                  fill: '#fff',
                  stroke: '#111',
                  strokeWidth: 1.2,
                  strokeLinejoin: 'round',
                }),
              ),
            ),
            h('span', { className: 'dvb-ripple', ref: rippleRef }),
          ),
          state.running && state.allowUserControl
            ? h(
                'div',
                { key: 'hint', className: 'dvb-hint' },
                h('span', null, t('hint.interactive')),
                state.headless ? h('span', null, t('hint.headless')) : null,
              )
            : null,
          logOpen
            ? h('button', {
                type: 'button',
                ref: splitRef,
                className: 'dvb-split',
                role: 'separator',
                'aria-orientation': 'horizontal',
                'aria-label': t('timeline.resize'),
                'aria-valuemin': LOG_MIN_HEIGHT,
                'aria-valuemax': logHeightLimit(),
                'aria-valuenow': logHeight !== null ? logHeight : undefined,
                title: t('timeline.resize'),
                'data-active': String(resizing),
                onPointerDown: onSplitDown,
                onKeyDown: onSplitKeyDown,
                onDoubleClick: resetLogHeight,
              })
            : null,
          h(
            'div',
            {
              key: 'log',
              className: 'dvb-log',
              ref: logRef,
              'data-open': String(logOpen),
              'data-sized': String(logHeight !== null),
              style: logHeight !== null ? { '--dvb-log-h': logHeight + 'px' } : undefined,
            },
            h(
              'button',
              {
                type: 'button',
                className: 'dvb-log-head',
                title: logOpen ? t('timeline.collapse') : t('timeline.expand'),
                'aria-expanded': String(logOpen),
                onClick: function () {
                  setLogOpen(function (value) {
                    return !value;
                  });
                },
              },
              h('span', { className: 'dvb-log-chevron' }, icon('chevron', 12)),
              h('span', { className: 'dvb-log-title' }, t('timeline.title')),
              h('span', { className: 'dvb-log-count' }, actions.length > 0 ? String(actions.length) : ''),
              h('span', { className: 'dvb-spacer' }),
              reachable ? null : h('span', { className: 'dvb-status' }, t('state.offline')),
            ),
            logOpen
              ? h(
                  'div',
                  { className: 'dvb-log-body', ref: logBodyRef },
                  actions.length === 0
                    ? h('div', { className: 'dvb-log-empty' }, t('timeline.empty'))
                    : actions.map(function (action) {
                        var label = action.detail || action.target || kindLabel(action.kind);
                        return h(
                          'div',
                          { key: action.seq, className: 'dvb-row', title: label },
                          h('span', { className: 'dvb-row-time' }, clock(action.ts)),
                          h('span', { className: 'dvb-row-kind', 'data-kind': action.kind }, kindLabel(action.kind)),
                          h('span', { className: 'dvb-row-text', 'data-error': String(action.ok === false) }, label),
                        );
                      }),
                )
              : null,
          ),
        );
      }

      // -------------------------------------------------------------------
      // Tab title
      // -------------------------------------------------------------------

      function BrowserTabTitle(props) {
        var t = props.t || translateCurrent;
        var info = null;
        if (typeof props.useTabInfo === 'function') info = props.useTabInfo();
        var title = info && info.tab && info.tab.title ? info.tab.title : t('panel.title');
        return h(
          'span',
          { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
          h(BrowserGlyph, { size: 15 }),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
        );
      }

      // -------------------------------------------------------------------
      // Module
      // -------------------------------------------------------------------

      return {
        inject: ['slots', 'locale'],
        apply: function (ctx) {
          bindLocale(ctx);
          installStyles(ctx);
          var slots = ctx.get('slots');
          if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
            console.warn('[dsh-visual-browser] slots service missing; panel disabled');
            return;
          }

          var register = function (slot, options, component, label) {
            try {
              ctx.effect(function () {
                return slots.inject(slot, function () {
                  return slots.register({ name: slot, ...options }, component);
                });
              }, label);
            } catch (error) {
              console.warn('[dsh-visual-browser] could not register ' + slot + ':', error && error.message ? error.message : error);
            }
          };

          // A guide card may open our tab through `tab.actions`, but the
          // controller keeps working from any seat; hold it for the fallback.
          ctx.inject(['sidebarRight'], function (scope) {
            var service = scope.get('sidebarRight');
            if (!service || typeof service.openTab !== 'function') return;
            var open = service.openTab.bind(service);
            sidebarRightOpen = open;
            scope.effect(
              function () {
                return function () {
                  if (sidebarRightOpen === open) sidebarRightOpen = null;
                };
              },
              'dsh-visual-browser: sidebar controller handle',
            );
          });

          // The tab type waits for the sidebar-right registry: sampling it once
          // in apply leaves the type unregistered on a cold page boot.
          ctx.inject(['sidebarRightTabs'], function (scope) {
            var tabs = scope.get('sidebarRightTabs');
            if (!tabs || typeof tabs.register !== 'function') {
              console.warn('[dsh-visual-browser] sidebarRightTabs service missing; tab type not registered');
              return;
            }
            scope.effect(
              function () {
                return tabs.register({
                  id: MODULE_ID,
                  kind: KIND,
                  priority: 'extension',
                  title: function () {
                    return translateCurrent('panel.title');
                  },
                  guide: [
                    {
                      id: 'open',
                      order: 40,
                      title: function () {
                        return translateCurrent('guide.title');
                      },
                      description: function () {
                        return translateCurrent('guide.description');
                      },
                    },
                  ],
                });
              },
              'dsh-visual-browser: tab type',
            );
          });

          register(
            'sidebar.right.pane.tab',
            { key: MODULE_ID, locale: NS },
            function (props) {
              return h(BrowserTab, { ctx: ctx, t: props.t });
            },
            'dsh-visual-browser: tab body',
          );
          register(
            'sidebar.right.pane.tab.title',
            { key: MODULE_ID, locale: NS },
            BrowserTabTitle,
            'dsh-visual-browser: tab title',
          );
          // Our own card only stands in when the built-in Browser has no card
          // for us to extend; normally the Browser card carries the extra row.
          register(
            'sidebar.right.tab.guide.entry',
            { key: MODULE_ID, locale: NS },
            function (props) {
              var tabs = ctx.get('sidebarRightTabs');
              var browserPresent =
                tabs !== undefined && typeof tabs.get === 'function' && tabs.get(BROWSER_KIND) !== undefined;
              if (browserPresent) return null;
              return h(VisualBrowserGuideCard, props);
            },
            'dsh-visual-browser: own guide card',
          );
          register(
            'sidebar.right.tab.guide.entry',
            { key: BROWSER_TYPE_ID, locale: NS },
            BrowserExtraGuideCard,
            'dsh-visual-browser: browser guide card',
          );
        },
      };
    },
  });
})();
