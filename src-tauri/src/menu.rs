//! macOS menu bar. Two jobs: give WKWebView the standard Edit roles (without
//! them ⌘C/⌘V/⌘A do nothing in text fields) and expose browser actions with
//! their canonical shortcuts. Windows/Linux run frameless without a menu bar;
//! there the same shortcuts are handled by the reporter script and chrome UI.
#![cfg(target_os = "macos")]

use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::AppHandle;

use crate::tabs;

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, text: &str, accel: &str| {
        MenuItemBuilder::with_id(id, text).accelerator(accel).build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "Svif")
        .about(Some(AboutMetadata {
            name: Some("Svif".into()),
            comments: Some("glide, simply.".into()),
            ..Default::default()
        }))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new_tab", "New Tab", "CmdOrCtrl+T")?)
        .item(&item("reopen_tab", "Reopen Closed Tab", "CmdOrCtrl+Shift+T")?)
        .separator()
        .item(&item("close_tab", "Close Tab", "CmdOrCtrl+W")?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("reload", "Reload Page", "CmdOrCtrl+R")?)
        .item(&item("stop", "Stop Loading", "CmdOrCtrl+.")?)
        .separator()
        .item(&item("zoom_in", "Zoom In", "CmdOrCtrl+=")?)
        .item(&item("zoom_out", "Zoom Out", "CmdOrCtrl+-")?)
        .item(&item("zoom_reset", "Actual Size", "CmdOrCtrl+0")?)
        .separator()
        .item(&item("find", "Find in Page…", "CmdOrCtrl+F")?)
        .item(&item("focus_address", "Open Location…", "CmdOrCtrl+L")?)
        .separator()
        .item(&item("toggle_mute", "Mute Tab", "CmdOrCtrl+Shift+M")?)
        .build()?;

    let history = SubmenuBuilder::new(app, "History")
        .item(&item("back", "Back", "CmdOrCtrl+[")?)
        .item(&item("forward", "Forward", "CmdOrCtrl+]")?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &history, &window])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        tabs::do_action(app, event.id().as_ref());
    });
    Ok(())
}
