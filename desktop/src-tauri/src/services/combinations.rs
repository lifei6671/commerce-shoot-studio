use sqlx::{Executor, Row};
use ulid::Ulid;

use crate::domain::combination::{
    ImageCombination, ImageCombinationSummary, SaveImageCombinationRequest,
};
use crate::error::{AppError, AppResult};
use crate::storage::sqlite::WorkspaceDatabase;

pub async fn save_image_combination_request(
    database: &WorkspaceDatabase,
    request: SaveImageCombinationRequest,
) -> AppResult<ImageCombination> {
    validate_combination_assets(database, &request).await?;

    let id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("combination_{}", Ulid::new()));

    let mut writer = database.writer().await;
    writer.execute("BEGIN IMMEDIATE").await?;

    let write_result = async {
        sqlx::query(
            "INSERT INTO image_combinations (id, name, person_asset_id)
             VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               person_asset_id = excluded.person_asset_id,
               updated_at = datetime('now')",
        )
        .bind(&id)
        .bind(&request.name)
        .bind(&request.person_asset_id)
        .execute(&mut *writer)
        .await?;

        sqlx::query("DELETE FROM image_combination_items WHERE combination_id = ?")
            .bind(&id)
            .execute(&mut *writer)
            .await?;

        for (index, asset_id) in request.garment_asset_ids.iter().enumerate() {
            sqlx::query(
                "INSERT INTO image_combination_items (
                    combination_id,
                    asset_id,
                    role,
                    sort_order
                ) VALUES (?, ?, 'garment', ?)",
            )
            .bind(&id)
            .bind(asset_id)
            .bind(index as i64)
            .execute(&mut *writer)
            .await?;
        }

        Ok::<(), sqlx::Error>(())
    }
    .await;

    if let Err(err) = write_result {
        writer.execute("ROLLBACK").await?;
        return Err(AppError::Storage(err));
    }

    writer.execute("COMMIT").await?;
    drop(writer);

    get_image_combination_by_id(database, &id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("saved combination was not found".to_string()))
}

pub async fn get_image_combination_by_id(
    database: &WorkspaceDatabase,
    id: &str,
) -> AppResult<Option<ImageCombination>> {
    let row = sqlx::query(
        "SELECT id, name, person_asset_id, created_at, updated_at
         FROM image_combinations
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    let garment_rows = sqlx::query(
        "SELECT asset_id
         FROM image_combination_items
         WHERE combination_id = ?
         ORDER BY sort_order ASC",
    )
    .bind(id)
    .fetch_all(database.pool())
    .await?;

    Ok(Some(ImageCombination {
        id: row.get("id"),
        name: row.get("name"),
        person_asset_id: row.get("person_asset_id"),
        garment_asset_ids: garment_rows
            .into_iter()
            .map(|row| row.get("asset_id"))
            .collect(),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }))
}

pub async fn list_image_combination_summaries(
    database: &WorkspaceDatabase,
) -> AppResult<Vec<ImageCombinationSummary>> {
    let rows = sqlx::query(
        "SELECT
            c.id,
            c.name,
            c.person_asset_id,
            COUNT(i.asset_id) AS garment_count,
            c.created_at,
            c.updated_at
         FROM image_combinations c
         LEFT JOIN image_combination_items i ON i.combination_id = c.id
         GROUP BY c.id
         ORDER BY c.updated_at DESC, c.created_at DESC",
    )
    .fetch_all(database.pool())
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| ImageCombinationSummary {
            id: row.get("id"),
            name: row.get("name"),
            person_asset_id: row.get("person_asset_id"),
            garment_count: row.get("garment_count"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect())
}

async fn validate_combination_assets(
    database: &WorkspaceDatabase,
    request: &SaveImageCombinationRequest,
) -> AppResult<()> {
    if request.name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "combination name is required".to_string(),
        ));
    }
    if request.garment_asset_ids.is_empty() {
        return Err(AppError::InvalidInput(
            "at least one garment asset is required".to_string(),
        ));
    }

    let person_type: Option<String> =
        sqlx::query_scalar("SELECT asset_type FROM assets WHERE id = ?")
            .bind(&request.person_asset_id)
            .fetch_optional(database.pool())
            .await?;
    if person_type.as_deref() != Some("person") {
        return Err(AppError::InvalidInput(
            "personAssetId must reference a person asset".to_string(),
        ));
    }

    for garment_asset_id in &request.garment_asset_ids {
        let garment_type: Option<String> =
            sqlx::query_scalar("SELECT asset_type FROM assets WHERE id = ?")
                .bind(garment_asset_id)
                .fetch_optional(database.pool())
                .await?;
        if garment_type.as_deref() != Some("garment") {
            return Err(AppError::InvalidInput(format!(
                "garment asset {garment_asset_id} must reference a garment asset"
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use image::{ImageBuffer, Rgba};

    use super::*;
    use crate::domain::asset::AssetType;
    use crate::services::assets::import_image_file;
    use crate::storage::file_store::WorkspacePaths;
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

    fn write_png(path: &std::path::Path, color: [u8; 4]) {
        let image = ImageBuffer::<Rgba<u8>, _>::from_pixel(20, 20, Rgba(color));
        image.save(path).expect("write png");
    }

    #[tokio::test]
    async fn save_image_combination_persists_ordered_garments() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let person_path = paths.root().join("person.png");
        let garment_a_path = paths.root().join("garment-a.png");
        let garment_b_path = paths.root().join("garment-b.png");
        write_png(&person_path, [12, 34, 56, 255]);
        write_png(&garment_a_path, [90, 34, 56, 255]);
        write_png(&garment_b_path, [12, 90, 56, 255]);

        let person = import_image_file(&database, &paths, person_path, AssetType::Person)
            .await
            .expect("person");
        let garment_a = import_image_file(&database, &paths, garment_a_path, AssetType::Garment)
            .await
            .expect("garment a");
        let garment_b = import_image_file(&database, &paths, garment_b_path, AssetType::Garment)
            .await
            .expect("garment b");

        let saved = save_image_combination_request(
            &database,
            SaveImageCombinationRequest {
                id: None,
                name: "look 1".to_string(),
                person_asset_id: person.asset.id,
                garment_asset_ids: vec![garment_b.asset.id.clone(), garment_a.asset.id.clone()],
            },
        )
        .await
        .expect("save combination");

        assert_eq!(saved.name, "look 1");
        assert_eq!(
            saved.garment_asset_ids,
            vec![garment_b.asset.id, garment_a.asset.id]
        );

        let summaries = list_image_combination_summaries(&database)
            .await
            .expect("list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].garment_count, 2);
    }

    #[tokio::test]
    async fn save_image_combination_rejects_missing_assets() {
        let (_temp_dir, _paths, database) = test_workspace().await;

        let result = save_image_combination_request(
            &database,
            SaveImageCombinationRequest {
                id: None,
                name: "invalid".to_string(),
                person_asset_id: "missing-person".to_string(),
                garment_asset_ids: vec!["missing-garment".to_string()],
            },
        )
        .await;

        assert!(matches!(result, Err(AppError::InvalidInput(_))));
    }
}
