use bigdecimal::BigDecimal;
use bigdecimal::ToPrimitive;
use chrono::Utc;
use rand::Rng;
use rocket::Route;
use rocket::http::Status;
use rocket::serde::json::Json;
use serde::{Deserialize, Serialize};
use sqlx;
use uuid::Uuid;
use rocket_governor::{Method, Quota, RocketGovernable, RocketGovernor};

use crate::auth::{GroupAuth, Permissions, generate_token, validate_token};
use crate::db;
use crate::models::*;

/// Rate limit for share code redemption: 10 requests per second per IP.
pub struct RedeemRateLimit;

impl<'r> RocketGovernable<'r> for RedeemRateLimit {
    fn quota(_method: Method, _route_name: &str) -> Quota {
        Quota::per_second(Self::nonzero(10u32))
    }
}

/// Rate limit for receipt scanning: 10 requests per second per IP.
pub struct ScanRateLimit;

impl<'r> RocketGovernable<'r> for ScanRateLimit {
    fn quota(_method: Method, _route_name: &str) -> Quota {
        Quota::per_second(Self::nonzero(10u32))
    }
}

// Health check
#[get("/health")]
fn health() -> &'static str {
    "OK"
}

// Create group - no auth required
#[post("/groups", data = "<request>")]
async fn create_group(
    request: Json<CreateGroupRequest>,
) -> Result<Json<GroupCreatedResponse>, Status> {
    let pool = db::get_pool();
    let group_id = Uuid::new_v4();
    let created_at = Utc::now();
    let currency = request.currency.as_deref().unwrap_or("EUR");

    // Insert group
    sqlx::query("INSERT INTO groups (id, name, currency, created_at, last_activity_at) VALUES ($1, $2, $3, $4, $4)")
        .bind(group_id)
        .bind(&request.name)
        .bind(currency)
        .bind(created_at)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to create group: {}", e);
            Status::InternalServerError
        })?;

    // Insert members
    let mut members = Vec::new();
    for name in &request.member_names {
        let member_id = Uuid::new_v4();
        sqlx::query("INSERT INTO members (id, group_id, name, created_at) VALUES ($1, $2, $3, $4)")
            .bind(member_id)
            .bind(group_id)
            .bind(name)
            .bind(created_at)
            .execute(pool)
            .await
            .map_err(|e| {
                eprintln!("Failed to create member: {}", e);
                Status::InternalServerError
            })?;

        members.push(Member {
            id: member_id,
            name: name.clone(),
            paypal_email: None,
            iban: None,
        });
    }

    let group = Group {
        id: group_id,
        name: request.name.clone(),
        currency: currency.to_string(),
        members,
        created_at,
        last_activity_at: created_at,
    };

    // Generate JWT for this group (creator gets all permissions)
    let token = generate_token(group_id, Some(Permissions::all()))
        .map_err(|_| Status::InternalServerError)?;

    Ok(Json(GroupCreatedResponse { group, token }))
}

// Get group - requires valid JWT
#[get("/groups/current")]
async fn get_current_group(auth: GroupAuth) -> Result<Json<Group>, Status> {
    let pool = db::get_pool();

    // Get group
    let group_row: GroupRow =
        sqlx::query_as("SELECT id, name, currency, created_at, last_activity_at FROM groups WHERE id = $1")
            .bind(auth.group_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| {
                eprintln!("Failed to fetch group: {}", e);
                Status::InternalServerError
            })?
            .ok_or(Status::NotFound)?;

    // Get members
    let member_rows: Vec<MemberRow> = sqlx::query_as(
        "SELECT id, group_id, name, paypal_email, iban, created_at FROM members WHERE group_id = $1 ORDER BY created_at"
    )
    .bind(auth.group_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch members: {}", e);
        Status::InternalServerError
    })?;

    let group = Group {
        id: group_row.id,
        name: group_row.name,
        currency: group_row.currency.clone(),
        members: member_rows
            .into_iter()
            .map(|r| Member {
                id: r.id,
                name: r.name,
                paypal_email: r.paypal_email,
                iban: r.iban,
            })
            .collect(),
        created_at: group_row.created_at,
        last_activity_at: group_row.last_activity_at,
    };

    Ok(Json(group))
}

// Add member - requires valid JWT + manage_members permission
#[post("/groups/current/members", data = "<request>")]
async fn add_member(
    auth: GroupAuth,
    request: Json<AddMemberRequest>,
) -> Result<Json<Group>, Status> {
    if !auth.permissions.has_manage_members() {
        return Err(Status::Forbidden);
    }
    let pool = db::get_pool();

    // Check group exists
    let group_row: GroupRow =
        sqlx::query_as("SELECT id, name, currency, created_at, last_activity_at FROM groups WHERE id = $1")
            .bind(auth.group_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| {
                eprintln!("Failed to fetch group: {}", e);
                Status::InternalServerError
            })?
            .ok_or(Status::NotFound)?;

    // Insert new member
    let member_id = Uuid::new_v4();
    sqlx::query("INSERT INTO members (id, group_id, name, created_at) VALUES ($1, $2, $3, $4)")
        .bind(member_id)
        .bind(auth.group_id)
        .bind(&request.name)
        .bind(Utc::now())
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to create member: {}", e);
            Status::InternalServerError
        })?;

    // Update last_activity_at
    sqlx::query("UPDATE groups SET last_activity_at = NOW() WHERE id = $1")
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to update last_activity_at: {}", e);
            Status::InternalServerError
        })?;

    // Get all members
    let member_rows: Vec<MemberRow> = sqlx::query_as(
        "SELECT id, group_id, name, paypal_email, iban, created_at FROM members WHERE group_id = $1 ORDER BY created_at"
    )
    .bind(auth.group_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch members: {}", e);
        Status::InternalServerError
    })?;

    let group = Group {
        id: group_row.id,
        name: group_row.name,
        currency: group_row.currency.clone(),
        members: member_rows
            .into_iter()
            .map(|r| Member {
                id: r.id,
                name: r.name,
                paypal_email: r.paypal_email,
                iban: r.iban,
            })
            .collect(),
        created_at: group_row.created_at,
        last_activity_at: group_row.last_activity_at,
    };

    Ok(Json(group))
}

// Update member payment info - requires valid JWT + update_payment permission
#[put("/groups/current/members/<member_id>/payment", data = "<request>")]
async fn update_member_payment(
    auth: GroupAuth,
    member_id: &str,
    request: Json<UpdateMemberPaymentRequest>,
) -> Result<Json<Member>, Status> {
    if !auth.permissions.has_update_payment() {
        return Err(Status::Forbidden);
    }
    let pool = db::get_pool();
    let member_uuid = Uuid::parse_str(member_id).map_err(|_| Status::BadRequest)?;

    // Verify member belongs to this group
    let member_row: MemberRow = sqlx::query_as(
        "SELECT id, group_id, name, paypal_email, iban, created_at FROM members WHERE id = $1 AND group_id = $2"
    )
    .bind(member_uuid)
    .bind(auth.group_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch member: {}", e);
        Status::InternalServerError
    })?
    .ok_or(Status::NotFound)?;

    // Update payment info
    sqlx::query("UPDATE members SET paypal_email = $1, iban = $2 WHERE id = $3")
        .bind(&request.paypal_email)
        .bind(&request.iban)
        .bind(member_uuid)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to update member payment info: {}", e);
            Status::InternalServerError
        })?;

    Ok(Json(Member {
        id: member_row.id,
        name: member_row.name,
        paypal_email: request.paypal_email.clone(),
        iban: request.iban.clone(),
    }))
}

// Get expenses - requires valid JWT
#[get("/groups/current/expenses")]
async fn get_expenses(auth: GroupAuth) -> Result<Json<Vec<Expense>>, Status> {
    let pool = db::get_pool();

    // Get all expenses for this group
    let expense_rows: Vec<ExpenseRow> = sqlx::query_as(
        "SELECT id, group_id, description, amount, paid_by, expense_type, transfer_to, currency, exchange_rate, expense_date, created_at, split_type 
         FROM expenses WHERE group_id = $1 ORDER BY expense_date DESC, created_at DESC"
    )
    .bind(auth.group_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch expenses: {}", e);
        Status::InternalServerError
    })?;

    let mut expenses = Vec::new();
    for row in expense_rows {
        // Get split members for each expense
        let splits: Vec<ExpenseSplitMemberRow> =
            sqlx::query_as("SELECT member_id, share FROM expense_splits WHERE expense_id = $1")
                .bind(row.id)
                .fetch_all(pool)
                .await
                .map_err(|e| {
                    eprintln!("Failed to fetch expense splits: {}", e);
                    Status::InternalServerError
                })?;

        let split_type = row.split_type.clone();
        let split_entries: Option<Vec<SplitEntry>> = if split_type != "equal" {
            Some(
                splits
                    .iter()
                    .map(|s| SplitEntry {
                        member_id: s.member_id,
                        share: s.share.as_ref().and_then(|v| v.to_f64()),
                    })
                    .collect(),
            )
        } else {
            None
        };

        expenses.push(Expense {
            id: row.id,
            group_id: row.group_id,
            description: row.description,
            amount: row.amount.to_f64().unwrap_or(0.0),
            paid_by: row.paid_by,
            split_between: splits.into_iter().map(|s| s.member_id).collect(),
            expense_type: row.expense_type,
            transfer_to: row.transfer_to,
            currency: row.currency,
            exchange_rate: row.exchange_rate.to_f64().unwrap_or(1.0),
            expense_date: row.expense_date,
            created_at: row.created_at,
            split_type,
            splits: split_entries,
        });
    }

    Ok(Json(expenses))
}

// Create expense - requires valid JWT + add_expenses permission
#[post("/groups/current/expenses", data = "<request>")]
async fn create_expense(
    auth: GroupAuth,
    request: Json<CreateExpenseRequest>,
) -> Result<Json<Expense>, Status> {
    if !auth.permissions.has_add_expenses() {
        return Err(Status::Forbidden);
    }
    let pool = db::get_pool();
    let expense_id = Uuid::new_v4();
    let created_at = Utc::now();
    let expense_date = request
        .expense_date
        .unwrap_or_else(|| Utc::now().date_naive());

    // Get group for default currency
    let group_row: GroupRow =
        sqlx::query_as("SELECT id, name, currency, created_at, last_activity_at FROM groups WHERE id = $1")
            .bind(auth.group_id)
            .fetch_one(pool)
            .await
            .map_err(|e| {
                eprintln!("Failed to fetch group: {}", e);
                Status::InternalServerError
            })?;
    let currency = request.currency.clone().unwrap_or(group_row.currency);
    let exchange_rate_val = BigDecimal::try_from(request.exchange_rate.unwrap_or(1.0))
        .map_err(|_| Status::BadRequest)?;

    // Convert f64 to BigDecimal
    let amount = BigDecimal::try_from(request.amount).map_err(|_| Status::BadRequest)?;

    // Insert expense
    sqlx::query(
        "INSERT INTO expenses (id, group_id, description, amount, paid_by, expense_type, transfer_to, currency, exchange_rate, expense_date, created_at, split_type) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)"
    )
    .bind(expense_id)
    .bind(auth.group_id)
    .bind(&request.description)
    .bind(&amount)
    .bind(request.paid_by)
    .bind(&request.expense_type)
    .bind(request.transfer_to)
    .bind(&currency)
    .bind(&exchange_rate_val)
    .bind(expense_date)
    .bind(created_at)
    .bind(&request.split_type)
    .execute(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to create expense: {}", e);
        Status::InternalServerError
    })?;

    // Insert expense splits (not needed for transfers)
    if request.expense_type != "transfer" {
        for member_id in &request.split_between {
            let share_val: Option<BigDecimal> = request.splits.as_ref().and_then(|splits| {
                splits
                    .iter()
                    .find(|s| &s.member_id == member_id)
                    .and_then(|s| s.share.and_then(|v| BigDecimal::try_from(v).ok()))
            });
            sqlx::query(
                "INSERT INTO expense_splits (expense_id, member_id, share) VALUES ($1, $2, $3)",
            )
            .bind(expense_id)
            .bind(member_id)
            .bind(&share_val)
            .execute(pool)
            .await
            .map_err(|e| {
                eprintln!("Failed to create expense split: {}", e);
                Status::InternalServerError
            })?;
        }
    }

    let split_entries: Option<Vec<SplitEntry>> = if request.split_type != "equal" {
        request.splits.clone()
    } else {
        None
    };

    // Update last_activity_at
    sqlx::query("UPDATE groups SET last_activity_at = NOW() WHERE id = $1")
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to update last_activity_at: {}", e);
            Status::InternalServerError
        })?;

    let expense = Expense {
        id: expense_id,
        group_id: auth.group_id,
        description: request.description.clone(),
        amount: request.amount,
        paid_by: request.paid_by,
        split_between: request.split_between.clone(),
        expense_type: request.expense_type.clone(),
        transfer_to: request.transfer_to,
        currency,
        exchange_rate: request.exchange_rate.unwrap_or(1.0),
        expense_date,
        created_at,
        split_type: request.split_type.clone(),
        splits: split_entries,
    };

    Ok(Json(expense))
}

// Update expense - requires valid JWT + edit_expenses permission
#[put("/groups/current/expenses/<expense_id>", data = "<request>")]
async fn update_expense(
    auth: GroupAuth,
    expense_id: &str,
    request: Json<UpdateExpenseRequest>,
) -> Result<Json<Expense>, Status> {
    if !auth.permissions.has_edit_expenses() {
        return Err(Status::Forbidden);
    }
    let pool = db::get_pool();
    let expense_uuid = Uuid::parse_str(expense_id).map_err(|_| Status::BadRequest)?;

    // Verify expense belongs to this group
    let _existing: ExpenseRow = sqlx::query_as(
        "SELECT id, group_id, description, amount, paid_by, expense_type, transfer_to, currency, exchange_rate, expense_date, created_at, split_type 
         FROM expenses WHERE id = $1 AND group_id = $2"
    )
    .bind(expense_uuid)
    .bind(auth.group_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch expense: {}", e);
        Status::InternalServerError
    })?
    .ok_or(Status::NotFound)?;

    let amount = BigDecimal::try_from(request.amount).map_err(|_| Status::BadRequest)?;
    let expense_date = request.expense_date.unwrap_or(_existing.expense_date);
    let currency = request.currency.clone().unwrap_or(_existing.currency);
    let exchange_rate_val = BigDecimal::try_from(
        request
            .exchange_rate
            .unwrap_or(_existing.exchange_rate.to_f64().unwrap_or(1.0)),
    )
    .map_err(|_| Status::BadRequest)?;

    // Update expense
    sqlx::query(
        "UPDATE expenses SET description = $1, amount = $2, paid_by = $3, expense_type = $4, transfer_to = $5, currency = $6, exchange_rate = $7, expense_date = $8, split_type = $9
         WHERE id = $10"
    )
    .bind(&request.description)
    .bind(&amount)
    .bind(request.paid_by)
    .bind(&request.expense_type)
    .bind(request.transfer_to)
    .bind(&currency)
    .bind(&exchange_rate_val)
    .bind(expense_date)
    .bind(&request.split_type)
    .bind(expense_uuid)
    .execute(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to update expense: {}", e);
        Status::InternalServerError
    })?;

    // Delete old splits and re-insert
    sqlx::query("DELETE FROM expense_splits WHERE expense_id = $1")
        .bind(expense_uuid)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to delete expense splits: {}", e);
            Status::InternalServerError
        })?;

    if request.expense_type != "transfer" {
        for member_id in &request.split_between {
            let share_val: Option<BigDecimal> = request.splits.as_ref().and_then(|splits| {
                splits
                    .iter()
                    .find(|s| &s.member_id == member_id)
                    .and_then(|s| s.share.and_then(|v| BigDecimal::try_from(v).ok()))
            });
            sqlx::query(
                "INSERT INTO expense_splits (expense_id, member_id, share) VALUES ($1, $2, $3)",
            )
            .bind(expense_uuid)
            .bind(member_id)
            .bind(&share_val)
            .execute(pool)
            .await
            .map_err(|e| {
                eprintln!("Failed to create expense split: {}", e);
                Status::InternalServerError
            })?;
        }
    }

    let split_entries: Option<Vec<SplitEntry>> = if request.split_type != "equal" {
        request.splits.clone()
    } else {
        None
    };

    // Update last_activity_at
    sqlx::query("UPDATE groups SET last_activity_at = NOW() WHERE id = $1")
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to update last_activity_at: {}", e);
            Status::InternalServerError
        })?;

    let expense = Expense {
        id: expense_uuid,
        group_id: auth.group_id,
        description: request.description.clone(),
        amount: request.amount,
        paid_by: request.paid_by,
        split_between: request.split_between.clone(),
        expense_type: request.expense_type.clone(),
        transfer_to: request.transfer_to,
        currency,
        exchange_rate: request.exchange_rate.unwrap_or(1.0),
        expense_date,
        created_at: _existing.created_at,
        split_type: request.split_type.clone(),
        splits: split_entries,
    };

    Ok(Json(expense))
}

// Delete expense - requires valid JWT + edit_expenses permission
#[delete("/groups/current/expenses/<expense_id>")]
async fn delete_expense(auth: GroupAuth, expense_id: &str) -> Result<Status, Status> {
    if !auth.permissions.has_edit_expenses() {
        return Err(Status::Forbidden);
    }
    let pool = db::get_pool();
    let expense_uuid = Uuid::parse_str(expense_id).map_err(|_| Status::BadRequest)?;

    // Verify expense belongs to this group
    let _existing: ExpenseRow = sqlx::query_as(
        "SELECT id, group_id, description, amount, paid_by, expense_type, transfer_to, currency, exchange_rate, expense_date, created_at, split_type 
         FROM expenses WHERE id = $1 AND group_id = $2"
    )
    .bind(expense_uuid)
    .bind(auth.group_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch expense: {}", e);
        Status::InternalServerError
    })?
    .ok_or(Status::NotFound)?;

    // Delete splits first
    sqlx::query("DELETE FROM expense_splits WHERE expense_id = $1")
        .bind(expense_uuid)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to delete expense splits: {}", e);
            Status::InternalServerError
        })?;

    // Delete expense
    sqlx::query("DELETE FROM expenses WHERE id = $1")
        .bind(expense_uuid)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to delete expense: {}", e);
            Status::InternalServerError
        })?;

    // Update last_activity_at
    sqlx::query("UPDATE groups SET last_activity_at = NOW() WHERE id = $1")
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to update last_activity_at: {}", e);
            Status::InternalServerError
        })?;

    Ok(Status::NoContent)
}

// Get balances - requires valid JWT
#[get("/groups/current/balances")]
async fn get_balances(auth: GroupAuth) -> Result<Json<Vec<Balance>>, Status> {
    let pool = db::get_pool();

    // Get all members
    let member_rows: Vec<MemberRow> = sqlx::query_as(
        "SELECT id, group_id, name, paypal_email, iban, created_at FROM members WHERE group_id = $1"
    )
    .bind(auth.group_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch members: {}", e);
        Status::InternalServerError
    })?;

    // Get all expenses with splits
    let expense_rows: Vec<ExpenseRow> = sqlx::query_as(
        "SELECT id, group_id, description, amount, paid_by, expense_type, transfer_to, currency, exchange_rate, expense_date, created_at, split_type 
         FROM expenses WHERE group_id = $1"
    )
    .bind(auth.group_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch expenses: {}", e);
        Status::InternalServerError
    })?;

    // Initialize balances
    let mut balances: Vec<Balance> = member_rows
        .iter()
        .map(|m| Balance {
            user_id: m.id,
            user_name: m.name.clone(),
            balance: 0.0,
        })
        .collect();

    // Calculate balances for each expense
    for expense_row in expense_rows {
        let raw_amount = expense_row.amount.to_f64().unwrap_or(0.0);
        let exchange_rate = expense_row.exchange_rate.to_f64().unwrap_or(1.0);
        let amount = raw_amount * exchange_rate; // Convert to group currency
        let paid_by = expense_row.paid_by;

        match expense_row.expense_type.as_str() {
            "transfer" => {
                // Direct transfer: sender is owed money back, receiver owes
                if let Some(sender) = balances.iter_mut().find(|b| b.user_id == paid_by) {
                    sender.balance += amount;
                }
                if let Some(to_id) = expense_row.transfer_to {
                    if let Some(receiver) = balances.iter_mut().find(|b| b.user_id == to_id) {
                        receiver.balance -= amount;
                    }
                }
            }
            "income" => {
                // External income: receiver holds money, split members are owed their share
                let splits: Vec<ExpenseSplitMemberRow> = sqlx::query_as(
                    "SELECT member_id, share FROM expense_splits WHERE expense_id = $1",
                )
                .bind(expense_row.id)
                .fetch_all(pool)
                .await
                .map_err(|e| {
                    eprintln!("Failed to fetch expense splits: {}", e);
                    Status::InternalServerError
                })?;

                let split_count = splits.len() as f64;
                if split_count == 0.0 {
                    continue;
                }

                // The receiver holds the money (owes distribution)
                if let Some(receiver) = balances.iter_mut().find(|b| b.user_id == paid_by) {
                    receiver.balance -= amount;
                }

                // Each split member is owed their share
                for split in &splits {
                    let member_amount = match expense_row.split_type.as_str() {
                        "percentage" => {
                            let pct = split
                                .share
                                .as_ref()
                                .and_then(|v| v.to_f64())
                                .unwrap_or(100.0 / split_count);
                            amount * pct / 100.0
                        }
                        "exact" => {
                            let exact = split
                                .share
                                .as_ref()
                                .and_then(|v| v.to_f64())
                                .unwrap_or(raw_amount / split_count);
                            exact * exchange_rate
                        }
                        "shares" => {
                            let total_shares: f64 = splits.iter()
                                .map(|s| s.share.as_ref().and_then(|v| v.to_f64()).unwrap_or(0.0))
                                .sum();
                            let my_shares = split.share.as_ref().and_then(|v| v.to_f64()).unwrap_or(0.0);
                            if total_shares > 0.0 { amount * my_shares / total_shares } else { 0.0 }
                        }
                        _ => amount / split_count, // equal
                    };
                    if let Some(member) = balances.iter_mut().find(|b| b.user_id == split.member_id)
                    {
                        member.balance += member_amount;
                    }
                }
            }
            _ => {
                // Regular expense: payer gets credit, split members owe
                let splits: Vec<ExpenseSplitMemberRow> = sqlx::query_as(
                    "SELECT member_id, share FROM expense_splits WHERE expense_id = $1",
                )
                .bind(expense_row.id)
                .fetch_all(pool)
                .await
                .map_err(|e| {
                    eprintln!("Failed to fetch expense splits: {}", e);
                    Status::InternalServerError
                })?;

                let split_count = splits.len() as f64;
                if split_count == 0.0 {
                    continue;
                }

                // The payer gets credit
                if let Some(payer) = balances.iter_mut().find(|b| b.user_id == paid_by) {
                    payer.balance += amount;
                }

                // Each person in the split owes
                for split in &splits {
                    let member_amount = match expense_row.split_type.as_str() {
                        "percentage" => {
                            let pct = split
                                .share
                                .as_ref()
                                .and_then(|v| v.to_f64())
                                .unwrap_or(100.0 / split_count);
                            amount * pct / 100.0
                        }
                        "exact" => {
                            let exact = split
                                .share
                                .as_ref()
                                .and_then(|v| v.to_f64())
                                .unwrap_or(raw_amount / split_count);
                            exact * exchange_rate
                        }
                        "shares" => {
                            let total_shares: f64 = splits.iter()
                                .map(|s| s.share.as_ref().and_then(|v| v.to_f64()).unwrap_or(0.0))
                                .sum();
                            let my_shares = split.share.as_ref().and_then(|v| v.to_f64()).unwrap_or(0.0);
                            if total_shares > 0.0 { amount * my_shares / total_shares } else { 0.0 }
                        }
                        _ => amount / split_count, // equal
                    };
                    if let Some(member) = balances.iter_mut().find(|b| b.user_id == split.member_id)
                    {
                        member.balance -= member_amount;
                    }
                }
            }
        }
    }

    Ok(Json(balances))
}

// Get current token's permissions
#[get("/groups/current/permissions")]
fn get_permissions(auth: GroupAuth) -> Json<PermissionsResponse> {
    let p = &auth.permissions;
    Json(PermissionsResponse {
        can_delete_group: p.has_delete_group(),
        can_manage_members: p.has_manage_members(),
        can_update_payment: p.has_update_payment(),
        can_add_expenses: p.has_add_expenses(),
        can_edit_expenses: p.has_edit_expenses(),
    })
}

/// Generate a random alphanumeric code of the given length.
/// Uses `rand::rng()` which returns `ThreadRng` — a CSPRNG (ChaCha12 seeded
/// from the OS). Safe for generating unguessable share codes.
fn random_code(len: usize) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::rng();
    (0..len)
        .map(|_| {
            let idx = rng.random_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

// Generate share link with selected permissions (capped by caller's own)
// Now stores a short code in the DB instead of returning a raw JWT
#[post("/groups/current/share", data = "<request>")]
async fn generate_share_link(
    auth: GroupAuth,
    request: Json<GenerateShareLinkRequest>,
) -> Result<Json<ShareCodeResponse>, Status> {
    let requested = Permissions {
        can_delete_group: request.can_delete_group,
        can_manage_members: request.can_manage_members,
        can_update_payment: request.can_update_payment,
        can_add_expenses: request.can_add_expenses,
        can_edit_expenses: request.can_edit_expenses,
    };
    let effective = requested.cap_by(&auth.permissions);
    let pool = db::get_pool();

    let dg = effective.has_delete_group();
    let mm = effective.has_manage_members();
    let up = effective.has_update_payment();
    let ae = effective.has_add_expenses();
    let ee = effective.has_edit_expenses();

    // Return an existing share link if one already exists with the same group + permissions
    // Exclude old 16-char codes so a new 20-char code is generated instead
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT code FROM share_links WHERE group_id = $1 AND can_delete_group = $2 AND can_manage_members = $3 AND can_update_payment = $4 AND can_add_expenses = $5 AND can_edit_expenses = $6 AND LENGTH(code) >= 20 LIMIT 1"
    )
    .bind(auth.group_id)
    .bind(dg)
    .bind(mm)
    .bind(up)
    .bind(ae)
    .bind(ee)
    .fetch_optional(pool)
    .await
    .map_err(|e| { eprintln!("DB error checking existing share link: {}", e); Status::InternalServerError })?;

    if let Some(code) = existing {
        return Ok(Json(ShareCodeResponse {
            code,
            permissions: PermissionsResponse {
                can_delete_group: dg,
                can_manage_members: mm,
                can_update_payment: up,
                can_add_expenses: ae,
                can_edit_expenses: ee,
            },
        }));
    }

    // Generate a unique 20-char code (retry on collision)
    let code = loop {
        let candidate = random_code(20);
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM share_links WHERE code = $1)")
                .bind(&candidate)
                .fetch_one(pool)
                .await
                .map_err(|e| {
                    eprintln!("DB error checking share code: {}", e);
                    Status::InternalServerError
                })?;
        if !exists {
            break candidate;
        }
    };

    sqlx::query(
        "INSERT INTO share_links (code, group_id, can_delete_group, can_manage_members, can_update_payment, can_add_expenses, can_edit_expenses) VALUES ($1, $2, $3, $4, $5, $6, $7)"
    )
    .bind(&code)
    .bind(auth.group_id)
    .bind(dg)
    .bind(mm)
    .bind(up)
    .bind(ae)
    .bind(ee)
    .execute(pool)
    .await
    .map_err(|e| { eprintln!("Failed to insert share link: {}", e); Status::InternalServerError })?;

    Ok(Json(ShareCodeResponse {
        code,
        permissions: PermissionsResponse {
            can_delete_group: dg,
            can_manage_members: mm,
            can_update_payment: up,
            can_add_expenses: ae,
            can_edit_expenses: ee,
        },
    }))
}

// Redeem a short share code → returns a JWT token (no auth required)
#[post("/share/redeem", data = "<request>")]
async fn redeem_share_code(
    _rate_limit: RocketGovernor<'_, RedeemRateLimit>,
    request: Json<RedeemShareCodeRequest>,
) -> Result<Json<ShareLinkResponse>, Status> {
    let pool = db::get_pool();

    let row = sqlx::query_as::<_, (Uuid, bool, bool, bool, bool, bool)>(
        "SELECT group_id, can_delete_group, can_manage_members, can_update_payment, can_add_expenses, can_edit_expenses FROM share_links WHERE code = $1"
    )
    .bind(&request.code)
    .fetch_optional(pool)
    .await
    .map_err(|e| { eprintln!("DB error redeeming share code: {}", e); Status::InternalServerError })?;

    let (group_id, dg, mm, up, ae, ee) = row.ok_or(Status::NotFound)?;

    let link_perms = Permissions {
        can_delete_group: Some(dg),
        can_manage_members: Some(mm),
        can_update_payment: Some(up),
        can_add_expenses: Some(ae),
        can_edit_expenses: Some(ee),
    };

    // If user sent an existing token for the same group, merge permissions
    let final_perms = if let Some(ref existing) = request.existing_token {
        if let Ok(claims) = validate_token(existing) {
            if claims.group_id == group_id {
                claims.effective_permissions().union_with(&link_perms)
            } else {
                link_perms
            }
        } else {
            link_perms
        }
    } else {
        link_perms
    };

    let token = generate_token(group_id, Some(final_perms.clone()))
        .map_err(|_| Status::InternalServerError)?;

    Ok(Json(ShareLinkResponse {
        token,
        permissions: PermissionsResponse {
            can_delete_group: final_perms.has_delete_group(),
            can_manage_members: final_perms.has_manage_members(),
            can_update_payment: final_perms.has_update_payment(),
            can_add_expenses: final_perms.has_add_expenses(),
            can_edit_expenses: final_perms.has_edit_expenses(),
        },
    }))
}

// Merge two tokens for the same group → new token with the union of permissions
#[post("/groups/current/merge-token", data = "<request>")]
fn merge_token(
    auth: GroupAuth,
    request: Json<MergeTokenRequest>,
) -> Result<Json<ShareLinkResponse>, Status> {
    let other_claims = validate_token(&request.other_token).map_err(|_| Status::BadRequest)?;

    // Both tokens must be for the same group
    if other_claims.group_id != auth.group_id {
        return Err(Status::BadRequest);
    }

    let merged = auth
        .permissions
        .union_with(&other_claims.effective_permissions());
    let token = generate_token(auth.group_id, Some(merged.clone()))
        .map_err(|_| Status::InternalServerError)?;

    Ok(Json(ShareLinkResponse {
        token,
        permissions: PermissionsResponse {
            can_delete_group: merged.has_delete_group(),
            can_manage_members: merged.has_manage_members(),
            can_update_payment: merged.has_update_payment(),
            can_add_expenses: merged.has_add_expenses(),
            can_edit_expenses: merged.has_edit_expenses(),
        },
    }))
}

// List all share links for the current group (requires all permissions)
#[get("/groups/current/share-links")]
async fn list_share_links(auth: GroupAuth) -> Result<Json<Vec<ShareLinkItem>>, Status> {
    if !auth.permissions.has_all() {
        return Err(Status::Forbidden);
    }
    let pool = db::get_pool();
    let rows = sqlx::query_as::<_, (String, bool, bool, bool, bool, bool, chrono::DateTime<chrono::Utc>)>(
        "SELECT code, can_delete_group, can_manage_members, can_update_payment, can_add_expenses, can_edit_expenses, created_at FROM share_links WHERE group_id = $1 ORDER BY created_at DESC"
    )
    .bind(auth.group_id)
    .fetch_all(pool)
    .await
    .map_err(|e| { eprintln!("DB error listing share links: {}", e); Status::InternalServerError })?;

    let items: Vec<ShareLinkItem> = rows
        .into_iter()
        .map(|(code, dg, mm, up, ae, ee, created_at)| ShareLinkItem {
            code,
            can_delete_group: dg,
            can_manage_members: mm,
            can_update_payment: up,
            can_add_expenses: ae,
            can_edit_expenses: ee,
            created_at: created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(items))
}

// Delete a share link by code (requires all permissions)
#[delete("/groups/current/share-links/<code>")]
async fn delete_share_link(auth: GroupAuth, code: &str) -> Result<Status, Status> {
    if !auth.permissions.has_all() {
        return Err(Status::Forbidden);
    }
    let pool = db::get_pool();
    let result = sqlx::query("DELETE FROM share_links WHERE code = $1 AND group_id = $2")
        .bind(code)
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("DB error deleting share link: {}", e);
            Status::InternalServerError
        })?;

    if result.rows_affected() == 0 {
        return Err(Status::NotFound);
    }
    Ok(Status::NoContent)
}

// Rename group - requires valid JWT + delete_group permission
#[put("/groups/current/name", data = "<request>")]
async fn rename_group(
    auth: GroupAuth,
    request: Json<RenameGroupRequest>,
) -> Result<Json<Group>, Status> {
    if !auth.permissions.has_delete_group() {
        return Err(Status::Forbidden);
    }
    let pool = db::get_pool();

    sqlx::query("UPDATE groups SET name = $1 WHERE id = $2")
        .bind(&request.name)
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to rename group: {}", e);
            Status::InternalServerError
        })?;

    // Update last_activity_at
    sqlx::query("UPDATE groups SET last_activity_at = NOW() WHERE id = $1")
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to update last_activity_at: {}", e);
            Status::InternalServerError
        })?;

    // Return updated group
    let group_row: GroupRow =
        sqlx::query_as("SELECT id, name, currency, created_at, last_activity_at FROM groups WHERE id = $1")
            .bind(auth.group_id)
            .fetch_one(pool)
            .await
            .map_err(|e| {
                eprintln!("DB error: {}", e);
                Status::InternalServerError
            })?;

    let member_rows: Vec<MemberRow> = sqlx::query_as(
        "SELECT id, group_id, name, paypal_email, iban, created_at FROM members WHERE group_id = $1 ORDER BY created_at"
    )
    .bind(auth.group_id)
    .fetch_all(pool)
    .await
    .map_err(|e| { eprintln!("DB error: {}", e); Status::InternalServerError })?;

    let group = Group {
        id: group_row.id,
        name: group_row.name,
        currency: group_row.currency,
        members: member_rows.into_iter().map(Member::from).collect(),
        created_at: group_row.created_at,
        last_activity_at: group_row.last_activity_at,
    };

    Ok(Json(group))
}

// Delete group - requires valid JWT + delete_group permission
#[delete("/groups/current")]
async fn delete_group(auth: GroupAuth) -> Result<Status, Status> {
    if !auth.permissions.has_delete_group() {
        return Err(Status::Forbidden);
    }
    let pool = db::get_pool();

    // Delete expense splits, then expenses, then members, then group
    sqlx::query(
        "DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)"
    )
    .bind(auth.group_id)
    .execute(pool)
    .await
    .map_err(|e| { eprintln!("Failed to delete expense splits: {}", e); Status::InternalServerError })?;

    sqlx::query("DELETE FROM expenses WHERE group_id = $1")
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to delete expenses: {}", e);
            Status::InternalServerError
        })?;

    sqlx::query("DELETE FROM members WHERE group_id = $1")
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to delete members: {}", e);
            Status::InternalServerError
        })?;

    sqlx::query("DELETE FROM groups WHERE id = $1")
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to delete group: {}", e);
            Status::InternalServerError
        })?;

    Ok(Status::NoContent)
}

// Extend group lifetime - resets the inactivity timer
#[post("/groups/current/extend-lifetime")]
async fn extend_lifetime(auth: GroupAuth) -> Result<Status, Status> {
    let pool = db::get_pool();
    sqlx::query("UPDATE groups SET last_activity_at = NOW() WHERE id = $1")
        .bind(auth.group_id)
        .execute(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to extend lifetime: {}", e);
            Status::InternalServerError
        })?;
    Ok(Status::NoContent)
}

// ---------- Receipt scanning via Ollama ----------

fn ollama_url() -> String {
    std::env::var("OLLAMA_URL").unwrap_or_else(|_| "https://api.ollama.com".to_string())
}

/// Local Ollama URL for OCR. Falls back to OLLAMA_URL if not set.
fn ollama_local_url() -> String {
    std::env::var("OLLAMA_LOCAL_URL").unwrap_or_else(|_| ollama_url())
}

fn ollama_api_token() -> Option<String> {
    std::env::var("OLLAMA_API_TOKEN").ok().filter(|s| !s.is_empty())
}

#[derive(Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<OllamaChatMessage>,
    stream: bool,
}

#[derive(Serialize)]
struct OllamaChatMessage {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct OllamaChatResponse {
    message: OllamaResponseMessage,
}

#[derive(Deserialize)]
struct OllamaResponseMessage {
    content: String,
}

/// Ensure a model is available in a local Ollama instance, pulling it if necessary.
/// Skipped when using a cloud API (i.e. when a token is provided).
async fn ensure_model(client: &reqwest::Client, base: &str, model: &str) -> Result<(), Status> {
    let show_resp = client
        .post(format!("{}/api/show", base))
        .json(&serde_json::json!({ "name": model }))
        .send()
        .await
        .map_err(|_| Status::ServiceUnavailable)?;

    if show_resp.status().is_success() {
        return Ok(());
    }

    eprintln!("Pulling Ollama model: {}", model);
    let pull_resp = client
        .post(format!("{}/api/pull", base))
        .json(&serde_json::json!({ "name": model, "stream": false }))
        .send()
        .await
        .map_err(|_| Status::ServiceUnavailable)?;

    if !pull_resp.status().is_success() {
        eprintln!("Failed to pull model {}: {}", model, pull_resp.status());
        return Err(Status::ServiceUnavailable);
    }

    Ok(())
}

/// Call Ollama chat endpoint.
async fn ollama_chat(
    client: &reqwest::Client,
    base: &str,
    model: &str,
    messages: Vec<OllamaChatMessage>,
    token: &Option<String>,
) -> Result<String, Status> {
    let req = OllamaChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
    };

    let mut http_req = client
        .post(format!("{}/api/chat", base))
        .json(&req);
    if let Some(t) = token {
        http_req = http_req.bearer_auth(t);
    }
    let resp = http_req
        .send()
        .await
        .map_err(|e| {
            eprintln!("Ollama request failed: {}", e);
            Status::ServiceUnavailable
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        eprintln!("Ollama returned {}: {}", status, body);
        return Err(Status::ServiceUnavailable);
    }

    let chat_resp: OllamaChatResponse = resp.json().await.map_err(|e| {
        eprintln!("Failed to parse Ollama response: {}", e);
        Status::InternalServerError
    })?;

    Ok(chat_resp.message.content)
}

fn ocr_model() -> String {
    std::env::var("OCR_MODEL").unwrap_or_else(|_| "glm-ocr:q8_0".to_string())
}

fn extract_model() -> String {
    std::env::var("EXTRACT_MODEL").unwrap_or_else(|_| "gemma4:31b-cloud".to_string())
}

#[post("/receipt/scan", data = "<request>")]
async fn scan_receipt(
    _auth: GroupAuth,
    _rate_limit: RocketGovernor<'_, ScanRateLimit>,
    request: Json<ScanReceiptRequest>,
) -> Result<Json<ScanReceiptResponse>, Status> {
    let cloud_url = ollama_url();
    let local_url = ollama_local_url();
    let api_token = ollama_api_token();
    // Use token for OCR only when using the cloud URL (no explicit OLLAMA_LOCAL_URL set)
    let ocr_token = if std::env::var("OLLAMA_LOCAL_URL").is_ok() { None } else { api_token.clone() };
    let ocr = ocr_model();
    let extract = extract_model();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|_| Status::InternalServerError)?;

    // Pull OCR model on local Ollama if needed (skip for cloud)
    if ocr_token.is_none() {
        ensure_model(&client, &local_url, &ocr).await?;
    }

    // Step 1: OCR — extract text from the image using a local vision model
    let ocr_text = ollama_chat(
        &client,
        &local_url,
        &ocr,
        vec![OllamaChatMessage {
            role: "user".to_string(),
            content: "Extract ALL text from this receipt image. Include every line, every number, every price. Output ONLY the raw text, nothing else.".to_string(),
            images: Some(vec![request.image.clone()]),
        }],
        &ocr_token,
    )
    .await?;

    // Step 2: Extract structured data using the cloud language model
    let lang = &request.language;
    let extract_prompt = format!(
        r#"You are a receipt parser. Given the OCR text of a receipt below, extract structured data as JSON.

IMPORTANT:
- The "title" field must be a short descriptive name for the purchase in {lang} language (e.g. "Grocery shopping" or "Restaurant dinner"). Translate if needed.
- The "total" field must be the final total amount paid (look for "Total", "Summe", "Totale", etc.). Use the final/grand total, not subtotals.
- The "date" field must be in YYYY-MM-DD format if you can find a date, or null if not found.
- The "currency" field must be the ISO 4217 currency code (e.g. "EUR", "USD", "GBP", "CHF"). Detect it from currency symbols (€, $, £), text, or locale of the receipt. Use null if uncertain.
- The "items" array should contain each individual line item with "description" (in the original language of the receipt) and "amount" (as a number).
- If you cannot determine the total, sum up the item amounts.
- Output ONLY valid JSON, no markdown, no explanation.

Expected format:
{{"title": "...", "total": 12.34, "date": "2024-01-15", "currency": "EUR", "items": [{{"description": "...", "amount": 1.23}}]}}

OCR Text:
{ocr_text}"#,
        lang = lang,
        ocr_text = ocr_text
    );

    let extract_result = ollama_chat(
        &client,
        &cloud_url,
        &extract,
        vec![OllamaChatMessage {
            role: "user".to_string(),
            content: extract_prompt,
            images: None,
        }],
        &api_token,
    )
    .await?;

    // Parse the JSON response — try to extract JSON from the response
    let json_str = extract_json_block(&extract_result);
    let parsed: ScanReceiptResponse = serde_json::from_str(&json_str).map_err(|e| {
        eprintln!(
            "Failed to parse receipt extraction JSON: {}\nRaw response: {}",
            e, extract_result
        );
        Status::UnprocessableEntity
    })?;

    Ok(Json(parsed))
}

/// Try to extract a JSON object from a string that might contain markdown fences or extra text.
fn extract_json_block(s: &str) -> String {
    // Try to find ```json ... ``` block first
    if let Some(start) = s.find("```json") {
        let after = &s[start + 7..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    // Try to find ``` ... ``` block
    if let Some(start) = s.find("```") {
        let after = &s[start + 3..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    // Try to find first { ... last }
    if let Some(start) = s.find('{') {
        if let Some(end) = s.rfind('}') {
            return s[start..=end].to_string();
        }
    }
    s.trim().to_string()
}

pub fn get_routes() -> Vec<Route> {
    routes![
        health,
        create_group,
        get_current_group,
        get_permissions,
        add_member,
        update_member_payment,
        get_expenses,
        create_expense,
        update_expense,
        delete_expense,
        get_balances,
        generate_share_link,
        list_share_links,
        delete_share_link,
        redeem_share_code,
        merge_token,
        rename_group,
        delete_group,
        extend_lifetime,
        scan_receipt
    ]
}
