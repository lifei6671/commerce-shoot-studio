use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use image::{DynamicImage, ImageFormat, ImageReader, Limits};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, OptionalExtension, Row};
use serde::Deserialize;

use crate::domain::assets::{Asset, AssetError, AssetKind, AssetLifecycle};
use crate::infrastructure::database::{DatabaseError, WorkspaceDatabase};
use crate::infrastructure::sha256;

static ASSET_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const STAGED_GC_TTL_HOURS: i64 = 24;
const MODEL_SOURCE_MAX_BYTES: u64 = 64 * 1024 * 1024;
const MODEL_IMAGE_MAX_DIMENSION: u32 = 8192;
const MODEL_IMAGE_MAX_DECODE_ALLOC: u64 = 128 * 1024 * 1024;
const MODEL_THUMBNAIL_SIZE: u32 = 320;
const MODEL_THUMBNAIL_CROP_RATIO: f32 = 0.42;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportImagesInput {
    pub kind: AssetKind,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetQuery {
    pub kind: Option<AssetKind>,
    pub include_deleted: Option<bool>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetPage {
    pub items: Vec<Asset>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GarbageCollectionResult {
    pub deleted_files: i64,
    pub reclaimed_bytes: i64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct AssetService;

impl AssetService {
    pub fn new() -> Self {
        Self
    }

    pub fn list_assets(
        &self,
        workspace_directory: &Path,
        query: AssetQuery,
    ) -> Result<AssetPage, AssetError> {
        let database = open_database(workspace_directory)?;
        list_assets(&database, query)
    }

    pub fn get_asset(
        &self,
        workspace_directory: &Path,
        asset_id: &str,
    ) -> Result<Asset, AssetError> {
        let database = open_database(workspace_directory)?;
        find_asset_by_id(&database, asset_id)?.ok_or_else(|| AssetError::NotFound(asset_id.into()))
    }

    pub fn import_images(
        &self,
        workspace_directory: &Path,
        input: ImportImagesInput,
    ) -> Result<Vec<Asset>, AssetError> {
        if input.paths.is_empty() {
            return Err(AssetError::InvalidInput(
                "至少需要选择一个图片文件。".to_string(),
            ));
        }
        if matches!(input.kind, AssetKind::Generated | AssetKind::Thumbnail) {
            return Err(AssetError::InvalidInput(
                "generated / thumbnail 资产只能由运行时内部写入。".to_string(),
            ));
        }

        let database = open_database(workspace_directory)?;
        let mut imported = Vec::new();

        for raw_path in input.paths {
            let source_path = PathBuf::from(raw_path);
            imported.push(import_single_image(
                &database,
                workspace_directory,
                input.kind,
                &source_path,
            )?);
        }

        Ok(imported)
    }

    pub fn delete_asset(
        &self,
        workspace_directory: &Path,
        asset_id: &str,
    ) -> Result<(), AssetError> {
        let database = open_database(workspace_directory)?;
        let updated = database.connection().execute(
            "
            UPDATE assets
            SET lifecycle = 'deleted',
                deleted_at = COALESCE(deleted_at, datetime('now')),
                updated_at = datetime('now')
            WHERE id = ?1
            ",
            params![asset_id],
        )?;

        if updated == 0 {
            return Err(AssetError::NotFound(asset_id.to_string()));
        }

        Ok(())
    }

    pub fn run_garbage_collection(
        &self,
        workspace_directory: &Path,
    ) -> Result<GarbageCollectionResult, AssetError> {
        let database = open_database(workspace_directory)?;
        run_garbage_collection(&database, workspace_directory)
    }

    pub fn asset_file_path(
        &self,
        workspace_directory: &Path,
        asset_id: &str,
    ) -> Result<PathBuf, AssetError> {
        let asset = self.get_asset(workspace_directory, asset_id)?;
        Ok(workspace_directory.join(relative_path_to_platform(&asset.relative_path)))
    }

    pub(crate) fn save_generated_image(
        &self,
        workspace_directory: &Path,
        original_name: &str,
        mime_type: &str,
        bytes: &[u8],
    ) -> Result<Asset, AssetError> {
        if bytes.is_empty() {
            return Err(AssetError::InvalidInput(
                "生成结果图片内容不能为空。".to_string(),
            ));
        }
        let database = open_database(workspace_directory)?;
        save_generated_image(
            &database,
            workspace_directory,
            original_name,
            mime_type,
            bytes,
        )
    }
}

fn open_database(workspace_directory: &Path) -> Result<WorkspaceDatabase, AssetError> {
    WorkspaceDatabase::open(workspace_directory).map_err(AssetError::from)
}

fn import_single_image(
    database: &WorkspaceDatabase,
    workspace_directory: &Path,
    kind: AssetKind,
    source_path: &Path,
) -> Result<Asset, AssetError> {
    validate_source_file(source_path)?;
    if kind == AssetKind::Model {
        validate_model_source_size(source_path)?;
    }
    let original_name = source_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AssetError::InvalidInput("图片文件名不能为空。".to_string()))?;
    let extension = normalized_extension(source_path)?;
    let mime_type = mime_type_for_extension(&extension)?;
    let bytes = if kind == AssetKind::Model {
        let source_file =
            fs::File::open(source_path).map_err(|source| io_error(source_path, source))?;
        let bytes = read_bytes_with_limit(source_file, MODEL_SOURCE_MAX_BYTES)
            .map_err(|source| io_error(source_path, source))?;
        validate_model_source_bytes_len(bytes.len())?;
        bytes
    } else {
        fs::read(source_path).map_err(|source| io_error(source_path, source))?
    };
    let sha256 = sha256::digest_hex(&bytes);

    if let Some(existing) = find_active_asset_by_hash(database, kind, &sha256)? {
        if kind == AssetKind::Model && existing.lifecycle == AssetLifecycle::Staged {
            database.connection().execute(
                "
                UPDATE assets
                SET lifecycle = 'active',
                    updated_at = datetime('now')
                WHERE id = ?1
                ",
                params![&existing.id],
            )?;
            return find_asset_by_id(database, &existing.id)?
                .ok_or_else(|| AssetError::NotFound(existing.id));
        }
        return Ok(existing);
    }

    let id = create_asset_id();
    let name = format!("{id}.{extension}");
    let relative_path = format!("assets/{}/{}", kind.directory_name(), name);
    let target_path = workspace_directory.join(relative_path_to_platform(&relative_path));
    let tmp_path = workspace_directory
        .join("cache")
        .join("tmp")
        .join(format!("{id}.importing"));

    if let Some(parent) = tmp_path.parent() {
        fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    }
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    }

    fs::write(&tmp_path, &bytes).map_err(|source| io_error(&tmp_path, source))?;
    // 先写入 workspace 内 tmp，再 rename 到 assets 目录，避免半截文件进入资源库。
    if let Err(source) = fs::rename(&tmp_path, &target_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(io_error(&target_path, source));
    }

    let (width, height) = image_dimensions(&bytes, &mime_type);
    let thumbnail_path = if kind == AssetKind::Model {
        match write_model_thumbnail(workspace_directory, &id, &bytes) {
            Ok(path) => Some(path),
            Err(error) => {
                let _ = fs::remove_file(&target_path);
                return Err(error);
            }
        }
    } else {
        None
    };

    if let Err(source) = database.connection().execute(
        "
        INSERT INTO assets (
            id, kind, name, original_name, mime_type, relative_path,
            sha256, width, height, size_bytes, lifecycle
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ",
        params![
            id,
            kind.as_str(),
            name,
            original_name,
            mime_type,
            relative_path,
            sha256,
            width,
            height,
            bytes.len() as i64,
            if kind == AssetKind::Model {
                AssetLifecycle::Active.as_str()
            } else {
                AssetLifecycle::Staged.as_str()
            }
        ],
    ) {
        let _ = fs::remove_file(&target_path);
        if let Some(path) = thumbnail_path {
            let _ = fs::remove_file(path);
        }
        return Err(AssetError::from(source));
    }

    find_asset_by_id(database, &id)?.ok_or_else(|| AssetError::NotFound(id))
}

fn save_generated_image(
    database: &WorkspaceDatabase,
    workspace_directory: &Path,
    original_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<Asset, AssetError> {
    let extension = extension_for_mime_type(mime_type)?;
    let sha256 = sha256::digest_hex(bytes);
    if let Some(existing) = find_active_asset_by_hash(database, AssetKind::Generated, &sha256)? {
        return Ok(existing);
    }

    let id = create_asset_id();
    let name = format!("{id}.{extension}");
    let original_name = if original_name.trim().is_empty() {
        format!("generated.{extension}")
    } else {
        original_name.to_string()
    };
    let relative_path = format!("assets/{}/{}", AssetKind::Generated.directory_name(), name);
    let target_path = workspace_directory.join(relative_path_to_platform(&relative_path));
    let tmp_path = workspace_directory
        .join("cache")
        .join("tmp")
        .join(format!("{id}.generated"));

    if let Some(parent) = tmp_path.parent() {
        fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    }
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    }

    fs::write(&tmp_path, bytes).map_err(|source| io_error(&tmp_path, source))?;
    if let Err(source) = fs::rename(&tmp_path, &target_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(io_error(&target_path, source));
    }

    let (width, height) = image_dimensions(bytes, mime_type);
    if let Err(source) = database.connection().execute(
        "
        INSERT INTO assets (
            id, kind, name, original_name, mime_type, relative_path,
            sha256, width, height, size_bytes, lifecycle
        )
        VALUES (?1, 'generated', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active')
        ",
        params![
            id,
            name,
            original_name,
            mime_type,
            relative_path,
            sha256,
            width,
            height,
            bytes.len() as i64
        ],
    ) {
        let _ = fs::remove_file(&target_path);
        return Err(AssetError::from(source));
    }

    find_asset_by_id(database, &id)?.ok_or_else(|| AssetError::NotFound(id))
}

fn list_assets(database: &WorkspaceDatabase, query: AssetQuery) -> Result<AssetPage, AssetError> {
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
    let offset = (page - 1) * page_size;
    let mut filters = Vec::new();
    let mut values = Vec::new();

    if let Some(kind) = query.kind {
        filters.push("kind = ?");
        values.push(Value::Text(kind.as_str().to_string()));
    }
    if !query.include_deleted.unwrap_or(false) {
        filters.push("deleted_at IS NULL");
    }

    let where_clause = if filters.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", filters.join(" AND "))
    };
    let total_sql = format!("SELECT COUNT(*) FROM assets{where_clause}");
    let total: i64 =
        database
            .connection()
            .query_row(&total_sql, params_from_iter(values.iter()), |row| {
                row.get(0)
            })?;

    let list_sql = format!(
        "
        SELECT id, kind, name, original_name, mime_type, relative_path,
               sha256, width, height, size_bytes, lifecycle, deleted_at, created_at, updated_at
        FROM assets
        {where_clause}
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ? OFFSET ?
        "
    );
    let mut list_values = values;
    list_values.push(Value::Integer(page_size));
    list_values.push(Value::Integer(offset));
    let mut statement = database.connection().prepare(&list_sql)?;
    let rows = statement.query_map(params_from_iter(list_values.iter()), asset_from_row)?;
    let mut items = Vec::new();

    for row in rows {
        items.push(row?);
    }

    Ok(AssetPage {
        items,
        page,
        page_size,
        total,
    })
}

fn find_asset_by_id(
    database: &WorkspaceDatabase,
    asset_id: &str,
) -> Result<Option<Asset>, AssetError> {
    database
        .connection()
        .query_row(
            "
            SELECT id, kind, name, original_name, mime_type, relative_path,
                   sha256, width, height, size_bytes, lifecycle, deleted_at, created_at, updated_at
            FROM assets
            WHERE id = ?1
            ",
            params![asset_id],
            asset_from_row,
        )
        .optional()
        .map_err(AssetError::from)
}

fn find_active_asset_by_hash(
    database: &WorkspaceDatabase,
    kind: AssetKind,
    sha256: &str,
) -> Result<Option<Asset>, AssetError> {
    database
        .connection()
        .query_row(
            "
            SELECT id, kind, name, original_name, mime_type, relative_path,
                   sha256, width, height, size_bytes, lifecycle, deleted_at, created_at, updated_at
            FROM assets
            WHERE kind = ?1 AND sha256 = ?2 AND lifecycle != 'deleted' AND deleted_at IS NULL
            ORDER BY datetime(created_at) ASC
            LIMIT 1
            ",
            params![kind.as_str(), sha256],
            asset_from_row,
        )
        .optional()
        .map_err(AssetError::from)
}

fn asset_from_row(row: &Row<'_>) -> Result<Asset, rusqlite::Error> {
    let kind_value: String = row.get(1)?;
    let kind = AssetKind::from_str(&kind_value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let lifecycle_value: String = row.get(10)?;
    let lifecycle = AssetLifecycle::from_str(&lifecycle_value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(10, rusqlite::types::Type::Text, Box::new(error))
    })?;

    Ok(Asset {
        id: row.get(0)?,
        kind,
        name: row.get(2)?,
        original_name: row.get(3)?,
        mime_type: row.get(4)?,
        relative_path: row.get(5)?,
        sha256: row.get(6)?,
        width: row.get(7)?,
        height: row.get(8)?,
        size_bytes: row.get(9)?,
        lifecycle,
        deleted_at: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn run_garbage_collection(
    database: &WorkspaceDatabase,
    workspace_directory: &Path,
) -> Result<GarbageCollectionResult, AssetError> {
    database.connection().execute(
        "
        UPDATE assets
        SET lifecycle = 'active',
            updated_at = datetime('now')
        WHERE kind = ?1 AND lifecycle = 'staged'
        ",
        params![AssetKind::Model.as_str()],
    )?;
    let mut statement = database.connection().prepare(
        "
        SELECT id, kind, relative_path, size_bytes
        FROM assets
        WHERE (
                lifecycle = 'deleted'
                OR (
                    lifecycle = 'staged'
                    AND datetime(created_at) <= datetime('now', ?1)
                )
            )
            AND NOT EXISTS (
                SELECT 1 FROM generation_task_input_assets
                WHERE generation_task_input_assets.asset_id = assets.id
            )
            AND NOT EXISTS (
                SELECT 1 FROM generation_assets
                WHERE generation_assets.asset_id = assets.id
            )
        ",
    )?;
    let ttl_clause = format!("-{STAGED_GC_TTL_HOURS} hours");
    let rows = statement.query_map([ttl_clause], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    let mut candidates = Vec::new();

    for row in rows {
        candidates.push(row?);
    }

    let mut deleted_files = 0;
    let mut reclaimed_bytes = 0;

    for (asset_id, kind, relative_path, size_bytes) in candidates {
        let path = workspace_directory.join(relative_path_to_platform(&relative_path));
        match fs::remove_file(&path) {
            Ok(()) => {
                deleted_files += 1;
                reclaimed_bytes += size_bytes;
                let (thumbnail_files, thumbnail_bytes) =
                    remove_model_thumbnail(workspace_directory, &kind, &asset_id)?;
                deleted_files += thumbnail_files;
                reclaimed_bytes += thumbnail_bytes;
                database
                    .connection()
                    .execute("DELETE FROM assets WHERE id = ?1", params![asset_id])?;
            }
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => {
                let (thumbnail_files, thumbnail_bytes) =
                    remove_model_thumbnail(workspace_directory, &kind, &asset_id)?;
                deleted_files += thumbnail_files;
                reclaimed_bytes += thumbnail_bytes;
                database
                    .connection()
                    .execute("DELETE FROM assets WHERE id = ?1", params![asset_id])?;
            }
            Err(source) => return Err(io_error(&path, source)),
        }
    }

    Ok(GarbageCollectionResult {
        deleted_files,
        reclaimed_bytes,
    })
}

fn write_model_thumbnail(
    workspace_directory: &Path,
    asset_id: &str,
    bytes: &[u8],
) -> Result<PathBuf, AssetError> {
    let mut reader = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| AssetError::InvalidInput(format!("模型图片格式识别失败：{error}")))?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MODEL_IMAGE_MAX_DIMENSION);
    limits.max_image_height = Some(MODEL_IMAGE_MAX_DIMENSION);
    limits.max_alloc = Some(MODEL_IMAGE_MAX_DECODE_ALLOC);
    reader.limits(limits);
    let image = reader.decode().map_err(model_thumbnail_decode_error)?;
    let source_width = image.width();
    let source_height = image.height();
    if source_width == 0 || source_height == 0 {
        return Err(AssetError::InvalidInput(
            "模型图片尺寸无效，无法生成头像缩略图。".to_string(),
        ));
    }

    let crop_height = ((source_height as f32 * MODEL_THUMBNAIL_CROP_RATIO).round() as u32)
        .max(1)
        .min(source_height);
    let crop_size = source_width.min(crop_height).max(1);
    let crop_x = (source_width - crop_size) / 2;
    let thumbnail = image
        .crop_imm(crop_x, 0, crop_size, crop_size)
        .resize_exact(
            MODEL_THUMBNAIL_SIZE,
            MODEL_THUMBNAIL_SIZE,
            image::imageops::FilterType::Lanczos3,
        );

    let thumbnail_path = workspace_directory
        .join("assets")
        .join("thumbnail")
        .join(format!("{asset_id}.png"));
    let tmp_path = workspace_directory
        .join("cache")
        .join("tmp")
        .join(format!("{asset_id}.thumbnail"));
    if let Some(parent) = tmp_path.parent() {
        fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    }
    if let Some(parent) = thumbnail_path.parent() {
        fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    }

    let result = (|| {
        let mut encoded = Vec::new();
        DynamicImage::write_to(
            &thumbnail,
            &mut std::io::Cursor::new(&mut encoded),
            ImageFormat::Png,
        )
        .map_err(|error| AssetError::InvalidInput(format!("模型头像缩略图编码失败：{error}")))?;
        fs::write(&tmp_path, encoded).map_err(|source| io_error(&tmp_path, source))?;
        fs::rename(&tmp_path, &thumbnail_path)
            .map_err(|source| io_error(&thumbnail_path, source))?;
        Ok::<(), AssetError>(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&tmp_path);
        let _ = fs::remove_file(&thumbnail_path);
        return Err(error);
    }

    Ok(thumbnail_path)
}

fn remove_model_thumbnail(
    workspace_directory: &Path,
    kind: &str,
    asset_id: &str,
) -> Result<(i64, i64), AssetError> {
    if kind != AssetKind::Model.as_str() {
        return Ok((0, 0));
    }

    let thumbnail_path = workspace_directory
        .join("assets")
        .join("thumbnail")
        .join(format!("{asset_id}.png"));
    let size_bytes = match fs::metadata(&thumbnail_path) {
        Ok(metadata) => i64::try_from(metadata.len()).map_err(|_| {
            AssetError::InvalidInput("模型头像缩略图文件大小超出支持范围。".to_string())
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok((0, 0)),
        Err(error) => return Err(io_error(&thumbnail_path, error)),
    };
    match fs::remove_file(&thumbnail_path) {
        Ok(()) => Ok((1, size_bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((0, 0)),
        Err(error) => Err(io_error(&thumbnail_path, error)),
    }
}

fn validate_model_source_size(path: &Path) -> Result<(), AssetError> {
    let size_bytes = fs::metadata(path)
        .map_err(|source| io_error(path, source))?
        .len();
    if size_bytes > MODEL_SOURCE_MAX_BYTES {
        return Err(AssetError::InvalidInput(
            "模型图片文件不能超过 64 MiB。".to_string(),
        ));
    }
    Ok(())
}

fn validate_model_source_bytes_len(size_bytes: usize) -> Result<(), AssetError> {
    if u64::try_from(size_bytes).map_or(true, |size_bytes| size_bytes > MODEL_SOURCE_MAX_BYTES) {
        return Err(AssetError::InvalidInput(
            "模型图片文件不能超过 64 MiB。".to_string(),
        ));
    }
    Ok(())
}

fn read_bytes_with_limit<R: Read>(reader: R, max_bytes: u64) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn model_thumbnail_decode_error(error: image::ImageError) -> AssetError {
    if matches!(error, image::ImageError::Limits(_)) {
        return AssetError::InvalidInput(
            "模型图片尺寸不能超过 8192×8192，且解码内存不能超过 128 MiB。".to_string(),
        );
    }
    AssetError::InvalidInput(format!("模型图片无法生成头像缩略图：{error}"))
}

fn validate_source_file(path: &Path) -> Result<(), AssetError> {
    if !path.is_file() {
        return Err(AssetError::InvalidInput(format!(
            "图片文件不存在或不是普通文件：{}",
            path.display()
        )));
    }
    Ok(())
}

fn normalized_extension(path: &Path) -> Result<String, AssetError> {
    path.extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AssetError::InvalidInput("图片文件缺少扩展名。".to_string()))
}

fn mime_type_for_extension(extension: &str) -> Result<String, AssetError> {
    match extension {
        "png" => Ok("image/png".to_string()),
        "jpg" | "jpeg" => Ok("image/jpeg".to_string()),
        "webp" => Ok("image/webp".to_string()),
        "gif" => Ok("image/gif".to_string()),
        _ => Err(AssetError::InvalidInput(format!(
            "暂不支持的图片格式：{extension}"
        ))),
    }
}

fn extension_for_mime_type(mime_type: &str) -> Result<&'static str, AssetError> {
    match mime_type {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        _ => Err(AssetError::InvalidInput(format!(
            "暂不支持的生成图片 MIME 类型：{mime_type}"
        ))),
    }
}

fn image_dimensions(bytes: &[u8], mime_type: &str) -> (Option<i64>, Option<i64>) {
    match mime_type {
        "image/png" => png_dimensions(bytes),
        "image/jpeg" => jpeg_dimensions(bytes),
        _ => (None, None),
    }
}

fn png_dimensions(bytes: &[u8]) -> (Option<i64>, Option<i64>) {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 24 || &bytes[0..8] != PNG_SIGNATURE {
        return (None, None);
    }

    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]) as i64;
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]) as i64;
    (Some(width), Some(height))
}

fn jpeg_dimensions(bytes: &[u8]) -> (Option<i64>, Option<i64>) {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return (None, None);
    }

    let mut index = 2;
    while index + 9 < bytes.len() {
        if bytes[index] != 0xff {
            index += 1;
            continue;
        }

        let marker = bytes[index + 1];
        index += 2;

        while index < bytes.len() && bytes[index] == 0xff {
            index += 1;
        }

        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if index + 2 > bytes.len() {
            break;
        }

        let length = u16::from_be_bytes([bytes[index], bytes[index + 1]]) as usize;
        if length < 2 || index + length > bytes.len() {
            break;
        }

        if is_jpeg_sof_marker(marker) && length >= 7 {
            let height = u16::from_be_bytes([bytes[index + 3], bytes[index + 4]]) as i64;
            let width = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as i64;
            return (Some(width), Some(height));
        }

        index += length;
    }

    (None, None)
}

fn is_jpeg_sof_marker(marker: u8) -> bool {
    matches!(
        marker,
        0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf
    )
}

fn relative_path_to_platform(relative_path: &str) -> PathBuf {
    relative_path.split('/').collect()
}

fn create_asset_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = ASSET_ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("asset_{nanos}_{sequence}")
}

fn io_error(path: &Path, source: std::io::Error) -> AssetError {
    AssetError::Io {
        path: path.to_path_buf(),
        message: source.to_string(),
    }
}

impl From<DatabaseError> for AssetError {
    fn from(source: DatabaseError) -> Self {
        AssetError::Database(source.to_string())
    }
}

impl From<rusqlite::Error> for AssetError {
    fn from(source: rusqlite::Error) -> Self {
        AssetError::Database(DatabaseError::from(source).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn limited_reader_stops_after_limit_plus_one_byte() {
        let mut source = Cursor::new(vec![0_u8; 16]);
        let bytes = read_bytes_with_limit(&mut source, 4).expect("read limited bytes");

        assert_eq!(bytes.len(), 5);
        assert_eq!(source.position(), 5);
    }
}
