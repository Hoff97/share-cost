#[macro_use]
extern crate rocket;

mod auth;
mod db;
mod models;
mod routes;

use rocket::http::Method;
use rocket::fairing::AdHoc;
use rocket_cors::{AllowedHeaders, AllowedOrigins, CorsOptions};

#[launch]
fn rocket() -> _ {
    // Load .env file if it exists
    dotenvy::dotenv().ok();

    let cors = CorsOptions::default()
        .allowed_origins(AllowedOrigins::all())
        .allowed_methods(
            vec![Method::Get, Method::Post, Method::Put, Method::Delete]
                .into_iter()
                .map(From::from)
                .collect(),
        )
        .allowed_headers(AllowedHeaders::all())
        .allow_credentials(true)
        .to_cors()
        .expect("CORS configuration failed");

    rocket::build()
        .attach(cors)
        .attach(AdHoc::try_on_ignite("Initialize Database", |rocket| async {
            let database_url = std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set");
            
            db::init_pool(&database_url).await
                .expect("Failed to initialize database pool");
            
            db::run_migrations(db::get_pool()).await
                .expect("Failed to run migrations");
            
            Ok(rocket)
        }))
        .mount("/api", routes::get_routes())
}
