use once_cell::sync::OnceCell;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

static POOL: OnceCell<PgPool> = OnceCell::new();

pub async fn init_pool(database_url: &str) -> Result<(), sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;
    
    POOL.set(pool).expect("Pool already initialized");
    Ok(())
}

pub fn get_pool() -> &'static PgPool {
    POOL.get().expect("Database pool not initialized")
}

/// Run all SQL migrations from the migrations folder
pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    // Create migrations tracking table if it doesn't exist
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS _sqlx_migrations (
            version BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            installed_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            success BOOLEAN NOT NULL,
            checksum BYTEA NOT NULL,
            execution_time BIGINT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // For simplicity, we'll just run the migration file directly
    // In production, you'd use sqlx-cli or a proper migration runner
    let migration_sql = include_str!("../migrations/001_initial_schema.sql");
    
    // Check if migration was already applied
    let applied: Option<(i64,)> = sqlx::query_as(
        "SELECT version FROM _sqlx_migrations WHERE version = 1"
    )
    .fetch_optional(pool)
    .await?;

    if applied.is_none() {
        println!("Running migration 001_initial_schema...");
        
        // Split migration into individual statements and execute each one
        // Filter out empty statements and comments
        for (i, statement) in migration_sql.split(';').enumerate() {
            // Remove comment lines and trim
            let cleaned: String = statement
                .lines()
                .filter(|line| !line.trim().starts_with("--"))
                .collect::<Vec<_>>()
                .join("\n");
            let cleaned = cleaned.trim();
            
            // Skip empty statements
            if cleaned.is_empty() {
                continue;
            }
            
            println!("Executing statement {}: {}...", i, &cleaned[..cleaned.len().min(50)]);
            sqlx::query(cleaned).execute(pool).await.map_err(|e| {
                eprintln!("Failed to execute statement {}: {}", i, cleaned);
                e
            })?;
        }
        
        // Record the migration
        sqlx::query(
            r#"
            INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
            VALUES (1, '001_initial_schema', true, '\x00', 0)
            "#,
        )
        .execute(pool)
        .await?;
        println!("Migration 001_initial_schema applied successfully.");
    } else {
        println!("Migration 001_initial_schema already applied.");
    }

    Ok(())
}
