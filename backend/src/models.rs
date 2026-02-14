use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub id: Uuid,
    pub name: String,
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
pub struct CreateExpenseRequest {
    pub description: String,
    pub amount: f64,
    pub paid_by: Uuid,
    pub split_between: Vec<Uuid>,
}

// Response DTOs
#[derive(Debug, Serialize)]
pub struct GroupCreatedResponse {
    pub group: Group,
    pub token: String,
}
