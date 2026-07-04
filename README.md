# Svif

**Surf, swiftly.**

Svif is a small, fast web browser built on your operating system's own webview.
It is a personal project and a way for me to learn systems programming, so treat
it as a working prototype rather than a finished product. Stack is Tauri 2,
SolidJS, and Rust. No accounts, no sync, no telemetry. The goal is to skim the
surface of the web quickly enough to actually use it, not to replace your daily
driver.

> Status: it runs day to day on macOS. Windows and Linux build from the same
> codebase but are less tested. Expect rough edges, and see "Known limits" at
> the bottom before you rely on it for anything important.

This README is the only document. It covers how to run it, how it works, and why
it is built this way.

## Run it

```sh
pnpm install
pnpm tauri dev      # develop
pnpm tauri build    # bundle for the current OS
```

Prerequisites: Node 20 or newer, pnpm, and Rust stable. On Linux you also need
the WebKitGTK 4.1 stack (`webkit2gtk-4.1`), plus `gst-plugins-good`,
`gst-plugins-bad`, and `gst-libav` if you want video and livestreams to play.

### Everyday driving

| | macOS | Windows / Linux |
|---|---|---|
| New tab / close tab / reopen closed | ⌘T / ⌘W / ⇧⌘T | Ctrl+T / Ctrl+W / Ctrl+Shift+T |
| Focus address bar | ⌘L | Ctrl+L |
| Reload / find in page | ⌘R / ⌘F | Ctrl+R / Ctrl+F |
| Back / forward | ⌘[ / ⌘] | Ctrl+[ / Ctrl+] |
| Zoom in / out / reset | ⌘= / ⌘- / ⌘0 | Ctrl+= / Ctrl+- / Ctrl+0 |
| Mute tab | ⇧⌘M | Ctrl+Shift+M |
| Jump to tab N / cycle tabs | ⌘1-9 / ⌃Tab | Ctrl+1-9 / Ctrl+Tab |

Everything else lives in the `…` menu: zoom, find, mute, manual tab sleep, clear
browsing data, page inspector, and Settings (themes, fonts, search engine, start
page, default zoom, tab sleep policy, session restore, and a festive fireworks
toggle).

## How it works

### One window, many webviews

Tauri 2's multi-webview API (the `unstable` cargo feature) lets one native
window host multiple child webviews. Svif uses exactly that:

```
┌────────────────────────────────────────────┐
│  "chrome" webview (transparent, 86px)      │  SolidJS UI: tabs, toolbar,
│  tab strip, address bar, menus             │  menus, settings
├────────────────────────────────────────────┤
│                                            │
│  "tab-N" webview (one per awake tab)       │  the actual page
│                                            │
└────────────────────────────────────────────┘
```

- **Rust owns everything.** `src-tauri/src/tabs.rs` holds the canonical tab list
  (URL, title, favicon, audio state, mute, zoom, asleep) behind one mutex. Every
  mutation re-broadcasts a full JSON snapshot to the chrome via the `tabs-state`
  event. The chrome is a dumb renderer of that snapshot, so the two sides cannot
  drift apart and the UI needs no state reconciliation logic.
- **The chrome calls commands** (`tab_new`, `tab_select`, `tab_navigate`,
  `tab_mute`, `browser_action`, and so on). It never touches webviews directly.
- **Layout is Rust's job.** On resize or DPI change the window event handler
  recomputes physical bounds for the chrome strip and the active tab view.
  Background tabs are hidden, not destroyed, so audio keeps playing like the
  background tabs you are used to.

### The reporter: giving pages browser senses

wry (Tauri's webview layer) exposes no cross-platform API for page titles,
favicons, single-page-app URL changes, audio state, mute, zoom, or find in page.
Rather than write three platform backends, one injected script does all of it
the same way everywhere. `src-tauri/src/reporter.js` runs at document start in
every tab and:

- reports title, url, and favicon changes (history patching, plus a slow
  safety-net poll),
- tracks every `<video>` and `<audio>` element to report playing and audible
  state, and enforces tab mute against site JS that tries to unmute,
- applies zoom as CSS zoom (identical rendering on all three engines; wry has no
  native zoom on macOS),
- implements find in page via `window.find()` (next and previous; the engines
  expose no match counts),
- turns `window.open()` and `target=_blank` into real tabs,
- forwards browser keyboard shortcuts when focus is inside a page.

It talks back over Tauri IPC, which leads to the security model.

### Security model

Web content is hostile input. The ACL is split into two capabilities
(`src-tauri/capabilities/`):

- **`chrome-ui`**: full permissions, granted only to the `chrome` webview.
- **`tab-pages`**: granted to `tab-*` webviews for remote http(s) URLs. Its only
  purpose is getting IPC injected so the reporter can call home.

Because Tauri app commands are not ACL scoped, every command also verifies the
caller's webview label in Rust. Pages may only call `report_page_state`,
`open_tab_from_page`, and `page_shortcut` (an allow-listed action set).
Everything else rejects non-`chrome` callers. At worst a malicious page can lie
about its own title or open a tab, which is the same power any web page already
has. Navigation is restricted to http(s) and the internal start page, and other
schemes are dropped.

### Tab sleep and restore

Sleeping a tab destroys its webview and keeps its metadata. Waking it recreates
the webview at its last URL. A 20-second Rust loop sleeps background tabs after a
configurable idle period (default 15 minutes), skipping tabs that are loading or
playing media (also configurable). The same mechanism powers session restore: on
launch, every restored background tab starts asleep, so ten restored tabs cost
zero webviews until you click them. The session file is rewritten every sweep, so
a crash loses at most about 20 seconds.

Priority tiers fall out of this design for free. Active tabs are visible and full
speed, media tabs are hidden but never slept so streams and music keep running,
and idle tabs are hidden, throttled by the engine, and slept on timeout.

### Frosted glass

The window is created with native material effects: vibrancy (`Sidebar`) on
macOS and `Acrylic` or `Blur` on Windows. The chrome webview is transparent, so
every surface in the UI is a translucent tint over real OS blur. The native
window appearance follows the active theme, so a light theme does not show dark
system material through the glass. On Linux there is no compositor-independent
blur, so the chrome paints its own tinted gradient backdrop instead. macOS keeps
its native traffic lights; Windows and Linux run frameless with chrome-drawn
window buttons.

One quirk worth knowing: child webviews cannot be z-reordered, so when a menu or
the settings sheet opens, Rust expands the chrome webview to cover the window and
hides the page behind the glass. Closing the layer restores it. The find bar just
shifts the page down instead.

### Theming

A theme is eight CSS colors in a JSON file, nothing else. Bundled themes
(`src/themes.ts`): Glass Dark, Glass Light, Midnight, Aurora, Rosé, and Americana.
Import your own in Settings then Appearance (paste JSON; "Copy template" gives you
the starting point). Themes apply as CSS variables to the chrome and are passed
into the start page so it matches. Custom themes persist in `settings.json`.

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "dark": true,
  "colors": {
    "accent": "#6aa5ff", "text": "…", "textDim": "…", "glass": "…",
    "surface": "…", "border": "…", "field": "…", "page": "…"
  }
}
```

### Files

```
src-tauri/src/
  lib.rs        wiring: commands, setup, exit hooks
  tabs.rs       the tab engine (state, lifecycle, layout, sleep, session)
  settings.rs   persisted settings store (JSON in the platform config dir)
  menu.rs       macOS menu bar (native Edit roles and shortcuts)
  reporter.js   injected page instrumentation (see above)
src/
  App.tsx       chrome shell, chrome-side shortcuts
  state.ts      signals mirroring Rust broadcasts; URL and search resolution
  ipc.ts        typed command wrappers
  themes.ts     bundled themes, validation, template
  components/   TabStrip, Toolbar, MenuPopover, SettingsPanel, FindBar, and more
newtab.html + src/newtab.ts   the built-in start page
```

Settings and session live in the platform config directory (on macOS,
`~/Library/Application Support/dev.redrix.svif/`).

## Why it is built this way

- **Tauri over a bundled engine.** The OS already ships a browser engine, so
  Svif is roughly 10 MB and starts instantly. The trade-off is that engines
  differ per OS (WebKit, WebKitGTK, Chromium), and the reporter abstracts over
  them in one place instead of three.
- **Rust as the single source of truth.** A browser UI is a distributed-state
  bug factory. Snapshot broadcasting removes that whole class of bug in exchange
  for re-sending a couple of kilobytes of JSON on each change.
- **Injected JS over native APIs.** Mute, audio, and find have no wry APIs. The
  reporter is small, identical on all platforms, and degrades safely (worst case,
  a tab shows a stale title).
- **Solid over React.** Fine-grained reactivity, no virtual DOM, tiny bundle. The
  chrome updates per signal, which is why the UI stays smooth while many tabs
  push state updates.

## Scope

Svif is closer to a surfer than a full browser, and that is on purpose. It tries
to do everyday reading and browsing well and leaves the heavy application
platform features alone.

- Works well: reading, tabs, search, media playback and livestreams (MSE/HLS,
  like Twitch and YouTube), low memory use, themes.
- Not the goal: DRM streaming such as Netflix (depends on the OS engine),
  browser extensions, and guaranteed rendering parity across platforms.

## Known limits

- Back and forward availability is not queryable from wry, so the buttons are
  always enabled and do nothing at history edges.
- Audio detection sees `<video>` and `<audio>` elements. Pure Web Audio API sound
  (rare outside games) is not tracked, and mute covers media elements.
- No match counter in find in page, since `window.find` does not report one.
- Opening the `…` menu currently dims the page behind it. This is a known
  trade-off of the multi-webview layout and may change later.
- Tab drag-to-reorder and multiple windows are not implemented yet.

## License

MIT.
