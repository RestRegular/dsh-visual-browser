/**
 * Client half of dsh-visual-browser.
 *
 * A tab type for the right Sidebar: a live picture of the page Chrome is
 * showing, Chrome-style page tabs, and a page console where scripts can be run.
 * Pictures arrive as one long binary response of length-prefixed JPEG frames
 * that the panel decodes off the main thread; pointer, wheel and keyboard
 * events go out in animation-frame batches, so a click costs one round trip
 * instead of a screenshot. The whole file is an IIFE because every client bundle
 * shares one global lexical scope inside the page.
 */
(function () {
  'use strict';

  var MODULE_ID = '@restregular/dsh-visual-browser';
  var API = '/visual-browser/api';
  var NS = 'dsh-visual-browser';
  var KIND = 'visual-browser';
  /**
   * The chip source name. It is also the `data-composer-chip` value the chat
   * composer puts on the chip's host element, so one name spans the reference
   * text form, the chip, and its serializer.
   */
  var CHIP_SOURCE = 'browser-page';
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
      'tab.closeAll': '关闭全部标签页',
      'tab.reference': '引用到对话框',
      'tab.copyLink': '复制链接',
      'tab.openExternal': '在默认浏览器中打开',
      'tab.strip': '浏览器标签页',
      'tab.untitled': '新页面',
      'toast.referenced': '已引用到对话框',
      'toast.noComposer': '没有找到对话框，请先打开一个会话',
      'toast.copied': '已复制链接',
      'toast.copyFailed': '复制失败，请手动复制',
      'toast.externalOpened': '已在默认浏览器中打开',
      'toast.externalFailed': '没能唤起默认浏览器',
      'url.placeholder': '输入网址，例如 example.com',
      'hint.interactive': '直接用鼠标操作画面；点一下画面后可用键盘输入',
      'hint.headless': '无头浏览器：窗口不可见，画面只在这里',
      'empty.title': '浏览器还没启动',
      'empty.desc': '在上方输入网址打开，或者让 Agent 用 browser_open 打开一个页面；之后每次操作都会在这里实时显示。',
      'connecting': '正在连接画面…',
      'console.title': '页面 Console',
      'console.empty': '页面还没有输出。在下面输入脚本按 Enter 运行，网页自身的 console 输出也会实时显示在这里。',
      'console.resize': '上下拖动调整控制台高度，双击复位',
      'console.collapse': '折叠控制台',
      'console.expand': '展开控制台',
      'console.clear': '清空控制台',
      'console.clearTitle': '清空控制台',
      'console.placeholder': '输入脚本，Enter 运行（Shift+Enter 换行）',
      'console.run': '运行',
      'console.count': '条',
      'console.log': '日志',
      'console.info': '信息',
      'console.debug': '调试',
      'console.warn': '警告',
      'console.error': '错误',
      'console.input': '脚本',
      'console.result': '返回',
      'agent.working': 'Agent 正在操作画面',
      'agent.hint': '画面已锁定',
      'agent.typing': '输入文字',
      'agent.scroll.up': '向上滚动',
      'agent.scroll.down': '向下滚动',
      'agent.scroll.left': '向左滚动',
      'agent.scroll.right': '向右滚动',
      'error.offline': '连不上宿主路由（/visual-browser/api），请确认插件已启用且宿主仍在运行。',
      'error.frame': '画面流中断，正在重连…',
      'error.input': '输入没能送到浏览器：',
      'kind.start': '启动',
      'kind.close': '关闭',
      'kind.open': '打开',
      'kind.click': '点击',
      'kind.upload': '上传',
      'kind.drag': '拖动',
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
      'tab.closeAll': 'Close all tabs',
      'tab.reference': 'Reference in the chat',
      'tab.copyLink': 'Copy link',
      'tab.openExternal': 'Open in default browser',
      'tab.strip': 'Browser tabs',
      'tab.untitled': 'New page',
      'toast.referenced': 'Referenced in the chat',
      'toast.noComposer': 'No chat composer found. Open a conversation first.',
      'toast.copied': 'Link copied',
      'toast.copyFailed': 'Could not copy the link',
      'toast.externalOpened': 'Opened in the default browser',
      'toast.externalFailed': 'Could not open the default browser',
      'url.placeholder': 'Enter a URL, for example example.com',
      'hint.interactive': 'Click straight into the picture; click once to type with the keyboard',
      'hint.headless': 'Headless browser: no window to watch, the picture here is the browser',
      'empty.title': 'The browser is not running yet',
      'empty.desc': 'Open a URL above, or let the Agent call browser_open. Everything that happens then shows up here live.',
      'connecting': 'Connecting the picture…',
      'console.title': 'Page Console',
      'console.empty': 'No page output yet. Run a script below with Enter; the page’s own console output shows up here live.',
      'console.resize': 'Drag up or down to resize the console; double-click to reset',
      'console.collapse': 'Collapse the console',
      'console.expand': 'Expand the console',
      'console.clear': 'Clear the console',
      'console.clearTitle': 'Clear the console',
      'console.placeholder': 'Run a script — Enter runs, Shift+Enter adds a line',
      'console.run': 'Run',
      'console.count': 'items',
      'console.log': 'log',
      'console.info': 'info',
      'console.debug': 'debug',
      'console.warn': 'warn',
      'console.error': 'error',
      'console.input': 'script',
      'console.result': 'result',
      'agent.working': 'Agent is driving the page',
      'agent.hint': 'the picture is locked',
      'agent.typing': 'typing text',
      'agent.scroll.up': 'scroll up',
      'agent.scroll.down': 'scroll down',
      'agent.scroll.left': 'scroll left',
      'agent.scroll.right': 'scroll right',
      'error.offline': 'Cannot reach the host route (/visual-browser/api). Check that the plugin is enabled and the host is running.',
      'error.frame': 'The picture stream dropped; reconnecting…',
      'error.input': 'Input never reached the browser:',
      'kind.start': 'start',
      'kind.close': 'close',
      'kind.open': 'open',
      'kind.click': 'click',
      'kind.upload': 'upload',
      'kind.drag': 'drag',
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
    '.dvb-root{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
    '.dvb-bar{flex:none;display:flex;align-items:center;gap:4px;padding:0 8px 8px;min-width:0}',
    '.dvb-spacer{flex:1 1 auto;min-width:6px}',
    '.dvb-status{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dvb-tools{display:flex;align-items:center;gap:2px;flex:none}',
    '.dvb-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;min-width:26px;padding:0 7px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px}',
    '.dvb-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
    '.dvb-btn:disabled{opacity:.4;cursor:default}',
    '.dvb-btn[data-variant="primary"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);padding:0 10px}',
    '.dvb-btn[data-variant="primary"]:hover:not(:disabled){background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);filter:brightness(1.06)}',
    '.dvb-tabs{position:relative;flex:none;display:flex;align-items:center;gap:4px;padding:8px 8px 4px;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;overflow-anchor:none}',
    '.dvb-tab{position:relative;flex:none;display:flex;align-items:center;gap:2px;height:26px;padding:0 3px 0 9px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;max-width:180px;min-width:0;cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease,transform .17s cubic-bezier(.2,0,0,1);touch-action:none;user-select:none;-webkit-user-select:none}',
    '.dvb-tab:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
    '.dvb-tab[data-current="true"]{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover));border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}',
    '.dvb-tab[data-dragging="true"]{z-index:30;cursor:grabbing;background:color-mix(in srgb,var(--dsw-alias-bg-base) 58%,transparent);border-color:var(--dsw-alias-border-l3);box-shadow:0 4px 10px rgba(0,0,0,.24),0 1px 3px rgba(0,0,0,.16);backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%);transition:none!important;will-change:transform}',
    '.dvb-tab[data-dragging="true"]:hover{background:color-mix(in srgb,var(--dsw-alias-bg-base) 58%,transparent)}',
    '.dvb-tab-label{display:block;max-width:140px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0;touch-action:none}',
    '.dvb-tab[data-dragging="true"] .dvb-tab-label{cursor:grabbing}',
    '.dvb-tab-close{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;cursor:pointer;padding:0;opacity:0;transition:opacity .1s ease,background .1s ease,color .1s ease}',
    '.dvb-tab:hover .dvb-tab-close,.dvb-tab[data-current="true"] .dvb-tab-close,.dvb-tab-close:focus-visible{opacity:1}',
    '.dvb-tab-close:hover{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}',
    '.dvb-tab-add{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease}',
    '.dvb-tab-add:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
    '.dvb-tab-add:disabled{opacity:.4;cursor:default}',
    '.dvb-menu{position:fixed;z-index:2147483000;min-width:184px;max-width:260px;padding:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));color:var(--dsw-alias-label-primary);box-shadow:0 12px 32px rgba(0,0,0,.26);backdrop-filter:var(--dsw-menu-backdrop-filter,blur(18px) saturate(160%));-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(18px) saturate(160%));font-size:12px;animation:dvb-menu-in .12s ease-out}',
    '@keyframes dvb-menu-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}',
    '.dvb-menu-item{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:nowrap}',
    '.dvb-menu-item:hover:not(:disabled),.dvb-menu-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}',
    '.dvb-menu-item:disabled{opacity:.4;cursor:default}',
    '.dvb-menu-item[data-danger="true"]{color:var(--dsw-alias-state-error-primary)}',
    '.dvb-menu-item[data-danger="true"]:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}',
    '.dvb-menu-glyph{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary)}',
    '.dvb-menu-item[data-danger="true"] .dvb-menu-glyph{color:inherit}',
    '.dvb-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l3)}',
    '.dvb-toast{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:70;max-width:calc(100% - 24px);padding:6px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 14px rgba(0,0,0,.18);pointer-events:none;animation:dvb-toast-in .16s ease-out}',
    '@keyframes dvb-toast-in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}',
    '.dvb-input{flex:1 1 auto;min-width:0;height:28px;padding:0 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
    '.dvb-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
    '.dvb-input:focus{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px}',
    // ---- address box + browsing history dropdown ------------------------
    '.dvb-addr-box{position:relative;flex:1 1 auto;min-width:0;display:flex;align-items:center}',
    '.dvb-history{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:30;max-height:280px;overflow-y:auto;padding:4px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 30px rgba(0,0,0,.28)}',
    '.dvb-history-item{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;font:inherit}',
    '.dvb-history-item:hover,.dvb-history-item-on{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dvb-history-title{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}',
    '.dvb-history-url{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
    // ---- stage ----------------------------------------------------------
    '.dvb-stage{position:relative;--dvb-scale:1;flex:1 1 auto;min-height:120px;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:8px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);outline:none}',
    '.dvb-stage[data-focus="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dvb-live{display:block;max-width:100%;max-height:100%;width:auto;height:auto;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);touch-action:none;user-select:none;-webkit-user-drag:none;cursor:none}',
    '.dvb-live[data-busy="true"]{cursor:progress}',
    // A zero-size anchor: the transform is exactly the viewport point, so the
    // arrow and the grabbing hand can keep their own hotspots and zoom sizes.
    '.dvb-cursor{position:absolute;left:0;top:0;width:0;height:0;z-index:9;pointer-events:none;opacity:0;will-change:transform}',
    '.dvb-cursor[data-visible="true"]{opacity:1}',
    '.dvb-cursor-arrow{position:absolute;left:calc(-2px * var(--dvb-scale,1));top:calc(-1.5px * var(--dvb-scale,1));width:calc(18px * var(--dvb-scale,1));height:calc(22px * var(--dvb-scale,1));filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));display:block}',
    '.dvb-cursor[data-mode="hand"] .dvb-cursor-arrow{display:none}',
    '.dvb-cursor-hand{display:none;position:absolute;left:calc(-8px * var(--dvb-scale,1));top:calc(-6px * var(--dvb-scale,1));width:calc(28px * var(--dvb-scale,1));height:calc(28px * var(--dvb-scale,1));filter:drop-shadow(0 1px 3px rgba(0,0,0,.35))}',
    '.dvb-cursor[data-mode="hand"] .dvb-cursor-hand{display:block}',
    '.dvb-ripple{position:absolute;left:0;top:0;z-index:10;width:calc(22px * var(--dvb-scale,1));height:calc(22px * var(--dvb-scale,1));margin:calc(-11px * var(--dvb-scale,1)) 0 0 calc(-11px * var(--dvb-scale,1));border-radius:50%;background:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));opacity:0;pointer-events:none;will-change:transform,opacity}',
    // The lock veil: a tinted, click-blocking layer over the picture while the
    // Agent is executing. The simulated pointer and the action graphics sit
    // above it, so the operation stays legible.
    '.dvb-lock{position:absolute;inset:0;z-index:5;display:flex;align-items:flex-start;justify-content:center;padding:10px 10px 0;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)) 24%,transparent);opacity:0;pointer-events:none;transition:opacity .15s ease;cursor:progress}',
    '.dvb-lock[data-on="true"]{opacity:1;pointer-events:auto}',
    '.dvb-lock-tag{display:inline-flex;align-items:center;gap:7px;max-width:calc(100% - 20px);min-width:0;padding:5px 11px;border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)) 88%,#000 12%);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:11.5px;line-height:1.35;box-shadow:0 3px 12px rgba(0,0,0,.25)}',
    '.dvb-lock-dot{width:7px;height:7px;flex:none;border-radius:50%;background:currentColor;animation:dvb-lock-pulse 1.1s ease-in-out infinite}',
    '.dvb-lock-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dvb-lock-hint{flex:none;color:color-mix(in srgb,currentColor 72%,transparent);font-size:10.5px}',
    '@keyframes dvb-lock-pulse{0%,100%{opacity:.35;transform:scale(.75)}50%{opacity:1;transform:scale(1.15)}}',
    '.dvb-scroll{position:absolute;left:0;top:0;z-index:8;width:calc(46px * var(--dvb-scale,1));height:calc(54px * var(--dvb-scale,1));margin:calc(-27px * var(--dvb-scale,1)) 0 0 calc(-23px * var(--dvb-scale,1));pointer-events:none;color:var(--dsw-alias-label-primary-foreground,#fff);filter:drop-shadow(0 1px 4px rgba(0,0,0,.5))}',
    '.dvb-scroll-rot{display:block;width:100%;height:100%;transform-origin:50% 50%}',
    '.dvb-scroll[data-direction="down"] .dvb-scroll-rot{transform:rotate(180deg)}',
    '.dvb-scroll[data-direction="left"] .dvb-scroll-rot{transform:rotate(-90deg)}',
    '.dvb-scroll[data-direction="right"] .dvb-scroll-rot{transform:rotate(90deg)}',
    '.dvb-scroll-anim{display:block;width:100%;height:100%;opacity:0}',
    '.dvb-key{position:absolute;left:50%;bottom:18%;z-index:11;display:inline-flex;align-items:center;justify-content:center;max-width:70%;padding:calc(5px * var(--dvb-scale,1)) calc(10px * var(--dvb-scale,1));border-radius:calc(8px * var(--dvb-scale,1));border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font:600 calc(12px * var(--dvb-scale,1))/1.25 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;box-shadow:0 3px 10px rgba(0,0,0,.3);will-change:transform,opacity}',
    '.dvb-key-text{overflow:hidden;text-overflow:ellipsis}',
    '.dvb-veil{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent);pointer-events:none}',
    '.dvb-retry{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 11px;border-radius:13px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;white-space:nowrap;cursor:pointer;pointer-events:auto}',
    '.dvb-retry:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dvb-inputerr{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);max-width:calc(100% - 24px);padding:4px 10px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1.35;text-align:center;pointer-events:none}',
    '.dvb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:20px 24px;color:var(--dsw-alias-label-secondary)}',
    '.dvb-empty-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}',
    '.dvb-empty-desc{max-width:340px;font-size:12px}',
    // ---- console --------------------------------------------------------
    '.dvb-log{flex:0 0 auto;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base)}',
    '.dvb-log-head-wrap{position:relative;flex:none;min-width:0}',
    '.dvb-log-head{display:flex;align-items:center;gap:6px;width:100%;padding:7px 44px 7px 10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}',
    '.dvb-log-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dvb-log-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:1;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit}',
    '.dvb-log-clear:hover{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}',
    '.dvb-log-chevron{display:inline-flex;transition:transform .16s ease}',
    '.dvb-log[data-open="true"] .dvb-log-chevron{transform:rotate(90deg)}',
    '.dvb-log-title{font-weight:600;color:var(--dsw-alias-label-secondary)}',
    '.dvb-log-count{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}',
    '.dvb-log-body{overflow-y:auto;overscroll-behavior:contain;max-height:min(44vh,320px);min-height:0;padding:2px 6px 0;display:flex;flex-direction:column;gap:1px;scrollbar-width:thin}',
    '.dvb-log[data-sized="true"] .dvb-log-body{max-height:none;height:var(--dvb-log-h,200px)}',
    '.dvb-split{flex:none;display:flex;align-items:center;justify-content:center;height:11px;margin:-1px 0;padding:0;border:0;background:transparent;cursor:ns-resize;touch-action:none}',
    '.dvb-split::before{content:"";width:36px;height:3px;border-radius:2px;background:var(--dsw-alias-border-l2);transition:background .12s ease}',
    '.dvb-split:hover::before,.dvb-split[data-active="true"]::before{background:var(--dsw-alias-brand-primary)}',
    '.dvb-split:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-3px;border-radius:6px}',
    '.dvb-log-empty{padding:5px 6px 10px;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}',
    '.dvb-console-row{display:grid;grid-template-columns:52px 42px minmax(0,1fr);align-items:start;gap:6px;padding:3px 6px;border-radius:6px;font:11.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;min-width:0}',
    '.dvb-console-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    '.dvb-console-time{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.65;white-space:nowrap}',
    '.dvb-console-level{flex:none;padding:0 4px;border-radius:4px;border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1.75;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dvb-console-text{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}',
    '.dvb-console-row[data-level="input"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}',
    '.dvb-console-row[data-level="input"] .dvb-console-text{color:var(--dsw-alias-label-primary)}',
    '.dvb-console-row[data-level="input"] .dvb-console-text::before{content:"> "}',
    '.dvb-console-row[data-level="result"] .dvb-console-text{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}',
    '.dvb-console-row[data-level="warn"] .dvb-console-text,.dvb-console-row[data-level="warn"] .dvb-console-level{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-primary))}',
    '.dvb-console-row[data-level="error"] .dvb-console-text{color:var(--dsw-alias-state-error-primary)}',
    '.dvb-console-row[data-level="error"] .dvb-console-level{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}',
    '.dvb-console-input-row{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;gap:6px;margin:2px -6px 0;padding:6px 8px;border-top:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base)}',
    '.dvb-console-prompt{flex:none;color:var(--dsw-alias-label-tertiary);font:600 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace}',
    '.dvb-console-input{flex:1 1 auto;min-width:0;height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:11.5px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}',
    '.dvb-console-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
    '.dvb-console-input:focus{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px}',
    '.dvb-console-run{flex:none;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}',
    '.dvb-console-run:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
    '.dvb-console-run:disabled{opacity:.4;cursor:default}',
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
    // ---- tab reference chips -------------------------------------------
    // One line-art browser glyph, masked so it follows the text colour in
    // both themes. The same variable draws the chip in the composer and the
    // one in the sent message.
    '  :root{--dvb-page-chip-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23fff%22 stroke-width=%221.25%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect x=%221.9%22 y=%223%22 width=%2212.2%22 height=%2210%22 rx=%222%22/%3E%3Cpath d=%22M1.9 6.1h12.2%22/%3E%3Ccircle cx=%224.4%22 cy=%224.55%22 r=%22.45%22 fill=%22%23fff%22 stroke=%22none%22/%3E%3C/svg%3E")}',
    '.dvb-page-ref{display:inline-flex;align-items:center;gap:5px;max-width:220px;height:22px;margin:0 1px;padding:0 8px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;line-height:20px;vertical-align:middle;user-select:none}',
    '.dvb-page-ref-icon{flex:none;width:13px;height:13px;background:var(--dsw-alias-label-secondary);-webkit-mask:var(--dvb-page-chip-icon) center/contain no-repeat;mask:var(--dvb-page-chip-icon) center/contain no-repeat}',
    '.dvb-page-ref-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
    '[data-composer-chip="browser-page"]{display:inline-flex;align-items:center;vertical-align:baseline;max-width:100%}',
    '[data-composer-chip="browser-page"] span[title]{display:inline-flex;align-items:center;gap:5px;max-width:220px;height:22px;padding:0 8px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;line-height:20px;vertical-align:middle;cursor:default}',
    // The composer chip's built-in domain glyph ("@" when no appearance is
    // set) is replaced by our own browser line icon to the left of the id.
    '[data-composer-chip="browser-page"] span[title] > span:first-child{display:none}',
    '[data-composer-chip="browser-page"] span[title]::before{content:"";flex:none;width:13px;height:13px;background:var(--dsw-alias-label-secondary);-webkit-mask:var(--dvb-page-chip-icon) center/contain no-repeat;mask:var(--dvb-page-chip-icon) center/contain no-repeat}',
    '[data-composer-chip="browser-page"] span[title] > span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}',
  ].join('\n');

  window.__ModuleLoader__.load({
    id: MODULE_ID,
    factory(require) {
      var React = require('react');
      var ReactDOM = require('react-dom');
      var h = React.createElement;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useRef = React.useRef;
      var useCallback = React.useCallback;
      var useMemo = React.useMemo;
      var useLayoutEffect = React.useLayoutEffect;

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
          case 'trash':
            return svg({ size: size || 13 }, [
              h('path', { key: 'a', d: 'M4 6.5h16' }),
              h('path', { key: 'b', d: 'M9.5 6.5V4.8h5v1.7' }),
              h('path', { key: 'c', d: 'M6.5 6.5l.9 13.2h9.2l.9-13.2' }),
              h('path', { key: 'd', d: 'M10.2 10v6.4' }),
              h('path', { key: 'e', d: 'M13.8 10v6.4' }),
            ]);
          case 'close':
            return svg({ size: size || 14 }, [
              h('path', { key: 'a', d: 'M6 6l12 12' }),
              h('path', { key: 'b', d: 'M18 6L6 18' }),
            ]);
          case 'link':
            return svg({ size: size || 14 }, [
              h('path', { key: 'a', d: 'M10.2 13.8a4.1 4.1 0 0 0 5.8 0l2.4-2.4a4.1 4.1 0 0 0-5.8-5.8l-1.2 1.2' }),
              h('path', { key: 'b', d: 'M13.8 10.2a4.1 4.1 0 0 0-5.8 0l-2.4 2.4a4.1 4.1 0 0 0 5.8 5.8l1.2-1.2' }),
            ]);
          case 'copy':
            return svg({ size: size || 14 }, [
              h('rect', { key: 'a', x: 9, y: 9, width: 10.5, height: 10.5, rx: 2.2 }),
              h('path', { key: 'b', d: 'M14.8 9V6.6A1.6 1.6 0 0 0 13.2 5H6.6A1.6 1.6 0 0 0 5 6.6v6.6a1.6 1.6 0 0 0 1.6 1.6H9' }),
            ]);
          case 'external':
            return svg({ size: size || 14 }, [
              h('path', { key: 'a', d: 'M13.5 5H19v5.5' }),
              h('path', { key: 'b', d: 'M19 5l-7.6 7.6' }),
              h('path', { key: 'c', d: 'M18.2 14.2v3.3a1.9 1.9 0 0 1-1.9 1.9H6.7a1.9 1.9 0 0 1-1.9-1.9V7.9A1.9 1.9 0 0 1 6.7 6h3.3' }),
            ]);
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
       * Height of the resizable console dock. The panel keeps the choice in
       * localStorage so a chosen split survives reopening the tab.
       */
      var LOG_HEIGHT_KEY = 'dsh.visual-browser.log-height.v1';
      /**
       * Whether the console dock was left open. It starts folded for a visitor
       * who has never opened it, so reopening the tab keeps the last choice.
       */
      var LOG_OPEN_KEY = 'dsh.visual-browser.log-open.v1';
      var LOG_MIN_HEIGHT = 96;
      var LOG_STAGE_RESERVE = 220;
      /** Gap between tabs, mirrored from `.dvb-tabs{gap}` for drag math. */
      var TAB_GAP = 4;

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

      /** Folded until the user opens it: opening the panel never reopens it. */
      function readStoredLogOpen() {
        try {
          return window.localStorage.getItem(LOG_OPEN_KEY) === 'true';
        } catch {
          return false;
        }
      }

      function storeLogOpen(value) {
        try {
          window.localStorage.setItem(LOG_OPEN_KEY, value ? 'true' : 'false');
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
        agentBusy: false,
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

      /**
       * The live composer in the conversation panel. The panel is a right
       * Sidebar tab, so the chat is a sibling surface in the same document; a
       * hidden session keeps its composer mounted, which is why visibility is
       * checked before the caret is taken.
       */
      function composerRoot() {
        var nodes = document.querySelectorAll('[data-composer-input]');
        for (var index = nodes.length - 1; index >= 0; index -= 1) {
          var node = nodes[index];
          if (!node || node.nodeType !== 1 || !node.isConnected) continue;
          var rect = node.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;
          var style = window.getComputedStyle(node);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          return node;
        }
        return null;
      }

      function placeCaretAtEnd(root) {
        var selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (selection !== null && selection.rangeCount > 0 && root.contains(selection.anchorNode)) return;
        var range = document.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
        if (selection !== null) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }

      /**
       * Put a tab reference into the chat composer, at the caret the user left
       * there. The composer is a Lexical editor: `execCommand` goes through its
       * before-input path, and a synthetic paste through the composer's own
       * paste handling, so the draft, undo history and chip scanning all stay
       * consistent. Nothing is ever submitted.
       */
      function insertComposerText(text) {
        var root = composerRoot();
        if (root === null) return false;
        try {
          root.focus({ preventScroll: true });
        } catch {
          root.focus();
        }
        placeCaretAtEnd(root);
        try {
          if (document.execCommand('insertText', false, text)) return true;
        } catch {
          /* fall through to the paste path */
        }
        try {
          var transfer = new DataTransfer();
          transfer.setData('text/plain', text);
          var event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
          try {
            Object.defineProperty(event, 'clipboardData', { value: transfer });
          } catch {
            /* the constructor may already carry it */
          }
          return root.dispatchEvent(event) === false;
        } catch {
          return false;
        }
      }

      /** The Session whose composer is mounted around this editor root. */
      function composerSessionId(root) {
        if (!root || typeof root.closest !== 'function') return '';
        var host = root.closest('[data-conversation-session]');
        var id = host === null ? null : host.getAttribute('data-conversation-session');
        return typeof id === 'string' ? id : '';
      }

      /**
       * The reference spelling the model receives and the chip's clipboard
       * form. The tab id is inside the brackets, so the Agent can name the tab
       * even though the bubble only shows that id.
       */
      function pageReferenceMention(page) {
        var id = page && page.id !== undefined && page.id !== null ? String(page.id) : '';
        return id === '' ? '' : '[' + CHIP_SOURCE + '>' + id + ']';
      }

      /**
       * Insert one page as an atomic reference chip in the chat composer —
       * the same way the built-in file reference puts a file chip there. The
       * Conversation service owns the Lexical editor, so its node is deleted
       * whole by one Backspace and survives draft persistence; its clipboard
       * form is exactly the `[browser-page>id]` text the model reads.
       *
       * Returns false when the composer or the chip API is unavailable, so the
       * caller can fall back to plain text (which the same UserText rule still
       * renders as a bubble once sent).
       */
      function insertComposerPageReference(ctx, page) {
        var mention = pageReferenceMention(page);
        if (mention === '') return false;
        var root = composerRoot();
        if (root === null) return false;
        var sessionId = composerSessionId(root);
        var conversation = ctx.get('conversation');
        var shell = null;
        if (sessionId !== '' && conversation && conversation.input && typeof conversation.input.shell === 'function') {
          try {
            shell = conversation.input.shell(sessionId);
          } catch {
            shell = null;
          }
        }
        if (shell !== null && typeof shell.addFiles === 'function') {
          // Restore the caret the user left in this composer before the chip is
          // appended; Lexical remembers it across the panel interaction. A
          // focus failure must not cost the chip itself.
          if (typeof shell.focus === 'function') {
            try {
              shell.focus();
            } catch {
              /* the insertion still lands at the editor's selection or end */
            }
          }
          try {
            var inserted = shell.addFiles(
              [
                {
                  source: CHIP_SOURCE,
                  ref: mention,
                  label: String(page.id),
                  clipboardText: mention,
                },
              ],
              [],
            );
            if (inserted === true) return true;
          } catch (error) {
            console.warn(
              '[dsh-visual-browser] composer chip insertion failed:',
              error && error.message ? error.message : error,
            );
          }
        }
        return insertComposerText(mention + ' ');
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
        var [logOpen, setLogOpen] = useState(readStoredLogOpen);
        var [logHeight, setLogHeight] = useState(readStoredLogHeight);
        var [resizing, setResizing] = useState(false);
        var [consoleDraft, setConsoleDraft] = useState('');
        var [consoleBusy, setConsoleBusy] = useState(false);
        var [live, setLive] = useState(false);
        var [streamRetry, setStreamRetry] = useState(0);
        var [retrying, setRetrying] = useState(false);
        var [focused, setFocused] = useState(false);
        // Agent-operation veil: `agentBusy` is the local animation lock, while
        // `state.agentBusy` is the host's own answer (the fallback when the
        // cue stream is unavailable and for operations that outlive an animation).
        var [agentBusy, setAgentBusy] = useState(false);
        var [agentLabel, setAgentLabel] = useState('');
        // Tab-strip chrome: the right-click menu, the tab being dragged, a
        // local move order that survives until the host state catches up, and
        // the small confirmation pill.
        var [tabMenu, setTabMenu] = useState(null);
        var [tabDrag, setTabDrag] = useState(null);
        var [tabOrder, setTabOrder] = useState(null);
        var [toast, setToast] = useState('');
        // URL-bar browsing history dropdown (shows while the input is focused).
        var [historyOpen, setHistoryOpen] = useState(false);
        var [historyIndex, setHistoryIndex] = useState(-1);
        var historyListRef = useRef(null);

        var rootRef = useRef(null);
        var logRef = useRef(null);
        var logBodyRef = useRef(null);
        var splitRef = useRef(null);
        var tabsRef = useRef(null);
        var addrRef = useRef(null);
        var stageRef = useRef(null);
        var canvasRef = useRef(null);
        var menuRef = useRef(null);
        var dragRef = useRef(null);
        var flipRef = useRef(null);
        var toastTimerRef = useRef(0);
        var orderTimerRef = useRef(0);
        var suppressClickRef = useRef(false);
        var autoScrollRef = useRef({ frame: 0, dir: 0 });
        var liveRef = useRef(false);
        var lastFrameAtRef = useRef(0);
        var cursorRef = useRef(null);
        var rippleRef = useRef(null);
        var scrollRef = useRef(null);
        var keyRef = useRef(null);
        // Where the drawn pointer currently sits, in stage pixels.
        var cursorStageRef = useRef(null);
        var cursorAnimRef = useRef(null);
        var scrollSeqRef = useRef(0);
        var keySeqRef = useRef(0);
        // Agent-lock bookkeeping: keep the veil up until the last drawn
        // animation (and, for navigation, until the host really finished).
        var lockedRef = useRef(false);
        var lockUntilRef = useRef(0);
        var lockTimerRef = useRef(0);
        var longCueRef = useRef(false);
        var eventsLiveRef = useRef(false);
        var playCueRef = useRef(null);
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
                  applyScale();
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

        /**
         * The picture is displayed at whatever size the pane allows, so the
         * drawn cursor, ripple and action graphics scale with it. The factor is
         * exposed as `--dvb-scale` for CSS and used to map viewport coordinates
         * (the Agent's coordinate space) onto stage pixels.
         */
        var applyScale = function () {
          var canvas = canvasRef.current;
          var stage = stageRef.current;
          if (!canvas || !stage) return 1;
          var rect = canvas.getBoundingClientRect();
          var intrinsic = canvas.width > 0 ? canvas.width : (state.viewport && state.viewport.width) || 1280;
          var scale = rect.width > 1 ? rect.width / intrinsic : 1;
          scale = Math.min(2.5, Math.max(0.15, scale));
          stage.style.setProperty('--dvb-scale', String(Math.round(scale * 1000) / 1000));
          return scale;
        };

        var stagePointFromViewport = function (x, y) {
          var canvas = canvasRef.current;
          var stage = stageRef.current;
          if (!canvas || !stage) return null;
          var cRect = canvas.getBoundingClientRect();
          var sRect = stage.getBoundingClientRect();
          if (cRect.width < 2) return null;
          var scale = cRect.width / (canvas.width > 0 ? canvas.width : 1);
          return {
            x: cRect.left - sRect.left + Number(x || 0) * scale,
            y: cRect.top - sRect.top + Number(y || 0) * scale,
          };
        };

        var pictureCenter = function () {
          var canvas = canvasRef.current;
          var stage = stageRef.current;
          if (!canvas || !stage) return { x: 0, y: 0 };
          var cRect = canvas.getBoundingClientRect();
          var sRect = stage.getBoundingClientRect();
          return {
            x: cRect.left - sRect.left + cRect.width / 2,
            y: cRect.top - sRect.top + cRect.height / 2,
          };
        };

        useEffect(
          function () {
            var canvas = canvasRef.current;
            var stage = stageRef.current;
            if (!canvas || !stage) return undefined;
            applyScale();
            if (typeof ResizeObserver !== 'function') {
              var onResize = function () {
                applyScale();
              };
              window.addEventListener('resize', onResize);
              return function () {
                window.removeEventListener('resize', onResize);
              };
            }
            var observer = new ResizeObserver(function () {
              applyScale();
            });
            observer.observe(canvas);
            observer.observe(stage);
            return function () {
              observer.disconnect();
            };
          },
          [state.running, state.startedAt],
        );

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
          cursorStageRef.current = { x: x, y: y };
          ring.setAttribute('data-mode', 'arrow');
          ring.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
          ring.setAttribute('data-visible', 'true');
        };

        var hideCursor = function () {
          var ring = cursorRef.current;
          if (ring) ring.setAttribute('data-visible', 'false');
        };

        var reduceMotion = function () {
          try {
            return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          } catch {
            return false;
          }
        };

        var playRippleAt = function (x, y) {
          var mark = rippleRef.current;
          if (!mark || typeof mark.animate !== 'function') return;
          try {
            mark.animate(
              [
                { transform: 'translate3d(' + x + 'px,' + y + 'px,0) scale(.35)', opacity: 0.5 },
                { transform: 'translate3d(' + x + 'px,' + y + 'px,0) scale(2.1)', opacity: 0 },
              ],
              { duration: reduceMotion() ? 120 : 340, easing: 'ease-out' },
            );
          } catch {
            /* older engines simply skip the ripple */
          }
        };

        var ripple = function (event) {
          var stage = stageRef.current;
          if (!stage) return;
          var stageRect = stage.getBoundingClientRect();
          playRippleAt(event.clientX - stageRect.left, event.clientY - stageRect.top);
        };

        var setCursorMode = function (mode) {
          var ring = cursorRef.current;
          if (ring) ring.setAttribute('data-mode', mode);
        };

        // ---- agent operation animation ------------------------------------

        var cancelCursorAnimation = function () {
          var animation = cursorAnimRef.current;
          cursorAnimRef.current = null;
          if (animation !== null) {
            try {
              animation.cancel();
            } catch {
              /* already finished */
            }
          }
        };

        var moveCursorTo = function (x, y, duration) {
          var ring = cursorRef.current;
          if (!ring) return Promise.resolve();
          var from = cursorStageRef.current || pictureCenter();
          cursorStageRef.current = { x: x, y: y };
          cancelCursorAnimation();
          ring.setAttribute('data-mode', 'arrow');
          ring.setAttribute('data-visible', 'true');
          var finalTransform = 'translate3d(' + x + 'px,' + y + 'px,0)';
          if (!(duration > 0) || typeof ring.animate !== 'function') {
            ring.style.transform = finalTransform;
            return Promise.resolve();
          }
          var animation = null;
          try {
            animation = ring.animate(
              [
                { transform: 'translate3d(' + from.x + 'px,' + from.y + 'px,0)' },
                { transform: finalTransform },
              ],
              { duration: duration, easing: 'cubic-bezier(.3,0,.18,1)', fill: 'forwards' },
            );
          } catch {
            ring.style.transform = finalTransform;
            return Promise.resolve();
          }
          cursorAnimRef.current = animation;
          var settle = function () {
            if (cursorAnimRef.current === animation) cursorAnimRef.current = null;
            ring.style.transform = finalTransform;
            try {
              animation.cancel();
            } catch {
              /* finished */
            }
          };
          return animation.finished.then(settle, settle);
        };

        /** The clenched hand travels the drag path while the real drag runs. */
        var moveHandTo = function (from, to, duration) {
          var ring = cursorRef.current;
          if (!ring) return Promise.resolve();
          cancelCursorAnimation();
          var finalTransform = 'translate3d(' + to.x + 'px,' + to.y + 'px,0)';
          cursorStageRef.current = { x: to.x, y: to.y };
          var ms = Math.max(0, Math.round(duration || 0));
          if (ms === 0 || typeof ring.animate !== 'function') {
            ring.style.transform = finalTransform;
            return Promise.resolve();
          }
          var frames = [];
          for (var index = 0; index <= 16; index += 1) {
            var t = index / 16;
            var eased = t * t * (3 - 2 * t);
            frames.push({
              offset: t,
              transform:
                'translate3d(' +
                (from.x + (to.x - from.x) * eased) +
                'px,' +
                (from.y + (to.y - from.y) * eased) +
                'px,0)',
            });
          }
          var animation = null;
          try {
            animation = ring.animate(frames, { duration: ms, easing: 'linear', fill: 'forwards' });
          } catch {
            ring.style.transform = finalTransform;
            return Promise.resolve();
          }
          cursorAnimRef.current = animation;
          var settle = function () {
            if (cursorAnimRef.current === animation) cursorAnimRef.current = null;
            ring.style.transform = finalTransform;
            try {
              animation.cancel();
            } catch {
              /* finished */
            }
          };
          return animation.finished.then(settle, settle);
        };

        /** Big chevrons drift the way the page scrolls, then fade away. */
        var playScroll = function (direction, point, reduce) {
          var el = scrollRef.current;
          if (!el) return;
          el.setAttribute('data-direction', direction);
          el.style.left = point.x + 'px';
          el.style.top = point.y + 'px';
          var target = el.querySelector('.dvb-scroll-anim');
          if (!target || typeof target.animate !== 'function') return;
          try {
            target.animate(
              [
                { transform: 'translateY(18px) scale(.72)', opacity: 0 },
                { transform: 'translateY(0px) scale(1)', opacity: 1, offset: 0.28 },
                { transform: 'translateY(-38px) scale(1.08)', opacity: 0 },
              ],
              { duration: reduce ? 130 : 620, easing: 'ease-out' },
            );
          } catch {
            /* no animation support: the lock still shows what is happening */
          }
        };

        /** A keycap for key presses and native <select> picks. */
        var playKey = function (text, reduce) {
          var el = keyRef.current;
          if (!el) return;
          var label = el.querySelector('.dvb-key-text');
          if (label) label.textContent = text;
          if (typeof el.animate !== 'function') return;
          try {
            el.animate(
              [
                { transform: 'translateX(-50%) translateY(12px) scale(.82)', opacity: 0 },
                { transform: 'translateX(-50%) translateY(0) scale(1)', opacity: 1, offset: 0.24 },
                { transform: 'translateX(-50%) translateY(-14px) scale(1)', opacity: 0 },
              ],
              { duration: reduce ? 140 : 560, easing: 'ease-out' },
            );
          } catch {
            /* no animation support */
          }
        };

        var ackActivity = function (id) {
          if (id === undefined || id === null) return;
          void fetch(API + '/ack', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: id }),
          }).catch(function () {
            /* the host's own timeout releases the action anyway */
          });
        };

        var lockNow = function (value) {
          lockedRef.current = value;
          setAgentBusy(value);
        };

        /** Keep the veil up for at least `ms`, never shortening an earlier hold. */
        var holdLock = function (ms) {
          if (!lockedRef.current) lockNow(true);
          var until = Date.now() + Math.max(0, ms || 0);
          if (until > lockUntilRef.current) lockUntilRef.current = until;
          if (lockTimerRef.current !== 0) window.clearTimeout(lockTimerRef.current);
          var wait = Math.max(0, lockUntilRef.current - Date.now());
          lockTimerRef.current = window.setTimeout(function () {
            lockTimerRef.current = 0;
            if (Date.now() + 15 < lockUntilRef.current) return;
            lockNow(false);
          }, wait + 15);
        };

        var actionLabelFor = function (cue) {
          var kind = String(cue.kind || '');
          var detail = typeof cue.detail === 'string' ? cue.detail : '';
          if (kind === 'scroll') return tRef.current('agent.scroll.' + String(cue.direction || 'down'));
          var base = kindLabel(kind);
          if (kind === 'type') return tRef.current('agent.typing') + (detail ? ' · ' + detail : '');
          return detail ? base + ' · ' + detail : base;
        };

        /**
         * One Agent cue: start the pointer travel, the click ripple, the scroll
         * arrows, the drag hand or a keycap, then ack the host so it dispatches
         * the real input right when the drawing says it happens.
         */
        var playCue = function (cue) {
          if (!cue || cue.type !== 'activity') return;
          var kind = String(cue.kind || 'action');
          if (cue.phase === 'end') {
            longCueRef.current = false;
            holdLock(reduceMotion() ? 90 : 190);
            void refreshState();
            return;
          }
          if (cue.phase !== 'start') return;
          var reduce = reduceMotion();
          setAgentLabel(actionLabelFor(cue));
          longCueRef.current = kind === 'open' || kind === 'back' || kind === 'forward' || kind === 'reload';
          // Navigation can outlive any single animation: let the host's own
          // busy flag take over the veil by reading it right away.
          if (longCueRef.current) void refreshState();
          var canvas = canvasRef.current;
          if (!canvas || !stageRef.current || canvas.getBoundingClientRect().width < 2) {
            holdLock(500);
            ackActivity(cue.id);
            return;
          }
          var center = pictureCenter();
          var start = cursorStageRef.current || center;
          var travelFor = function (to) {
            if (reduce) return 40;
            var distance = Math.sqrt((to.x - start.x) * (to.x - start.x) + (to.y - start.y) * (to.y - start.y));
            return Math.round(Math.min(420, Math.max(150, distance * 0.55)));
          };
          switch (kind) {
            case 'click':
            case 'upload': {
              var point = stagePointFromViewport(cue.x, cue.y) || center;
              var travel = travelFor(point);
              holdLock(travel + (reduce ? 220 : 500));
              moveCursorTo(point.x, point.y, travel).then(function () {
                playRippleAt(point.x, point.y);
                ackActivity(cue.id);
              });
              break;
            }
            case 'hover': {
              var point = stagePointFromViewport(cue.x, cue.y) || center;
              var travel = travelFor(point);
              holdLock(travel + 340);
              moveCursorTo(point.x, point.y, travel).then(function () {
                ackActivity(cue.id);
              });
              break;
            }
            case 'type': {
              var point = Number.isFinite(cue.x) && Number.isFinite(cue.y) ? stagePointFromViewport(cue.x, cue.y) : null;
              if (!point) {
                holdLock(700);
                ackActivity(cue.id);
                break;
              }
              var travel = travelFor(point);
              holdLock(travel + (reduce ? 220 : 520));
              moveCursorTo(point.x, point.y, travel).then(function () {
                ackActivity(cue.id);
              });
              break;
            }
            case 'drag': {
              var from = Number.isFinite(cue.x) && Number.isFinite(cue.y) ? stagePointFromViewport(cue.x, cue.y) : center;
              var to = Number.isFinite(cue.toX) && Number.isFinite(cue.toY) ? stagePointFromViewport(cue.toX, cue.toY) : from;
              var travel = travelFor(from);
              var dragMs = reduce ? 140 : Math.max(120, Math.min(2000, Number(cue.durationMs) || 420));
              holdLock(travel + dragMs + 520);
              moveCursorTo(from.x, from.y, travel).then(function () {
                setCursorMode('hand');
                ackActivity(cue.id);
                void moveHandTo(from, to, dragMs).then(function () {
                  setCursorMode('arrow');
                  playRippleAt(to.x, to.y);
                });
              });
              break;
            }
            case 'scroll': {
              var point = stagePointFromViewport(cue.x, cue.y) || center;
              holdLock(reduce ? 260 : 760);
              playScroll(String(cue.direction || 'down'), point, reduce);
              ackActivity(cue.id);
              break;
            }
            case 'key': {
              holdLock(reduce ? 260 : 620);
              playKey(String(cue.detail || ''), reduce);
              ackActivity(cue.id);
              break;
            }
            case 'select': {
              holdLock(reduce ? 260 : 620);
              playKey(String(cue.detail || kindLabel('select')), reduce);
              ackActivity(cue.id);
              break;
            }
            case 'open':
            case 'back':
            case 'forward':
            case 'reload': {
              holdLock(600);
              ackActivity(cue.id);
              break;
            }
            default: {
              holdLock(600);
              ackActivity(cue.id);
            }
          }
        };
        playCueRef.current = playCue;

        useEffect(
          function () {
            return function () {
              if (lockTimerRef.current !== 0) window.clearTimeout(lockTimerRef.current);
              cancelCursorAnimation();
            };
          },
          [],
        );

        // The host pushes a cue the instant an Agent tool starts acting, so the
        // veil goes up before the click lands instead of a poll later. A cue
        // stream that dies keeps the state-poll fallback alive.
        useEffect(
          function () {
            if (!state.running) {
              eventsLiveRef.current = false;
              return undefined;
            }
            var cancelled = false;
            var controller = null;
            var reader = null;
            var retryTimer = 0;
            var decoder = new TextDecoder();
            var buffer = '';
            var schedule = function () {
              if (cancelled || retryTimer !== 0) return;
              retryTimer = window.setTimeout(function () {
                retryTimer = 0;
                void connect();
              }, 1500);
            };
            var connect = async function () {
              if (cancelled) return;
              controller = new AbortController();
              try {
                var response = await fetch(API + '/events?r=' + (state.startedAt || 0), {
                  signal: controller.signal,
                  cache: 'no-store',
                });
                if (cancelled) return;
                if (!response.ok || !response.body) {
                  eventsLiveRef.current = false;
                  schedule();
                  return;
                }
                eventsLiveRef.current = true;
                reader = response.body.getReader();
                var loop = async function () {
                  var step = await reader.read();
                  if (cancelled) return;
                  if (step.done) {
                    eventsLiveRef.current = false;
                    schedule();
                    return;
                  }
                  buffer += decoder.decode(step.value, { stream: true });
                  var index;
                  while ((index = buffer.indexOf('\n')) >= 0) {
                    var line = buffer.slice(0, index);
                    buffer = buffer.slice(index + 1);
                    if (line === '') continue;
                    try {
                      var cue = JSON.parse(line);
                      if (typeof playCueRef.current === 'function') playCueRef.current(cue);
                    } catch {
                      /* a malformed cue is not worth tearing the stream down */
                    }
                  }
                  await loop();
                };
                void loop();
              } catch {
                if (cancelled) return;
                eventsLiveRef.current = false;
                schedule();
              }
            };
            void connect();
            return function () {
              cancelled = true;
              eventsLiveRef.current = false;
              if (retryTimer !== 0) window.clearTimeout(retryTimer);
              try {
                if (reader) void reader.cancel();
              } catch {
                /* already closed */
              }
              try {
                if (controller) controller.abort();
              } catch {
                /* already closed */
              }
            };
          },
          [state.running, state.startedAt],
        );

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
          if (!state.running || !state.allowUserControl || lockedRef.current) return;
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
          if (!state.running || !state.allowUserControl || lockedRef.current) return;
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
              if (!state.running || !state.allowUserControl || lockedRef.current) return;
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
          if (!state.running || !state.allowUserControl || lockedRef.current) return;
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
          if (!state.running || !state.allowUserControl || lockedRef.current) return;
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
          if (!state.running || !state.allowUserControl || lockedRef.current) return;
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

        var toDraftEnd = function () {
          window.setTimeout(function () {
            var input = addrRef.current;
            if (!input) return;
            input.focus();
            try {
              var len = input.value.length;
              input.setSelectionRange(len, len);
            } catch {
              /* older engines ignore it */
            }
          }, 0);
        };

        // Highlight the history entry that currently matches the draft (first
        // match), or none, when opening the dropdown for the first time.
        var previewIndexFromDraft = function () {
          if (draft.trim() === '') return -1;
          var wanted = draft.trim();
          for (var i = 0; i < historyEntries.length; i++) {
            if (historyEntries[i].url === wanted || shortUrl(historyEntries[i].url) === shortUrl(wanted)) return i;
          }
          return -1;
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

        // Once the host reports the order a drop previewed, the local overlay
        // has done its job; keeping it longer would mask a new tab or a close.
        useEffect(
          function () {
            if (tabOrder === null) return;
            var ids = (Array.isArray(state.pages) ? state.pages : []).map(function (page) {
              return page.id;
            });
            if (ids.length !== tabOrder.length) return;
            for (var index = 0; index < ids.length; index += 1) {
              if (ids[index] !== tabOrder[index]) return;
            }
            setTabOrder(null);
            if (orderTimerRef.current !== 0) {
              window.clearTimeout(orderTimerRef.current);
              orderTimerRef.current = 0;
            }
          },
          [state.pages, tabOrder],
        );

        // Chrome-style drop: every tab starts from where it was visually before
        // the order changed (the lifted tab included) and slides to its slot.
        useLayoutEffect(
          function () {
            var flip = flipRef.current;
            if (flip === null) return;
            flipRef.current = null;
            var strip = tabsRef.current;
            if (!strip) return;
            var nodes = strip.querySelectorAll('[data-tab-id]');
            var all = [];
            for (var index = 0; index < nodes.length; index += 1) {
              all.push(nodes[index]);
            }
            // Cancel the drag preview's transforms (and any transition still
            // running on them) before measuring the settled layout. Measuring
            // while the preview transform is mid-transition produced a bogus
            // delta and made neighbour tabs animate from their old slots.
            all.forEach(function (node) {
              node.style.transition = 'none';
              node.style.transform = '';
            });
            void strip.offsetWidth;
            var moving = [];
            all.forEach(function (node) {
              var before = flip.lefts.get(node.getAttribute('data-tab-id'));
              if (before === undefined) return;
              var after = node.getBoundingClientRect().left;
              var delta = before - after;
              if (Math.abs(delta) < 0.5) {
                node.style.transition = '';
                return;
              }
              node.style.transform = 'translateX(' + delta + 'px)';
              moving.push(node);
            });
            if (moving.length === 0) return;
            window.requestAnimationFrame(function () {
              window.requestAnimationFrame(function () {
                moving.forEach(function (node) {
                  node.style.transition = 'transform 190ms cubic-bezier(.2,0,0,1)';
                  node.style.transform = '';
                });
                window.setTimeout(function () {
                  moving.forEach(function (node) {
                    node.style.transition = '';
                    node.style.transform = '';
                  });
                }, 240);
              });
            });
          },
          [tabOrder, tabDrag],
        );

        // The context menu is a light-dismiss layer: outside press, Escape,
        // window resize or blur close it. Scroll is deliberately not a dismiss
        // trigger: the console dock auto-scrolls as page output arrives and the
        // tab strip scrolls the active chip into view, so a capture-phase scroll
        // listener would close the menu while the pointer is merely moving.
        useEffect(
          function () {
            if (tabMenu === null) return undefined;
            var onPointerDown = function (event) {
              if (menuRef.current !== null && menuRef.current.contains(event.target)) return;
              setTabMenu(null);
            };
            var onKeyDown = function (event) {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setTabMenu(null);
            };
            var onDismiss = function () {
              setTabMenu(null);
            };
            window.addEventListener('pointerdown', onPointerDown, true);
            window.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('resize', onDismiss);
            window.addEventListener('blur', onDismiss);
            return function () {
              window.removeEventListener('pointerdown', onPointerDown, true);
              window.removeEventListener('keydown', onKeyDown, true);
              window.removeEventListener('resize', onDismiss);
              window.removeEventListener('blur', onDismiss);
            };
          },
          [tabMenu],
        );

        useLayoutEffect(
          function () {
            if (tabMenu === null) return;
            var menu = menuRef.current;
            if (menu === null) return;
            var rect = menu.getBoundingClientRect();
            var left = Math.max(8, Math.min(tabMenu.x, window.innerWidth - rect.width - 8));
            var top = Math.max(8, Math.min(tabMenu.y, window.innerHeight - rect.height - 8));
            menu.style.left = Math.round(left) + 'px';
            menu.style.top = Math.round(top) + 'px';
          },
          [tabMenu],
        );

        // One teardown for every strip timer/listener: a closed pane must not
        // keep a drag listener or a toast timeout alive.
        useEffect(
          function () {
            return function () {
              detachDragListeners();
              dragRef.current = null;
              if (toastTimerRef.current !== 0) window.clearTimeout(toastTimerRef.current);
              if (orderTimerRef.current !== 0) window.clearTimeout(orderTimerRef.current);
            };
          },
          [],
        );

        // Follow the newest console line unless the user has scrolled up to
        // read history; an eval answer or a page log then stays in view.
        useEffect(
          function () {
            var body = logBodyRef.current;
            if (!body) return;
            var distance = body.scrollHeight - body.scrollTop - body.clientHeight;
            if (distance < 80) body.scrollTop = body.scrollHeight;
          },
          [state.console, logOpen, logHeight],
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

        // Persist the fold itself: the panel remounts on every tab switch, and
        // a visitor who closed the console never wants it back automatically.
        var toggleLogOpen = function () {
          var next = !logOpen;
          storeLogOpen(next);
          setLogOpen(next);
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

        var serverPages = Array.isArray(state.pages) ? state.pages : [];
        // A drop reorders the strip immediately; the host's poll catches up a
        // moment later, so a local order bridges the gap and is dropped as soon
        // as the polled page order is the one we already show.
        var pages = serverPages;
        if (tabOrder !== null) {
          var byId = new Map(
            serverPages.map(function (page) {
              return [page.id, page];
            }),
          );
          var ordered = [];
          tabOrder.forEach(function (id) {
            var page = byId.get(id);
            if (page !== undefined) {
              ordered.push(page);
              byId.delete(id);
            }
          });
          serverPages.forEach(function (page) {
            if (byId.has(page.id)) ordered.push(page);
          });
          pages = ordered;
        }
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

        var showToast = function (text) {
          setToast(text);
          if (toastTimerRef.current !== 0) window.clearTimeout(toastTimerRef.current);
          toastTimerRef.current = window.setTimeout(function () {
            toastTimerRef.current = 0;
            setToast('');
          }, 1900);
        };

        var postPage = function (body) {
          return requestJson('/page', { method: 'POST', body: body }).then(
            function (data) {
              if (data && data.state) {
                stateJsonRef.current = JSON.stringify(data.state);
                setState(data.state);
                setReachable(true);
              }
              return data;
            },
            function (failure) {
              setError(failure && failure.message ? failure.message : String(failure));
              return null;
            },
          );
        };

        var postConsole = function (body) {
          return requestJson('/console', { method: 'POST', body: body }).then(
            function (data) {
              if (data && data.state) {
                stateJsonRef.current = JSON.stringify(data.state);
                setState(data.state);
                setReachable(true);
              }
              return data;
            },
            function (failure) {
              setError(failure && failure.message ? failure.message : String(failure));
              return null;
            },
          );
        };

        var referencePage = function (page) {
          showToast(insertComposerPageReference(ctx, page) ? t('toast.referenced') : t('toast.noComposer'));
        };

        /**
         * A page the browser never navigated anywhere (`about:blank`, or a tab
         * Chrome has not resolved yet) has no link to copy and nothing to hand
         * to another browser, so both menu rows stay off for it.
         */
        var pageLink = function (page) {
          var url = page === null || page === undefined ? '' : page.url;
          if (typeof url !== 'string') return '';
          var trimmed = url.trim();
          return /^https?:\/\//i.test(trimmed) ? trimmed : '';
        };

        /**
         * Copy without depending on one clipboard API: the panel lives on
         * dsh-app:// inside Electron, where `navigator.clipboard` can refuse a
         * write even from a click, while the old `execCommand('copy')` path
         * still runs inside the gesture. Try the modern one, fall back once.
         */
        var copyText = function (text) {
          var legacyCopy = function () {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.top = '-1000px';
            area.style.opacity = '0';
            document.body.appendChild(area);
            var copied = false;
            try {
              area.select();
              copied = document.execCommand('copy');
            } catch {
              copied = false;
            }
            document.body.removeChild(area);
            return copied;
          };
          var clipboard = navigator.clipboard;
          if (clipboard !== null && clipboard !== undefined && typeof clipboard.writeText === 'function') {
            return clipboard.writeText(text).then(
              function () {
                return true;
              },
              function () {
                return legacyCopy();
              },
            );
          }
          return Promise.resolve(legacyCopy());
        };

        var copyPageLink = function (page) {
          var link = pageLink(page);
          if (link === '') return;
          void copyText(link).then(function (copied) {
            showToast(copied ? t('toast.copied') : t('toast.copyFailed'));
          });
        };

        /**
         * Your own browser is not this Chrome: the host hands the URL to the
         * operating system's default handler (`/external`), which needs no
         * window from the panel and works the same in the desktop shell and in
         * a plain web page.
         */
        var openPageExternal = function (page) {
          var link = pageLink(page);
          if (link === '') return;
          requestJson('/external', { method: 'POST', body: { url: link } }).then(
            function () {
              showToast(t('toast.externalOpened'));
            },
            function () {
              showToast(t('toast.externalFailed'));
            },
          );
        };

        var holdOrder = function (ids) {
          setTabOrder(ids);
          if (orderTimerRef.current !== 0) window.clearTimeout(orderTimerRef.current);
          orderTimerRef.current = window.setTimeout(function () {
            orderTimerRef.current = 0;
            setTabOrder(null);
          }, 4000);
        };

        var tabShift = function (index) {
          if (tabDrag === null || tabDrag.started !== true) return 0;
          var dragged = pages[index];
          if (dragged === undefined || dragged.id === tabDrag.id) return 0;
          var step = tabDrag.width + TAB_GAP;
          if (tabDrag.fromIndex < tabDrag.overIndex) {
            if (index > tabDrag.fromIndex && index <= tabDrag.overIndex) return -step;
          } else if (tabDrag.fromIndex > tabDrag.overIndex) {
            if (index >= tabDrag.overIndex && index < tabDrag.fromIndex) return step;
          }
          return 0;
        };

        var updateDrag = function (clientX) {
          var drag = dragRef.current;
          if (drag === null) return;
          var scrollDelta = drag.strip ? drag.strip.scrollLeft - drag.scrollAtStart : 0;
          var deltaX = clientX - drag.startClientX + scrollDelta;
          // Chrome's tab-strip rule: the lifted tab's leading edge decides for
          // tabs behind it and its trailing edge decides for tabs ahead of it,
          // each against that tab's centre — never the lifted tab's own centre.
          // That makes the hand-off happen exactly when the lifted chip touches
          // the neighbour's middle, instead of halfway through a wide tab.
          var left = drag.startLeft + (clientX - drag.startClientX);
          var right = left + drag.width;
          var overIndex = drag.fromIndex;
          drag.order.forEach(function (id, index) {
            if (id === drag.id) return;
            var rect = drag.rects.get(id);
            if (!rect) return;
            var center = rect.left + rect.width / 2 - scrollDelta;
            if (index > drag.fromIndex && right > center) overIndex += 1;
            else if (index < drag.fromIndex && left < center) overIndex -= 1;
          });
          drag.deltaX = deltaX;
          drag.lastClientX = clientX;
          drag.overIndex = Math.max(0, Math.min(drag.order.length - 1, overIndex));
          setTabDrag({
            id: drag.id,
            fromIndex: drag.fromIndex,
            overIndex: drag.overIndex,
            deltaX: drag.deltaX,
            width: drag.width,
            started: true,
          });
        };

        var dragAutoScroll = function () {
          var drag = dragRef.current;
          if (drag === null) {
            autoScrollRef.current.frame = 0;
            return;
          }
          var strip = drag.strip;
          if (strip && autoScrollRef.current.dir !== 0) {
            var before = strip.scrollLeft;
            strip.scrollLeft = before + autoScrollRef.current.dir * 9;
            if (strip.scrollLeft !== before) updateDrag(drag.lastClientX);
          }
          autoScrollRef.current.frame = window.requestAnimationFrame(dragAutoScroll);
        };

        var setAutoScroll = function (clientX) {
          var drag = dragRef.current;
          if (drag === null || drag.strip === null) return;
          var rect = drag.strip.getBoundingClientRect();
          var edge = 26;
          autoScrollRef.current.dir = clientX < rect.left + edge ? -1 : clientX > rect.right - edge ? 1 : 0;
          if (autoScrollRef.current.frame === 0) {
            autoScrollRef.current.frame = window.requestAnimationFrame(dragAutoScroll);
          }
        };

        var detachDragListeners = function () {
          window.removeEventListener('pointermove', onTabPointerMove, { passive: false });
          window.removeEventListener('pointerup', onTabPointerUp);
          window.removeEventListener('pointercancel', onTabPointerUp);
          window.removeEventListener('pointermove', onTabPointerMove);
          if (autoScrollRef.current.frame !== 0) {
            window.cancelAnimationFrame(autoScrollRef.current.frame);
            autoScrollRef.current.frame = 0;
          }
          autoScrollRef.current.dir = 0;
        };

        var onTabPointerMove = function (event) {
          var drag = dragRef.current;
          if (drag === null || event.pointerId !== drag.pointerId) return;
          if (drag.started !== true) {
            if (Math.abs(event.clientX - drag.startClientX) < 4 && Math.abs(event.clientY - drag.startClientY) < 4) return;
            drag.started = true;
            suppressClickRef.current = true;
          }
          if (event.cancelable) event.preventDefault();
          setAutoScroll(event.clientX);
          updateDrag(event.clientX);
        };

        var onTabPointerUp = function (event) {
          var drag = dragRef.current;
          if (drag === null || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
          detachDragListeners();
          dragRef.current = null;
          if (drag.started !== true) return;
          // Work out where every chip is *visually* at the moment of release
          // from the synchronous drag data, not from getBoundingClientRect:
          // React may not have painted the last pointermove yet, and measuring
          // the DOM then would start the settle from a stale (often original)
          // position, making the whole strip slide from where it used to be.
          var scrollDelta = drag.strip ? drag.strip.scrollLeft - drag.scrollAtStart : 0;
          var step = drag.width + TAB_GAP;
          var releaseX = Number.isFinite(event.clientX) ? event.clientX : drag.lastClientX;
          var before = new Map();
          drag.order.forEach(function (id, index) {
            if (id === drag.id) {
              before.set(id, drag.startLeft + (releaseX - drag.startClientX));
              return;
            }
            var origin = drag.rects.get(id);
            if (!origin) return;
            var shift = 0;
            if (drag.fromIndex < drag.overIndex) {
              if (index > drag.fromIndex && index <= drag.overIndex) shift = -step;
            } else if (drag.fromIndex > drag.overIndex) {
              if (index >= drag.overIndex && index < drag.fromIndex) shift = step;
            }
            before.set(id, origin.left - scrollDelta + shift);
          });
          flipRef.current = { lefts: before, id: drag.id };
          var ids = pages.map(function (page) {
            return page.id;
          });
          var fromIndex = ids.indexOf(drag.id);
          var targetIndex = Math.max(0, Math.min(ids.length - 1, drag.overIndex));
          setTabDrag(null);
          if (fromIndex >= 0 && targetIndex !== fromIndex) {
            var next = ids.slice();
            next.splice(fromIndex, 1);
            next.splice(targetIndex, 0, drag.id);
            holdOrder(next);
            void postPage({ action: 'move', id: drag.id, index: targetIndex });
          }
          window.setTimeout(function () {
            suppressClickRef.current = false;
          }, 0);
        };

        var onTabPointerDown = function (event, page, index) {
          if (event.button !== 0 || locked) return;
          if (event.target && typeof event.target.closest === 'function' && event.target.closest('.dvb-tab-close')) return;
          var strip = tabsRef.current;
          if (!strip) return;
          var rects = new Map();
          var order = [];
          var nodes = strip.querySelectorAll('[data-tab-id]');
          for (var cursor = 0; cursor < nodes.length; cursor += 1) {
            var id = nodes[cursor].getAttribute('data-tab-id');
            var rect = nodes[cursor].getBoundingClientRect();
            rects.set(id, { left: rect.left, width: rect.width });
            order.push(id);
          }
          var own = rects.get(page.id);
          if (!own) return;
          dragRef.current = {
            id: page.id,
            fromIndex: index,
            overIndex: index,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startLeft: own.left,
            width: own.width,
            rects: rects,
            order: order,
            strip: strip,
            scrollAtStart: strip.scrollLeft,
            lastClientX: event.clientX,
            deltaX: 0,
            started: false,
          };
          autoScrollRef.current.dir = 0;
          window.addEventListener('pointermove', onTabPointerMove, { passive: false });
          window.addEventListener('pointerup', onTabPointerUp);
          window.addEventListener('pointercancel', onTabPointerUp);
        };

        var openTabMenu = function (event, page) {
          event.preventDefault();
          event.stopPropagation();
          setTabMenu({ id: page.id, x: event.clientX, y: event.clientY });
        };

        var closeTabMenu = function () {
          setTabMenu(null);
        };

        var runMenuAction = function (action) {
          var page = tabMenu === null ? null : pages.find(function (candidate) { return candidate.id === tabMenu.id; });
          closeTabMenu();
          if (page === null) return;
          if (action === 'reload') void postPage({ action: 'reload', id: page.id });
          else if (action === 'copy-link') copyPageLink(page);
          else if (action === 'open-external') openPageExternal(page);
          else if (action === 'reference') referencePage(page);
          else if (action === 'close') void postPage({ action: 'close', id: page.id });
          else if (action === 'close-all') void postPage({ action: 'close-all' });
        };
        var menuPage =
          tabMenu === null
            ? null
            : pages.find(function (page) {
                return page.id === tabMenu.id;
              }) || null;

        var menuItem = function (options) {
          return h(
            'button',
            {
              key: options.key,
              type: 'button',
              role: 'menuitem',
              className: 'dvb-menu-item',
              'data-danger': String(options.danger === true),
              disabled: options.disabled === true,
              onClick: function () {
                runMenuAction(options.action);
              },
            },
            h('span', { className: 'dvb-menu-glyph' }, icon(options.glyph, 14)),
            h('span', null, options.label),
          );
        };

        var consoleLevelLabel = function (level) {
          var key = 'console.' + level;
          var text = t(key);
          return text === key ? level : text;
        };

        // Activity cues (lock tag, scroll arrows) still use the kind table.
        var kindLabel = function (kind) {
          var key = 'kind.' + kind;
          var text = t(key);
          return text === key ? kind : text;
        };

        var runConsole = function () {
          var code = consoleDraft;
          if (code.trim() === '' || consoleBusy || locked || !state.running) return;
          setConsoleBusy(true);
          setConsoleDraft('');
          void postConsole({ action: 'eval', code: code }).finally(function () {
            setConsoleBusy(false);
          });
        };

        var consoleEntries = Array.isArray(state.console) ? state.console : [];
        var historyEntries = Array.isArray(state.history) ? state.history : [];
        // A "start tab": the active page still sits on about:blank and the
        // panel switches to the minimal new-tab layout (URL box only).
        var activeIsBlank =
          state.running &&
          (pages.length === 0 ||
            (pages.length === 1 && (state.url === 'about:blank' || state.url === '')));
        // The local animation lock is authoritative; the host's own flag only
        // matters for operations that outlive their animation (navigation) or
        // when the cue stream is down.
        var locked = agentBusy || (state.agentBusy === true && (longCueRef.current || !eventsLiveRef.current));

        return h(
          'div',
          { className: 'dvb-root', ref: rootRef },
          // The tab strip is the topmost row, directly under the host's own
          // title bar. Always visible, even with one page: it is the page
          // switcher, the drag surface and the place the new-tab button lives.
          h(
            'div',
            { key: 'tabs', className: 'dvb-tabs', ref: tabsRef, role: 'tablist', 'aria-label': t('tab.strip') },
            pages.map(function (page, index) {
              var lifted = tabDrag !== null && tabDrag.started === true && tabDrag.id === page.id;
              var shift = tabDrag === null ? 0 : tabShift(index);
              var style = lifted
                ? { transform: 'translateX(' + Math.round(tabDrag.deltaX * 100) / 100 + 'px)' }
                : shift !== 0
                  ? { transform: 'translateX(' + shift + 'px)' }
                  : undefined;
              return h(
                'div',
                {
                  key: page.id,
                  className: 'dvb-tab',
                  'data-tab-id': page.id,
                  'data-current': String(page.active === true),
                  'data-dragging': String(lifted),
                  style: style,
                  onPointerDown: function (event) {
                    onTabPointerDown(event, page, index);
                  },
                  // The click target is the whole rounded chip, not just its
                  // label: padding, icon and the gap are the same control.
                  // A drag settles before this fires, and the × stops its own
                  // click, so neither can select the page by accident. Always
                  // tell the host, even when the chip already reads current:
                  // Chrome's foreground tab can drift from the panel, and this
                  // click is what brings it back.
                  onClick: function (event) {
                    if (suppressClickRef.current) {
                      event.preventDefault();
                      return;
                    }
                    if (locked) return;
                    void run('select-page', '/page', { action: 'select', id: page.id });
                  },
                  onContextMenu: function (event) {
                    openTabMenu(event, page);
                  },
                  onDragStart: function (event) {
                    event.preventDefault();
                  },
                },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-tab-label',
                    title: page.title || page.url || page.id,
                    role: 'tab',
                    'aria-selected': String(page.active === true),
                    disabled: locked,
                    // The container owns the click; a focused chip's keyboard
                    // activation still bubbles out of this button.
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
                    disabled: locked,
                    onPointerDown: function (event) {
                      event.stopPropagation();
                    },
                    onClick: function (event) {
                      event.stopPropagation();
                      void run('close-page', '/page', { action: 'close', id: page.id });
                    },
                  },
                  '×',
                ),
              );
            }),
            h(
              'button',
              {
                key: 'add',
                type: 'button',
                className: 'dvb-tab-add',
                title: t('tab.new'),
                'aria-label': t('tab.new'),
                disabled: !state.running || Boolean(busy) || locked,
                onClick: openNewPage,
              },
              icon('plus', 14),
            ),
          ),
          // One toolbar row: history buttons, the URL box, then the page
          // controls. The URL box took the title's place, so an address bar no
          // longer costs a second row under the tabs.
          h(
            'div',
            { key: 'bar', className: 'dvb-bar' },
            h(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                title: t('action.back'),
                'aria-label': t('action.back'),
                disabled: !state.running || Boolean(busy) || locked,
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
                disabled: !state.running || Boolean(busy) || locked,
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
                disabled: !state.running || Boolean(busy) || locked,
                onClick: function () {
                  void run('reload', '/nav', { action: 'reload' });
                },
              },
              icon('reload', 16),
            ),
            h(
              'div',
              { key: 'addr-box', className: 'dvb-addr-box' },
              h('input', {
                ref: addrRef,
                className: 'dvb-input',
                type: 'text',
                spellCheck: false,
                disabled: locked,
                placeholder: t('url.placeholder'),
                value: draft,
                onChange: function (event) {
                  setDirty(true);
                  setDraft(event.target.value);
                },
                onFocus: function () {
                  setHistoryOpen(true);
                  setHistoryIndex(previewIndexFromDraft());
                },
                onBlur: function (event) {
                  var next = event.relatedTarget;
                  if (next && historyListRef.current && historyListRef.current.contains(next)) return;
                  setHistoryOpen(false);
                  setHistoryIndex(-1);
                },
                onKeyDown: function (event) {
                  if (activeIsBlank) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setHistoryOpen(true);
                      setHistoryIndex(function (value) {
                        return historyEntries.length === 0 ? -1 : Math.min(historyEntries.length - 1, value + 1);
                      });
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setHistoryIndex(function (value) {
                        return historyEntries.length === 0 ? -1 : Math.max(0, value === -1 ? historyEntries.length - 1 : value - 1);
                      });
                      return;
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (historyIndex >= 0 && historyIndex < historyEntries.length) {
                        var picked = historyEntries[historyIndex];
                        setDirty(false);
                        setDraft(picked.url);
                        // Selecting with the keyboard fills the box and keeps it
                        // focused without navigating: the user may edit it.
                        toDraftEnd();
                      } else {
                        openOrStart();
                      }
                      return;
                    }
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    openOrStart();
                  }
                },
              }),
              historyOpen && !activeIsBlank
                ? null
                : historyOpen && historyEntries.length > 0 && activeIsBlank
                  ? h(
                      'div',
                      { key: 'dvb-history', className: 'dvb-history', ref: historyListRef, role: 'listbox' },
                      historyEntries.map(function (entry, index) {
                        return h(
                          'button',
                          {
                            key: entry.url,
                            type: 'button',
                            role: 'option',
                            'aria-selected': String(index === historyIndex),
                            className: 'dvb-history-item' + (index === historyIndex ? ' dvb-history-item-on' : ''),
                            onMouseDown: function (event) {
                              event.preventDefault();
                              setDirty(false);
                              setDraft(entry.url);
                              void run('open', '/start', { url: entry.url });
                              setHistoryOpen(false);
                              setHistoryIndex(-1);
                            },
                          },
                          h('span', { className: 'dvb-history-title' }, entry.title || shortUrl(entry.url) || entry.url),
                          h('span', { className: 'dvb-history-url' }, shortUrl(entry.url) || entry.url),
                        );
                      }),
                    )
                  : null,
            ),
            busy ? h('span', { key: 'busy', className: 'dvb-status' }, t('busy')) : null,
            h(
              'div',
              { key: 'tools', className: 'dvb-tools' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  title: t('tab.new'),
                  'aria-label': t('tab.new'),
                  disabled: !state.running || Boolean(busy) || locked,
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
                      disabled: Boolean(busy) || locked,
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
                      disabled: Boolean(busy) || locked,
                      onClick: openOrStart,
                    },
                    icon('play', 14),
                    t('action.start'),
                  ),
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
            state.running && !live
              ? h('div', { key: 'veil', className: 'dvb-veil' }, t(retrying ? 'error.frame' : 'connecting'))
              : null,
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
                  { key: 'retry', type: 'button', className: 'dvb-retry', title: t('action.reconnect'), onClick: retryStream },
                  icon('reload', 13),
                  t('action.reconnect'),
                )
              : null,
            // While an Agent tool is acting, a tinted veil covers the picture
            // and swallows the user's pointer; the drawn cursor and the action
            // graphics stay on top of it.
            state.running
              ? h(
                  'div',
                  {
                    key: 'lock',
                    className: 'dvb-lock',
                    'data-on': String(locked),
                    'aria-hidden': String(!locked),
                  },
                  h(
                    'div',
                    { className: 'dvb-lock-tag', role: 'status', 'aria-live': 'polite' },
                    h('span', { className: 'dvb-lock-dot' }),
                    h('span', { className: 'dvb-lock-text' }, agentLabel || t('agent.working')),
                    h('span', { className: 'dvb-lock-hint' }, t('agent.hint')),
                  ),
                )
              : null,
            h(
              'span',
              {
                key: 'cursor',
                className: 'dvb-cursor',
                ref: cursorRef,
                'data-visible': 'false',
                'data-mode': 'arrow',
                'aria-hidden': 'true',
              },
              // The pointer shape, not a ring: the page's own cursor is not part
              // of the screencast, so this is the only cursor the user sees.
              h(
                'svg',
                {
                  key: 'arrow',
                  className: 'dvb-cursor-arrow',
                  viewBox: '0 0 18 22',
                  fill: 'none',
                  'aria-hidden': true,
                  focusable: false,
                },
                h('path', {
                  d: 'M2 1.5 2 17.2 6.3 13.3 9 19.6 12 18.3 9.3 12.1 15.4 12.1 Z',
                  fill: '#fff',
                  stroke: '#111',
                  strokeWidth: 1.2,
                  strokeLinejoin: 'round',
                }),
              ),
              // A drag becomes a grabbing hand: fingers curl at the press and
              // open again when the drop lands.
              h(
                'svg',
                {
                  key: 'hand',
                  className: 'dvb-cursor-hand',
                  viewBox: '0 0 28 28',
                  fill: 'none',
                  'aria-hidden': true,
                  focusable: false,
                },
                h('path', {
                  d: 'M7 14.2V9.4a1.8 1.8 0 0 1 3.6 0v3.1V7.2a1.8 1.8 0 0 1 3.6 0v5V8.4a1.8 1.8 0 0 1 3.6 0v4.9V9.8a1.8 1.8 0 0 1 3.6 0v6.1c0 4.4-2.9 7.3-7.4 7.3h-1c-2.7 0-4.7-1.2-6.2-3.5l-1.8-2.7a1.8 1.8 0 0 1 2.9-2l1.5 1.8Z',
                  fill: '#fff',
                  stroke: '#111',
                  strokeWidth: 1.2,
                  strokeLinejoin: 'round',
                }),
              ),
            ),
            h('span', { key: 'ripple', className: 'dvb-ripple', ref: rippleRef, 'aria-hidden': 'true' }),
            h(
              'span',
              {
                key: 'scroll',
                className: 'dvb-scroll',
                ref: scrollRef,
                'data-direction': 'down',
                'aria-hidden': 'true',
              },
              h(
                'span',
                { className: 'dvb-scroll-rot' },
                h(
                  'span',
                  { className: 'dvb-scroll-anim' },
                  h(
                    'svg',
                    {
                      viewBox: '0 0 46 54',
                      width: '100%',
                      height: '100%',
                      fill: 'none',
                      stroke: 'currentColor',
                      strokeWidth: 5.5,
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                      'aria-hidden': true,
                      focusable: false,
                    },
                    h('path', { key: 'a', d: 'M10 32 L23 19 L36 32' }),
                    h('path', { key: 'b', d: 'M10 48 L23 35 L36 48' }),
                  ),
                ),
              ),
            ),
            h(
              'span',
              { key: 'keycap', className: 'dvb-key', ref: keyRef, 'aria-hidden': 'true' },
              h('span', { className: 'dvb-key-text' }),
            ),
          ),
          logOpen
            ? h('button', {
                type: 'button',
                ref: splitRef,
                className: 'dvb-split',
                role: 'separator',
                'aria-orientation': 'horizontal',
                'aria-label': t('console.resize'),
                'aria-valuemin': LOG_MIN_HEIGHT,
                'aria-valuemax': logHeightLimit(),
                'aria-valuenow': logHeight !== null ? logHeight : undefined,
                title: t('console.resize'),
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
              'div',
              { key: 'log-head', className: 'dvb-log-head-wrap' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dvb-log-head',
                  title: logOpen ? t('console.collapse') : t('console.expand'),
                  'aria-expanded': String(logOpen),
                  onClick: toggleLogOpen,
                },
                h('span', { className: 'dvb-log-chevron' }, icon('chevron', 12)),
                h('span', { className: 'dvb-log-title' }, t('console.title')),
                h(
                  'span',
                  { className: 'dvb-log-count' },
                  consoleEntries.length > 0 ? String(consoleEntries.length) + ' ' + t('console.count') : '',
                ),
                h('span', { className: 'dvb-spacer' }),
                reachable ? null : h('span', { className: 'dvb-status' }, t('state.offline')),
              ),
              consoleEntries.length > 0
                ? h(
                    'button',
                    {
                      key: 'clear',
                      type: 'button',
                      className: 'dvb-log-clear',
                      title: t('console.clearTitle'),
                      'aria-label': t('console.clearTitle'),
                      onClick: function () {
                        void postConsole({ action: 'clear' });
                      },
                    },
                    icon('trash', 13),
                  )
                : null,
            ),
            logOpen
              ? h(
                  'div',
                  { className: 'dvb-log-body', ref: logBodyRef },
                  consoleEntries.length === 0
                    ? h('div', { className: 'dvb-log-empty' }, t('console.empty'))
                    : consoleEntries.map(function (entry) {
                          return h(
                            'div',
                            {
                              key: entry.id,
                              className: 'dvb-console-row',
                              'data-level': entry.level,
                              title: entry.url || '',
                            },
                            h('span', { className: 'dvb-console-time' }, clock(entry.ts)),
                            h('span', { className: 'dvb-console-level' }, consoleLevelLabel(entry.level)),
                            h('span', { className: 'dvb-console-text' }, entry.text),
                          );
                        }),
                  h('div', { key: 'console-fill', style: { flex: '1 1 auto', minHeight: '2px' } }),
                  h(
                    'div',
                    { key: 'console-input', className: 'dvb-console-input-row' },
                    h('span', { className: 'dvb-console-prompt', 'aria-hidden': 'true' }, '>'),
                    h('input', {
                      className: 'dvb-console-input',
                      type: 'text',
                      spellCheck: false,
                      disabled: !state.running || locked || consoleBusy,
                      placeholder: t('console.placeholder'),
                      value: consoleDraft,
                      'aria-label': t('console.input'),
                      onChange: function (event) {
                        setConsoleDraft(event.target.value);
                      },
                      onKeyDown: function (event) {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        runConsole();
                      },
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-console-run',
                        disabled: consoleDraft.trim() === '' || consoleBusy || !state.running || locked,
                        onClick: runConsole,
                      },
                      consoleBusy ? '…' : t('console.run'),
                    ),
                  ),
                )
              : null,
          ),
          tabMenu !== null && menuPage !== null
            ? ReactDOM.createPortal(
                h(
                  'div',
                  {
                    className: 'dvb-menu',
                    ref: menuRef,
                    role: 'menu',
                    'aria-label': t('tab.strip'),
                    style: { left: tabMenu.x, top: tabMenu.y },
                    onContextMenu: function (event) {
                      event.preventDefault();
                    },
                  },
                  menuItem({
                    key: 'reload',
                    label: t('action.reload'),
                    glyph: 'reload',
                    action: 'reload',
                    disabled: !state.running || locked,
                  }),
                  // Both rows need a real http(s) link: a page Chrome never
                  // navigated has nothing to copy and nothing to hand over.
                  menuItem({
                    key: 'copy-link',
                    label: t('tab.copyLink'),
                    glyph: 'copy',
                    action: 'copy-link',
                    disabled: pageLink(menuPage) === '',
                  }),
                  menuItem({
                    key: 'open-external',
                    label: t('tab.openExternal'),
                    glyph: 'external',
                    action: 'open-external',
                    disabled: pageLink(menuPage) === '',
                  }),
                  menuItem({ key: 'reference', label: t('tab.reference'), glyph: 'link', action: 'reference' }),
                  menuItem({
                    key: 'close',
                    label: t('tab.close'),
                    glyph: 'close',
                    action: 'close',
                    disabled: !state.running || locked || pages.length <= 1,
                  }),
                  h('div', { key: 'sep', className: 'dvb-menu-sep', role: 'separator' }),
                  menuItem({
                    key: 'close-all',
                    label: t('tab.closeAll'),
                    glyph: 'trash',
                    action: 'close-all',
                    danger: true,
                    disabled: !state.running || locked || pages.length === 0,
                  }),
                ),
                document.body,
                'dvb-tab-menu',
              )
            : null,
          toast !== ''
            ? h('div', { key: 'toast', className: 'dvb-toast', role: 'status', 'aria-live': 'polite' }, toast)
            : null,
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
      // Chat reference
      // -------------------------------------------------------------------

      // A reference chip is persisted and sent as its clipboard form, so the
      // exact text the model reads is also the text a sent message carries.
      // The pattern is deliberately narrow: the id holds no whitespace or `]`.
      /**
       * Name one page reference in the text around a candidate position.
       * @param {string} text - the whole message text.
       * @param {number} from - first offset a candidate may start at.
       * @returns the UserText node, or undefined when no reference follows.
       */
      function nextPageReference(text, from) {
        var pattern = /\[browser-page>([^\]\s]+)\]/g;
        pattern.lastIndex = from;
        var found = pattern.exec(text);
        if (found === null) return undefined;
        return {
          id: CHIP_SOURCE,
          start: found.index,
          end: found.index + found[0].length,
          data: { id: found[1] },
        };
      }

      var PAGE_REFERENCE_RULE = {
        id: CHIP_SOURCE,
        order: 25,
        match: nextPageReference,
      };

      /**
       * The sent-message form of a page reference: a rounded chip carrying the
       * browser line icon and the same tab id the model reads.
       * @param {object} props - the UserText node and its original spelling.
       * @returns one inline chip.
       */
      function BrowserPageReference(props) {
        var data = props && props.node && props.node.data ? props.node.data : null;
        var id = data && typeof data.id === 'string' && data.id !== '' ? data.id : '';
        var raw = props && typeof props.raw === 'string' ? props.raw : '';
        return h(
          'span',
          { className: 'dvb-page-ref', title: raw !== '' ? raw : id },
          h('span', { className: 'dvb-page-ref-icon', 'aria-hidden': 'true' }),
          h('span', { className: 'dvb-page-ref-id' }, id !== '' ? id : raw),
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

          // A page chip needs three pieces: a serializer for the composer node
          // (the editor refuses a send whose chip has no codec), a UserText rule
          // for the sent text, and the bubble that rule renders.
          ctx.inject(['inputTriggers'], function (scope) {
            var inputTriggers = scope.get('inputTriggers');
            if (!inputTriggers || typeof inputTriggers.registerSource !== 'function') return;
            scope.effect(
              function () {
                return inputTriggers.registerSource({
                  // A chip resolves its serializer by source name, never by a
                  // typed trigger. Staying on `@` keeps the source inside the
                  // declared trigger set, and offering no candidates keeps the
                  // reference menu free of extra rows.
                  trigger: '@',
                  name: CHIP_SOURCE,
                  order: 100,
                  showGroupTitle: false,
                  candidates: function () {
                    return Promise.resolve([]);
                  },
                  codec: {
                    clipboardText: function (ref) {
                      return ref;
                    },
                    serialize: function (ref) {
                      return Promise.resolve(ref);
                    },
                  },
                });
              },
              'dsh-visual-browser: page reference serializer',
            );
          });

          ctx.inject(['uiConversation'], function (scope) {
            var conversation = scope.get('uiConversation');
            if (!conversation || !conversation.userText || typeof conversation.userText.register !== 'function') return;
            scope.effect(
              function () {
                return conversation.userText.register(PAGE_REFERENCE_RULE);
              },
              'dsh-visual-browser: page reference rule',
            );
          });

          register(
            'conversation.user.text.node',
            { key: CHIP_SOURCE, locale: NS },
            BrowserPageReference,
            'dsh-visual-browser: page reference bubble',
          );

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
