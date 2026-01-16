# syntax=docker.io/docker/dockerfile:1
# ============================================
# ANT UI - Production Dockerfile
# ============================================
# Multi-stage build with Nginx for static files
# Build-time environment variables for Vite
# ============================================

# BASE STAGE
FROM node:20-alpine AS base
RUN npm install -g pnpm


# BUILD STAGE
FROM base AS builder
RUN apk add --no-cache libc6-compat
RUN apk update
WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy ant-ui package
COPY packages/ant-ui/package.json ./packages/ant-ui/

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy ant-ui source code
COPY packages/ant-ui ./packages/ant-ui

# Build environment argument (dev, stage, prod)
ARG BUILD_ENV=prod

# Determine which .env file to use
# dev -> .env.development
# stage, prod -> .env.production
RUN if [ "${BUILD_ENV}" = "dev" ]; then \
      ENV_FILE=".env.development"; \
    else \
      ENV_FILE=".env.production"; \
    fi && \
    echo "🔨 Building for environment: ${BUILD_ENV}" && \
    echo "📄 Using env file: ${ENV_FILE}" && \
    if [ -f "./packages/ant-ui/${ENV_FILE}" ]; then \
      echo "Environment variables:" && \
      cat ./packages/ant-ui/${ENV_FILE} && \
      cp ./packages/ant-ui/${ENV_FILE} ./packages/ant-ui/.env.production; \
    else \
      echo "⚠️  Warning: ${ENV_FILE} not found, using Vite defaults"; \
    fi

# Build ant-ui (Vite will load .env.production automatically)
RUN pnpm --filter @ant/ui build

# Debug: 빌드 결과물 확인
RUN echo "=== Checking dist location ===" && \
    ls -la /app/packages/ant-ui/dist/ || echo "dist not found"


# RUNNER STAGE - nginx with static files
FROM nginx:alpine AS runner

# Remove default nginx config and static content
RUN rm -rf /usr/share/nginx/html/* && \
    rm -f /etc/nginx/conf.d/default.conf

# Copy Vite build output to nginx html directory
COPY --from=builder /app/packages/ant-ui/dist /usr/share/nginx/html

# nginx.conf는 ConfigMap에서 /etc/nginx/conf.d/default.conf로 마운트됨

EXPOSE 8080

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

