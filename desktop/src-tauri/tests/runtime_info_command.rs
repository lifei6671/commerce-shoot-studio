use commerce_shoot_studio_lib::commands::runtime_info::runtime_info;

#[test]
fn runtime_info_reports_local_mode_and_supported_features() {
    let info = runtime_info();

    assert_eq!(info.mode_name(), "local");
    assert_eq!(info.features().mode_name(), "local");
    assert!(info.features().supports_directory_picker());
    assert!(info.features().supports_local_file_reveal());
    assert!(info.features().supports_local_model_config());
    assert!(info.features().supports_secret_management());
    assert!(!info.features().supports_workspace_switch());
    assert!(!info.features().supports_system_notification());
    assert!(!info.version().is_empty());
}
