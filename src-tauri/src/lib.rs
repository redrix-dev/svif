mod menu;
mod settings;
mod tabs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            settings::settings_get,
            settings::settings_set,
            tabs::tabs_snapshot,
            tabs::tab_new,
            tabs::tab_close,
            tabs::tab_select,
            tabs::tab_navigate,
            tabs::tab_mute,
            tabs::tab_zoom,
            tabs::tab_sleep,
            tabs::browser_action,
            tabs::set_overlay,
            tabs::find_in_page,
            tabs::clear_browsing_data,
            tabs::open_devtools,
            tabs::report_page_state,
            tabs::open_tab_from_page,
            tabs::page_shortcut,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            settings::init(&handle)?;
            tabs::init(&handle)?;
            #[cfg(target_os = "macos")]
            menu::install(&handle)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                tabs::save_session(app);
            }
        });
}
