# Share Cost

A web application for sharing costs between friends and groups. Built with React (frontend) and Rust/Rocket (backend) with PostgreSQL for persistent storage. **No sign-up required** - just create a group and share the link!

## Project Structure

```
share-cost/
├── frontend/          # React + TypeScript + Vite
│   └── src/
│       ├── components/
│       │   ├── CreateGroup.tsx
│       │   └── GroupDetail.tsx
│       ├── api.ts
│       ├── App.tsx
│       └── App.css
├── backend/           # Rust + Rocket
│   └── src/
│       ├── main.rs
│       ├── models.rs
│       ├── routes.rs
│       ├── db.rs
│       └── auth.rs
│   └── migrations/    # SQL migrations
└── docker-compose.yml # PostgreSQL database
```

## Features

- **No Registration Required**: Create a group instantly with member names
- **Shareable Links**: Each group gets a unique access token URL
- **Expense Tracking**: Add expenses with flexible splitting options
- **Balance Calculation**: Automatically calculates who owes whom
- **Add Members Anytime**: New members can be added to existing groups
- **Persistent Storage**: All data is stored in PostgreSQL

## Getting Started

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Cargo
- Docker (for PostgreSQL) or PostgreSQL 14+

### Starting the Database

Using Docker (recommended):
```bash
docker-compose up -d
```

Or ensure you have PostgreSQL running with:
- Host: localhost
- Port: 5432
- User: postgres
- Password: postgres
- Database: share_cost

### Running the Backend

```bash
cd backend
cargo run
```

The API will be available at `http://localhost:8000`

Migrations will run automatically on startup.

### Running the Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`

## How It Works

1. **Create a Group**: Enter a group name and add member names
2. **Share the Link**: Copy the generated link (e.g., `/group/abc12345`) and share with friends
3. **Add Expenses**: Anyone with the link can add expenses and see balances
4. **Track Balances**: The app automatically calculates who owes whom

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/groups/token/:token` | Get group by access token |
| GET | `/api/groups/:id` | Get group by ID |
| POST | `/api/groups` | Create a group with members |
| POST | `/api/groups/:token/members` | Add a member to a group |
| GET | `/api/groups/:id/expenses` | List expenses for a group |
| POST | `/api/expenses` | Create an expense |
| GET | `/api/groups/:id/balances` | Get balances for a group |

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Backend**: Rust, Rocket, Serde
- **Data**: In-memory storage (can be extended to use a database)
