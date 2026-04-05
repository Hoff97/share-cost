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
    pub last_activity_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)]
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
    pub split_type: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct ExpenseSplitMemberRow {
    pub member_id: Uuid,
    pub share: Option<BigDecimal>,
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
    pub last_activity_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitEntry {
    pub member_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share: Option<f64>,
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
    #[serde(default = "default_split_type")]
    pub split_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub splits: Option<Vec<SplitEntry>>,
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

fn default_split_type() -> String {
    "equal".to_string()
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
    #[serde(default = "default_split_type")]
    pub split_type: String,
    pub splits: Option<Vec<SplitEntry>>,
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
    #[serde(default = "default_split_type")]
    pub split_type: String,
    pub splits: Option<Vec<SplitEntry>>,
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

/// Response containing the generated short share code and its effective permissions.
#[derive(Debug, Serialize)]
pub struct ShareCodeResponse {
    pub code: String,
    pub permissions: PermissionsResponse,
}

/// A share link entry for listing existing links.
#[derive(Debug, Serialize)]
pub struct ShareLinkItem {
    pub code: String,
    pub can_delete_group: bool,
    pub can_manage_members: bool,
    pub can_update_payment: bool,
    pub can_add_expenses: bool,
    pub can_edit_expenses: bool,
    pub created_at: String,
}

/// Request to redeem a share code for a JWT token.
#[derive(Debug, Deserialize)]
pub struct RedeemShareCodeRequest {
    pub code: String,
    /// If the user already has a token for this group, send it to merge permissions.
    pub existing_token: Option<String>,
}

/// Request to rename a group.
#[derive(Debug, Deserialize)]
pub struct RenameGroupRequest {
    pub name: String,
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

/// Request to scan a receipt image.
#[derive(Debug, Deserialize)]
pub struct ScanReceiptRequest {
    /// Base64-encoded image data (JPEG or PNG)
    pub image: String,
    /// Target language code for the extracted title (e.g. "en", "de", "fr")
    pub language: String,
}

/// A single line item extracted from a receipt.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReceiptItem {
    pub description: String,
    pub amount: f64,
}

/// Response from receipt scanning.
#[derive(Debug, Serialize, Deserialize)]
pub struct ScanReceiptResponse {
    /// Descriptive title for the whole receipt
    pub title: String,
    /// Total amount on the receipt
    pub total: f64,
    /// Date on the receipt (YYYY-MM-DD) if found
    pub date: Option<String>,
    /// ISO 4217 currency code detected from the receipt (e.g. "EUR", "USD")
    pub currency: Option<String>,
    /// Individual line items
    pub items: Vec<ReceiptItem>,
}
