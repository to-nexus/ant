# syntax=docker.io/docker/dockerfile:1
# ============================================
# ANT UI - Production Dockerfile
# ============================================
# Multi-stage build with Nginx for static files
# Build-time environment variables for Vite
# ============================================

# BASE STAGE
FROM node:22-alpine AS base
# pnpm version pinned via root package.json `packageManager` field
RUN corepack enable && corepack prepare pnpm@11.1.0 --activate


# BUILD STAGE
FROM base AS builder
RUN apk update && apk add --no-cache libc6-compat
WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy ant-ui package + its workspace deps (vite resolves both from source:
# @ant/shared is aliased to ../ant-shared/src, @ant/auth-client's main is src/)
COPY packages/ant-ui/package.json ./packages/ant-ui/
COPY packages/ant-shared/package.json ./packages/ant-shared/
COPY packages/ant-auth-client/package.json ./packages/ant-auth-client/

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY packages/ant-ui ./packages/ant-ui
COPY packages/ant-shared ./packages/ant-shared
COPY packages/ant-auth-client ./packages/ant-auth-client

# Build environment argument (dev, stage, prod)
ARG BUILD_ENV=prod

# Determine which .env file to use
# dev -> .env.development (copy to .env.production for Vite build)
# stage, prod -> .env.production (already in place, no copy needed)
# Do NOT `cat` env files — that leaks their contents into build logs (CI artifacts).
RUN echo "🔨 Building for environment: ${BUILD_ENV}" && \
    if [ "${BUILD_ENV}" = "dev" ]; then \
      echo "📄 Using env file: .env.development" && \
      if [ -f "./packages/ant-ui/.env.development" ]; then \
        cp ./packages/ant-ui/.env.development ./packages/ant-ui/.env.production; \
      else \
        echo "⚠️  Warning: .env.development not found, using Vite defaults"; \
      fi; \
    else \
      echo "📄 Using env file: .env.production" && \
      if [ ! -f "./packages/ant-ui/.env.production" ]; then \
        echo "⚠️  Warning: .env.production not found, using Vite defaults"; \
      fi; \
    fi

# Preview/deploy CONTENT origin override.
#
# The content origin must differ from the origin the control-plane APIs answer on
# (report H-NEW-001), and which host that is depends on the deployment, not on the
# committed env file. A build arg appends it so the same env file serves both the
# single-host default and a split-origin deployment.
ARG VITE_PREVIEW_CONTENT_HOST=
RUN if [ -n "${VITE_PREVIEW_CONTENT_HOST}" ]; then       echo "" >> ./packages/ant-ui/.env.production &&       echo "VITE_PREVIEW_CONTENT_HOST=${VITE_PREVIEW_CONTENT_HOST}" >> ./packages/ant-ui/.env.production &&       echo "📄 content origin override applied";     fi

# Build ant-ui (Vite will load .env.production automatically)
RUN pnpm --filter @ant/ui build

# Debug: verify the build output landed where the runner stage expects
RUN echo "=== Checking dist location ===" && \
    ls -la /app/packages/ant-ui/dist/ || echo "dist not found"


# RUNNER STAGE - nginx with static files
FROM nginx:alpine AS runner

# Remove default nginx config and static content
RUN rm -rf /usr/share/nginx/html/* && \
    rm -f /etc/nginx/conf.d/default.conf

# Copy Vite build output to nginx html directory
COPY --from=builder /app/packages/ant-ui/dist /usr/share/nginx/html

# nginx.conf is mounted from a ConfigMap as /etc/nginx/conf.d/default.conf

# Run as non-root: grant the nginx user write access to pid/cache/log/html.
# The mounted ConfigMap nginx.conf listens on 8080 (unprivileged port).
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx && \
    touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid
USER nginx

EXPOSE 8080

# Start nginx
CMD ["nginx", "-g", "daemon off;"]