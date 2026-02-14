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
    pub expense_date: Option<NaiveDate>,
}

// Response DTOs
#[derive(Debug, Serialize)]
pub struct GroupCreatedResponse {
    pub group: Group,
    pub token: String,
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
