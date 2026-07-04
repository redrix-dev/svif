//! Persisted settings. One JSON file in the platform config dir.
//!
//! Rust only interprets the handful of fields it needs (sleep policy, default
//! zoom, homepage, theme colors for injecting into the new-tab page); the
//! chrome UI owns everything else (themes, fonts, search engine) and reads or
//! writes the same blob through `settings_get` / `settings_set`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Webview};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "d_theme")]
    pub theme: String,
    #[serde(default = "d_ui_font")]
    pub ui_font: String,
    #[serde(default = "d_engine")]
    pub search_engine: String,
    #[serde(default = "d_homepage")]
    pub homepage: String,
    #[serde(default = "d_true")]
    pub sleep_enabled: bool,
    #[serde(default = "d_sleep_mins")]
    pub sleep_after_mins: u32,
    #[serde(default = "d_true")]
    pub sleep_keep_media: bool,
    #[serde(default = "d_true")]
    pub restore_session: bool,
    #[serde(default = "d_zoom")]
    pub default_zoom: u32,
    /// Festive fireworks on the start page (July 4th toggle).
    #[serde(default)]
    pub festive: bool,
    /// Resolved color palette of the active theme, written by the chrome UI.
    /// Rust forwards it into the new-tab page so it matches the chrome.
    #[serde(default)]
    pub theme_colors: Value,
    /// User-imported themes. Opaque to Rust; validated by the chrome UI.
    #[serde(default)]
    pub custom_themes: Vec<Value>,
    /// Anything a future version adds survives a round-trip.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn d_theme() -> String { "glass-dark".into() }
fn d_ui_font() -> String { "system".into() }
fn d_engine() -> String { "duckduckgo".into() }
fn d_homepage() -> String { "about:newtab".into() }
fn d_true() -> bool { true }
fn d_sleep_mins() -> u32 { 15 }
fn d_zoom() -> u32 { 100 }

impl Default for Settings {
    fn default() -> Self {
        serde_json::from_value(Value::Object(Map::new())).expect("defaults are total")
    }
}

pub struct SettingsStore {
    path: PathBuf,
    pub current: Mutex<Settings>,
}

impl SettingsStore {
    pub fn get(&self) -> Settings {
        self.current.lock().unwrap().clone()
    }

    fn save(&self, s: &Settings) {
        if let Some(dir) = self.path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(s) {
            let _ = fs::write(&self.path, json);
        }
    }
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let path = app.path().app_config_dir()?.join("settings.json");
    let current = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    app.manage(SettingsStore {
        path,
        current: Mutex::new(current),
    });
    Ok(())
}

fn require_chrome(webview: &Webview) -> Result<(), String> {
    if webview.label() == "chrome" {
        Ok(())
    } else {
        Err("denied: settings are chrome-only".into())
    }
}

#[tauri::command]
pub fn settings_get(webview: Webview, app: AppHandle) -> Result<Settings, String> {
    require_chrome(&webview)?;
    Ok(app.state::<SettingsStore>().get())
}

/// Shallow-merges a JSON patch into the settings, persists, and notifies the
/// chrome UI. Merging as JSON keeps Rust out of the business of knowing every
/// UI-owned field.
#[tauri::command]
pub fn settings_set(
    webview: Webview,
    app: AppHandle,
    patch: Map<String, Value>,
) -> Result<Settings, String> {
    require_chrome(&webview)?;
    let store = app.state::<SettingsStore>();
    let updated = {
        let cur = store.current.lock().unwrap();
        let mut obj = match serde_json::to_value(&*cur) {
            Ok(Value::Object(o)) => o,
            _ => Map::new(),
        };
        for (k, v) in patch {
            obj.insert(k, v);
        }
        serde_json::from_value::<Settings>(Value::Object(obj)).map_err(|e| e.to_string())?
    };
    *store.current.lock().unwrap() = updated.clone();
    store.save(&updated);
    let _ = app.emit_to("chrome", "settings-changed", &updated);
    // Re-skin already-open start pages in place (regular sites ignore it).
    crate::tabs::apply_theme_to_tabs(&app, &updated.theme_colors);
    crate::tabs::apply_festive_to_tabs(&app, updated.festive);
    Ok(updated)
}
