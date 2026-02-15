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

/// Granular permissions stored in the JWT.
/// All fields are `Option<bool>` for backward compatibility:
/// old tokens that lack these fields default to `true` (full access).
/// Short serde names keep the JWT compact; `alias` accepts old long names.
fn default_true() -> Option<bool> {
    Some(true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permissions {
    #[serde(default = "default_true", rename = "dg", alias = "can_delete_group", skip_serializing_if = "Option::is_none")]
    pub can_delete_group: Option<bool>,
    #[serde(default = "default_true", rename = "mm", alias = "can_manage_members", skip_serializing_if = "Option::is_none")]
    pub can_manage_members: Option<bool>,
    #[serde(default = "default_true", rename = "up", alias = "can_update_payment", skip_serializing_if = "Option::is_none")]
    pub can_update_payment: Option<bool>,
    #[serde(default = "default_true", rename = "ae", alias = "can_add_expenses", skip_serializing_if = "Option::is_none")]
    pub can_add_expenses: Option<bool>,
    #[serde(default = "default_true", rename = "ee", alias = "can_edit_expenses", skip_serializing_if = "Option::is_none")]
    pub can_edit_expenses: Option<bool>,
}

impl Permissions {
    /// All permissions granted (used for group creator tokens).
    pub fn all() -> Self {
        Permissions {
            can_delete_group: Some(true),
            can_manage_members: Some(true),
            can_update_payment: Some(true),
            can_add_expenses: Some(true),
            can_edit_expenses: Some(true),
        }
    }

    /// Resolve an `Option<bool>` field: `None` (old token) → `true`.
    fn resolve(opt: Option<bool>) -> bool {
        opt.unwrap_or(true)
    }

    pub fn has_delete_group(&self) -> bool { Self::resolve(self.can_delete_group) }
    pub fn has_manage_members(&self) -> bool { Self::resolve(self.can_manage_members) }
    pub fn has_update_payment(&self) -> bool { Self::resolve(self.can_update_payment) }
    pub fn has_add_expenses(&self) -> bool { Self::resolve(self.can_add_expenses) }
    pub fn has_edit_expenses(&self) -> bool { Self::resolve(self.can_edit_expenses) }

    /// Returns true if every permission is granted.
    pub fn has_all(&self) -> bool {
        self.has_delete_group() && self.has_manage_members() && self.has_update_payment()
            && self.has_add_expenses() && self.has_edit_expenses()
    }

    /// Cap each permission by the caller's own permissions (share link can't escalate).
    pub fn cap_by(&self, caller: &Permissions) -> Permissions {
        Permissions {
            can_delete_group:   Some(self.has_delete_group()   && caller.has_delete_group()),
            can_manage_members: Some(self.has_manage_members() && caller.has_manage_members()),
            can_update_payment: Some(self.has_update_payment() && caller.has_update_payment()),
            can_add_expenses:   Some(self.has_add_expenses()   && caller.has_add_expenses()),
            can_edit_expenses:  Some(self.has_edit_expenses()  && caller.has_edit_expenses()),
        }
    }

    /// Union of two permission sets (logical OR). Used when merging an existing
    /// token with a newly received share link so the user keeps the best of both.
    pub fn union_with(&self, other: &Permissions) -> Permissions {
        Permissions {
            can_delete_group:   Some(self.has_delete_group()   || other.has_delete_group()),
            can_manage_members: Some(self.has_manage_members() || other.has_manage_members()),
            can_update_payment: Some(self.has_update_payment() || other.has_update_payment()),
            can_add_expenses:   Some(self.has_add_expenses()   || other.has_add_expenses()),
            can_edit_expenses:  Some(self.has_edit_expenses()  || other.has_edit_expenses()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    #[serde(rename = "g", alias = "group_id")]
    pub group_id: Uuid,
    pub exp: usize,
    /// Granular permissions — absent in old tokens (defaults to all-true).
    #[serde(default, rename = "p", alias = "permissions")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Permissions>,
}

impl Claims {
    pub fn effective_permissions(&self) -> Permissions {
        self.permissions.clone().unwrap_or_else(Permissions::all)
    }
}

pub struct GroupAuth {
    pub group_id: Uuid,
    pub permissions: Permissions,
}

#[derive(Debug)]
pub enum AuthError {
    Missing,
    Invalid,
    Forbidden,
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
                        Ok(claims) => Outcome::Success(GroupAuth {
                            group_id: claims.group_id,
                            permissions: claims.effective_permissions(),
                        }),
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

pub fn generate_token(group_id: Uuid, permissions: Option<Permissions>) -> Result<String, jsonwebtoken::errors::Error> {
    let claims = Claims {
        group_id,
        // Token expires in 10 years (essentially permanent for share links)
        exp: (chrono::Utc::now() + chrono::Duration::days(3650)).timestamp() as usize,
        permissions,
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
