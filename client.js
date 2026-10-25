/**
 * Client half of dsh-visual-browser.
 *
 * One sidebar entry + one main panel: the live page frame, a click-through
 * surface, browser controls, and the replayable action timeline the Host keeps.
 * The whole file is an IIFE because every client bundle shares one global
 * lexical scope inside the page.
 */
(function () {
  'use strict';

  var MODULE_ID = '@restregular/dsh-visual-browser';
  var API = '/visual-browser/api';
  var NS = 'dsh-visual-browser';

  var DICT = {
    zh: {
      'panel.title': '浏览器',
      'state.running': '运行中',
      'state.starting': '启动中',
      'state.stopped': '未启动',
      'state.offline': '宿主未连接',
      'action.start': '启动',
      'action.stop': '关闭',
      'action.back': '后退',
      'action.forward': '前进',
      'action.reload': '刷新页面',
      'action.capture': '截取画面',
      'action.live': '实时画面',
      'action.open': '打开',
      'url.placeholder': '输入网址，例如 example.com',
      'hint.interactive': '点击画面可直接操作浏览器，滚轮可滚动页面',
      'hint.headless': '当前是无头浏览器：用户看不到窗口，画面只在这里',
      'empty.title': '浏览器还没启动',
      'empty.desc': '在上方输入网址打开，或者让 Agent 用 browser_open 打开一个页面；之后每一次操作都会在这里留下画面。',
      'timeline.title': '操作记录',
      'timeline.empty': '还没有操作。Agent 每次点击、输入之后都会在这里留一帧画面。',
      'timeline.latest': '回到最新',
      'timeline.replay': '回放这一帧',
      'error.offline': '连不上宿主路由（/visual-browser/api），请确认插件已启用且宿主仍在运行。',
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
      'kind.user-scroll': '你滚动',
      'kind.user-key': '你按键',
      'busy': '处理中…',
    },
    en: {
      'panel.title': 'Browser',
      'state.running': 'Running',
      'state.starting': 'Starting',
      'state.stopped': 'Stopped',
      'state.offline': 'Host offline',
      'action.start': 'Start',
      'action.stop': 'Stop',
      'action.back': 'Back',
      'action.forward': 'Forward',
      'action.reload': 'Reload page',
      'action.capture': 'Refresh frame',
      'action.live': 'Live view',
      'action.open': 'Open',
      'url.placeholder': 'Enter a URL, for example example.com',
      'hint.interactive': 'Click the picture to control the browser; the wheel scrolls the page',
      'hint.headless': 'Headless browser: there is no window to watch, the picture here is the browser',
      'empty.title': 'The browser is not running yet',
      'empty.desc': 'Open a URL above, or let the Agent call browser_open. Every action it takes leaves a frame here.',
      'timeline.title': 'Actions',
      'timeline.empty': 'No actions yet. Every click and keystroke the Agent makes leaves a frame here.',
      'timeline.latest': 'Back to latest',
      'timeline.replay': 'Replay this frame',
      'error.offline': 'Cannot reach the host route (/visual-browser/api). Check that the plugin is enabled and the host is running.',
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
      'kind.user-scroll': 'you scrolled',
      'kind.user-key': 'you pressed',
      'busy': 'Working…',
    },
  };

  var CSS = [
    '.dvb-page{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
    '.dvb-head{flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);padding:10px 14px 10px;display:flex;flex-direction:column;gap:8px}',
    '.dvb-head-row{display:flex;align-items:center;gap:8px;min-width:0}',
    '.dvb-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}',
    '.dvb-dot[data-on="true"]{background:var(--dsw-alias-state-success-primary)}',
    '.dvb-dot[data-error="true"]{background:var(--dsw-alias-state-error-primary)}',
    '.dvb-title{font-weight:600;font-size:14px;white-space:nowrap}',
    '.dvb-status{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dvb-spacer{flex:1 1 auto;min-width:8px}',
    '.dvb-tools{display:flex;align-items:center;gap:4px;flex:none}',
    '.dvb-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;min-width:28px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px}',
    '.dvb-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
    '.dvb-btn:disabled{opacity:.45;cursor:default}',
    '.dvb-btn[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
    '.dvb-btn[data-variant="primary"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}',
    '.dvb-btn[data-variant="primary"]:hover:not(:disabled){background:var(--dsw-alias-brand-primary);filter:brightness(1.06);color:#fff}',
    '.dvb-url{display:flex;align-items:center;gap:8px;min-width:0}',
    '.dvb-input{flex:1 1 auto;min-width:0;height:28px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
    '.dvb-input::placeholder{color:var(--dsw-alias-label-secondary)}',
    '.dvb-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
    '.dvb-stage{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 14px}',
    '.dvb-frame{display:block;width:100%;height:auto;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:0 6px 20px rgba(0,0,0,.08)}',
    '.dvb-stage[data-interactive="true"] .dvb-frame{cursor:crosshair}',
    '.dvb-hint{padding:6px 2px 0;font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;flex-wrap:wrap}',
    '.dvb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:100%;min-height:220px;text-align:center;padding:24px}',
    '.dvb-empty-title{font-size:14px;font-weight:600}',
    '.dvb-empty-desc{max-width:360px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
    '.dvb-timeline{flex:none;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;min-height:0;max-height:38%}',
    '.dvb-timeline-head{display:flex;align-items:center;gap:8px;padding:8px 14px 6px;flex:none}',
    '.dvb-timeline-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
    '.dvb-rows{overflow:auto;padding:0 8px 10px;display:flex;flex-direction:column;gap:2px;min-height:0}',
    '.dvb-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:5px 6px;border-radius:6px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}',
    '.dvb-row:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
    '.dvb-row[data-selected="true"]{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}',
    '.dvb-row:disabled{cursor:default;opacity:.6}',
    '.dvb-row-time{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);flex:none;width:56px}',
    '.dvb-row-kind{flex:none;min-width:52px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;text-align:center}',
    '.dvb-row-kind[data-kind^="user"]{background:var(--dsw-alias-brand-primary);color:#fff}',
    '.dvb-row-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dvb-row-text[data-error="true"]{color:var(--dsw-alias-state-error-primary)}',
    '.dvb-empty-timeline{padding:2px 14px 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
    '.dvb-error{margin:0 14px 10px;padding:8px 10px;border-radius:7px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:12px}',
    '.dvb-busy{font-size:11px;color:var(--dsw-alias-label-secondary)}',
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

      // ---------------------------------------------------------------------
      // Host API
      // ---------------------------------------------------------------------

      async function requestJson(path, options) {
        var init = { method: (options && options.method) || 'GET', headers: {} };
        if (options && options.body !== undefined) {
          init.headers['content-type'] = 'application/json';
          init.body = JSON.stringify(options.body);
        }
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
      }

      function pad(value) {
        return value < 10 ? '0' + value : String(value);
      }

      function clock(ts) {
        var date = new Date(ts || Date.now());
        return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
      }

      function shortUrl(value) {
        var text = String(value || '');
        return text.replace(/^https?:\/\//, '').replace(/\/$/, '');
      }

      // ---------------------------------------------------------------------
      // Icons (inline SVG, currentColor)
      // ---------------------------------------------------------------------

      function icon(name, size) {
        var common = {
          width: size || 16,
          height: size || 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        };
        var paths;
        switch (name) {
          case 'play':
            paths = [h('path', { key: 'a', d: 'M8 5.5v13l11-6.5-11-6.5Z', fill: 'currentColor', stroke: 'none' })];
            break;
          case 'stop':
            paths = [h('rect', { key: 'a', x: 6, y: 6, width: 12, height: 12, rx: 2.5, fill: 'currentColor', stroke: 'none' })];
            break;
          case 'back':
            paths = [h('path', { key: 'a', d: 'M14.5 6.5 8 12l6.5 5.5' })];
            break;
          case 'forward':
            paths = [h('path', { key: 'a', d: 'M9.5 6.5 16 12l-6.5 5.5' })];
            break;
          case 'reload':
            paths = [
              h('path', { key: 'a', d: 'M19 12a7 7 0 1 1-2.1-5' }),
              h('path', { key: 'b', d: 'M19 4.5V9h-4.5' }),
            ];
            break;
          case 'camera':
            paths = [
              h('path', { key: 'a', d: 'M4.5 8.5h3l1.5-2h6l1.5 2h3v9.5h-15Z' }),
              h('circle', { key: 'b', cx: 12, cy: 13, r: 3.2 }),
            ];
            break;
          case 'live':
            paths = [
              h('circle', { key: 'a', cx: 12, cy: 12, r: 3 }),
              h('path', { key: 'b', d: 'M6.5 6.5a7.8 7.8 0 0 0 0 11M17.5 6.5a7.8 7.8 0 0 1 0 11' }),
            ];
            break;
          default:
            paths = [];
        }
        return h('svg', common, paths);
      }

      function PanelIcon(props) {
        var size = (props && props.size) || 16;
        var active = props && props.active;
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            focusable: false,
            style: { opacity: active ? 1 : 0.86 },
          },
          h('rect', { key: 'a', x: 3, y: 4.5, width: 18, height: 15, rx: 2.6 }),
          h('path', { key: 'b', d: 'M3 8.5h18' }),
          h('circle', { key: 'c', cx: 12, cy: 13.6, r: 2.2, fill: 'currentColor', stroke: 'none' }),
        );
      }

      // ---------------------------------------------------------------------
      // Panel
      // ---------------------------------------------------------------------

      var EMPTY_STATE = {
        running: false,
        starting: false,
        url: '',
        title: '',
        viewport: { width: 1280, height: 800 },
        frameSeq: 0,
        actionSeq: 0,
        frameSeqs: [],
        actions: [],
        allowUserControl: true,
        lastError: '',
      };

      function BrowserPage(props) {
        var ctx = props.ctx;
        var t = translateCurrent;
        var [tick, setTick] = useState(0);
        var [state, setState] = useState(EMPTY_STATE);
        var [reachable, setReachable] = useState(true);
        var [busy, setBusy] = useState('');
        var [error, setError] = useState('');
        var [live, setLive] = useState(false);
        var [liveTick, setLiveTick] = useState(0);
        var [previewSeq, setPreviewSeq] = useState(0);
        var [draft, setDraft] = useState('');
        var [dirty, setDirty] = useState(false);
        var stageRef = useRef(null);
        var wheelAcc = useRef({ deltaY: 0, timer: 0 });

        useEffect(function () {
          var locale = ctx.get('locale');
          if (!locale || typeof locale.subscribe !== 'function') return undefined;
          return locale.subscribe(function () {
            setTick(function (value) {
              return value + 1;
            });
          });
        }, [ctx]);

        useEffect(
          function () {
            var cancelled = false;
            var timer = null;
            var poll = async function () {
              try {
                var data = await requestJson('/state');
                if (cancelled) return;
                setReachable(true);
                if (data.state) setState(data.state);
              } catch {
                if (!cancelled) setReachable(false);
              }
              if (!cancelled) {
                timer = window.setTimeout(poll, document.visibilityState === 'hidden' ? 5000 : 1500);
              }
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

        useEffect(
          function () {
            if (!live || !state.running) return undefined;
            var id = window.setInterval(function () {
              setLiveTick(function (value) {
                return value + 1;
              });
            }, 1100);
            return function () {
              window.clearInterval(id);
            };
          },
          [live, state.running],
        );

        var run = useCallback(async function (label, path, body) {
          setBusy(label);
          setError('');
          try {
            var data = await requestJson(path, { method: 'POST', body: body || {} });
            if (data && data.state) {
              setState(data.state);
              setReachable(true);
            }
          } catch (failure) {
            setError(failure && failure.message ? failure.message : String(failure));
          } finally {
            setBusy('');
          }
        }, []);

        var sendWheel = useCallback(
          function (deltaY) {
            if (!state.running || !state.allowUserControl) return;
            void run('wheel', '/wheel', { deltaY: Math.round(deltaY) });
          },
          [run, state.running, state.allowUserControl],
        );

        useEffect(
          function () {
            var stage = stageRef.current;
            if (!stage) return undefined;
            var onWheel = function (event) {
              if (!state.running || !state.allowUserControl) return;
              event.preventDefault();
              var acc = wheelAcc.current;
              acc.deltaY += event.deltaY;
              if (acc.timer) window.clearTimeout(acc.timer);
              acc.timer = window.setTimeout(function () {
                var deltaY = acc.deltaY;
                acc.deltaY = 0;
                acc.timer = 0;
                if (Math.abs(deltaY) >= 1) sendWheel(deltaY);
              }, 160);
            };
            stage.addEventListener('wheel', onWheel, { passive: false });
            return function () {
              stage.removeEventListener('wheel', onWheel);
              var acc = wheelAcc.current;
              if (acc.timer) window.clearTimeout(acc.timer);
            };
          },
          [sendWheel, state.running, state.allowUserControl],
        );

        var onFrameClick = function (event) {
          if (!state.running || !state.allowUserControl) return;
          var image = event.currentTarget;
          var rect = image.getBoundingClientRect();
          if (!rect || rect.width < 2 || rect.height < 2) return;
          var x = (event.clientX - rect.left) / rect.width;
          var y = (event.clientY - rect.top) / rect.height;
          if (x < 0 || x > 1 || y < 0 || y > 1) return;
          void run('click', '/click', { x: x, y: y });
        };

        var frameSrc = useMemo(
          function () {
            if (previewSeq > 0) return API + '/frame?seq=' + previewSeq;
            if (live && state.running) return API + '/live?t=' + liveTick;
            return API + '/frame?seq=' + (state.frameSeq || 0);
          },
          [previewSeq, live, liveTick, state.frameSeq, state.running],
        );

        var hasFrame = previewSeq > 0 || (state.running && state.frameSeq > 0);
        var kindLabel = function (kind) {
          var key = 'kind.' + kind;
          var text = t(key);
          return text === key ? kind : text;
        };

        var openOrStart = function () {
          void run('open', '/start', { url: draft.trim() });
          setDirty(false);
        };

        var statusText = !reachable
          ? t('state.offline')
          : state.starting
            ? t('state.starting')
            : state.running
              ? t('state.running')
              : t('state.stopped');

        return h(
          'div',
          { className: 'dvb-page' },
          h(
            'div',
            { className: 'dvb-head' },
            h(
              'div',
              { className: 'dvb-head-row' },
              h('span', {
                className: 'dvb-dot',
                'data-on': String(state.running),
                'data-error': String(!reachable),
                title: statusText + (state.headless ? ' · headless' : ''),
              }),
              h('span', { className: 'dvb-title' }, t('panel.title')),
              h('span', { className: 'dvb-status', title: state.title || state.url || '' }, state.title || shortUrl(state.url) || statusText),
              h('span', { className: 'dvb-spacer' }),
              busy ? h('span', { className: 'dvb-busy' }, t('busy')) : null,
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
                  icon('back'),
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
                  icon('forward'),
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
                  icon('reload'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-btn',
                    title: t('action.live'),
                    'aria-label': t('action.live'),
                    'data-on': String(live),
                    disabled: !state.running || Boolean(busy),
                    onClick: function () {
                      setLive(function (value) {
                        return !value;
                      });
                      setLiveTick(function (value) {
                        return value + 1;
                      });
                    },
                  },
                  icon('live'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-btn',
                    title: t('action.capture'),
                    'aria-label': t('action.capture'),
                    disabled: !state.running || Boolean(busy),
                    onClick: function () {
                      void run('capture', '/capture', {});
                    },
                  },
                  icon('camera'),
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
                      icon('stop'),
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
                      icon('play'),
                      t('action.start'),
                    ),
              ),
            ),
            h(
              'div',
              { className: 'dvb-url' },
              h('input', {
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
          ),
          error ? h('div', { className: 'dvb-error' }, error) : null,
          !reachable ? h('div', { className: 'dvb-error' }, t('error.offline')) : null,
          h(
            'div',
            { className: 'dvb-stage', ref: stageRef, 'data-interactive': String(state.running && state.allowUserControl) },
            hasFrame
              ? h(
                  'div',
                  null,
                  h('img', {
                    className: 'dvb-frame',
                    src: frameSrc,
                    alt: state.title || state.url || t('panel.title'),
                    draggable: false,
                    onClick: onFrameClick,
                  }),
                  h(
                    'div',
                    { className: 'dvb-hint' },
                    state.running ? h('span', null, state.allowUserControl ? t('hint.interactive') : '—') : null,
                    state.running && state.headless ? h('span', null, t('hint.headless')) : null,
                  ),
                )
              : h(
                  'div',
                  { className: 'dvb-empty' },
                  h('svg', {
                    width: 56,
                    height: 56,
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: 'var(--dsw-alias-label-secondary)',
                    strokeWidth: 1.2,
                    'aria-hidden': true,
                  },
                    h('rect', { x: 2.5, y: 4, width: 19, height: 16, rx: 2.5 }),
                    h('path', { d: 'M2.5 8h19' }),
                    h('circle', { cx: 12, cy: 13.5, r: 2.6 }),
                  ),
                  h('div', { className: 'dvb-empty-title' }, t('empty.title')),
                  h('div', { className: 'dvb-empty-desc' }, t('empty.desc')),
                  state.running
                    ? h('button', {
                        type: 'button',
                        className: 'dvb-btn',
                        disabled: Boolean(busy),
                        onClick: function () {
                          void run('capture', '/capture', {});
                        },
                      }, t('action.capture'))
                    : null,
                ),
          ),
          h(
            'div',
            { className: 'dvb-timeline' },
            h(
              'div',
              { className: 'dvb-timeline-head' },
              h('span', { className: 'dvb-timeline-title' }, t('timeline.title')),
              h('span', { className: 'dvb-status' }, state.actions.length ? String(state.actions.length) : ''),
              h('span', { className: 'dvb-spacer' }),
              previewSeq > 0
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn',
                      onClick: function () {
                        setPreviewSeq(0);
                      },
                    },
                    t('timeline.latest'),
                  )
                : null,
            ),
            state.actions.length === 0
              ? h('div', { className: 'dvb-empty-timeline' }, t('timeline.empty'))
              : h(
                  'div',
                  { className: 'dvb-rows' },
                  state.actions.map(function (action) {
                    var selected = previewSeq > 0 && previewSeq === action.frameSeq;
                    var label = action.detail || action.target || kindLabel(action.kind);
                    return h(
                      'button',
                      {
                        key: action.seq,
                        type: 'button',
                        className: 'dvb-row',
                        'data-selected': String(selected),
                        disabled: !action.frameSeq,
                        title: label,
                        onClick: function () {
                          if (action.frameSeq) setPreviewSeq(action.frameSeq);
                        },
                      },
                      h('span', { className: 'dvb-row-time' }, clock(action.ts)),
                      h('span', { className: 'dvb-row-kind', 'data-kind': action.kind }, kindLabel(action.kind)),
                      h('span', { className: 'dvb-row-text', 'data-error': String(action.ok === false) }, label),
                    );
                  }),
                ),
          ),
        );
      }

      // ---------------------------------------------------------------------
      // Module
      // ---------------------------------------------------------------------

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
          register(
            'sidebar.panellist',
            {
              id: 'visual-browser',
              order: 40,
              label: function () {
                return translateCurrent('panel.title');
              },
            },
            function (props) {
              return h(PanelIcon, { size: props && props.size ? props.size : 16, active: Boolean(props && props.active) });
            },
            'dsh-visual-browser: sidebar entry',
          );
          register('main', { key: 'visual-browser' }, function () {
            return h(BrowserPage, { ctx: ctx });
          }, 'dsh-visual-browser: main page');
        },
      };
    },
  });
})();
