use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use once_cell::sync::Lazy;
use rocket::http::Status;
use rocket::request::{FromRequest, Outcome, Request};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// In production, load this from environment variable
static JWT_SECRET: Lazy<String> = Lazy::new(|| {
    std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-secret-change-in-production".to_string())
});

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub group_id: Uuid,
    pub exp: usize, // Expiration time (optional, can be far future for share links)
}

pub struct GroupAuth {
    pub group_id: Uuid,
}

#[derive(Debug)]
pub enum AuthError {
    Missing,
    Invalid,
}

#[rocket::async_trait]
impl<'r> FromRequest<'r> for GroupAuth {
    type Error = AuthError;

    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, Self::Error> {
        // Check Authorization header: Bearer <token>
        let auth_header = request.headers().get_one("Authorization");
        
        match auth_header {
            Some(header) => {
                if let Some(token) = header.strip_prefix("Bearer ") {
                    match validate_token(token) {
                        Ok(claims) => Outcome::Success(GroupAuth { group_id: claims.group_id }),
                        Err(_) => Outcome::Error((Status::Unauthorized, AuthError::Invalid)),
                    }
                } else {
                    Outcome::Error((Status::Unauthorized, AuthError::Invalid))
                }
            }
            None => Outcome::Error((Status::Unauthorized, AuthError::Missing)),
        }
    }
}

pub fn generate_token(group_id: Uuid) -> Result<String, jsonwebtoken::errors::Error> {
    let claims = Claims {
        group_id,
        // Token expires in 10 years (essentially permanent for share links)
        exp: (chrono::Utc::now() + chrono::Duration::days(3650)).timestamp() as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(JWT_SECRET.as_bytes()),
    )
}

pub fn validate_token(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(JWT_SECRET.as_bytes()),
        &Validation::default(),
    )?;

    Ok(token_data.claims)
}
