use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::domain::assets::{AssetKind, AssetLifecycle};
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::infrastructure::sha256;
use commerce_shoot_studio_lib::services::assets::{AssetQuery, AssetService, ImportImagesInput};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

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
fn garbage_collection_removes_unreferenced_staged_assets() {
    let workspace_dir = initialized_workspace("asset-gc-staged");
    let source_file = workspace_dir.join("staged.png");
    fs::write(&source_file, png_fixture_bytes(2, 2)).expect("write fixture");
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
fn delete_asset_soft_deletes_and_default_list_hides_it() {
    let workspace_dir = initialized_workspace("asset-delete");
    let source_file = workspace_dir.join("delete.png");
    fs::write(&source_file, png_fixture_bytes(1, 1)).expect("write fixture");
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
