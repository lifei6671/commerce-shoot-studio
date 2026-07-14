use std::path::Path;

use commerce_shoot_studio_lib::commands::shell::reveal_command_for_platform;

#[test]
fn reveal_command_uses_finder_on_macos() {
    let command = reveal_command_for_platform("macos", Path::new("/tmp/workspace"))
        .expect("macOS reveal command");

    assert_eq!(command.program(), "open");
    assert_eq!(command.args(), &["-R", "/tmp/workspace"]);
}

#[test]
fn reveal_command_uses_explorer_on_windows() {
    let command = reveal_command_for_platform("windows", Path::new(r"C:\workspace\file.png"))
        .expect("Windows reveal command");

    assert_eq!(command.program(), "explorer");
    assert_eq!(command.args(), &[r"/select,C:\workspace\file.png"]);
}

#[test]
fn reveal_command_uses_xdg_open_on_linux() {
    let command = reveal_command_for_platform("linux", Path::new("/tmp/workspace"))
        .expect("Linux reveal command");

    assert_eq!(command.program(), "xdg-open");
    assert_eq!(command.args(), &["/tmp/workspace"]);
}

#[test]
fn reveal_command_uses_parent_directory_on_linux_when_target_is_file() {
    let command = reveal_command_for_platform("linux", Path::new("/tmp/workspace/file.png"))
        .expect("Linux reveal command");

    assert_eq!(command.program(), "xdg-open");
    assert_eq!(command.args(), &["/tmp/workspace"]);
}

#[test]
fn reveal_command_rejects_empty_path() {
    let result = reveal_command_for_platform("linux", Path::new(""));

    assert!(result.is_err());
}
