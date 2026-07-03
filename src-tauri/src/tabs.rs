//! The tab engine.
//!
//! One raw `Window` hosts N+1 child webviews: the "chrome" webview (Solid UI,
//! top 86 logical px) plus one webview per awake tab below it. Rust owns the
//! canonical tab list and broadcasts a full JSON snapshot to the chrome UI on
//! every mutation ("tabs-state" event) — the UI is a dumb renderer of that
//! snapshot, which keeps the two sides impossible to de-sync.
//!
//! Sleeping a tab destroys its webview and keeps the metadata; selecting it
//! recreates the webview at its last URL. That is the entire memory-reclaim
//! model, and it is also how session restore works at launch (every restored
//! background tab starts asleep).
//!
//! Locking discipline: `Inner` is behind one Mutex. Webview operations can
//! re-enter (page-load callbacks fire on the main thread), so no webview call
//! is ever made while the lock is held — lock, compute, drop, then act.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::utils::config::WindowEffectsConfig;
use tauri::utils::WindowEffect;
use tauri::webview::{DownloadEvent, PageLoadEvent, WebviewBuilder};
use tauri::window::WindowBuilder;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Url, Webview, WebviewUrl,
    WindowEvent,
};

use crate::settings::SettingsStore;

/// Logical height of the chrome strip (tab strip 40 + toolbar 46).
/// Mirrored in the chrome UI's CSS; change both together.
pub const CHROME_H: f64 = 86.0;
/// Extra inset while the find bar is open.
const FIND_H: f64 = 44.0;
const NEWTAB: &str = "about:newtab";
const REPORTER: &str = include_str!("reporter.js");
const ZOOM_STEPS: [u32; 15] = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct Tab {
    id: u32,
    url: String,
    title: String,
    favicon: Option<String>,
    loading: bool,
    /// Any media element is playing (even muted) — exempts from sleep.
    playing: bool,
    /// Actually producing sound.
    audible: bool,
    muted: bool,
    asleep: bool,
    zoom: u32,
    /// Last time this tab was the active one; the sleep timer counts from here.
    backgrounded_at: Instant,
}

impl Tab {
    fn label(&self) -> String {
        format!("tab-{}", self.id)
    }

    fn info(&self, active: Option<u32>) -> Value {
        json!({
            "id": self.id,
            "url": self.url,
            "title": self.title,
            "favicon": self.favicon,
            "loading": self.loading,
            "playing": self.playing,
            "audible": self.audible,
            "muted": self.muted,
            "asleep": self.asleep,
            "zoom": self.zoom,
            "active": active == Some(self.id),
        })
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Overlay {
    None,
    Find,
    Full,
}

struct Inner {
    tabs: Vec<Tab>,
    active: Option<u32>,
    next_id: u32,
    closed: Vec<String>,
    overlay: Overlay,
}

pub struct TabManager {
    inner: Mutex<Inner>,
}

fn lock(app: &AppHandle) -> std::sync::MutexGuard<'_, Inner> {
    app.state::<TabManager>().inner().inner.lock().unwrap()
}

// ---------------------------------------------------------------------------
// Snapshot + layout
// ---------------------------------------------------------------------------

fn state_json(inner: &Inner) -> Value {
    json!({
        "tabs": inner.tabs.iter().map(|t| t.info(inner.active)).collect::<Vec<_>>(),
        "activeId": inner.active,
        "canReopen": !inner.closed.is_empty(),
    })
}

pub fn broadcast(app: &AppHandle) {
    let payload = state_json(&lock(app));
    let _ = app.emit_to("chrome", "tabs-state", payload);
}

/// Positions the chrome webview and the active tab webview inside the window.
/// Overlay::Find pushes the page down to make room for the find bar;
/// Overlay::Full hands the whole window to the chrome (menus/settings render
/// on frosted glass, the page is hidden because child webviews cannot be
/// z-reordered).
fn layout(app: &AppHandle) {
    let Some(window) = app.get_window("main") else { return };
    let Ok(size) = window.inner_size() else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (overlay, active_label) = {
        let inner = lock(app);
        let label = inner
            .active
            .and_then(|id| inner.tabs.iter().find(|t| t.id == id))
            .filter(|t| !t.asleep)
            .map(|t| t.label());
        (inner.overlay, label)
    };

    let chrome_px = (CHROME_H * scale).round() as u32;
    let find_px = (FIND_H * scale).round() as u32;
    let (chrome_h, page_y, page_visible) = match overlay {
        Overlay::None => (chrome_px, chrome_px, true),
        Overlay::Find => (chrome_px + find_px, chrome_px + find_px, true),
        Overlay::Full => (size.height.max(chrome_px), chrome_px, false),
    };

    if let Some(chrome) = app.get_webview("chrome") {
        let _ = chrome.set_position(PhysicalPosition::new(0, 0));
        let _ = chrome.set_size(PhysicalSize::new(size.width, chrome_h));
    }
    if let Some(view) = active_label.and_then(|l| app.get_webview(&l)) {
        if page_visible {
            let _ = view.set_position(PhysicalPosition::new(0, page_y as i32));
            let _ = view.set_size(PhysicalSize::new(size.width, size.height.saturating_sub(page_y)));
            let _ = view.show();
        } else {
            let _ = view.hide();
        }
    }
}

// ---------------------------------------------------------------------------
// Webview lifecycle
// ---------------------------------------------------------------------------

fn resolve_webview_url(url: &str) -> WebviewUrl {
    if url == NEWTAB {
        WebviewUrl::App("newtab.html".into())
    } else {
        match Url::parse(url) {
            Ok(u) => WebviewUrl::External(u),
            Err(_) => WebviewUrl::App("newtab.html".into()),
        }
    }
}

fn allowed_url(url: &str) -> bool {
    url == NEWTAB || url.starts_with("http://") || url.starts_with("https://")
}

fn reporter_script(app: &AppHandle, muted: bool, zoom: u32) -> String {
    let s = app.state::<SettingsStore>().get();
    let cfg = json!({
        "mac": cfg!(target_os = "macos"),
        "muted": muted,
        "zoom": zoom,
        "engine": s.search_engine,
        "theme": s.theme_colors,
    });
    REPORTER.replace("__SB_CONFIG__", &cfg.to_string())
}

fn on_page_load(webview: &Webview, url: &Url, event: PageLoadEvent) {
    let app = webview.app_handle().clone();
    let label = webview.label().to_string();
    let mut apply: Option<(bool, u32)> = None;
    {
        let mut inner = lock(&app);
        if let Some(tab) = inner.tabs.iter_mut().find(|t| t.label() == label) {
            match event {
                PageLoadEvent::Started => {
                    tab.loading = true;
                    tab.url = url.to_string();
                }
                PageLoadEvent::Finished => {
                    tab.loading = false;
                    apply = Some((tab.muted, tab.zoom));
                }
            }
        }
    }
    // Re-assert mute/zoom on every completed navigation: the init script's
    // baked-in config only knows the values from webview-creation time.
    if let Some((muted, zoom)) = apply {
        let _ = webview.eval(&format!(
            "window.__SB_SET_MUTED&&__SB_SET_MUTED({muted});window.__SB_SET_ZOOM&&__SB_SET_ZOOM({zoom});"
        ));
    }
    broadcast(&app);
}

fn handle_download(app: &AppHandle, event: DownloadEvent<'_>) {
    match event {
        DownloadEvent::Requested { url, destination } => {
            let dir = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            let name = url
                .path_segments()
                .and_then(|mut s| s.next_back())
                .filter(|s| !s.is_empty())
                .unwrap_or("download")
                .to_string();
            let mut path = dir.join(&name);
            let mut n = 1;
            while path.exists() {
                path = dir.join(format!("{n}-{name}"));
                n += 1;
            }
            *destination = path.clone();
            let _ = app.emit_to(
                "chrome",
                "download",
                json!({ "state": "started", "name": name }),
            );
        }
        DownloadEvent::Finished { url: _, path, success } => {
            let _ = app.emit_to(
                "chrome",
                "download",
                json!({
                    "state": if success { "done" } else { "failed" },
                    "path": path.map(|p| p.to_string_lossy().to_string()),
                }),
            );
        }
        _ => {}
    }
}

/// Creates the actual webview for a tab that already exists in `Inner`.
/// Child webview creation must happen on the main thread (hard requirement on
/// Linux), so this always trampolines through `run_on_main_thread`.
fn spawn_webview(app: &AppHandle, id: u32) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(window) = app.get_window("main") else { return };
        let (url, muted, zoom, is_active) = {
            let inner = lock(&app);
            let Some(tab) = inner.tabs.iter().find(|t| t.id == id) else { return };
            (tab.url.clone(), tab.muted, tab.zoom, inner.active == Some(id))
        };

        let label = format!("tab-{id}");
        let script = reporter_script(&app, muted, zoom);
        let builder = WebviewBuilder::new(&label, resolve_webview_url(&url))
            .initialization_script(script.as_str())
            .on_page_load(|webview, payload| {
                on_page_load(&webview, payload.url(), payload.event());
            })
            .on_download({
                let app = app.clone();
                move |_wv, event| {
                    handle_download(&app, event);
                    true
                }
            });

        let size = window.inner_size().unwrap_or(PhysicalSize::new(1280, 820));
        let scale = window.scale_factor().unwrap_or(1.0);
        let chrome_px = (CHROME_H * scale).round() as u32;
        match window.add_child(
            builder,
            PhysicalPosition::new(0, chrome_px as i32),
            PhysicalSize::new(size.width, size.height.saturating_sub(chrome_px)),
        ) {
            Ok(view) => {
                if is_active {
                    let _ = view.set_focus();
                } else {
                    let _ = view.hide();
                }
            }
            Err(e) => eprintln!("svif: failed to create webview: {e}"),
        }
        layout(&app);
        broadcast(&app);
    });
}

pub fn create_tab(app: &AppHandle, url: Option<String>, background: bool) {
    let url = url.unwrap_or_else(|| app.state::<SettingsStore>().get().homepage);
    if !allowed_url(&url) {
        return;
    }
    let default_zoom = app.state::<SettingsStore>().get().default_zoom;
    let (id, prev) = {
        let mut inner = lock(app);
        let id = inner.next_id;
        inner.next_id += 1;
        inner.tabs.push(Tab {
            id,
            url,
            title: "New Tab".into(),
            favicon: None,
            loading: true,
            playing: false,
            audible: false,
            muted: false,
            asleep: false,
            zoom: default_zoom,
            backgrounded_at: Instant::now(),
        });
        let prev = inner.active;
        if !background {
            inner.active = Some(id);
        }
        (id, prev)
    };
    if !background {
        if let Some(prev_label) = tab_label(app, prev) {
            if let Some(v) = app.get_webview(&prev_label) {
                let _ = v.hide();
            }
        }
    }
    spawn_webview(app, id);
}

fn tab_label(app: &AppHandle, id: Option<u32>) -> Option<String> {
    let inner = lock(app);
    id.and_then(|id| inner.tabs.iter().find(|t| t.id == id)).map(|t| t.label())
}

pub fn select_tab(app: &AppHandle, id: u32) {
    let (prev_label, needs_wake, label) = {
        let mut inner = lock(app);
        if !inner.tabs.iter().any(|t| t.id == id) {
            return;
        }
        let prev = inner.active;
        let prev_label = prev
            .filter(|p| *p != id)
            .and_then(|p| inner.tabs.iter().find(|t| t.id == p))
            .map(|t| t.label());
        inner.active = Some(id);
        let now = Instant::now();
        for t in inner.tabs.iter_mut() {
            if t.id == id || Some(t.id) == prev {
                t.backgrounded_at = now;
            }
        }
        let tab = inner.tabs.iter_mut().find(|t| t.id == id).unwrap();
        let needs_wake = tab.asleep;
        if needs_wake {
            tab.asleep = false;
            tab.loading = true;
        }
        (prev_label, needs_wake, tab.label())
    };

    if let Some(prev) = prev_label.and_then(|l| app.get_webview(&l)) {
        let _ = prev.hide();
    }
    if needs_wake {
        spawn_webview(app, id);
    } else if let Some(view) = app.get_webview(&label) {
        let _ = view.show();
        let _ = view.set_focus();
    }
    layout(app);
    broadcast(app);
}

pub fn close_tab(app: &AppHandle, id: u32) {
    let (label, next_active, was_active, now_empty) = {
        let mut inner = lock(app);
        let Some(idx) = inner.tabs.iter().position(|t| t.id == id) else { return };
        let tab = inner.tabs.remove(idx);
        if tab.url != NEWTAB {
            inner.closed.push(tab.url.clone());
            if inner.closed.len() > 25 {
                inner.closed.remove(0);
            }
        }
        let was_active = inner.active == Some(id);
        let next_active = if was_active {
            inner
                .tabs
                .get(idx.min(inner.tabs.len().saturating_sub(1)))
                .map(|t| t.id)
        } else {
            inner.active
        };
        if was_active {
            inner.active = next_active;
        }
        (tab.label(), next_active, was_active, inner.tabs.is_empty())
    };

    if let Some(view) = app.get_webview(&label) {
        let _ = view.close();
    }
    if now_empty {
        create_tab(app, None, false); // a browser always has at least one tab
        return;
    }
    if was_active {
        if let Some(next) = next_active {
            select_tab(app, next);
            return;
        }
    }
    broadcast(app);
}

pub fn sleep_tab(app: &AppHandle, id: u32) {
    let label = {
        let mut inner = lock(app);
        if inner.active == Some(id) {
            return; // never sleep the visible tab
        }
        let Some(tab) = inner.tabs.iter_mut().find(|t| t.id == id && !t.asleep) else { return };
        tab.asleep = true;
        tab.loading = false;
        tab.playing = false;
        tab.audible = false;
        tab.label()
    };
    if let Some(view) = app.get_webview(&label) {
        let _ = view.close();
    }
    broadcast(app);
}

fn active_webview(app: &AppHandle) -> Option<Webview> {
    let label = {
        let inner = lock(app);
        inner
            .active
            .and_then(|id| inner.tabs.iter().find(|t| t.id == id))
            .filter(|t| !t.asleep)
            .map(|t| t.label())
    };
    label.and_then(|l| app.get_webview(&l))
}

fn set_zoom(app: &AppHandle, id: u32, pct: u32) {
    let pct = pct.clamp(25, 300);
    let label = {
        let mut inner = lock(app);
        let Some(tab) = inner.tabs.iter_mut().find(|t| t.id == id) else { return };
        tab.zoom = pct;
        tab.label()
    };
    if let Some(view) = app.get_webview(&label) {
        let _ = view.eval(&format!("window.__SB_SET_ZOOM&&__SB_SET_ZOOM({pct})"));
    }
    broadcast(app);
}

fn set_muted(app: &AppHandle, id: u32, muted: bool) {
    let label = {
        let mut inner = lock(app);
        let Some(tab) = inner.tabs.iter_mut().find(|t| t.id == id) else { return };
        tab.muted = muted;
        if muted {
            tab.audible = false;
        }
        tab.label()
    };
    if let Some(view) = app.get_webview(&label) {
        let _ = view.eval(&format!("window.__SB_SET_MUTED&&__SB_SET_MUTED({muted})"));
    }
    broadcast(app);
}

// ---------------------------------------------------------------------------
// Shared actions (menu items, page shortcuts and chrome buttons all land here)
// ---------------------------------------------------------------------------

pub fn do_action(app: &AppHandle, action: &str) {
    let active = { lock(app).active };
    match action {
        "new_tab" => create_tab(app, None, false),
        "close_tab" => {
            if let Some(id) = active {
                close_tab(app, id);
            }
        }
        "reopen_tab" => {
            let url = { lock(app).closed.pop() };
            if let Some(url) = url {
                create_tab(app, Some(url), false);
            }
        }
        "focus_address" | "find" => {
            if let Some(chrome) = app.get_webview("chrome") {
                let _ = chrome.set_focus();
            }
            let _ = app.emit_to("chrome", "chrome-command", json!({ "action": action }));
        }
        "reload" | "back" | "forward" | "stop" => {
            if let Some(view) = active_webview(app) {
                let js = match action {
                    "reload" => "location.reload()",
                    "back" => "history.back()",
                    "forward" => "history.forward()",
                    _ => "window.stop()",
                };
                let _ = view.eval(js);
            }
        }
        "zoom_in" | "zoom_out" | "zoom_reset" => {
            if let Some(id) = active {
                let cur = {
                    let inner = lock(app);
                    inner.tabs.iter().find(|t| t.id == id).map(|t| t.zoom).unwrap_or(100)
                };
                let next = match action {
                    "zoom_reset" => 100,
                    "zoom_in" => *ZOOM_STEPS.iter().find(|s| **s > cur).unwrap_or(&300),
                    _ => *ZOOM_STEPS.iter().rev().find(|s| **s < cur).unwrap_or(&25),
                };
                set_zoom(app, id, next);
            }
        }
        "toggle_mute" => {
            if let Some(id) = active {
                let muted = {
                    let inner = lock(app);
                    inner.tabs.iter().find(|t| t.id == id).map(|t| t.muted).unwrap_or(false)
                };
                set_muted(app, id, !muted);
            }
        }
        "next_tab" | "prev_tab" => {
            let target = {
                let inner = lock(app);
                if inner.tabs.is_empty() {
                    None
                } else {
                    let idx = inner
                        .tabs
                        .iter()
                        .position(|t| Some(t.id) == inner.active)
                        .unwrap_or(0);
                    let n = inner.tabs.len();
                    let next = if action == "next_tab" { (idx + 1) % n } else { (idx + n - 1) % n };
                    Some(inner.tabs[next].id)
                }
            };
            if let Some(id) = target {
                select_tab(app, id);
            }
        }
        a if a.starts_with("tab_") => {
            let target = a[4..]
                .parse::<usize>()
                .ok()
                .and_then(|n| {
                    let inner = lock(app);
                    inner.tabs.get(n - 1).map(|t| t.id)
                });
            if let Some(id) = target {
                select_tab(app, id);
            }
        }
        "sleep_now" => {
            // Sleeping the active tab: switch away first if possible.
            if let Some(id) = active {
                let other = {
                    let inner = lock(app);
                    inner.tabs.iter().map(|t| t.id).find(|t| *t != id)
                };
                if let Some(other) = other {
                    select_tab(app, other);
                    sleep_tab(app, id);
                }
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct SessionTab {
    url: String,
    title: String,
}

#[derive(Serialize, Deserialize)]
struct Session {
    tabs: Vec<SessionTab>,
    active: usize,
}

fn session_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("session.json"))
}

pub fn save_session(app: &AppHandle) {
    let Some(path) = session_path(app) else { return };
    let session = {
        let inner = lock(app);
        Session {
            tabs: inner
                .tabs
                .iter()
                .map(|t| SessionTab {
                    // Internal pages round-trip as about:newtab.
                    url: if t.url.contains("newtab.html") || !t.url.starts_with("http") {
                        NEWTAB.into()
                    } else {
                        t.url.clone()
                    },
                    title: t.title.clone(),
                })
                .collect(),
            active: inner
                .tabs
                .iter()
                .position(|t| Some(t.id) == inner.active)
                .unwrap_or(0),
        }
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(&session) {
        let _ = fs::write(path, json);
    }
}

/// Restores the previous session: the active tab wakes immediately, every
/// other tab is created asleep (title + URL only, zero webviews) — the sleep
/// system doubles as instant startup.
fn restore_session(app: &AppHandle) -> bool {
    let Some(session) = session_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Session>(&s).ok())
        .filter(|s| !s.tabs.is_empty())
    else {
        return false;
    };
    let default_zoom = app.state::<SettingsStore>().get().default_zoom;
    let active_id = {
        let mut inner = lock(app);
        for (i, t) in session.tabs.iter().enumerate() {
            if !allowed_url(&t.url) {
                continue;
            }
            let id = inner.next_id;
            inner.next_id += 1;
            inner.tabs.push(Tab {
                id,
                url: t.url.clone(),
                title: if t.title.is_empty() { "New Tab".into() } else { t.title.clone() },
                favicon: None,
                loading: false,
                playing: false,
                audible: false,
                muted: false,
                asleep: true,
                zoom: default_zoom,
                backgrounded_at: Instant::now(),
            });
            if i == session.active {
                inner.active = Some(id);
            }
        }
        if inner.tabs.is_empty() {
            return false;
        }
        Some(inner.active.unwrap_or(inner.tabs[0].id))
    };
    if let Some(id) = active_id {
        select_tab(app, id);
    }
    true
}

// ---------------------------------------------------------------------------
// Init: window, chrome webview, sleep loop
// ---------------------------------------------------------------------------

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.manage(TabManager {
        inner: Mutex::new(Inner {
            tabs: Vec::new(),
            active: None,
            next_id: 1,
            closed: Vec::new(),
            overlay: Overlay::None,
        }),
    });

    #[allow(unused_mut)]
    let mut win_builder = WindowBuilder::new(app, "main")
        .title("Svif")
        .inner_size(1280.0, 820.0)
        .min_inner_size(720.0, 480.0)
        .effects(WindowEffectsConfig {
            // First supported effect wins per platform; the rest are ignored.
            effects: vec![
                WindowEffect::Sidebar,  // macOS vibrancy
                WindowEffect::Acrylic,  // Windows 11
                WindowEffect::Blur,     // Windows 10
            ],
            ..Default::default()
        });
    #[cfg(target_os = "macos")]
    {
        win_builder = win_builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .transparent(true);
    }
    #[cfg(target_os = "windows")]
    {
        win_builder = win_builder.transparent(true);
    }
    #[cfg(target_os = "linux")]
    {
        // No compositor-independent glass on Linux; the chrome draws its own
        // tinted backdrop instead. Keep native decorations off for the same
        // seamless strip, with window buttons rendered by the chrome UI.
        win_builder = win_builder.decorations(false);
    }
    let window = win_builder.build()?;

    let size = window.inner_size()?;
    let scale = window.scale_factor()?;
    window.add_child(
        WebviewBuilder::new("chrome", WebviewUrl::App("index.html".into())).transparent(true),
        PhysicalPosition::new(0, 0),
        PhysicalSize::new(size.width, (CHROME_H * scale).round() as u32),
    )?;

    window.on_window_event({
        let app = app.clone();
        move |event| match event {
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => layout(&app),
            WindowEvent::CloseRequested { .. } => save_session(&app),
            _ => {}
        }
    });

    let restore = app.state::<SettingsStore>().get().restore_session;
    if !(restore && restore_session(app)) {
        create_tab(app, None, false);
    }

    // Sleep loop: put idle background tabs to sleep, save the session as a
    // crash net. Cheap enough to run forever.
    std::thread::spawn({
        let app = app.clone();
        move || loop {
            std::thread::sleep(Duration::from_secs(20));
            let s = app.state::<SettingsStore>().get();
            if !s.sleep_enabled {
                continue;
            }
            let limit = Duration::from_secs(u64::from(s.sleep_after_mins) * 60);
            let due: Vec<u32> = {
                let inner = lock(&app);
                inner
                    .tabs
                    .iter()
                    .filter(|t| {
                        !t.asleep
                            && Some(t.id) != inner.active
                            && t.backgrounded_at.elapsed() > limit
                            && !(s.sleep_keep_media && (t.playing || t.audible || t.loading))
                    })
                    .map(|t| t.id)
                    .collect()
            };
            for id in due {
                sleep_tab(&app, id);
            }
            save_session(&app);
        }
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn require_chrome(webview: &Webview) -> Result<(), String> {
    if webview.label() == "chrome" {
        Ok(())
    } else {
        Err("denied: chrome-only command".into())
    }
}

fn require_tab(webview: &Webview) -> Result<u32, String> {
    webview
        .label()
        .strip_prefix("tab-")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "denied: tab-only command".into())
}

#[tauri::command]
pub fn tabs_snapshot(webview: Webview, app: AppHandle) -> Result<Value, String> {
    require_chrome(&webview)?;
    let mut v = state_json(&lock(&app));
    v["env"] = json!({
        "platform": std::env::consts::OS,
        "version": app.package_info().version.to_string(),
        "chromeHeight": CHROME_H,
    });
    Ok(v)
}

#[tauri::command]
pub fn tab_new(webview: Webview, app: AppHandle, url: Option<String>, background: Option<bool>) -> Result<(), String> {
    require_chrome(&webview)?;
    create_tab(&app, url, background.unwrap_or(false));
    Ok(())
}

#[tauri::command]
pub fn tab_close(webview: Webview, app: AppHandle, id: u32) -> Result<(), String> {
    require_chrome(&webview)?;
    close_tab(&app, id);
    Ok(())
}

#[tauri::command]
pub fn tab_select(webview: Webview, app: AppHandle, id: u32) -> Result<(), String> {
    require_chrome(&webview)?;
    select_tab(&app, id);
    Ok(())
}

#[tauri::command]
pub fn tab_navigate(webview: Webview, app: AppHandle, id: u32, url: String) -> Result<(), String> {
    require_chrome(&webview)?;
    if !allowed_url(&url) {
        return Err("blocked url scheme".into());
    }
    let (label, asleep, is_active) = {
        let mut inner = lock(&app);
        let active = inner.active;
        let Some(tab) = inner.tabs.iter_mut().find(|t| t.id == id) else {
            return Err("no such tab".into());
        };
        tab.url = url.clone();
        tab.loading = !tab.asleep;
        (tab.label(), tab.asleep, active == Some(id))
    };
    if asleep {
        if is_active {
            select_tab(&app, id); // wake at the new url
        }
    } else if let Some(view) = app.get_webview(&label) {
        if url == NEWTAB {
            // Internal page: recreate, since navigate() only takes real URLs.
            let _ = view.close();
            spawn_webview(&app, id);
        } else if let Ok(parsed) = Url::parse(&url) {
            let _ = view.navigate(parsed);
        }
    }
    broadcast(&app);
    Ok(())
}

#[tauri::command]
pub fn tab_mute(webview: Webview, app: AppHandle, id: u32, muted: bool) -> Result<(), String> {
    require_chrome(&webview)?;
    set_muted(&app, id, muted);
    Ok(())
}

#[tauri::command]
pub fn tab_zoom(webview: Webview, app: AppHandle, id: u32, pct: u32) -> Result<(), String> {
    require_chrome(&webview)?;
    set_zoom(&app, id, pct);
    Ok(())
}

#[tauri::command]
pub fn tab_sleep(webview: Webview, app: AppHandle, id: u32) -> Result<(), String> {
    require_chrome(&webview)?;
    sleep_tab(&app, id);
    Ok(())
}

#[tauri::command]
pub fn browser_action(webview: Webview, app: AppHandle, action: String) -> Result<(), String> {
    require_chrome(&webview)?;
    do_action(&app, &action);
    Ok(())
}

#[tauri::command]
pub fn set_overlay(webview: Webview, app: AppHandle, mode: String) -> Result<(), String> {
    require_chrome(&webview)?;
    {
        let mut inner = lock(&app);
        inner.overlay = match mode.as_str() {
            "find" => Overlay::Find,
            "full" => Overlay::Full,
            _ => Overlay::None,
        };
    }
    layout(&app);
    Ok(())
}

#[tauri::command]
pub fn find_in_page(
    webview: Webview,
    app: AppHandle,
    text: String,
    backwards: Option<bool>,
    clear: Option<bool>,
) -> Result<(), String> {
    require_chrome(&webview)?;
    if let Some(view) = active_webview(&app) {
        if clear.unwrap_or(false) {
            let _ = view.eval("window.__SB_FIND_CLEAR&&__SB_FIND_CLEAR()");
        } else {
            let quoted = serde_json::to_string(&text).unwrap_or_default();
            let _ = view.eval(&format!(
                "window.__SB_FIND&&__SB_FIND({quoted},{})",
                backwards.unwrap_or(false)
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn clear_browsing_data(webview: Webview, app: AppHandle) -> Result<(), String> {
    require_chrome(&webview)?;
    let mut cleared = false;
    let labels: Vec<String> = { lock(&app).tabs.iter().filter(|t| !t.asleep).map(|t| t.label()).collect() };
    for label in labels {
        if let Some(view) = app.get_webview(&label) {
            if view.clear_all_browsing_data().is_ok() {
                cleared = true;
            }
        }
    }
    if cleared {
        Ok(())
    } else {
        Err("platform webview did not report success".into())
    }
}

#[tauri::command]
pub fn open_devtools(webview: Webview, app: AppHandle) -> Result<(), String> {
    require_chrome(&webview)?;
    if let Some(view) = active_webview(&app) {
        view.open_devtools();
    }
    Ok(())
}

// ---- commands invocable by pages (reporter script) ----

#[tauri::command]
pub fn report_page_state(webview: Webview, app: AppHandle, patch: Map<String, Value>) -> Result<(), String> {
    let id = require_tab(&webview)?;
    {
        let mut inner = lock(&app);
        let Some(tab) = inner.tabs.iter_mut().find(|t| t.id == id && !t.asleep) else {
            return Ok(());
        };
        for (k, v) in patch {
            match (k.as_str(), v) {
                ("url", Value::String(s)) => tab.url = s,
                ("title", Value::String(s)) => {
                    if !s.is_empty() {
                        tab.title = s;
                    }
                }
                ("favicon", Value::String(s)) => tab.favicon = Some(s),
                ("playing", Value::Bool(b)) => tab.playing = b,
                ("audible", Value::Bool(b)) => tab.audible = b && !tab.muted,
                _ => {}
            }
        }
    }
    broadcast(&app);
    Ok(())
}

#[tauri::command]
pub fn open_tab_from_page(webview: Webview, app: AppHandle, url: String) -> Result<(), String> {
    require_tab(&webview)?;
    if url.starts_with("http://") || url.starts_with("https://") {
        create_tab(&app, Some(url), false);
    }
    Ok(())
}

#[tauri::command]
pub fn page_shortcut(webview: Webview, app: AppHandle, action: String) -> Result<(), String> {
    require_tab(&webview)?;
    const ALLOWED: &[&str] = &[
        "new_tab", "close_tab", "reopen_tab", "focus_address", "reload", "back", "forward",
        "find", "zoom_in", "zoom_out", "zoom_reset", "toggle_mute", "next_tab", "prev_tab",
        "tab_1", "tab_2", "tab_3", "tab_4", "tab_5", "tab_6", "tab_7", "tab_8", "tab_9",
    ];
    if ALLOWED.contains(&action.as_str()) {
        do_action(&app, &action);
    }
    Ok(())
}
