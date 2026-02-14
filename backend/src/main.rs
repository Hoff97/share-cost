#[macro_use]
extern crate rocket;

mod auth;
mod models;
mod routes;

use rocket::http::Method;
use rocket_cors::{AllowedHeaders, AllowedOrigins, CorsOptions};

#[launch]
fn rocket() -> _ {
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
        .manage(routes::get_state())
        .mount("/api", routes::get_routes())
}
