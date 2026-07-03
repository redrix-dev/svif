# Svif

**glide, simply.**

A small, fast, frosted-glass web browser. Tauri 2 + SolidJS + TypeScript.
No accounts, no sync, no telemetry — a browser that is just a browser.

This README is the only document. It covers how to run it, how it works,
why it works, and why it is built this way.

---

## Run it

```sh
pnpm install
pnpm tauri dev      # develop
pnpm tauri build    # produce a signed-ready bundle for the current OS
```

Prerequisites: Node 20+, pnpm, Rust stable, and on Linux the WebKitGTK 4.1
stack (`webkit2gtk-4.1`, plus `gst-plugins-good`/`gst-plugins-bad` +
`gst-libav` if you want video and livestreams to play).

### Everyday driving

| | macOS | Windows / Linux |
|---|---|---|
| New tab / close tab / reopen closed | ⌘T / ⌘W / ⇧⌘T | Ctrl+T / Ctrl+W / Ctrl+Shift+T |
| Focus address bar | ⌘L | Ctrl+L |
| Reload / find in page | ⌘R / ⌘F | Ctrl+R / Ctrl+F |
| Back / forward | ⌘[ / ⌘] | Ctrl+[ / Ctrl+] |
| Zoom in / out / reset | ⌘+ / ⌘− / ⌘0 | Ctrl+= / Ctrl+− / Ctrl+0 |
| Mute tab | ⇧⌘M | Ctrl+Shift+M |
| Jump to tab N / cycle tabs | ⌘1–9 / ⌃Tab | Ctrl+1–9 / Ctrl+Tab |

Everything else lives in the `…` menu: zoom, find, mute, manual tab sleep,
clear browsing data, page inspector, and Settings (themes, fonts, search
engine, start page, default zoom, tab-sleep policy, session restore).

---

## How it works

### One window, many webviews

Tauri 2's multi-webview API (the `unstable` cargo feature) lets one native
window host multiple child webviews. Svif uses exactly that:

```
┌────────────────────────────────────────────┐
│  "chrome" webview (transparent, 86px)      │  ← SolidJS UI: tabs, toolbar,
│  tab strip · address bar · menus           │    menus, settings
├────────────────────────────────────────────┤
│                                            │
│  "tab-N" webview (one per awake tab)       │  ← the actual page
│                                            │
└────────────────────────────────────────────┘
```

- **Rust owns everything.** `src-tauri/src/tabs.rs` holds the canonical tab
  list (URL, title, favicon, audio state, mute, zoom, asleep) behind one
  mutex. Every mutation re-broadcasts a full JSON snapshot to the chrome via
  the `tabs-state` event. The chrome is a dumb renderer of that snapshot —
  the two sides cannot drift apart, and the UI needs no state reconciliation
  logic at all.
- **The chrome calls commands** (`tab_new`, `tab_select`, `tab_navigate`,
  `tab_mute`, `browser_action`, …). It never touches webviews directly.
- **Layout is Rust's job.** On resize/DPI change the window event handler
  re-computes physical bounds for the chrome strip and the active tab view.
  Background tabs are hidden, not destroyed — audio keeps playing, exactly
  like the background tabs you're used to.

### The reporter: giving pages browser senses

wry (Tauri's webview layer) exposes no cross-platform API for page titles,
favicons, SPA URL changes, audio state, mute, zoom, or find-in-page. Instead
of three platform backends, one injected script does all of it identically
everywhere: `src-tauri/src/reporter.js` runs at document-start in every tab
and

- reports `title` / `url` / `favicon` changes (history patching + observer +
  a slow safety-net poll),
- tracks every `<video>/<audio>` element to report *playing* and *audible*,
  and enforces tab mute against site JS that tries to unmute,
- applies zoom as CSS zoom (identical rendering on all three engines; wry has
  no native zoom on macOS),
- implements find-in-page via `window.find()` (next/previous; engines expose
  no match counts),
- converts `window.open()` and `target=_blank` into real tabs,
- forwards browser keyboard shortcuts when focus is inside a page.

It phones home over Tauri IPC. Which brings us to:

### Security model

Web content is hostile input. The ACL is split into two capabilities
(`src-tauri/capabilities/`):

- **`chrome-ui`** — full permissions, granted only to the `chrome` webview.
- **`tab-pages`** — granted to `tab-*` webviews for remote http(s) URLs; its
  only purpose is getting IPC injected so the reporter can call home.

Because Tauri app commands aren't ACL-scoped, **every command additionally
verifies the caller's webview label in Rust**: pages may only call
`report_page_state`, `open_tab_from_page`, and `page_shortcut` (an
allow-listed action set); everything else rejects non-`chrome` callers.
A malicious page can, at worst, lie about its own title or open a tab —
the same power any web page already has. Navigation is restricted to
`http(s)` and the internal start page; exotic schemes are dropped.

### Tab sleep & restore

Sleeping a tab = destroying its webview and keeping its metadata. Waking =
recreating the webview at its last URL. A 20-second Rust loop sleeps
background tabs after a configurable idle period (default 15 min), skipping
tabs that are loading or playing media (configurable). The same mechanism
powers session restore: on launch, every restored background tab *starts*
asleep — ten restored tabs cost zero webviews until you click them.
The session file is rewritten every sweep, so a crash loses at most ~20s.

Priority tiers fall out of this design for free: **active** (visible,
full speed) → **media** (hidden but never slept — streams and music keep
running) → **idle** (hidden, throttled by the engine, slept on timeout).

### Frosted glass

The window is created with native material effects — vibrancy (`Sidebar`) on
macOS, `Acrylic`/`Blur` on Windows — and the chrome webview is transparent,
so every surface in the UI is a translucent tint over real OS blur. On Linux
there is no compositor-independent blur, so the chrome paints its own tinted
gradient backdrop; same variables, honest fallback. macOS keeps its native
traffic lights (title-bar overlay); Windows/Linux run frameless with chrome-
drawn window buttons.

One quirk worth knowing: child webviews cannot be z-reordered, so when a
menu or the settings sheet opens, Rust expands the chrome webview to cover
the window and hides the page behind the glass. Closing the layer restores
it. The find bar just shifts the page down 44px instead.

### Theming

A theme is eight CSS colors in a JSON file — nothing else. Bundled themes
(`src/themes.ts`): Glass Dark, Glass Light, Midnight, Aurora, Rosé. Import
your own in Settings → Appearance (paste JSON; "Copy template" gives you the
starting point). Themes apply as CSS variables to the chrome and are passed
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
  menu.rs       macOS menu bar (native Edit roles + shortcuts)
  reporter.js   injected page instrumentation (see above)
src/
  App.tsx       chrome shell, chrome-side shortcuts
  state.ts      signals mirroring Rust broadcasts; URL/search resolution
  ipc.ts        typed command wrappers
  themes.ts     bundled themes, validation, template
  components/   TabStrip, Toolbar, MenuPopover, SettingsPanel, FindBar, …
newtab.html + src/newtab.ts   the built-in start page
```

Settings/session live in the platform config dir (macOS:
`~/Library/Application Support/dev.redrix.svif/`).

---

## Why it's built this way

- **Tauri over a bundled engine** — the OS already ships a browser engine;
  Svif is ~10 MB and starts instantly. The trade-off is accepted
  honestly: engines differ per OS (WebKit / WebKitGTK / Chromium), and the
  reporter abstracts over them in one place instead of three.
- **Rust as the single source of truth** — a browser UI is a distributed-
  state bug factory. Snapshot broadcasting deletes the whole bug class in
  exchange for re-sending ~2 KB of JSON on each change.
- **Injected JS over native APIs** — mute/audio/find have no wry APIs. The
  reporter is ~150 lines, identical on all platforms, and degrades safely
  (worst case: a tab shows a stale title).
- **Solid over React** — fine-grained reactivity, no VDOM, ~7 KB; the chrome
  re-renders per-signal, which is why the UI stays put while ten tabs
  hammer state updates.
- **One doc file** — if it can't be explained in one README, it isn't
  simple enough to ship under this name.

### Known limits (v0.1)

- Back/forward availability isn't queryable from wry, so the buttons are
  always enabled and no-op at history edges.
- Audio detection sees `<video>/<audio>` elements; pure Web-Audio-API sound
  (rare outside games) isn't tracked, and mute covers media elements.
- No match counter in find-in-page (`window.find` doesn't report one).
- DRM (Widevine) content — Netflix et al. — depends on the OS engine;
  Twitch/YouTube-style MSE/HLS streaming works.
- Tab drag-reorder and multi-window are not implemented yet.
