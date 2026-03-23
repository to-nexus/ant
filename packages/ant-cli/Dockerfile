# ============================================
# ANT CLI - Dockerfile
# ============================================
# Multi-stage build:
#   builder    — TypeScript compile (node:20)
#   preview    — Multi-language runtime for preview worker (node:20-alpine)
#   production — Lean runtime for api/job workers (node:20-alpine)  ← default
#
# Build targets:
#   docker build .                        → production (api/job)
#   docker build --target preview .       → preview worker
#
# Language toolchain ARGs (preview only):
#   GO_VERSION      base Go toolchain; per-project via go.mod toolchain + GOTOOLCHAIN=auto
#   PYTHON_VERSION  base Python via uv; per-project via .python-version / pyproject.toml
#   RUST_VERSION    base Rust via rustup; per-project via rust-toolchain.toml
#   JAVA_VERSION    base Java via mise; per-project via .mise.toml / .tool-versions
#
# Environment variables are injected via Vault Injector at runtime
# ============================================

# ============================================
# Stage 1: Builder
# ============================================
FROM node:20 AS builder

# Install build dependencies for native modules (sharp, argon2, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace configuration files
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy ant-cli package files
COPY packages/ant-cli/package.json ./packages/ant-cli/

# Install dependencies (frozen lockfile for reproducibility)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy ant-cli source code
COPY packages/ant-cli ./packages/ant-cli

# Build ant-cli
RUN pnpm build:cli

# ============================================
# Stage 2: Preview (multi-language runtime for preview worker)
# ============================================
# Starts fresh from node:20-alpine (does NOT extend production) so that
# language runtimes can be added incrementally without polluting api/job image.
FROM node:20-alpine AS preview

# --- Language version ARGs (empty string = skip install) ---
ARG GO_VERSION="1.23.6"
ARG PYTHON_VERSION=""
ARG RUST_VERSION=""
ARG JAVA_VERSION=""

# Base system deps (curl/bash needed by rustup/uv/mise installers)
# libc6-compat: required to run official Go binaries (glibc-linked) on Alpine (musl)
RUN apk add --no-cache \
    git \
    ca-certificates \
    wget \
    curl \
    bash \
    gcc \
    musl-dev \
    build-base \
    libc6-compat \
    docker-cli \
    docker-cli-compose

# -------- Go (official binary + GOTOOLCHAIN=auto) --------
# Installs base toolchain; per-project go.mod/go.work `toolchain` directive
# controls the actual version used at runtime via GOTOOLCHAIN=auto.
RUN if [ -n "${GO_VERSION}" ]; then \
      wget -qO /tmp/go.tar.gz \
        "https://dl.google.com/go/go${GO_VERSION}.linux-amd64.tar.gz" && \
      tar -C /usr/local -xzf /tmp/go.tar.gz && \
      rm /tmp/go.tar.gz; \
    fi
ENV PATH="${PATH}:/usr/local/go/bin"
ENV GOPATH="/home/ant/go"
ENV GOTOOLCHAIN=auto

# -------- Python (uv — .python-version / pyproject.toml auto-switch) --------
# `uv run` and `uv sync` automatically read .python-version for per-project version.
RUN if [ -n "${PYTHON_VERSION}" ]; then \
      curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh && \
      uv python install "${PYTHON_VERSION}"; \
    fi

# -------- Rust (rustup — rust-toolchain.toml auto-switch) --------
# RUSTUP_AUTO_INSTALL=1 causes rustup to auto-download the toolchain
# specified in rust-toolchain.toml when first invoked in a project.
ENV RUSTUP_HOME="/usr/local/rustup"
ENV CARGO_HOME="/usr/local/cargo"
RUN if [ -n "${RUST_VERSION}" ]; then \
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
        sh -s -- -y --default-toolchain "${RUST_VERSION}" --no-modify-path; \
    fi
ENV PATH="${PATH}:/usr/local/cargo/bin"
ENV RUSTUP_AUTO_INSTALL=1

# -------- Java (mise — .mise.toml / .tool-versions auto-switch) --------
# MISE_AUTO_INSTALL=true causes mise shims to auto-install the version
# specified in .mise.toml or .tool-versions when first invoked.
RUN if [ -n "${JAVA_VERSION}" ]; then \
      curl https://mise.run | sh && \
      /root/.local/bin/mise use --global "java@${JAVA_VERSION}"; \
    fi
ENV PATH="${PATH}:/root/.local/share/mise/shims"
ENV MISE_AUTO_INSTALL=true

# -------- Node.js tooling --------
RUN npm install -g pnpm tsx

# Create non-root user
RUN addgroup -S ant && adduser -S -G ant ant

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy ant-cli package.json
COPY packages/ant-cli/package.json ./packages/ant-cli/

# Install all dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy built artifacts from builder stage
COPY --from=builder /app/packages/ant-cli/dist ./packages/ant-cli/dist

# Copy runtime assets (templates, profiles)
COPY --from=builder /app/packages/ant-cli/dist/core/prompt/templates ./packages/ant-cli/dist/core/prompt/templates
COPY --from=builder /app/packages/ant-cli/dist/core/prompt/profiles ./packages/ant-cli/dist/core/prompt/profiles

# Copy source code for tsx execution
COPY --from=builder /app/packages/ant-cli/src ./packages/ant-cli/src
COPY --from=builder /app/packages/ant-cli/tsconfig.json ./packages/ant-cli/tsconfig.json

# Copy monorepo docs
COPY docs ./docs

# Create workspace directory and fix ownership
RUN mkdir -p /cross/workspaces && chown -R ant:ant /cross/workspaces
RUN mkdir -p /home/ant/go && chown -R ant:ant /home/ant/go
RUN if [ -d /usr/local/rustup ]; then chown -R ant:ant /usr/local/rustup /usr/local/cargo; fi
RUN chown -R ant:ant /app

USER ant

WORKDIR /app/packages/ant-cli

ENV NODE_ENV=production
ENV ANT_SERVER_MODE=cloud
ENV ANT_CLI_PORT=4100
ENV ANT_WORKSPACE_BASE_PATH=/data/workspaces
ENV GOOGLE_REDIRECT_URI=""
ENV FRONTEND_URL=""
ENV NODE_OPTIONS="--max-old-space-size=8192"

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4100/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["tsx", "src/composition/server.ts"]

# ============================================
# Stage 3: Production (api/job — lean, no language runtimes)
# ============================================
FROM node:20-alpine AS production

# Language version ARG (empty = skip install)
ARG GO_VERSION="1.23.6"

# Install runtime dependencies
# libc6-compat: required to run official Go binaries (glibc-linked) on Alpine (musl)
RUN apk add --no-cache \
    git \
    ca-certificates \
    wget \
    libc6-compat

# Go toolchain (official binary + GOTOOLCHAIN=auto for per-project version switching)
RUN if [ -n "${GO_VERSION}" ]; then \
      wget -qO /tmp/go.tar.gz \
        "https://dl.google.com/go/go${GO_VERSION}.linux-amd64.tar.gz" && \
      tar -C /usr/local -xzf /tmp/go.tar.gz && \
      rm /tmp/go.tar.gz; \
    fi
ENV PATH="${PATH}:/usr/local/go/bin"
ENV GOPATH="/home/ant/go"
ENV GOTOOLCHAIN=auto

# Install pnpm and tsx for production
RUN npm install -g pnpm tsx

# Create non-root user for security (Alpine uses addgroup/adduser)
RUN addgroup -S ant && adduser -S -G ant ant

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy ant-cli package.json
COPY packages/ant-cli/package.json ./packages/ant-cli/

# Install all dependencies (tsx execution needs devDependencies like typescript)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy built artifacts from builder stage
COPY --from=builder /app/packages/ant-cli/dist ./packages/ant-cli/dist

# Copy runtime assets (templates, profiles)
COPY --from=builder /app/packages/ant-cli/dist/core/prompt/templates ./packages/ant-cli/dist/core/prompt/templates
COPY --from=builder /app/packages/ant-cli/dist/core/prompt/profiles ./packages/ant-cli/dist/core/prompt/profiles

# Copy source code for tsx execution
COPY --from=builder /app/packages/ant-cli/src ./packages/ant-cli/src
COPY --from=builder /app/packages/ant-cli/tsconfig.json ./packages/ant-cli/tsconfig.json

# Copy monorepo docs (rubrics, guides, architecture docs used by ask tools)
COPY docs ./docs

# Create workspace directory
RUN mkdir -p /cross/workspaces && chown -R ant:ant /cross/workspaces

# Set ownership
RUN mkdir -p /home/ant/go && chown -R ant:ant /home/ant/go
RUN chown -R ant:ant /app

# Switch to non-root user
USER ant

WORKDIR /app/packages/ant-cli

# ============================================
# Environment Configuration
# ============================================
# NOTE: Sensitive environment variables (API keys, secrets) are injected
# via HashiCorp Vault Injector at runtime. Do NOT hardcode secrets here.

# Server configuration (non-sensitive defaults)
ENV NODE_ENV=production
ENV ANT_SERVER_MODE=cloud
ENV ANT_CLI_PORT=4100
ENV ANT_WORKSPACE_BASE_PATH=/data/workspaces

# Auth / Redirect defaults (overridden by docker-compose env_file at runtime)
ENV GOOGLE_REDIRECT_URI=""
ENV FRONTEND_URL=""

# Node.js memory configuration
ENV NODE_OPTIONS="--max-old-space-size=8192"

# Expose server port
EXPOSE 4100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4100/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server using tsx (avoids ESM module resolution issues)
CMD ["tsx", "src/composition/server.ts"]
