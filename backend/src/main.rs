#[macro_use]
extern crate rocket;

mod auth;
mod db;
mod models;
mod routes;

use rocket::fairing::AdHoc;
use rocket::fs::NamedFile;
use rocket::http::ContentType;
use rocket::http::Method;
use rocket_cors::{AllowedHeaders, AllowedOrigins, CorsOptions};
use rocket_governor::rocket_governor_catcher;
use std::path::{Path, PathBuf};

// Serve the PWA manifest with the correct Content-Type (Rocket doesn't know .webmanifest)
#[get("/manifest.webmanifest", rank = 5)]
async fn manifest() -> Option<(ContentType, Vec<u8>)> {
    let bytes = rocket::tokio::fs::read("static/manifest.webmanifest")
        .await
        .ok()?;
    Some((ContentType::new("application", "manifest+json"), bytes))
}

// SPA fallback: serve index.html for any route not matched by API or static files
#[get("/<_path..>", rank = 100)]
async fn spa_fallback(_path: PathBuf) -> Option<NamedFile> {
    NamedFile::open("static/index.html").await.ok()
}

#[get("/", rank = 99)]
async fn index() -> Option<NamedFile> {
    NamedFile::open("static/index.html").await.ok()
}

#[launch]
fn rocket() -> _ {
    // Load .env file if it exists
    dotenvy::dotenv().ok();

    let cors = CorsOptions::default()
        .allowed_origins(AllowedOrigins::all())
        .allowed_methods(
            vec![
                Method::Get,
                Method::Post,
                Method::Put,
                Method::Delete,
                Method::Options,
            ]
            .into_iter()
            .map(From::from)
            .collect(),
        )
        .allowed_headers(AllowedHeaders::all())
        .to_cors()
        .expect("CORS configuration failed");

    rocket::build()
        .attach(cors)
        .attach(AdHoc::try_on_ignite(
            "Initialize Database",
            |rocket| async {
                let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

                db::run_migrations(&database_url)
                    .await
                    .expect("Failed to run migrations");

                db::init_pool(&database_url)
                    .await
                    .expect("Failed to initialize database pool");

                Ok(rocket)
            },
        ))
        .mount("/api", routes::get_routes())
        .register("/api", catchers![rocket_governor_catcher])
        .attach(AdHoc::on_liftoff("Cleanup Scheduler", |_rocket| Box::pin(async {
            rocket::tokio::spawn(async {
                let mut interval = rocket::tokio::time::interval(rocket::tokio::time::Duration::from_secs(24 * 60 * 60));
                loop {
                    interval.tick().await;
                    let pool = db::get_pool();
                    match sqlx::query("DELETE FROM groups WHERE last_activity_at < NOW() - INTERVAL '6 months'")
                        .execute(pool)
                        .await
                    {
                        Ok(result) => {
                            let count = result.rows_affected();
                            if count > 0 {
                                println!("Cleanup: deleted {} inactive group(s)", count);
                            }
                        }
                        Err(e) => eprintln!("Cleanup failed: {}", e),
                    }
                }
            });
        })))
        .mount("/", routes![manifest, index, spa_fallback])
        .attach(AdHoc::on_ignite("Static Files", |rocket| async {
            if Path::new("static").is_dir() {
                rocket.mount("/", rocket::fs::FileServer::from("static").rank(10))
            } else {
                println!("No 'static' directory found — skipping static file serving");
                rocket
            }
        }))
}
