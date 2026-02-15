use bigdecimal::BigDecimal;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// Database row types
#[derive(Debug, Clone, FromRow)]
pub struct GroupRow {
    pub id: Uuid,
    pub name: String,
    pub currency: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct MemberRow {
    pub id: Uuid,
    pub group_id: Uuid,
    pub name: String,
    pub paypal_email: Option<String>,
    pub iban: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ExpenseRow {
    pub id: Uuid,
    pub group_id: Uuid,
    pub description: String,
    pub amount: BigDecimal,
    pub paid_by: Uuid,
    pub expense_type: String,
    pub transfer_to: Option<Uuid>,
    pub currency: String,
    pub exchange_rate: BigDecimal,
    pub expense_date: NaiveDate,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ExpenseSplitMemberRow {
    pub member_id: Uuid,
}

#[derive(Debug, Clone, FromRow)]
pub struct ExpenseSplitRow {
    pub id: Uuid,
    pub expense_id: Uuid,
    pub member_id: Uuid,
}

// API response types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub id: Uuid,
    pub name: String,
    pub paypal_email: Option<String>,
    pub iban: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: Uuid,
    pub name: String,
    pub currency: String,
    pub members: Vec<Member>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Expense {
    pub id: Uuid,
    pub group_id: Uuid,
    pub description: String,
    pub amount: f64,
    pub paid_by: Uuid,
    pub split_between: Vec<Uuid>,
    pub expense_type: String,
    pub transfer_to: Option<Uuid>,
    pub currency: String,
    pub exchange_rate: f64,
    pub expense_date: NaiveDate,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Balance {
    pub user_id: Uuid,
    pub user_name: String,
    pub balance: f64, // positive = owed money, negative = owes money
}

// Request DTOs
#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    pub member_names: Vec<String>,
    pub currency: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMemberPaymentRequest {
    pub paypal_email: Option<String>,
    pub iban: Option<String>,
}

fn default_expense_type() -> String {
    "expense".to_string()
}

#[derive(Debug, Deserialize)]
pub struct CreateExpenseRequest {
    pub description: String,
    pub amount: f64,
    pub paid_by: Uuid,
    pub split_between: Vec<Uuid>,
    #[serde(default = "default_expense_type")]
    pub expense_type: String,
    pub transfer_to: Option<Uuid>,
    pub currency: Option<String>,
    pub exchange_rate: Option<f64>,
    pub expense_date: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateExpenseRequest {
    pub description: String,
    pub amount: f64,
    pub paid_by: Uuid,
    pub split_between: Vec<Uuid>,
    #[serde(default = "default_expense_type")]
    pub expense_type: String,
    pub transfer_to: Option<Uuid>,
    pub currency: Option<String>,
    pub exchange_rate: Option<f64>,
    pub expense_date: Option<NaiveDate>,
}

// Response DTOs
#[derive(Debug, Serialize)]
pub struct GroupCreatedResponse {
    pub group: Group,
    pub token: String,
}

/// Request to generate a share link with specific permissions.
#[derive(Debug, Deserialize)]
pub struct GenerateShareLinkRequest {
    pub can_delete_group: Option<bool>,
    pub can_manage_members: Option<bool>,
    pub can_update_payment: Option<bool>,
    pub can_add_expenses: Option<bool>,
    pub can_edit_expenses: Option<bool>,
}

/// Response containing the generated share token and its effective permissions.
#[derive(Debug, Serialize)]
pub struct ShareLinkResponse {
    pub token: String,
    pub permissions: PermissionsResponse,
}

/// Request to merge an existing token with the current one.
#[derive(Debug, Deserialize)]
pub struct MergeTokenRequest {
    pub other_token: String,
}

/// Permissions in API responses (always resolved to concrete booleans).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PermissionsResponse {
    pub can_delete_group: bool,
    pub can_manage_members: bool,
    pub can_update_payment: bool,
    pub can_add_expenses: bool,
    pub can_edit_expenses: bool,
}

// Conversion helpers
impl From<MemberRow> for Member {
    fn from(row: MemberRow) -> Self {
        Member {
            id: row.id,
            name: row.name,
            paypal_email: row.paypal_email,
            iban: row.iban,
        }
    }
}
