use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::domain::assets::{AssetKind, AssetLifecycle};
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::infrastructure::sha256;
use commerce_shoot_studio_lib::services::assets::{AssetQuery, AssetService, ImportImagesInput};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};
use image::{DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};

#[test]
fn import_images_copies_file_and_persists_metadata_with_relative_path() {
    let workspace_dir = initialized_workspace("asset-import");
    let source_file = workspace_dir.join("fixture.png");
    let bytes = png_fixture_bytes(320, 240);
    fs::write(&source_file, &bytes).expect("write fixture");
    let service = AssetService::new();

    let imported = service
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Source,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("image should import");

    assert_eq!(imported.len(), 1);
    let asset = &imported[0];
    assert_eq!(asset.kind, AssetKind::Source);
    assert_eq!(asset.original_name, "fixture.png");
    assert_eq!(asset.mime_type, "image/png");
    assert_eq!(asset.sha256, sha256::digest_hex(&bytes));
    assert_eq!(asset.width, Some(320));
    assert_eq!(asset.height, Some(240));
    assert_eq!(asset.size_bytes, bytes.len() as i64);
    assert_eq!(asset.lifecycle, AssetLifecycle::Staged);
    assert!(
        asset.relative_path.starts_with("assets/source/"),
        "SQLite DTO should only expose workspace-relative asset paths",
    );
    assert!(
        !asset
            .relative_path
            .contains(&workspace_dir.to_string_lossy().to_string()),
        "relative_path must not leak an absolute workspace path",
    );
    assert!(
        workspace_dir
            .join(asset.relative_path.split('/').collect::<PathBuf>())
            .is_file(),
        "imported file should exist under workspace assets directory",
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn import_images_reuses_active_asset_with_same_kind_and_hash() {
    let workspace_dir = initialized_workspace("asset-dedup");
    let source_file = workspace_dir.join("same.png");
    fs::write(&source_file, png_fixture_bytes(1, 1)).expect("write fixture");
    let service = AssetService::new();
    let input = ImportImagesInput {
        kind: AssetKind::Reference,
        paths: vec![source_file.to_string_lossy().to_string()],
    };

    let first = service
        .import_images(&workspace_dir, input.clone())
        .expect("first import should succeed");
    let second = service
        .import_images(&workspace_dir, input)
        .expect("second import should reuse asset");
    let page = service
        .list_assets(
            &workspace_dir,
            AssetQuery {
                kind: Some(AssetKind::Reference),
                ..AssetQuery::default()
            },
        )
        .expect("assets should list");

    assert_eq!(first[0].id, second[0].id);
    assert_eq!(page.total, 1);

    remove_workspace(&workspace_dir);
}

#[test]
fn importing_model_generates_a_320_square_avatar_thumbnail() {
    let workspace_dir = initialized_workspace("asset-model-thumbnail");
    let source_file = workspace_dir.join("model.png");
    fs::write(&source_file, avatar_fixture_bytes(800, 1200)).expect("write fixture");
    let service = AssetService::new();

    let asset = service
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Model,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("model image should import")
        .remove(0);

    let thumbnail_path = workspace_dir
        .join("assets/thumbnail")
        .join(format!("{}.png", asset.id));
    assert!(
        thumbnail_path.is_file(),
        "model import should create thumbnail"
    );
    let thumbnail = image::open(&thumbnail_path).expect("thumbnail should be readable");
    assert_eq!(thumbnail.dimensions(), (320, 320));
    let thumbnail_pixels = thumbnail.to_rgba8();
    let top_pixel = thumbnail_pixels.get_pixel(160, 20);
    let bottom_pixel = thumbnail_pixels.get_pixel(160, 300);
    assert!(
        top_pixel[0] > top_pixel[2],
        "thumbnail should start at image top"
    );
    assert!(
        bottom_pixel[2] > bottom_pixel[0],
        "thumbnail should include head-to-shoulder area"
    );
    assert!(workspace_dir
        .join(asset.relative_path.split('/').collect::<PathBuf>())
        .is_file());

    remove_workspace(&workspace_dir);
}

#[test]
fn importing_non_model_does_not_generate_avatar_thumbnail() {
    let workspace_dir = initialized_workspace("asset-source-no-thumbnail");
    let source_file = workspace_dir.join("source.png");
    fs::write(&source_file, avatar_fixture_bytes(800, 1200)).expect("write fixture");
    let service = AssetService::new();

    let asset = service
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Source,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("source image should import")
        .remove(0);

    let thumbnail_path = workspace_dir
        .join("assets/thumbnail")
        .join(format!("{}.png", asset.id));
    assert!(
        !thumbnail_path.exists(),
        "source imports must not create thumbnails"
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn importing_model_rejects_source_larger_than_64_mib() {
    let workspace_dir = initialized_workspace("asset-model-source-size-limit");
    let source_file = workspace_dir.join("oversized-model.png");
    let file = fs::File::create(&source_file).expect("create sparse fixture");
    file.set_len(64 * 1024 * 1024 + 1)
        .expect("extend sparse fixture");

    let error = AssetService::new()
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Model,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect_err("oversized model source should be rejected");

    assert_eq!(error.to_string(), "模型图片文件不能超过 64 MiB。");
    remove_workspace(&workspace_dir);
}

#[test]
fn importing_model_rejects_dimensions_over_8192_pixels() {
    let workspace_dir = initialized_workspace("asset-model-dimension-limit");
    let service = AssetService::new();

    for (file_name, width, height) in [("too-wide.png", 8193, 1), ("too-tall.png", 1, 8193)] {
        let source_file = workspace_dir.join(file_name);
        fs::write(&source_file, avatar_fixture_bytes(width, height)).expect("write fixture");

        let error = service
            .import_images(
                &workspace_dir,
                ImportImagesInput {
                    kind: AssetKind::Model,
                    paths: vec![source_file.to_string_lossy().to_string()],
                },
            )
            .expect_err("oversized model dimensions should be rejected");

        assert_eq!(
            error.to_string(),
            "模型图片尺寸不能超过 8192×8192，且解码内存不能超过 128 MiB。"
        );
    }

    remove_workspace(&workspace_dir);
}

#[test]
fn importing_model_limits_decoder_allocation_to_128_mib() {
    let workspace_dir = initialized_workspace("asset-model-decoder-allocation-limit");
    let source_file = workspace_dir.join("oversized-allocation.gif");
    fs::write(&source_file, gif_with_logical_screen(8192, 4097)).expect("write fixture");

    let error = AssetService::new()
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Model,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect_err("oversized decode allocation should be rejected");

    assert_eq!(
        error.to_string(),
        "模型图片尺寸不能超过 8192×8192，且解码内存不能超过 128 MiB。"
    );
    remove_workspace(&workspace_dir);
}

#[test]
fn garbage_collection_removes_unreferenced_staged_assets() {
    let workspace_dir = initialized_workspace("asset-gc-staged");
    let source_file = workspace_dir.join("staged.png");
    fs::write(&source_file, avatar_fixture_bytes(2, 2)).expect("write fixture");
    let service = AssetService::new();
    let asset = service
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Source,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("image should import")
        .remove(0);
    let asset_path = workspace_dir.join(asset.relative_path.split('/').collect::<PathBuf>());
    mark_asset_created_at_old(&workspace_dir, &asset.id);

    let result = service
        .run_garbage_collection(&workspace_dir)
        .expect("gc should run");
    let page = service
        .list_assets(
            &workspace_dir,
            AssetQuery {
                include_deleted: Some(true),
                ..AssetQuery::default()
            },
        )
        .expect("assets should list");

    assert_eq!(result.deleted_files, 1);
    assert_eq!(result.reclaimed_bytes, asset.size_bytes);
    assert!(!asset_path.exists());
    assert_eq!(page.total, 0);

    remove_workspace(&workspace_dir);
}

#[test]
fn garbage_collection_keeps_old_model_library_assets() {
    let workspace_dir = initialized_workspace("asset-gc-model-library");
    let source_file = workspace_dir.join("model.png");
    fs::write(&source_file, avatar_fixture_bytes(2, 2)).expect("write fixture");
    let service = AssetService::new();
    let asset = service
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Model,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("model image should import")
        .remove(0);
    let asset_path = workspace_dir.join(asset.relative_path.split('/').collect::<PathBuf>());
    mark_asset_created_at_old(&workspace_dir, &asset.id);

    let result = service
        .run_garbage_collection(&workspace_dir)
        .expect("gc should run");
    let retained = service
        .get_asset(&workspace_dir, &asset.id)
        .expect("model library asset should remain");

    assert_eq!(retained.lifecycle, AssetLifecycle::Active);
    assert_eq!(result.deleted_files, 0);
    assert!(asset_path.exists());

    remove_workspace(&workspace_dir);
}

#[test]
fn garbage_collection_repairs_and_keeps_legacy_staged_model_library_assets() {
    let workspace_dir = initialized_workspace("asset-gc-legacy-staged-model");
    let source_file = workspace_dir.join("legacy-model.png");
    fs::write(&source_file, avatar_fixture_bytes(2, 2)).expect("write fixture");
    let service = AssetService::new();
    let asset = service
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Model,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("model image should import")
        .remove(0);
    let asset_path = workspace_dir.join(asset.relative_path.split('/').collect::<PathBuf>());
    mark_asset_staged(&workspace_dir, &asset.id);
    mark_asset_created_at_old(&workspace_dir, &asset.id);

    let result = service
        .run_garbage_collection(&workspace_dir)
        .expect("gc should repair legacy models");
    let retained = service
        .get_asset(&workspace_dir, &asset.id)
        .expect("legacy model library asset should remain");

    assert_eq!(retained.lifecycle, AssetLifecycle::Active);
    assert_eq!(result.deleted_files, 0);
    assert!(asset_path.exists());

    remove_workspace(&workspace_dir);
}

#[test]
fn importing_a_legacy_staged_model_promotes_the_deduplicated_asset() {
    let workspace_dir = initialized_workspace("asset-model-dedup-activation");
    let source_file = workspace_dir.join("model.png");
    fs::write(&source_file, avatar_fixture_bytes(2, 2)).expect("write fixture");
    let service = AssetService::new();
    let input = ImportImagesInput {
        kind: AssetKind::Model,
        paths: vec![source_file.to_string_lossy().to_string()],
    };
    let original = service
        .import_images(&workspace_dir, input.clone())
        .expect("model image should import")
        .remove(0);
    mark_asset_staged(&workspace_dir, &original.id);

    let deduplicated = service
        .import_images(&workspace_dir, input)
        .expect("model image should deduplicate")
        .remove(0);

    assert_eq!(deduplicated.id, original.id);
    assert_eq!(deduplicated.lifecycle, AssetLifecycle::Active);

    remove_workspace(&workspace_dir);
}

#[test]
fn delete_asset_soft_deletes_and_default_list_hides_it() {
    let workspace_dir = initialized_workspace("asset-delete");
    let source_file = workspace_dir.join("delete.png");
    fs::write(&source_file, avatar_fixture_bytes(1, 1)).expect("write fixture");
    let service = AssetService::new();
    let asset = service
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Model,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("image should import")
        .remove(0);

    service
        .delete_asset(&workspace_dir, &asset.id)
        .expect("asset should soft delete");

    let active_page = service
        .list_assets(&workspace_dir, AssetQuery::default())
        .expect("active list should load");
    let deleted_page = service
        .list_assets(
            &workspace_dir,
            AssetQuery {
                include_deleted: Some(true),
                ..AssetQuery::default()
            },
        )
        .expect("deleted list should load");

    assert_eq!(active_page.total, 0);
    assert_eq!(deleted_page.total, 1);
    assert!(deleted_page.items[0].deleted_at.is_some());

    remove_workspace(&workspace_dir);
}

#[test]
fn garbage_collection_removes_deleted_model_thumbnail() {
    let workspace_dir = initialized_workspace("asset-model-thumbnail-gc");
    let source_file = workspace_dir.join("model.png");
    fs::write(&source_file, avatar_fixture_bytes(800, 1200)).expect("write fixture");
    let service = AssetService::new();
    let asset = service
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Model,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("model image should import")
        .remove(0);
    let thumbnail_path = workspace_dir
        .join("assets/thumbnail")
        .join(format!("{}.png", asset.id));
    assert!(thumbnail_path.is_file());
    let thumbnail_size = fs::metadata(&thumbnail_path)
        .expect("thumbnail metadata should load")
        .len() as i64;

    service
        .delete_asset(&workspace_dir, &asset.id)
        .expect("model should soft delete");
    let result = service
        .run_garbage_collection(&workspace_dir)
        .expect("gc should remove deleted model");

    assert_eq!(result.deleted_files, 2);
    assert_eq!(result.reclaimed_bytes, asset.size_bytes + thumbnail_size);
    assert!(!thumbnail_path.exists());
    remove_workspace(&workspace_dir);
}

#[test]
fn garbage_collection_counts_thumbnail_when_original_is_missing() {
    let workspace_dir = initialized_workspace("asset-model-thumbnail-only-gc");
    let source_file = workspace_dir.join("model.png");
    fs::write(&source_file, avatar_fixture_bytes(800, 1200)).expect("write fixture");
    let service = AssetService::new();
    let asset = service
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Model,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("model image should import")
        .remove(0);
    let original_path = workspace_dir.join(asset.relative_path.split('/').collect::<PathBuf>());
    let thumbnail_path = workspace_dir
        .join("assets/thumbnail")
        .join(format!("{}.png", asset.id));
    let thumbnail_size = fs::metadata(&thumbnail_path)
        .expect("thumbnail metadata should load")
        .len() as i64;

    service
        .delete_asset(&workspace_dir, &asset.id)
        .expect("model should soft delete");
    fs::remove_file(original_path).expect("remove original fixture");
    let result = service
        .run_garbage_collection(&workspace_dir)
        .expect("gc should remove orphan thumbnail");

    assert_eq!(result.deleted_files, 1);
    assert_eq!(result.reclaimed_bytes, thumbnail_size);
    assert!(!thumbnail_path.exists());
    assert!(service.get_asset(&workspace_dir, &asset.id).is_err());
    remove_workspace(&workspace_dir);
}

#[test]
fn import_images_rejects_unsupported_extensions() {
    let workspace_dir = initialized_workspace("asset-invalid");
    let source_file = workspace_dir.join("not-image.txt");
    fs::write(&source_file, b"not image").expect("write fixture");
    let service = AssetService::new();

    let result = service.import_images(
        &workspace_dir,
        ImportImagesInput {
            kind: AssetKind::Source,
            paths: vec![source_file.to_string_lossy().to_string()],
        },
    );

    assert!(result
        .expect_err("txt should be rejected")
        .to_string()
        .contains("暂不支持的图片格式"));

    remove_workspace(&workspace_dir);
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

fn avatar_fixture_bytes(width: u32, height: u32) -> Vec<u8> {
    let image = RgbaImage::from_fn(width, height, |_, y| {
        if y < height / 6 {
            Rgba([220, 40, 40, 255])
        } else {
            Rgba([40, 80, 220, 255])
        }
    });
    let mut bytes = Vec::new();
    DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .expect("fixture should encode");
    bytes
}

fn gif_with_logical_screen(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = vec![
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00,
        0x00, 0xff, 0xff, 0xff, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02,
        0x01, 0x4c, 0x00, 0x3b,
    ];
    bytes[6..8].copy_from_slice(&width.to_le_bytes());
    bytes[8..10].copy_from_slice(&height.to_le_bytes());
    bytes
}

fn mark_asset_created_at_old(workspace_dir: &Path, asset_id: &str) {
    let database =
        commerce_shoot_studio_lib::infrastructure::database::WorkspaceDatabase::open(workspace_dir)
            .expect("database should open");
    database
        .connection()
        .execute(
            "UPDATE assets SET created_at = datetime('now', '-2 days') WHERE id = ?1",
            [asset_id],
        )
        .expect("asset should be marked old");
}

fn mark_asset_staged(workspace_dir: &Path, asset_id: &str) {
    let database =
        commerce_shoot_studio_lib::infrastructure::database::WorkspaceDatabase::open(workspace_dir)
            .expect("database should open");
    database
        .connection()
        .execute(
            "UPDATE assets SET lifecycle = 'staged' WHERE id = ?1",
            [asset_id],
        )
        .expect("asset should be staged");
}

fn initialized_workspace(label: &str) -> PathBuf {
    let workspace_dir = unique_temp_workspace(label);
    WorkspaceService::new(WorkspaceFileSystem::new())
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    workspace_dir
}

fn unique_temp_workspace(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("commerce-shoot-studio-{label}-{nanos}"))
}

fn remove_workspace(path: &Path) {
    let _ = fs::remove_dir_all(path);
}
