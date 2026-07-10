use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::services::builtin_models::BuiltinModelService;
use image::GenericImageView;

#[test]
fn list_builtin_models_filters_supported_images_and_sorts_by_file_name() {
    let resource_dir = test_resource_dir("builtin-model-list");
    let thumbnail_dir = test_resource_dir("builtin-model-thumbnails");
    fs::write(resource_dir.join("zeta.png"), png_fixture_bytes(1, 1)).expect("write png");
    fs::write(resource_dir.join("alpha.jpg"), b"jpg").expect("write jpg");
    fs::write(thumbnail_dir.join("alpha.png"), png_fixture_bytes(1, 1)).expect("write thumbnail");
    fs::write(resource_dir.join(".DS_Store"), b"metadata").expect("write hidden metadata");
    fs::write(resource_dir.join("notes.txt"), b"not image").expect("write text");

    let models = BuiltinModelService::new()
        .list_builtin_models(&resource_dir, &thumbnail_dir)
        .expect("builtin models should list");

    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "alpha");
    assert_eq!(models[0].label, "内置模特 01");
    assert_eq!(models[0].file_name, "alpha.jpg");
    assert_eq!(
        models[0].thumbnail_path.as_deref(),
        Some(thumbnail_dir.join("alpha.png").as_path())
    );
    assert_eq!(models[1].id, "zeta");
    assert_eq!(models[1].label, "内置模特 02");
    assert_eq!(models[1].file_name, "zeta.png");
    assert!(models[1].thumbnail_path.is_none());
    assert!(models.iter().all(|model| model.path.is_absolute()));

    remove_dir(&resource_dir);
    remove_dir(&thumbnail_dir);
}

#[test]
fn bundled_models_have_320_by_320_png_thumbnails() {
    let resource_directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    let models = BuiltinModelService::new()
        .list_builtin_models(
            &resource_directory.join("builtin-models"),
            &resource_directory.join("builtin-model-thumbnails"),
        )
        .expect("内置模特资源应可读取");

    assert!(!models.is_empty(), "内置模特资源不能为空");
    for model in models {
        let thumbnail_path = model
            .thumbnail_path
            .unwrap_or_else(|| panic!("{} 缺少 PNG 缩略图", model.file_name));
        let thumbnail = image::open(&thumbnail_path)
            .unwrap_or_else(|error| panic!("{} 无法解码：{error}", thumbnail_path.display()));

        assert_eq!(
            thumbnail.dimensions(),
            (320, 320),
            "{} 缩略图尺寸必须为 320×320",
            model.file_name
        );
    }
}

fn png_fixture_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes
}

fn test_resource_dir(name: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time should move forward")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("commerce-shoot-studio-{name}-{nanos}"));
    fs::create_dir_all(&dir).expect("create test dir");
    dir
}

fn remove_dir(path: &Path) {
    fs::remove_dir_all(path).expect("remove test dir");
}
