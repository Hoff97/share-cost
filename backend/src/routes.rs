use bigdecimal::BigDecimal;
use bigdecimal::ToPrimitive;
use rocket::http::Status;
use rocket::serde::json::Json;
use rocket::Route;
use sqlx;
use uuid::Uuid;
use chrono::Utc;

use crate::auth::{generate_token, GroupAuth};
use crate::db;
use crate::models::*;

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

    // Insert group
    sqlx::query(
        "INSERT INTO groups (id, name, created_at) VALUES ($1, $2, $3)"
    )
    .bind(group_id)
    .bind(&request.name)
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
        sqlx::query(
            "INSERT INTO members (id, group_id, name, created_at) VALUES ($1, $2, $3, $4)"
        )
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
        members,
        created_at,
    };

    // Generate JWT for this group
    let token = generate_token(group_id)
        .map_err(|_| Status::InternalServerError)?;

    Ok(Json(GroupCreatedResponse { group, token }))
}

// Get group - requires valid JWT
#[get("/groups/current")]
async fn get_current_group(
    auth: GroupAuth,
) -> Result<Json<Group>, Status> {
    let pool = db::get_pool();
    
    // Get group
    let group_row: GroupRow = sqlx::query_as(
        "SELECT id, name, created_at FROM groups WHERE id = $1"
    )
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
        members: member_rows.into_iter().map(|r| Member {
            id: r.id,
            name: r.name,
            paypal_email: r.paypal_email,
            iban: r.iban,
        }).collect(),
        created_at: group_row.created_at,
    };

    Ok(Json(group))
}

// Add member - requires valid JWT
#[post("/groups/current/members", data = "<request>")]
async fn add_member(
    auth: GroupAuth,
    request: Json<AddMemberRequest>,
) -> Result<Json<Group>, Status> {
    let pool = db::get_pool();
    
    // Check group exists
    let group_row: GroupRow = sqlx::query_as(
        "SELECT id, name, created_at FROM groups WHERE id = $1"
    )
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
    sqlx::query(
        "INSERT INTO members (id, group_id, name, created_at) VALUES ($1, $2, $3, $4)"
    )
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
        members: member_rows.into_iter().map(|r| Member {
            id: r.id,
            name: r.name,
            paypal_email: r.paypal_email,
            iban: r.iban,
        }).collect(),
        created_at: group_row.created_at,
    };

    Ok(Json(group))
}

// Update member payment info - requires valid JWT
#[put("/groups/current/members/<member_id>/payment", data = "<request>")]
async fn update_member_payment(
    auth: GroupAuth,
    member_id: &str,
    request: Json<UpdateMemberPaymentRequest>,
) -> Result<Json<Member>, Status> {
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
    sqlx::query(
        "UPDATE members SET paypal_email = $1, iban = $2 WHERE id = $3"
    )
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
async fn get_expenses(
    auth: GroupAuth,
) -> Result<Json<Vec<Expense>>, Status> {
    let pool = db::get_pool();
    
    // Get all expenses for this group
    let expense_rows: Vec<ExpenseRow> = sqlx::query_as(
        "SELECT id, group_id, description, amount, paid_by, expense_type, transfer_to, created_at 
         FROM expenses WHERE group_id = $1 ORDER BY created_at DESC"
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
        let splits: Vec<ExpenseSplitMemberRow> = sqlx::query_as(
            "SELECT member_id FROM expense_splits WHERE expense_id = $1"
        )
        .bind(row.id)
        .fetch_all(pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to fetch expense splits: {}", e);
            Status::InternalServerError
        })?;

        expenses.push(Expense {
            id: row.id,
            group_id: row.group_id,
            description: row.description,
            amount: row.amount.to_f64().unwrap_or(0.0),
            paid_by: row.paid_by,
            split_between: splits.into_iter().map(|s| s.member_id).collect(),
            expense_type: row.expense_type,
            transfer_to: row.transfer_to,
            created_at: row.created_at,
        });
    }

    Ok(Json(expenses))
}

// Create expense - requires valid JWT
#[post("/groups/current/expenses", data = "<request>")]
async fn create_expense(
    auth: GroupAuth,
    request: Json<CreateExpenseRequest>,
) -> Result<Json<Expense>, Status> {
    let pool = db::get_pool();
    let expense_id = Uuid::new_v4();
    let created_at = Utc::now();

    // Convert f64 to BigDecimal
    let amount = BigDecimal::try_from(request.amount).map_err(|_| Status::BadRequest)?;

    // Insert expense
    sqlx::query(
        "INSERT INTO expenses (id, group_id, description, amount, paid_by, expense_type, transfer_to, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
    )
    .bind(expense_id)
    .bind(auth.group_id)
    .bind(&request.description)
    .bind(&amount)
    .bind(request.paid_by)
    .bind(&request.expense_type)
    .bind(request.transfer_to)
    .bind(created_at)
    .execute(pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to create expense: {}", e);
        Status::InternalServerError
    })?;

    // Insert expense splits (not needed for transfers)
    if request.expense_type != "transfer" {
        for member_id in &request.split_between {
            sqlx::query(
                "INSERT INTO expense_splits (expense_id, member_id) VALUES ($1, $2)"
            )
            .bind(expense_id)
            .bind(member_id)
            .execute(pool)
            .await
            .map_err(|e| {
                eprintln!("Failed to create expense split: {}", e);
                Status::InternalServerError
            })?;
        }
    }

    let expense = Expense {
        id: expense_id,
        group_id: auth.group_id,
        description: request.description.clone(),
        amount: request.amount,
        paid_by: request.paid_by,
        split_between: request.split_between.clone(),
        expense_type: request.expense_type.clone(),
        transfer_to: request.transfer_to,
        created_at,
    };

    Ok(Json(expense))
}

// Update expense - requires valid JWT
#[put("/groups/current/expenses/<expense_id>", data = "<request>")]
async fn update_expense(
    auth: GroupAuth,
    expense_id: &str,
    request: Json<UpdateExpenseRequest>,
) -> Result<Json<Expense>, Status> {
    let pool = db::get_pool();
    let expense_uuid = Uuid::parse_str(expense_id).map_err(|_| Status::BadRequest)?;

    // Verify expense belongs to this group
    let _existing: ExpenseRow = sqlx::query_as(
        "SELECT id, group_id, description, amount, paid_by, expense_type, transfer_to, created_at 
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

    // Update expense
    sqlx::query(
        "UPDATE expenses SET description = $1, amount = $2, paid_by = $3, expense_type = $4, transfer_to = $5
         WHERE id = $6"
    )
    .bind(&request.description)
    .bind(&amount)
    .bind(request.paid_by)
    .bind(&request.expense_type)
    .bind(request.transfer_to)
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
            sqlx::query(
                "INSERT INTO expense_splits (expense_id, member_id) VALUES ($1, $2)"
            )
            .bind(expense_uuid)
            .bind(member_id)
            .execute(pool)
            .await
            .map_err(|e| {
                eprintln!("Failed to create expense split: {}", e);
                Status::InternalServerError
            })?;
        }
    }

    let expense = Expense {
        id: expense_uuid,
        group_id: auth.group_id,
        description: request.description.clone(),
        amount: request.amount,
        paid_by: request.paid_by,
        split_between: request.split_between.clone(),
        expense_type: request.expense_type.clone(),
        transfer_to: request.transfer_to,
        created_at: _existing.created_at,
    };

    Ok(Json(expense))
}

// Delete expense - requires valid JWT
#[delete("/groups/current/expenses/<expense_id>")]
async fn delete_expense(
    auth: GroupAuth,
    expense_id: &str,
) -> Result<Status, Status> {
    let pool = db::get_pool();
    let expense_uuid = Uuid::parse_str(expense_id).map_err(|_| Status::BadRequest)?;

    // Verify expense belongs to this group
    let _existing: ExpenseRow = sqlx::query_as(
        "SELECT id, group_id, description, amount, paid_by, expense_type, transfer_to, created_at 
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

    Ok(Status::NoContent)
}

// Get balances - requires valid JWT
#[get("/groups/current/balances")]
async fn get_balances(
    auth: GroupAuth,
) -> Result<Json<Vec<Balance>>, Status> {
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
        "SELECT id, group_id, description, amount, paid_by, expense_type, transfer_to, created_at 
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
        let amount = expense_row.amount.to_f64().unwrap_or(0.0);
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
                    "SELECT member_id FROM expense_splits WHERE expense_id = $1"
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
                let split_amount = amount / split_count;

                // The receiver holds the money (owes distribution)
                if let Some(receiver) = balances.iter_mut().find(|b| b.user_id == paid_by) {
                    receiver.balance -= amount;
                }

                // Each split member is owed their share
                for split in splits {
                    if let Some(member) = balances.iter_mut().find(|b| b.user_id == split.member_id) {
                        member.balance += split_amount;
                    }
                }
            }
            _ => {
                // Regular expense: payer gets credit, split members owe
                let splits: Vec<ExpenseSplitMemberRow> = sqlx::query_as(
                    "SELECT member_id FROM expense_splits WHERE expense_id = $1"
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
                let split_amount = amount / split_count;

                // The payer gets credit
                if let Some(payer) = balances.iter_mut().find(|b| b.user_id == paid_by) {
                    payer.balance += amount;
                }

                // Each person in the split owes
                for split in splits {
                    if let Some(member) = balances.iter_mut().find(|b| b.user_id == split.member_id) {
                        member.balance -= split_amount;
                    }
                }
            }
        }
    }

    Ok(Json(balances))
}

pub fn get_routes() -> Vec<Route> {
    routes![
        health,
        create_group,
        get_current_group,
        add_member,
        update_member_payment,
        get_expenses,
        create_expense,
        update_expense,
        delete_expense,
        get_balances
    ]
}
