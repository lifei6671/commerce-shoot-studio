use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use image::GenericImageView;
use sha2::{Digest, Sha256};
use ulid::Ulid;

use crate::domain::asset::{Asset, AssetFileView, AssetType, ImportImageResponse};
use crate::error::{AppError, AppResult};
use crate::storage::file_store::WorkspacePaths;
use crate::storage::sqlite::WorkspaceDatabase;

pub async fn import_image_file(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    source_path: PathBuf,
    asset_type: AssetType,
) -> AppResult<ImportImageResponse> {
    if !source_path.is_file() {
        return Err(AppError::InvalidInput(
            "sourcePath must point to an existing image file".to_string(),
        ));
    }

    let extension = normalized_image_extension(&source_path)?;
    let mime_type = mime_type_for_extension(extension);
    let sha256 = calculate_sha256(&source_path)?;

    if let Some(existing) = find_asset_by_type_and_sha256(database, &asset_type, &sha256).await? {
        let thumb_file_path = paths.root().join(&existing.thumb_relative_path);
        return Ok(ImportImageResponse {
            asset: existing,
            duplicate: true,
            thumb_file_path: thumb_file_path.to_string_lossy().to_string(),
        });
    }

    let id = format!("asset_{}", Ulid::new());
    let relative_path = format!("assets/{}/{}.{}", asset_type.as_str(), id, extension);
    let thumb_relative_path = format!("assets/cache/thumbs/{id}.jpg");
    let destination_path = paths.root().join(&relative_path);
    let thumb_path = paths.root().join(&thumb_relative_path);

    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = thumb_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let image = image::open(&source_path)
        .map_err(|err| AppError::InvalidInput(format!("invalid image file: {err}")))?;
    let (width, height) = image.dimensions();

    fs::copy(&source_path, &destination_path)?;
    let thumbnail = image.thumbnail(320, 320).to_rgb8();
    thumbnail
        .save_with_format(&thumb_path, image::ImageFormat::Jpeg)
        .map_err(|err| AppError::InvalidInput(format!("failed to create thumbnail: {err}")))?;

    let original_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::InvalidInput("sourcePath file name is invalid".to_string()))?
        .to_string();

    let mut writer = database.writer().await;
    sqlx::query(
        "INSERT INTO assets (
            id,
            asset_type,
            original_name,
            relative_path,
            thumb_relative_path,
            mime_type,
            sha256,
            width,
            height
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(asset_type.as_str())
    .bind(&original_name)
    .bind(&relative_path)
    .bind(&thumb_relative_path)
    .bind(mime_type)
    .bind(&sha256)
    .bind(i64::from(width))
    .bind(i64::from(height))
    .execute(&mut *writer)
    .await?;
    drop(writer);

    let asset = get_asset_by_id(database, &id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("created asset was not found".to_string()))?;

    Ok(ImportImageResponse {
        asset,
        duplicate: false,
        thumb_file_path: thumb_path.to_string_lossy().to_string(),
    })
}

pub async fn get_asset_by_id(database: &WorkspaceDatabase, id: &str) -> AppResult<Option<Asset>> {
    let row = sqlx::query_as::<_, AssetRow>(
        "SELECT
            id,
            asset_type,
            original_name,
            relative_path,
            thumb_relative_path,
            mime_type,
            sha256,
            width,
            height,
            created_at
        FROM assets
        WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?;

    row.map(AssetRow::try_into_asset).transpose()
}

pub async fn get_asset_file_view_by_id(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    id: &str,
) -> AppResult<Option<AssetFileView>> {
    Ok(get_asset_by_id(database, id)
        .await?
        .map(|asset| asset_file_view(paths, asset)))
}

pub async fn list_asset_file_views(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    asset_type: Option<AssetType>,
) -> AppResult<Vec<AssetFileView>> {
    let rows = match asset_type {
        Some(asset_type) => {
            sqlx::query_as::<_, AssetRow>(
                "SELECT
                    id,
                    asset_type,
                    original_name,
                    relative_path,
                    thumb_relative_path,
                    mime_type,
                    sha256,
                    width,
                    height,
                    created_at
                 FROM assets
                 WHERE asset_type = ?
                 ORDER BY created_at DESC, id DESC",
            )
            .bind(asset_type.as_str())
            .fetch_all(database.pool())
            .await?
        }
        None => {
            sqlx::query_as::<_, AssetRow>(
                "SELECT
                    id,
                    asset_type,
                    original_name,
                    relative_path,
                    thumb_relative_path,
                    mime_type,
                    sha256,
                    width,
                    height,
                    created_at
                 FROM assets
                 ORDER BY created_at DESC, id DESC",
            )
            .fetch_all(database.pool())
            .await?
        }
    };

    rows.into_iter()
        .map(AssetRow::try_into_asset)
        .map(|result| result.map(|asset| asset_file_view(paths, asset)))
        .collect()
}

fn asset_file_view(paths: &WorkspacePaths, asset: Asset) -> AssetFileView {
    AssetFileView {
        file_path: paths
            .root()
            .join(&asset.relative_path)
            .to_string_lossy()
            .to_string(),
        thumb_file_path: paths
            .root()
            .join(&asset.thumb_relative_path)
            .to_string_lossy()
            .to_string(),
        asset,
    }
}

pub async fn delete_asset(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    asset_id: &str,
) -> AppResult<()> {
    let Some(asset) = get_asset_by_id(database, asset_id).await? else {
        return Err(AppError::InvalidInput(format!(
            "asset {asset_id} was not found"
        )));
    };
    let combination_ref_count: i64 = sqlx::query_scalar(
        "SELECT
            (SELECT COUNT(*) FROM image_combinations WHERE person_asset_id = ?)
            +
            (SELECT COUNT(*) FROM image_combination_items WHERE asset_id = ?)",
    )
    .bind(asset_id)
    .bind(asset_id)
    .fetch_one(database.pool())
    .await?;
    if combination_ref_count > 0 {
        return Err(AppError::InvalidInput(format!(
            "asset {asset_id} is referenced by an image combination"
        )));
    }
    let task_ref_count: i64 = sqlx::query_scalar(
        "SELECT
            (SELECT COUNT(*) FROM generation_task_input_assets WHERE asset_id = ?)
            +
            (SELECT COUNT(*) FROM generation_task_results WHERE asset_id = ?)",
    )
    .bind(asset_id)
    .bind(asset_id)
    .fetch_one(database.pool())
    .await?;
    if task_ref_count > 0 {
        return Err(AppError::InvalidInput(format!(
            "asset {asset_id} is referenced by a generation task"
        )));
    }

    let mut writer = database.writer().await;
    sqlx::query("DELETE FROM assets WHERE id = ?")
        .bind(asset_id)
        .execute(&mut *writer)
        .await?;
    drop(writer);

    remove_workspace_file_or_record_gc(database, paths, &asset.relative_path).await?;
    remove_workspace_file_or_record_gc(database, paths, &asset.thumb_relative_path).await?;

    Ok(())
}

pub async fn run_asset_gc(database: &WorkspaceDatabase, paths: &WorkspacePaths) -> AppResult<u64> {
    let rows = sqlx::query_as::<_, AssetGcRow>(
        "SELECT id, relative_path
         FROM asset_gc_queue
         ORDER BY updated_at ASC, id ASC
         LIMIT 100",
    )
    .fetch_all(database.pool())
    .await?;
    let mut removed = 0_u64;

    for row in rows {
        if !is_gc_relative_path_allowed(&row.relative_path) {
            continue;
        }
        match remove_workspace_file(paths, &row.relative_path) {
            Ok(()) => {
                let mut writer = database.writer().await;
                sqlx::query("DELETE FROM asset_gc_queue WHERE id = ?")
                    .bind(&row.id)
                    .execute(&mut *writer)
                    .await?;
                removed += 1;
            }
            Err(err) => {
                record_asset_gc(database, &row.relative_path, &err.to_string()).await?;
            }
        }
    }

    Ok(removed)
}

fn is_gc_relative_path_allowed(relative_path: &str) -> bool {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return false;
    }
    if !relative_path.starts_with("assets/") {
        return false;
    }
    !path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir))
}

async fn remove_workspace_file_or_record_gc(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    relative_path: &str,
) -> AppResult<()> {
    match remove_workspace_file(paths, relative_path) {
        Ok(()) => Ok(()),
        Err(err) => {
            record_asset_gc(database, relative_path, &err.to_string()).await?;
            Ok(())
        }
    }
}

fn remove_workspace_file(paths: &WorkspacePaths, relative_path: &str) -> AppResult<()> {
    let path = paths.root().join(relative_path);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

async fn record_asset_gc(
    database: &WorkspaceDatabase,
    relative_path: &str,
    last_error: &str,
) -> AppResult<()> {
    let id = format!("asset_gc_{}", Ulid::new());
    let mut writer = database.writer().await;
    sqlx::query(
        "INSERT INTO asset_gc_queue (
            id,
            relative_path,
            reason,
            last_error
         ) VALUES (?, ?, 'delete_failed', ?)
         ON CONFLICT(relative_path) DO UPDATE SET
            attempts = asset_gc_queue.attempts + 1,
            last_error = excluded.last_error,
            updated_at = datetime('now')",
    )
    .bind(id)
    .bind(relative_path)
    .bind(last_error)
    .execute(&mut *writer)
    .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct AssetGcRow {
    id: String,
    relative_path: String,
}

async fn find_asset_by_type_and_sha256(
    database: &WorkspaceDatabase,
    asset_type: &AssetType,
    sha256: &str,
) -> AppResult<Option<Asset>> {
    let row = sqlx::query_as::<_, AssetRow>(
        "SELECT
            id,
            asset_type,
            original_name,
            relative_path,
            thumb_relative_path,
            mime_type,
            sha256,
            width,
            height,
            created_at
        FROM assets
        WHERE asset_type = ? AND sha256 = ?",
    )
    .bind(asset_type.as_str())
    .bind(sha256)
    .fetch_optional(database.pool())
    .await?;

    row.map(AssetRow::try_into_asset).transpose()
}

fn normalized_image_extension(source_path: &Path) -> AppResult<&'static str> {
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| AppError::InvalidInput("image file extension is required".to_string()))?;

    match extension.as_str() {
        "jpg" | "jpeg" => Ok("jpg"),
        "png" => Ok("png"),
        _ => Err(AppError::InvalidInput(
            "only png, jpg and jpeg images are supported".to_string(),
        )),
    }
}

fn mime_type_for_extension(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        _ => "image/jpeg",
    }
}

fn calculate_sha256(source_path: &Path) -> AppResult<String> {
    let mut file = fs::File::open(source_path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(sqlx::FromRow)]
struct AssetRow {
    id: String,
    asset_type: String,
    original_name: String,
    relative_path: String,
    thumb_relative_path: String,
    mime_type: String,
    sha256: String,
    width: i64,
    height: i64,
    created_at: String,
}

impl AssetRow {
    fn try_into_asset(self) -> AppResult<Asset> {
        let asset_type = match self.asset_type.as_str() {
            "person" => AssetType::Person,
            "garment" => AssetType::Garment,
            "result" => AssetType::Result,
            _ => {
                return Err(AppError::InvalidInput(format!(
                    "unknown asset type {}",
                    self.asset_type
                )))
            }
        };

        Ok(Asset {
            id: self.id,
            asset_type,
            original_name: self.original_name,
            relative_path: self.relative_path,
            thumb_relative_path: self.thumb_relative_path,
            mime_type: self.mime_type,
            sha256: self.sha256,
            width: self.width,
            height: self.height,
            created_at: self.created_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use image::{ImageBuffer, Rgba};

    use super::*;
    use crate::domain::combination::SaveImageCombinationRequest;
    use crate::services::combinations::save_image_combination_request;
    use crate::storage::migrations::run_workspace_migrations;

    async fn test_workspace() -> (tempfile::TempDir, WorkspacePaths, WorkspaceDatabase) {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().join("workspace"));
        paths.ensure().expect("ensure");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("connect");
        run_workspace_migrations(&paths, &database)
            .await
            .expect("migrate");
        (temp_dir, paths, database)
    }

    fn write_png(path: &Path) {
        let image = ImageBuffer::<Rgba<u8>, _>::from_pixel(16, 12, Rgba([42, 84, 126, 255]));
        image.save(path).expect("write png");
    }

    #[tokio::test]
    async fn import_image_file_stores_relative_paths_and_thumbnail() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let source_path = paths.root().join("source.png");
        write_png(&source_path);

        let response = import_image_file(&database, &paths, source_path.clone(), AssetType::Person)
            .await
            .expect("import");

        assert!(!response.duplicate);
        assert_eq!(response.asset.asset_type.as_str(), "person");
        assert_eq!(response.asset.width, 16);
        assert_eq!(response.asset.height, 12);
        assert!(!response
            .asset
            .relative_path
            .contains(source_path.to_str().unwrap()));
        assert!(response
            .asset
            .relative_path
            .starts_with("assets/person/asset_"));
        assert!(paths.root().join(&response.asset.relative_path).is_file());
        assert!(paths
            .root()
            .join(&response.asset.thumb_relative_path)
            .is_file());
    }

    #[tokio::test]
    async fn import_image_file_deduplicates_only_within_same_asset_type() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let source_path = paths.root().join("source.png");
        write_png(&source_path);

        let first = import_image_file(&database, &paths, source_path.clone(), AssetType::Person)
            .await
            .expect("first import");
        let duplicate =
            import_image_file(&database, &paths, source_path.clone(), AssetType::Person)
                .await
                .expect("duplicate import");
        let other_type = import_image_file(&database, &paths, source_path, AssetType::Garment)
            .await
            .expect("other type import");

        assert_eq!(first.asset.id, duplicate.asset.id);
        assert!(duplicate.duplicate);
        assert_ne!(first.asset.id, other_type.asset.id);
        assert!(!other_type.duplicate);
    }

    #[tokio::test]
    async fn list_asset_file_views_filters_type_and_resolves_paths() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let person_path = paths.root().join("person.png");
        let garment_path = paths.root().join("garment.png");
        write_png(&person_path);
        write_png(&garment_path);
        let person = import_image_file(&database, &paths, person_path, AssetType::Person)
            .await
            .expect("person import");
        let garment = import_image_file(&database, &paths, garment_path, AssetType::Garment)
            .await
            .expect("garment import");

        let people = list_asset_file_views(&database, &paths, Some(AssetType::Person))
            .await
            .expect("list people");

        assert_eq!(people.len(), 1);
        assert_eq!(people[0].asset.id, person.asset.id);
        assert!(people[0]
            .thumb_file_path
            .ends_with(&person.asset.thumb_relative_path));
        assert_ne!(people[0].asset.id, garment.asset.id);
    }

    #[tokio::test]
    async fn delete_asset_rejects_combination_references() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let person_path = paths.root().join("person.png");
        let garment_path = paths.root().join("garment.png");
        write_png(&person_path);
        write_png(&garment_path);
        let person = import_image_file(&database, &paths, person_path, AssetType::Person)
            .await
            .expect("person");
        let garment = import_image_file(&database, &paths, garment_path, AssetType::Garment)
            .await
            .expect("garment");
        save_image_combination_request(
            &database,
            SaveImageCombinationRequest {
                id: None,
                name: "protected look".to_string(),
                person_asset_id: person.asset.id.clone(),
                garment_asset_ids: vec![garment.asset.id],
            },
        )
        .await
        .expect("save combination");

        let result = delete_asset(&database, &paths, &person.asset.id).await;

        assert!(matches!(result, Err(AppError::InvalidInput(_))));
        assert!(get_asset_by_id(&database, &person.asset.id)
            .await
            .expect("asset lookup")
            .is_some());
        assert!(paths.root().join(&person.asset.relative_path).is_file());
    }

    #[tokio::test]
    async fn delete_asset_rejects_generation_task_input_references() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let source_path = paths.root().join("garment.png");
        write_png(&source_path);
        let garment = import_image_file(&database, &paths, source_path, AssetType::Garment)
            .await
            .expect("garment");
        sqlx::query(
            "INSERT INTO generation_tasks (
                id,
                status,
                provider,
                model_id,
                combination_snapshot_json,
                prompt_snapshot_json,
                model_snapshot_json,
                input_assets_snapshot_json,
                input_snapshot_json,
                final_prompt_snapshot_json,
                model_config_snapshot_json,
                asset_snapshot_json,
                updated_at
            ) VALUES (
                'task-with-input',
                'succeeded',
                'openai',
                'gpt-image-1',
                '{}',
                '{}',
                '{}',
                '[]',
                '{}',
                '{}',
                '{}',
                '[]',
                datetime('now')
            )",
        )
        .execute(database.pool())
        .await
        .expect("task");
        sqlx::query(
            "INSERT INTO generation_task_input_assets (
                task_id,
                asset_id,
                role,
                sort_order,
                is_primary
            ) VALUES ('task-with-input', ?, 'garment', 0, 1)",
        )
        .bind(&garment.asset.id)
        .execute(database.pool())
        .await
        .expect("task input");

        let result = delete_asset(&database, &paths, &garment.asset.id).await;

        assert!(matches!(result, Err(AppError::InvalidInput(_))));
        assert!(get_asset_by_id(&database, &garment.asset.id)
            .await
            .expect("asset lookup")
            .is_some());
    }

    #[tokio::test]
    async fn delete_asset_rejects_generation_task_result_references() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let source_path = paths.root().join("result.png");
        write_png(&source_path);
        let result_asset = import_image_file(&database, &paths, source_path, AssetType::Result)
            .await
            .expect("result asset");
        sqlx::query(
            "INSERT INTO generation_tasks (
                id,
                status,
                provider,
                model_id,
                combination_snapshot_json,
                prompt_snapshot_json,
                model_snapshot_json,
                input_assets_snapshot_json,
                input_snapshot_json,
                final_prompt_snapshot_json,
                model_config_snapshot_json,
                asset_snapshot_json,
                updated_at
            ) VALUES (
                'task-with-result',
                'succeeded',
                'openai',
                'gpt-image-1',
                '{}',
                '{}',
                '{}',
                '[]',
                '{}',
                '{}',
                '{}',
                '[]',
                datetime('now')
            )",
        )
        .execute(database.pool())
        .await
        .expect("task");
        sqlx::query(
            "INSERT INTO generation_task_results (
                id,
                task_id,
                asset_id,
                sort_order
            ) VALUES ('task-result-1', 'task-with-result', ?, 0)",
        )
        .bind(&result_asset.asset.id)
        .execute(database.pool())
        .await
        .expect("task result");

        let result = delete_asset(&database, &paths, &result_asset.asset.id).await;

        assert!(matches!(result, Err(AppError::InvalidInput(_))));
        assert!(get_asset_by_id(&database, &result_asset.asset.id)
            .await
            .expect("asset lookup")
            .is_some());
    }

    #[tokio::test]
    async fn delete_asset_removes_unreferenced_asset_record_and_files() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let source_path = paths.root().join("person.png");
        write_png(&source_path);
        let person = import_image_file(&database, &paths, source_path, AssetType::Person)
            .await
            .expect("person");
        let image_path = paths.root().join(&person.asset.relative_path);
        let thumb_path = paths.root().join(&person.asset.thumb_relative_path);

        delete_asset(&database, &paths, &person.asset.id)
            .await
            .expect("delete asset");

        assert!(get_asset_by_id(&database, &person.asset.id)
            .await
            .expect("asset lookup")
            .is_none());
        assert!(!image_path.exists());
        assert!(!thumb_path.exists());
    }

    #[tokio::test]
    async fn delete_asset_records_gc_when_file_removal_fails_after_database_delete() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let source_path = paths.root().join("person.png");
        write_png(&source_path);
        let person = import_image_file(&database, &paths, source_path, AssetType::Person)
            .await
            .expect("person");
        let image_path = paths.root().join(&person.asset.relative_path);
        fs::remove_file(&image_path).expect("remove imported file");
        fs::create_dir(&image_path).expect("create directory at asset path");

        delete_asset(&database, &paths, &person.asset.id)
            .await
            .expect("delete asset");

        assert!(get_asset_by_id(&database, &person.asset.id)
            .await
            .expect("asset lookup")
            .is_none());
        let pending_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM asset_gc_queue
             WHERE relative_path = ? AND reason = 'delete_failed'",
        )
        .bind(&person.asset.relative_path)
        .fetch_one(database.pool())
        .await
        .expect("gc queue");
        assert_eq!(pending_count, 1);
        assert!(image_path.is_dir());
    }

    #[tokio::test]
    async fn run_asset_gc_removes_only_workspace_asset_paths() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let orphan_relative_path = "assets/person/orphan.png";
        let orphan_path = paths.root().join(orphan_relative_path);
        fs::create_dir_all(orphan_path.parent().expect("orphan parent")).expect("orphan parent");
        fs::write(&orphan_path, b"orphan").expect("orphan file");
        let outside_path = paths.root().join("../outside.png");
        fs::write(&outside_path, b"outside").expect("outside file");
        sqlx::query(
            "INSERT INTO asset_gc_queue (id, relative_path, reason)
             VALUES
               ('gc_allowed', ?, 'delete_failed'),
               ('gc_outside', '../outside.png', 'delete_failed')",
        )
        .bind(orphan_relative_path)
        .execute(database.pool())
        .await
        .expect("gc rows");

        let removed = run_asset_gc(&database, &paths).await.expect("run gc");

        assert_eq!(removed, 1);
        assert!(!orphan_path.exists());
        assert!(outside_path.exists());
        let remaining_paths: Vec<String> =
            sqlx::query_scalar("SELECT relative_path FROM asset_gc_queue ORDER BY relative_path")
                .fetch_all(database.pool())
                .await
                .expect("remaining gc rows");
        assert_eq!(remaining_paths, vec!["../outside.png".to_string()]);
    }
}
