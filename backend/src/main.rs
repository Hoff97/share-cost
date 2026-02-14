#[macro_use]
extern crate rocket;

mod auth;
mod db;
mod models;
mod routes;

use rocket::http::Method;
use rocket::fairing::AdHoc;
use rocket::fs::NamedFile;
use rocket_cors::{AllowedHeaders, AllowedOrigins, CorsOptions};
use std::path::{Path, PathBuf};

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
            vec![Method::Get, Method::Post, Method::Put, Method::Delete, Method::Options]
                .into_iter()
                .map(From::from)
                .collect(),
        )
        .allowed_headers(AllowedHeaders::all())
        .to_cors()
        .expect("CORS configuration failed");

    rocket::build()
        .attach(cors)
        .attach(AdHoc::try_on_ignite("Initialize Database", |rocket| async {
            let database_url = std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set");
            
            db::run_migrations(&database_url).await
                .expect("Failed to run migrations");

            db::init_pool(&database_url).await
                .expect("Failed to initialize database pool");
            
            Ok(rocket)
        }))
        .mount("/api", routes::get_routes())
        .mount("/", routes![index, spa_fallback])
        .attach(AdHoc::on_ignite("Static Files", |rocket| async {
            if Path::new("static").is_dir() {
                rocket.mount("/", rocket::fs::FileServer::from("static").rank(10))
            } else {
                println!("No 'static' directory found — skipping static file serving");
                rocket
            }
        }))
}
