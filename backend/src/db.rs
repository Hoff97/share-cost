use once_cell::sync::OnceCell;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("migrations");
}

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

pub async fn run_migrations(database_url: &str) -> Result<(), Box<dyn std::error::Error>> {
    let (mut client, connection) = tokio_postgres::connect(database_url, tokio_postgres::NoTls).await?;
    
    // Spawn the connection handler
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("Database connection error: {}", e);
        }
    });

    let report = embedded::migrations::runner().run_async(&mut client).await?;
    for migration in report.applied_migrations() {
        println!("Applied migration: {}", migration);
    }

    Ok(())
}
