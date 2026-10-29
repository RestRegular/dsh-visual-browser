# dsh-visual-browser

A DeepSeek Harness plugin that gives the Agent a **real Chrome** and gives you a **live window into it** — as a tab in the **right Sidebar**, right under the built-in *Browser* entry.

- The Agent never reads the DOM. It reads a numbered list of *visible interactive
  elements* plus a short text excerpt — a few hundred tokens per page instead of a
  full DOM snapshot.
- **One tab strip per workspace.** Sessions in the same workspace share the
  strip and the Follow flag; another workspace's pages are invisible (and
  unaddressable) from here. `browser_open` puts a URL in a new tab of the
  calling workspace.
- The tab streams Chrome's own screencast (CDP `Page.startScreencast`) as a
  length-prefixed JPEG stream, decoded off the main thread onto a canvas. No
  screenshot polling, no per-frame request, no re-render of the panel per frame.
- Your pointer, wheel and keyboard go straight to the DevTools input domain in
  animation-frame batches: click, drag, scroll and type with normal latency
  instead of "screenshot after the fact" latency.
- The bottom **page console** shows the active page's own `console.*` output and
  uncaught exceptions live, and runs the script you type in it (Enter) right in
  that page, printing the returned value or the error. Its height is draggable,
  it collapses, and a clear button empties it.
- While the Agent drives, the panel **draws the operation**: a tinted lock veil
  covers the picture (the browser is locked for that moment), a simulated
  pointer travels to the target and a water ripple marks the click, scrolls get
  large arrows fading in the direction of travel, drags swap the pointer for a
  clenched hand, and key presses get a keycap. The drawn cursor, ripple and
  action graphics scale with the pane like everything else in the picture.
- Cookies persist across restarts (one dedicated Chrome profile), so a login the
  Agent performs once keeps working.
- Native widgets that are not page content are filled rather than faked: file
  choosers receive real paths, and date / time / month / week / colour / range
  inputs get a real value, so their OS dialogs and browser popups never block a
  headless session.

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
3. Watch the picture. Click, drag, wheel and type straight into it. The tab strip
   sits above the toolbar; the toolbar below it carries the address box (type a
   URL and press Enter) plus back / forward / reload / **new page** / stop / and
   **跟随 / Follow** — the takeover switch described below. A
   tab strip always shows (even with one page): ＋ adds a page, a chip switches
   to it, its × closes it (the last page stays).
   The whole rounded chip is the hit area — a click anywhere on it (padding,
   icon, title) switches pages, and dragging from anywhere on it reorders the
   strip (the × keeps its own click and close). Right-click a chip for refresh /
   copy link / open in your default browser / reference in the chat / close /
   close all; the lifted chip follows the
   pointer, slides on frosted glass, and the other chips move aside like
   Chrome's own tab strip. Every page is a real Chrome tab with its own history;
   only the active one is streamed and receives input. Over
   the picture the native pointer is hidden and the panel draws the cursor, so
   what you see is the page's own position; dragging selects text, moves
   sliders and pans real scrollbars (the browser keeps its scrollbars).

**Address-box history** — focusing the box opens a list of the pages this
browser has visited, on every tab and not just a fresh one: the whole history
when the box is empty, and only entries that start with what you typed
otherwise (the scheme and a leading `www.` are ignored). A perfect match closes
the list — there is nothing left to suggest, so Enter just submits what is in
the box. Each row is one line, “title - example.com”, cut with an ellipsis;
clicking a row fills the box and opens it in one go. ↑/↓ walk the list and write
the picked URL into the box, Enter opens it, Esc closes the list and restores the
box. Hovering a row reveals a × that forgets just that entry (Delete does the
same for the highlighted row); the page itself stays open.

**Reference a page in the chat** — right-click its tab and pick “引用到对话框 /
Reference in the chat”. The page drops into the composer as one atomic browser
chip (a rounded bubble with a browser line icon and the tab id), at the caret,
without sending anything. The chip travels as the text `[browser-page>p1]`, so
the Agent can tell exactly which tab the next message talks about; one
Backspace deletes the whole chip, and the sent message shows the same bubble.
The insertion path is the built-in file-reference one: the Conversation input
machine owns the node, so drafts and undo behave like every other reference.

**Copy the link, or hand the page to your own browser** — the same tab menu
copies the page's URL to the clipboard (“复制链接 / Copy link”, with a toast that
says whether it worked) and can open it in the operating system's default
browser (“在默认浏览器中打开 / Open in default browser”). Both rows stay disabled
for a tab that has no real `http(s)` link yet, such as a fresh `about:blank`
page. Opening goes through the host (`POST /visual-browser/api/external`), which
hands the URL to `rundll32` (Windows), `open` (macOS) or `xdg-open` (Linux) with
no shell in between — query strings survive as one argument, and this Chrome is
never reused for it.

The page console at the bottom is the active page's own console: webpage
`console.log` / `warn` / `error`, script exceptions, and anything you run from the
input line below it. Type an expression or statement and press Enter; the script
runs in the page (promises are awaited) and the returned value is printed. Click
the header to fold the console away; the panel remembers whether you left it
open and starts folded for a visitor who never opened it. Drag the handle above
it to choose how much room it takes (the picture keeps a minimum reserve), or
double-click the handle to reset. The trash button clears the console. The
chosen height is remembered too.

### Watching the Agent act

When a tool starts acting, the panel receives a cue before the input is sent
(a small NDJSON stream next to the frame stream). It raises the tinted veil,
moves its own pointer to the target, and only then acknowledges — the real
click happens when the drawn pointer arrives. The same channel drives:

| Operation | What the picture shows |
| --- | --- |
| `click` / `hover` | pointer travel, then a water-ripple click |
| `upload` | the same pointer travel to the control, then the file chooser is filled |
| `scroll` | big chevrons drifting and fading in the scroll direction |
| `drag` | a clenched hand from the press point to the drop point, then a release |
| `type` | pointer travel to the field and a typing badge |
| `key` / `select` | a keycap with the key name or option |
| `open`, `back`, `forward`, `reload` | the veil and the operation label until the page is ready |

The veil blocks the picture's pointer, wheel, keyboard, address bar and page
tabs, so a user gesture cannot race the Agent; it lifts by itself when the
operation ends. Every drawn element scales with the displayed picture, so the
panel looks right whether the sidebar is narrow or wide. `prefers-reduced-motion`
shortens the animations without removing the lock.

### Workspaces

Each **workspace** owns its own tab strip, even though every tab is a real page of the same Chrome. A page opened from a Session is visible in that Session and in every other Session of the same workspace; Sessions in another workspace (or a Session that is not in a workspace at all) never list it, never stream it, and cannot address it by page id. The address-box history, the page console and the Follow flag are scoped the same way. Switching to a Session of another workspace makes that workspace's active tab the foreground page (and restarts its live picture), so two workspaces never borrow each other's picture.

The workspace is resolved on the host from the Session that opened the tab: the panel sends its Session id, and the agent tools resolve the executing Session. A Session outside every workspace is isolated to itself.

### Tabs the page opens

A link or button with `target="_blank"` (or `window.open`) is not left
invisible: the host listens for new page targets, attaches them, and — when the
tab was opened during an input gesture — switches the panel to it, exactly
where Chrome put it. The new page appears as a chip in the strip, keeps its own
history, and closing the old opener leaves it live. Same-tab navigation is
followed too; a page that never finishes loading only holds the action for a
bounded grace period instead of freezing the session.

### Dark mode

The panel only uses `--dsw-alias-*` theme tokens for surfaces, text, borders,
hover and focus, so light and dark (and theme switches) need no extra rules. The
only literal colour in the bundle is the `#fff` fallback after
`--dsw-alias-label-primary-foreground`.

## Tools the Agent gets

| Tool | Purpose |
| --- | --- |
| `browser_open` | Open a URL in a new tab of the current workspace (launches Chrome on first use) and return the numbered view. A fresh workspace's blank tab is reused for its first open. |
| `browser_see` | Fresh numbered view of the current page. |
| `browser_act` | `click` / `upload` / `drag` / `type` / `key` / `hover` / `scroll` / `select` / `back` / `forward` / `reload` / `wait` / `close`, then return the new view **and, by default, a picture of the result in the same answer** — the old “click, screenshot, read_image” is one call. `screenshot: false` skips the picture, `read: false` only saves it, `delay_ms` waits before the shot. |
| `browser_text` | Read text of the page or of one element (a link also returns its `href`). |
| `browser_screenshot` | Capture a picture and hand it to the model in the same answer (`read: false` returns only the saved path). |
| `browser_cdp` | One raw CDP command (`method`, `params`, optional `page`) for what the numbered view cannot express — `Runtime.evaluate`, `Network.*`, `Emulation.*`. Routing it through the manager keeps the panel, the action log and the takeover mode on the same page. |

### Takeover: the Agent gets the panel

The **跟随 / Follow** button in the toolbar hands the whole panel to the Agent.
While it is on, a translucent sheet covers the panel — clear in the middle, a
pale orange-red vignette towards the edges — and takes every pointer event, so
nothing in the panel can be clicked, typed into or dragged. The Agent's own
operations then decide what you see: whichever tab it reads or acts on becomes
the active page, so the live picture switches to it by itself (this also holds
for `browser_cdp`, as long as the command names its `page`). Leave with **Esc**
or the **退出跟随 / Stop following** button on the sheet; closing the panel
leaves the mode in force, because Follow is remembered per workspace and the
next Session of that workspace opens with it still set. The Agent can keep the
tabs of another workspace moving without locking this panel: follow, the lock
veil and the pointer cues are routed by workspace.

### Native controls: the parts that are not page content

Some controls are drawn by the browser or the operating system, so they never
appear in a picture and CDP input never reaches them. The plugin writes the
value instead of pretending to click:

| Control | What happens |
| --- | --- |
| file picker (`<input type=file>`, any "upload" button) | `upload` with `files: ['/abs/a.png']` intercepts the chooser and hands the browser real paths — the page receives the same `change` event a human picking the file produces. A plain `click` that wants files reports `that click opened a file chooser` instead of leaving an OS dialog in front of a headless browser. |
| a control that only hides an `<input type=file>` | the files are written straight into the input, no click needed. |
| `input type=date / time / month / week / datetime-local` | `type` writes the value (`2026/10/6` → `2026-10-06`), so the calendar popup is never needed. |
| `input type=color` | `type` accepts `#1a2` and writes `#11aa22`. |
| `input type=range` | `type` writes a number, clamped to `min`/`max` and snapped to `step`; `drag` works normally too. |
| `<select>` | `select` writes the option and fires `input` + `change`. |

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

### Acting by coordinates

Anything visible in the picture can also be driven by position alone — `x` / `y`
in CSS pixels, the same scale as `browser_screenshot` — for the cases where the
element view has nothing to offer: canvas apps, maps, and every widget inside a
cross-origin iframe, where `querySelector` is blocked by the same-origin policy
while the DevTools input domain still hits whatever is under the pointer.

`drag` is a real gesture, not two clicks: press, N interpolated moves, release.
Every held move reports `button: 'left'` with `buttons: 1`, because that bitmask
is what tells Chrome's input pipeline the difference between hovering and
dragging; without it a slider still receives `mousedown`/`mousemove` and simply
refuses to move. `steps` (default 16) and `duration_ms` (default 420) shape the
path, `to_x` / `to_y` are the drop point, and a `ref` may stand in for the
starting `x` / `y`:

```
browser_act({ action: 'drag', x: 486, y: 421, to_x: 704, to_y: 421 })
browser_act({ action: 'click', x: 640, y: 400 })
```

## Configuration

Row config (in the profile's `cordis.patch.yml`, override by row id
`dsh-visual-browser`):

```yaml
- id: dsh-visual-browser
  config:
    headless: true            # false = visible Chrome window
    stealth: true             # look like a normal Chrome (see below); false = raw automation
    userAgent: ''             # explicit UA; default: the installed build's own
    extraArgs: []             # extra Chrome switches, appended last
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
    | `GET /state` | Status, viewport, tabs and the page console (tiny JSON poll). |
    | `GET /stream` | One long response of `[len][seq][jpeg]` frames. |
    | `POST /input` | A batch of pointer / wheel / key / text events. |
    | `POST /page` | new / select / close / reload / close-all / move one page. |
    | `POST /console` | eval a script in the active page, or clear the console. |
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
- Blocking JS dialogs are auto-accepted and noted in the page console.
- The panel route is served by the Harness web server on its existing origin;
  it performs no extra authentication, matching the other local panel routes.
- The stream is a raw binary response on purpose: `multipart/x-mixed-replace`
  parsing differs between browser builds, so the panel parses frames itself.
- The model-facing tools act on the **active page of the calling Session's
  workspace**: `browser_open` opens a new tab there and every read/act applies
  to that workspace's active page, so "the current page" stays unambiguous
  while other workspaces keep their own strips. In takeover mode the tools'
  `page` argument also moves that workspace's active page, which is how the
  panel follows the Agent.
- Requests time out and the panel always retries, so a connection that a sleep
  or a host restart black-holed recovers on its own instead of needing a page
  refresh.
- Headless mode is the default. Some sites behave differently headless; set
  `headless: false` when a site insists on a window.

## Looking like an ordinary browser

A page can tell a driven browser apart, and sites that bind a session to the
browser they handed it to kill that session once they see it. With `stealth:
true` (the default) the command line is built so the page sees a normal Chrome:

| Tell | Without stealth | With stealth |
| --- | --- | --- |
| `navigator.webdriver` | `true` — a remote debugging session counts as automation | `false` (`--disable-blink-features=AutomationControlled`) |
| `navigator.userAgent` | `… HeadlessChrome/155.0.0.0 …` | the installed build's own: `… Chrome/155.0.0.0 …` |
| `screen.width/height` | `800x600`, smaller than the window | `1920x1080` (a desktop screen larger than the viewport) |
| Background timers | throttled to 1 Hz when occluded, stalling session keep-alives | left at full rate |

The User-Agent version is read from the installed browser before launch (Chrome's
registry `BLBeacon` on Windows, `Info.plist` on macOS, `--version` on Linux) and
is Chrome's own reduced form (`<major>.0.0.0`), so it agrees with
`navigator.userAgentData` — an inconsistent pair is itself a fingerprint. When
the build cannot be read that way, the browser is asked over CDP after starting
and the same User-Agent is stamped on every target instead.

This is what makes a long-lived login on [doubao.com](https://www.doubao.com)
survive: before 0.10.0 every page it saw reported `webdriver: true` and the
headless User-Agent, and ByteDance's risk control signed the session out seconds
after it succeeded. If a profile was already through that mill, its stored device
id may be burnt: stop the browser and delete
`~/.dsh/visual-browser/chrome-profile` (or point `userDataDir` at a new
directory) so the next login starts from a clean identity.

`stealth: false` restores the raw automation command line, and `extraArgs` adds
your own switches after the built-in ones when a site needs something specific.

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
