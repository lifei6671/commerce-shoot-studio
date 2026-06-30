#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_macos_locale();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_generated_asset])
        .run(tauri::generate_context!())
        .expect("error while running commerce-shoot-studio");
}

#[tauri::command]
fn save_generated_asset(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn configure_macos_locale() {
    std::env::set_var("AppleLanguages", "(zh-Hans, en)");
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_locale() {}
