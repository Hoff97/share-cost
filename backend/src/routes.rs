use rocket::http::Status;
use rocket::serde::json::Json;
use rocket::{Route, State};
use std::sync::Mutex;
use uuid::Uuid;
use chrono::Utc;

use crate::auth::{generate_token, GroupAuth};
use crate::models::*;

// In-memory storage (replace with database in production)
pub struct AppState {
    pub groups: Mutex<Vec<Group>>,
    pub expenses: Mutex<Vec<Expense>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            groups: Mutex::new(Vec::new()),
            expenses: Mutex::new(Vec::new()),
        }
    }
}

// Health check
#[get("/health")]
fn health() -> &'static str {
    "OK"
}

// Create group - no auth required
#[post("/groups", data = "<request>")]
fn create_group(state: &State<AppState>, request: Json<CreateGroupRequest>) -> Result<Json<GroupCreatedResponse>, Status> {
    let members: Vec<Member> = request
        .member_names
        .iter()
        .map(|name| Member {
            id: Uuid::new_v4(),
            name: name.clone(),
        })
        .collect();

    let group_id = Uuid::new_v4();
    
    let group = Group {
        id: group_id,
        name: request.name.clone(),
        members,
        created_at: Utc::now(),
    };
    
    state.groups.lock().unwrap().push(group.clone());
    
    // Generate JWT for this group
    let token = generate_token(group_id)
        .map_err(|_| Status::InternalServerError)?;
    
    Ok(Json(GroupCreatedResponse { group, token }))
}

// Get group - requires valid JWT
#[get("/groups/current")]
fn get_current_group(state: &State<AppState>, auth: GroupAuth) -> Option<Json<Group>> {
    let groups = state.groups.lock().unwrap();
    groups.iter().find(|g| g.id == auth.group_id).map(|g| Json(g.clone()))
}

// Add member - requires valid JWT
#[post("/groups/current/members", data = "<request>")]
fn add_member(state: &State<AppState>, auth: GroupAuth, request: Json<AddMemberRequest>) -> Option<Json<Group>> {
    let mut groups = state.groups.lock().unwrap();
    let group = groups.iter_mut().find(|g| g.id == auth.group_id)?;
    
    let member = Member {
        id: Uuid::new_v4(),
        name: request.name.clone(),
    };
    group.members.push(member);
    
    Some(Json(group.clone()))
}

// Get expenses - requires valid JWT
#[get("/groups/current/expenses")]
fn get_expenses(state: &State<AppState>, auth: GroupAuth) -> Json<Vec<Expense>> {
    let expenses = state.expenses.lock().unwrap();
    let group_expenses: Vec<Expense> = expenses
        .iter()
        .filter(|e| e.group_id == auth.group_id)
        .cloned()
        .collect();
    Json(group_expenses)
}

// Create expense - requires valid JWT
#[post("/groups/current/expenses", data = "<request>")]
fn create_expense(state: &State<AppState>, auth: GroupAuth, request: Json<CreateExpenseRequest>) -> Json<Expense> {
    let expense = Expense {
        id: Uuid::new_v4(),
        group_id: auth.group_id,
        description: request.description.clone(),
        amount: request.amount,
        paid_by: request.paid_by,
        split_between: request.split_between.clone(),
        created_at: Utc::now(),
    };
    state.expenses.lock().unwrap().push(expense.clone());
    Json(expense)
}

// Get balances - requires valid JWT
#[get("/groups/current/balances")]
fn get_balances(state: &State<AppState>, auth: GroupAuth) -> Option<Json<Vec<Balance>>> {
    let groups = state.groups.lock().unwrap();
    let expenses = state.expenses.lock().unwrap();
    
    let group = groups.iter().find(|g| g.id == auth.group_id)?;
    
    let mut balances: Vec<Balance> = group
        .members
        .iter()
        .map(|member| Balance {
            user_id: member.id,
            user_name: member.name.clone(),
            balance: 0.0,
        })
        .collect();
    
    // Calculate balances
    for expense in expenses.iter().filter(|e| e.group_id == auth.group_id) {
        let split_amount = expense.amount / expense.split_between.len() as f64;
        
        // The payer gets credit
        if let Some(payer) = balances.iter_mut().find(|b| b.user_id == expense.paid_by) {
            payer.balance += expense.amount;
        }
        
        // Each person in the split owes
        for member_id in &expense.split_between {
            if let Some(member) = balances.iter_mut().find(|b| b.user_id == *member_id) {
                member.balance -= split_amount;
            }
        }
    }
    
    Some(Json(balances))
}

pub fn get_routes() -> Vec<Route> {
    routes![
        health,
        create_group,
        get_current_group,
        add_member,
        get_expenses,
        create_expense,
        get_balances
    ]
}

pub fn get_state() -> AppState {
    AppState::default()
}
