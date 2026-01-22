# ============================================
# ANT CLI - Production Dockerfile
# ============================================
# Multi-stage build for optimized image size
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
# Stage 2: Production
# ============================================
FROM node:20-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    git \
    ca-certificates

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
COPY --from=builder /app/packages/ant-cli/dist/periphery/profiles ./packages/ant-cli/dist/periphery/profiles

# Copy source code for tsx execution
COPY --from=builder /app/packages/ant-cli/src ./packages/ant-cli/src
COPY --from=builder /app/packages/ant-cli/tsconfig.json ./packages/ant-cli/tsconfig.json

# Create workspace directory
RUN mkdir -p /cross/workspaces && chown -R ant:ant /cross/workspaces

# Set ownership
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
ENV SKIP_AUTH_FOR_LOCALHOST="false"

# Node.js memory configuration
ENV NODE_OPTIONS="--max-old-space-size=8192"

# Expose server port
EXPOSE 4100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4100/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server using tsx (avoids ESM module resolution issues)
CMD ["tsx", "src/composition/server.ts"]

