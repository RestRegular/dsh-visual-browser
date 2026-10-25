# dsh-visual-browser

A DeepSeek Harness plugin that gives the Agent a **real Chrome** and gives you a **window into it**.

- The Agent never reads the DOM. It reads a numbered list of *visible interactive
  elements* plus a short text excerpt — a few hundred tokens per page instead of a
  full snapshot.
- Every action the Agent takes (click, type, key, scroll, navigation) is mirrored
  into a **面板 (panel)** with the page frame, an operation timeline you can replay,
  and a picture you can click to take over the browser yourself.
- Cookies persist across restarts (one dedicated Chrome profile), so a login the
  Agent performs once keeps working.

## Install

```bash
# The plugin is a normal DSH bundle; install it from the registry
dsh plugin add @restregular/dsh-visual-browser
```

Or from the Harness UI: **Plugins → Add → `@restregular/dsh-visual-browser`**.

Requirements: Google Chrome, Microsoft Edge, or Chromium on the machine
(auto-detected), and Node.js 22 or newer (the plugin ships no runtime
dependencies; it talks CDP over the built-in WebSocket).

## Use

1. Click the **浏览器 / Browser** icon in the sidebar to open the panel.
2. Ask the Agent something that needs a website, for example
   *"打开 example.com 看看首页写了什么"*. The Agent calls `browser_open`.
3. Watch the frame update. Click the picture to click the page; wheel over it to
   scroll; use the toolbar for back / forward / reload / live view / stop.

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
    frameQuality: 62          # JPEG quality of panel frames
    timelineFrames: 24        # replayable frames kept in memory
    allowUserControl: true    # allow clicks from the panel
    actionTimeoutMs: 12000
    navigationTimeoutMs: 30000
```

## How it works

- **Host** (`index.js`, `lib/`): launches Chrome with
  `--remote-debugging-port=0 --user-data-dir=<profile>`, parses the DevTools
  endpoint from stderr, attaches one flattened CDP session, and exposes:
  - five tools through the `tools` service (registration is effect-scoped),
  - a same-origin prefix route `/visual-browser/api` (`/state`, `/frame`,
    `/live`, `/start`, `/stop`, `/capture`, `/click`, `/wheel`, `/key`, `/nav`)
    that the panel polls and posts to.
- **Snapshot** (`lib/page-scripts.js`): one serialized function runs in the page,
  filters interactive elements to the viewport, assigns `data-dsh-vb-ref`
  numbers, and returns structured JSON. Nothing else about the DOM leaves the
  page.
- **Frames** stay on the host: the panel displays the newest JPEG by sequence
  number, so a live picture costs no session tokens. The timeline holds the last
  N frames; clicking a row replays that moment.
- **One code path**: panel clicks, wheel events and keys run the same
  `BrowserManager` methods the tools use.

Chrome is killed with its process tree when the plugin unloads.

## Notes and limits

- Cross-origin iframes are counted but not inspected; open the direct URL when a
  flow lives inside a frame.
- Blocking JS dialogs are auto-accepted and logged in the timeline.
- The panel route is served by the Harness web server on its existing origin;
  it performs no extra authentication, matching the other local panel routes.
- Headless mode is the default. Some sites behave differently headless; set
  `headless: false` when a site insists on a window.

## Development

```bash
npm test    # syntax checks + snapshot/format/route/package smoke tests
```

MIT © RestRegular
