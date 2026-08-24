# ============================================
# ANT CLI - Dockerfile
# ============================================
# Multi-stage build:
#   builder    — TypeScript compile (node:22)
#   preview    — Multi-language runtime for preview worker (node:22-alpine)
#   production — Lean runtime for api/job workers (node:22-alpine)  ← default
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
FROM node:22 AS builder

# Install build dependencies for native modules (sharp, argon2, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm — version pinned via root package.json `packageManager` field
RUN corepack enable && corepack prepare pnpm@11.1.0 --activate

WORKDIR /app

# Copy workspace configuration files
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy package files (ant-shared must be present for workspace resolution)
COPY packages/ant-shared/package.json ./packages/ant-shared/
COPY packages/ant-cli/package.json ./packages/ant-cli/

# Install dependencies (frozen lockfile for reproducibility).
# Build-script whitelisting lives in pnpm-workspace.yaml `allowBuilds`. Do NOT
# pass `--ignore-scripts`: sharp still postinstalls, and it would produce a
# runtime failure instead of a build failure (see AGENTS.md → Native-Binary
# Dependencies).
RUN pnpm install --frozen-lockfile

# Fail the build immediately if ripgrep's bin is missing — a runtime ENOENT
# from `search_code` is much harder to diagnose than a build failure here.
# Since @vscode/ripgrep 1.18 the binary ships as a platform-specific
# optionalDependency (@vscode/ripgrep-linux-*), not a postinstall download.
RUN test -x "$(ls -d node_modules/.pnpm/@vscode+ripgrep-*/node_modules/@vscode/ripgrep-*/bin/rg | head -n1)" \
    || (echo "ERROR: @vscode/ripgrep platform binary missing — check optionalDependencies were installed" && exit 1)

# Copy source code
COPY packages/ant-shared ./packages/ant-shared
COPY packages/ant-cli ./packages/ant-cli
COPY docs ./docs

# Build ant-cli (builds @ant/shared first, then esbuild-bundles @ant/cli).
# Deliberately does NOT run the test suite — CI is the gate (.github/workflows/ci.yml).
RUN pnpm build:cli

# ============================================
# Stage 2: Preview (multi-language runtime for preview worker)
# ============================================
# Starts fresh from node:22-alpine (does NOT extend production) so that
# language runtimes can be added incrementally without polluting api/job image.
FROM node:22-alpine AS preview

# --- Language version ARGs (empty string = skip install) ---
ARG GO_VERSION="1.23.6"
ARG PYTHON_VERSION=""
ARG RUST_VERSION=""
ARG JAVA_VERSION=""

# Base system deps (curl/bash needed by rustup/uv/mise installers)
# libc6-compat: required to run official Go binaries (glibc-linked) on Alpine (musl)
# util-linux: provides the real `setpriv`, the UID-drop launcher the stdio-MCP
# spawn path re-execs through. It is resolved by ABSOLUTE path (a bare name would
# be looked up through the tenant-controlled child PATH — H-014), so the binary
# has to exist at /usr/bin/setpriv rather than as a busybox applet.
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
    util-linux \
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
RUN corepack enable && corepack prepare pnpm@11.1.0 --activate
RUN npm install -g tsx

# Create non-root user
RUN addgroup -S ant && adduser -S -G ant ant

# Second, unprivileged identity for USER-AUTHORED child processes (dev servers,
# install lifecycle scripts, build commands). A child sharing the service UID can
# read /proc/<service-pid>/environ and pick up whatever the service holds,
# whatever the composed child env says (report C-001). Its primary group is `ant`
# so it still reads and writes the shared workspace; the umask below keeps
# group-write on both sides so either identity can clean up the other's files.
#
# `ANT_CHILD_UID/GID` are NOT set as image defaults on purpose: changing a
# child's UID needs an effective CAP_SETUID, which these containers do not have
# by default. Set them from the deployment once the pod is allowed to drop UIDs
# (the runtime probes and logs loudly if it is not) — see
# docs/cloud-mode/self-host.md.
RUN adduser -S -G ant -u 10001 -H -h /nonexistent ant-child

# THIRD identity, for the credentialed dependency-FETCH pass only. That pass is
# the one child that holds a user's registry/git PAT in its environment, and
# /proc/<pid>/environ is mode 0400 owned by the process UID — so giving it a UID
# distinct from `ant-child` is what stops a concurrent user-code child (a dev
# server, a lifecycle script) from reading that PAT out of it (M-NEW-001). Same
# `ant` group, so the tree it writes stays writable by the credential-free
# lifecycle pass that follows.
RUN adduser -S -G ant -u 10002 -H -h /nonexistent ant-acquire
ENV ANT_CHILD_UMASK=002

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy package files (ant-shared must be present for workspace resolution)
COPY packages/ant-shared/package.json ./packages/ant-shared/
COPY packages/ant-cli/package.json ./packages/ant-cli/

# Install all dependencies.
# `--ignore-scripts` MUST NOT be passed: pnpm restricts build scripts to the
# pnpm-workspace.yaml `allowBuilds` whitelist already, and sharp needs its
# postinstall. ripgrep 1.18+ ships platform binaries as optionalDependencies.
RUN pnpm install --frozen-lockfile

RUN test -x "$(ls -d node_modules/.pnpm/@vscode+ripgrep-*/node_modules/@vscode/ripgrep-*/bin/rg | head -n1)" \
    || (echo "ERROR: @vscode/ripgrep platform binary missing in preview stage" && exit 1)

# Copy ant-shared from builder
COPY --from=builder /app/packages/ant-shared ./packages/ant-shared

# Copy built artifacts from builder stage
COPY --from=builder /app/packages/ant-cli/dist ./packages/ant-cli/dist

# Copy source code for tsx execution
COPY --from=builder /app/packages/ant-cli/src ./packages/ant-cli/src
COPY --from=builder /app/packages/ant-cli/tsconfig.json ./packages/ant-cli/tsconfig.json

# Copy monorepo docs
COPY docs ./docs

# Create workspace directory and fix ownership
RUN mkdir -p /cross/workspaces && chown -R ant:ant /cross/workspaces && chmod 2775 /cross/workspaces
RUN mkdir -p /home/ant/go && chown -R ant:ant /home/ant/go
RUN if [ -d /usr/local/rustup ]; then chown -R ant:ant /usr/local/rustup /usr/local/cargo; fi
RUN chown -R ant:ant /app

USER ant

WORKDIR /app/packages/ant-cli

ENV NODE_ENV=production
# Default to local/OSS mode; cloud images override with --build-arg ANT_SERVER_MODE=cloud.
ARG ANT_SERVER_MODE=local
ENV ANT_SERVER_MODE=${ANT_SERVER_MODE}
ENV ANT_CLI_PORT=4100
ENV ANT_WORKSPACE_BASE_PATH=/data/workspaces
ENV NODE_OPTIONS="--max-old-space-size=8192"

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4100/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["tsx", "src/composition/server.ts"]

# ============================================
# Stage 3: Production (api/job — lean, no language runtimes)
# ============================================
FROM node:22-alpine AS production

# Language version ARG (empty = skip install)
ARG GO_VERSION="1.23.6"

# Install runtime dependencies
# libc6-compat: required to run official Go binaries (glibc-linked) on Alpine (musl)
# curl/bash: verification probes from architect agent (run_command tool)
# procps/iproute2/lsof: process & port discovery used by DevProcessControl
#   (pgrep BFS, lsof -ti :PORT, ss -ltnp). Without these, DevProcessControl's
#   execFileSync calls ENOENT silently and orphan dev servers accumulate
#   between verification cycles.
# util-linux: the real /usr/bin/setpriv — see the preview stage (H-014).
RUN apk add --no-cache \
    git \
    ca-certificates \
    wget \
    curl \
    bash \
    procps \
    iproute2 \
    lsof \
    libc6-compat \
    util-linux

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
RUN corepack enable && corepack prepare pnpm@11.1.0 --activate
RUN npm install -g tsx

# Create non-root user for security (Alpine uses addgroup/adduser)
RUN addgroup -S ant && adduser -S -G ant ant

# Unprivileged identity for user-authored children — same rationale as the
# preview stage above (the job worker runs LLM-chosen shell commands).
RUN adduser -S -G ant -u 10001 -H -h /nonexistent ant-child

# Credentialed dependency-FETCH identity — see the preview stage above
# (M-NEW-001): the one child that carries a user PAT gets its own UID so a
# same-UID peer cannot read it from /proc/<pid>/environ.
RUN adduser -S -G ant -u 10002 -H -h /nonexistent ant-acquire
ENV ANT_CHILD_UMASK=002

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy package files (ant-shared must be present for workspace resolution)
COPY packages/ant-shared/package.json ./packages/ant-shared/
COPY packages/ant-cli/package.json ./packages/ant-cli/

# Install all dependencies (tsx execution needs devDependencies like typescript).
# Do NOT add `--ignore-scripts`: pnpm restricts build scripts to the
# pnpm-workspace.yaml `allowBuilds` whitelist already, and sharp needs its
# postinstall. ripgrep 1.18+ ships platform binaries as optionalDependencies.
RUN pnpm install --frozen-lockfile

RUN test -x "$(ls -d node_modules/.pnpm/@vscode+ripgrep-*/node_modules/@vscode/ripgrep-*/bin/rg | head -n1)" \
    || (echo "ERROR: @vscode/ripgrep platform binary missing in production stage" && exit 1)

# Copy ant-shared from builder
COPY --from=builder /app/packages/ant-shared ./packages/ant-shared

# Copy built artifacts from builder stage
COPY --from=builder /app/packages/ant-cli/dist ./packages/ant-cli/dist

# Copy source code for tsx execution
COPY --from=builder /app/packages/ant-cli/src ./packages/ant-cli/src
COPY --from=builder /app/packages/ant-cli/tsconfig.json ./packages/ant-cli/tsconfig.json

# Copy monorepo docs (rubrics, guides, architecture docs used by ask tools)
COPY docs ./docs

# Create workspace directory
RUN mkdir -p /cross/workspaces && chown -R ant:ant /cross/workspaces && chmod 2775 /cross/workspaces

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
# Default to local/OSS mode; cloud images override with --build-arg ANT_SERVER_MODE=cloud.
ARG ANT_SERVER_MODE=local
ENV ANT_SERVER_MODE=${ANT_SERVER_MODE}
ENV ANT_CLI_PORT=4100
ENV ANT_WORKSPACE_BASE_PATH=/data/workspaces

# Node.js memory configuration
ENV NODE_OPTIONS="--max-old-space-size=8192"

# Expose server port
EXPOSE 4100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4100/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server using tsx (avoids ESM module resolution issues)
CMD ["tsx", "src/composition/server.ts"]
