# ── Stage 1: Build frontend ─────────────────────────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build backend ──────────────────────────────────────────────────
FROM rust:1.88-slim-bookworm AS backend-build

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
# Create a dummy main to cache dependency compilation
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release && rm -rf src

# Now copy real source and rebuild (only the app recompiles, deps are cached)
COPY backend/src/ ./src/
COPY backend/migrations/ ./migrations/
RUN touch src/main.rs && cargo build --release

# ── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend binary
COPY --from=backend-build /app/backend/target/release/share-cost-api ./share-cost-api

# Copy migrations (needed by refinery at startup)
COPY --from=backend-build /app/backend/migrations/ ./migrations/

# Copy frontend build output into static/
COPY --from=frontend-build /app/frontend/dist/ ./static/

# Rocket configuration for production
ENV ROCKET_ADDRESS=0.0.0.0
ENV ROCKET_PORT=8000
ENV ROCKET_LOG_LEVEL=normal

EXPOSE 8000

CMD ["./share-cost-api"]
