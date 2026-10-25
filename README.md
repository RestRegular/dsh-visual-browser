# dsh-visual-browser

A DeepSeek Harness plugin that gives the Agent a **real Chrome** and gives you a **live window into it** — as a tab in the **right Sidebar**, right under the built-in *Browser* entry.

- The Agent never reads the DOM. It reads a numbered list of *visible interactive
  elements* plus a short text excerpt — a few hundred tokens per page instead of a
  full DOM snapshot.
- The tab streams Chrome's own screencast (CDP `Page.startScreencast`) as a
  length-prefixed JPEG stream, decoded off the main thread onto a canvas. No
  screenshot polling, no per-frame request, no re-render of the panel per frame.
- Your pointer, wheel and keyboard go straight to the DevTools input domain in
  animation-frame batches: click, drag, scroll and type with normal latency
  instead of "screenshot after the fact" latency.
- Every action — the Agent's and yours — lands in a collapsible, scrollable
  **operation log** whose height you can drag. Records only: there is nothing to
  replay.
- Cookies persist across restarts (one dedicated Chrome profile), so a login the
  Agent performs once keeps working.

## Install

```bash
dsh plugin add @restregular/dsh-visual-browser
```

Or from the Harness UI: **Plugins → Add → `@restregular/dsh-visual-browser`**.

Requirements: Google Chrome, Microsoft Edge, or Chromium on the machine
(auto-detected), and Node.js 22 or newer (the plugin ships no runtime
dependencies; it talks CDP over the built-in WebSocket).

## Use

1. Open the right Sidebar. Under the built-in **浏览器 / Browser** card sits the
   Visual Browser row — click it, or click the **浏览器** card itself and then the
   extra row beneath it. The tab opens and replaces the guide in that pane.
2. Ask the Agent something that needs a website, for example
   *"打开 example.com 看看首页写了什么"*. The Agent calls `browser_open`.
3. Watch the picture. Click, drag, wheel and type straight into it; the toolbar
   has back / forward / reload / stop, and the address bar opens any URL.

The operation log at the bottom remembers the Agent's actions and yours. Click
its header to fold it away, or scroll it when the list is longer than the pane.
Drag the handle above the log to choose how much room it takes (the picture keeps
a minimum reserve); double-click the handle to go back to the default, or focus
it and use ↑ / ↓ (Shift for bigger steps, Home / End for the extremes). The
chosen height is remembered per browser.

### Dark mode

The panel only uses `--dsw-alias-*` theme tokens for surfaces, text, borders,
hover and focus, so light and dark (and theme switches) need no extra rules. The
only literal colour in the bundle is the `#fff` fallback after
`--dsw-alias-label-primary-foreground`.

## Tools the Agent gets

| Tool | Purpose |
| --- | --- |
| `browser_open` | Open a URL (launches Chrome on first use) and return the numbered view. |
| `browser_see` | Fresh numbered view of the current page. |
| `browser_act` | `click` / `type` / `key` / `hover` / `scroll` / `select` / `back` / `forward` / `reload` / `wait` / `close`, then return the new view. |
| `browser_text` | Read text of the page or of one element (a link also returns its `href`). |
| `browser_screenshot` | Save a PNG/JPEG to disk and return the path (feed it to `read_image`). |

### What the Agent sees

```
URL: https://example.com/login
TITLE: 登录 - Example
VIEW: 1280x800 scroll 0/2400 · 4/6 interactive
[1] textbox "手机号" value=13800000000
[2] textbox "密码" value=••••••
[3] button "登录"
[4] link "忘记密码" → /forgot
HEADINGS: 用户登录 | 没有账号?
TEXT: 用户登录 手机号 密码 登录 忘记密码
ACTIVE: [1] textbox "手机号"
```

Numbers are reassigned on every view, so an action always uses the newest
numbers; a stale one fails with a clear "take a fresh snapshot" message instead
of clicking the wrong element.

## Configuration

Row config (in the profile's `cordis.patch.yml`, override by row id
`dsh-visual-browser`):

```yaml
- id: dsh-visual-browser
  config:
    headless: true            # false = visible Chrome window
    executablePath: ''        # explicit chrome.exe path
    userDataDir: ''           # default: ~/.dsh/visual-browser/chrome-profile
    viewport:
      width: 1280
      height: 800
    maxElements: 100          # cap on the numbered list
    maxTextChars: 320         # cap on the text excerpt
    streamQuality: 60         # JPEG quality of the live screencast
    allowUserControl: true    # allow clicks/typing from the panel
    reuseExisting: true       # adopt a Chrome that already owns the profile
    actionTimeoutMs: 12000
    navigationTimeoutMs: 30000
```

## How it works

- **Host** (`index.js`, `lib/`): launches Chrome with
  `--remote-debugging-port=0 --user-data-dir=<profile>`, parses the DevTools
  endpoint from stderr, attaches one flattened CDP session, and exposes:
  - five tools through the `tools` service (registration is effect-scoped),
  - a same-origin prefix route `/visual-browser/api`:
    | Route | Purpose |
    | --- | --- |
    | `GET /state` | Status, viewport and the operation log (tiny JSON poll). |
    | `GET /stream` | One long response of `[len][seq][jpeg]` frames. |
    | `POST /input` | A batch of pointer / wheel / key / text events. |
    | `POST /start`, `POST /stop`, `POST /nav` | Open a URL, close Chrome, back/forward/reload. |
- **Live picture** (`lib/browser.js`): `Page.startScreencast` pushes a JPEG per
  painted frame; the manager acks each frame and fans the same buffer out to every
  panel. The first subscriber restarts the screencast so a still page appears at
  once; the last one stops it, so a closed panel costs nothing. No screenshot is
  taken per click, and nothing about the picture touches the model context.
- **Input** (`lib/browser.js`): panel events become `Input.dispatchMouseEvent` /
  `Input.dispatchKeyEvent` / `Input.insertText` commands. Nothing waits for a
  snapshot or a capture, so input latency is one round trip; the client batches
  per animation frame so a drag or flick is one request, not thirty.
- **Snapshot** (`lib/page-scripts.js`): one serialized function runs in the page,
  filters interactive elements to the viewport, assigns `data-dsh-vb-ref`
  numbers, and returns structured JSON. Nothing else about the DOM leaves the
  page.
- **Survives a host restart**: Chrome writes `DevToolsActivePort` into its
  profile, so a restarted host (or one whose previous host crashed with Chrome
  still alive) attaches to that browser instead of failing on the profile lock.
  An adopted browser is only detached — its process is not killed.

Chrome is killed with its process tree when the plugin unloads.

## Notes and limits

- Cross-origin iframes are counted but not inspected; open the direct URL when a
  flow lives inside a frame.
- Blocking JS dialogs are auto-accepted and logged in the operation log.
- The panel route is served by the Harness web server on its existing origin;
  it performs no extra authentication, matching the other local panel routes.
- The stream is a raw binary response on purpose: `multipart/x-mixed-replace`
  parsing differs between browser builds, so the panel parses frames itself.
- Headless mode is the default. Some sites behave differently headless; set
  `headless: false` when a site insists on a window.

## Development

```bash
npm test    # syntax checks + snapshot/format/route/package smoke tests
```

`.dsh-probe/` (git-ignored) holds the manual probes used while developing:
`live-probe.mjs` drives the real browser end to end, `ui-probe.mjs` renders the
real client bundle in Chrome against the real host API and drives the panel with
real DOM events, and `build-css.mjs` copies the panel CSS and theme tokens for
that harness.

MIT © RestRegular
