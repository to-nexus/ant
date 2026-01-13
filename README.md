# ANT Works

**AI-Native Development Platform** - Transform your development workflow with AI-powered autonomous agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)

---

## 📖 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Configuration](#environment-configuration)
  - [Running the Application](#running-the-application)
- [Workspace Structure](#workspace-structure)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Development](#development)
- [Documentation](#documentation)
- [Tech Stack](#tech-stack)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

ANT Works is an AI-native development platform that combines powerful AI agents with a modern web interface to automate software development tasks. It features:

- **Autonomous AI Agents**: Architect, Reviewer, Planner agents with specialized capabilities
- **Hexagonal Architecture**: Clean separation of concerns with ports & adapters
- **LangGraph Orchestration**: State-machine-based workflow management
- **Dual Memory System**: ChromaDB vector memory + JSON session persistence
- **Real-time Collaboration**: Live updates via Server-Sent Events (SSE)
- **Cloud & Local Modes**: Deploy to cloud or run entirely on your local machine

---

## Features

### 🎨 Modern Web Interface

- **3-Panel Layout**:
  - **Left Panel**: Project & Feature management
  - **Center Panel**: Task queue, Kanban board, and real-time logs
  - **Right Panel**: File browser and code editor

- **Real-time Updates**: Live streaming of agent activities, task progress, and file changes

- **Multiple Agents**: Choose from Architect, Reviewer, Planner, and more

- **Task Management**: Visual Kanban board with drag-and-drop task organization

### 🤖 AI-Powered Automation

- **Design Generation**: Automatically create system architecture and design documents
- **Code Generation**: Generate production-ready code from requirements
- **Code Review**: Automated code quality analysis and suggestions
- **Learning System**: Agents learn from past experiences to improve future performance
- **Error Resolution**: Autonomous error detection and fix strategies

### 🔧 Flexible Deployment

- **Cloud Mode**: Multi-tenant workspace with authentication
  - Organization-based isolation: `workspaces/{org}/{user}/{project}/`
  - User authentication and session management
  - Scalable for team collaboration

- **Local Mode**: Privacy-first, fully offline development
  - No authentication required
  - Direct access to local codebase
  - All data stays on your machine

---

## Architecture

ANT Works follows **Hexagonal Architecture** (Ports & Adapters) principles:

```
┌─────────────────────────────────────────────────────────┐
│                     Presentation Layer                   │
│              (ant-ui: React + TypeScript)                │
│        • Project Management  • Kanban Board              │
│        • File Editor         • Real-time Logs            │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP/SSE
┌────────────────────▼────────────────────────────────────┐
│                    Application Layer                     │
│              (ant-cli: Express Server)                   │
│        • REST API            • SSE Streaming            │
│        • Authentication      • Session Management       │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                      Domain Layer                        │
│               (Core Business Logic)                      │
│        • Agents (Architect, Reviewer, Planner)          │
│        • Workflow Orchestration (LangGraph)             │
│        • Task Management                                 │
│        • Memory & Learning                               │
└────────────────────┬────────────────────────────────────┘
                     │ Ports (Interfaces)
┌────────────────────▼────────────────────────────────────┐
│                  Infrastructure Layer                    │
│                   (Adapters)                             │
│    • LLM Clients (OpenAI, Anthropic)                    │
│    • Vector DB (ChromaDB)                                │
│    • Git Operations (simple-git)                         │
│    • File System                                         │
│    • Session Persistence                                 │
└─────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
ant/
├── packages/
│   ├── ant-cli/              # Backend (Node.js + Express)
│   │   ├── src/
│   │   │   ├── agents/       # AI Agents (Architect, Reviewer, etc.)
│   │   │   ├── core/         # Domain logic (ports, types, policies)
│   │   │   ├── periphery/    # Adapters (LLM, memory, git, HTTP)
│   │   │   ├── composition/  # Dependency injection
│   │   │   ├── cli/          # CLI commands
│   │   │   └── infrastructure/ # Cross-cutting (auth, workspace)
│   │   ├── dist/             # Compiled output
│   │   └── package.json
│   │
│   ├── ant-ui/               # Frontend (React + Vite)
│   │   ├── src/
│   │   │   ├── presentation/ # React components
│   │   │   ├── application/  # Hooks and business logic
│   │   │   ├── domain/       # State management (Zustand)
│   │   │   ├── infrastructure/ # HTTP, SSE clients
│   │   │   └── shared/       # Utilities
│   │   └── package.json
│   │
│   └── ant-ide/              # Web-based IDE (Monaco Editor)
│       └── package.json
│
├── workspaces/               # User workspaces (created at runtime)
│   ├── local/                # Local mode workspaces
│   │   └── user/             # Fixed user directory
│   │       └── {project}/
│   │           ├── config.json
│   │           ├── codebase/
│   │           └── features/
│   │               └── {feature}/
│   │                   ├── inputs/
│   │                   ├── outputs/
│   │                   └── sessions/
│   │
│   └── {org}/                # Cloud mode workspaces
│       └── {user}/
│           └── {project}/
│               ├── config.json
│               ├── codebase/
│               └── features/
│
├── docs/                     # Documentation
├── package.json              # Root workspace config
└── pnpm-workspace.yaml       # pnpm workspace definition
```

---

## Getting Started

### Prerequisites

- **Node.js**: v18 or higher (v22 recommended)
- **pnpm**: Package manager
  ```bash
  npm install -g pnpm
  ```
- **Git**: For version control operations
- **LLM API Key**: OpenAI or Anthropic API key

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/to-nexus/ant.git
   cd ant
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Build packages**:
   ```bash
   pnpm build
   ```

### Environment Configuration

#### Backend (`ant-cli`)

Create `packages/ant-cli/.env`:

```bash
# ============================================
# Server Mode
# ============================================
# local: Single-user mode, no authentication
# cloud: Multi-tenant mode with authentication
ANT_SERVER_MODE=local

# ============================================
# Server Configuration
# ============================================
# Port for HTTP server (default: 4100)
PORT=4100

# Cloud mode only: Redirect URL for local mode info
CLOUD_URL=http://localhost:4200/local

# ============================================
# LLM Provider Configuration (REQUIRED)
# ============================================
# Provider: 'openai' or 'anthropic'
AI_MODEL_PROVIDER=anthropic

# API Keys (provide the one matching your provider)
ANTHROPIC_API_KEY=sk-ant-api03-...
# OPENAI_API_KEY=sk-...

# Optional: Specify model (defaults to provider's best model)
# AI_MODEL_NAME=claude-sonnet-4-5
# AI_MODEL_NAME=gpt-4-turbo

# ============================================
# Optional: Vector Memory (ChromaDB)
# ============================================
# Uncomment to enable ChromaDB for long-term memory
# CHROMA_URL=http://localhost:8000
```

**Key Environment Variables**:

| Variable | Description | Example |
|----------|-------------|---------|
| `ANT_SERVER_MODE` | Deployment mode: `local` or `cloud` | `local` |
| `PORT` | HTTP server port | `4100` |
| `AI_MODEL_PROVIDER` | LLM provider | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | Anthropic API key | `sk-ant-api03-...` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `AI_MODEL_NAME` | Specific model (optional) | `claude-sonnet-4-5` |
| `CHROMA_URL` | ChromaDB URL (optional) | `http://localhost:8000` |

**Google OIDC Authentication (Cloud Mode)**:

For Google sign-in support, see [Google OIDC Setup Guide](./docs/GOOGLE_OIDC_SETUP.md).

**Development (localhost)**: Authentication can be skipped for convenience
```bash
SKIP_AUTH_FOR_LOCALHOST=true  # Default dev user: dev@localhost
```

**Production**: Required environment variables
- `GOOGLE_CLIENT_ID`: OAuth client ID from Google Cloud Console
- `GOOGLE_CLIENT_SECRET`: OAuth client secret
- `GOOGLE_REDIRECT_URI`: Callback URL (e.g., `https://ant.crosstoken.io/api/auth/google/callback`)
- `SKIP_AUTH_FOR_LOCALHOST=false`: Enforce authentication

#### Frontend (`ant-ui`)

Create `packages/ant-ui/.env`:

```bash
# ============================================
# Frontend Mode
# ============================================
# Where the frontend is running:
# local: Development (localhost)
# cloud: Production (deployed)
VITE_FRONTEND_MODE=local

# ============================================
# Backend Target
# ============================================
# Which backend to connect to (can be changed in UI):
# local: Connect to local backend
# cloud: Connect to cloud backend
VITE_TARGET_BACKEND_MODE=local

# ============================================
# Backend URLs
# ============================================
# Local backend API endpoint
VITE_LOCAL_BACKEND_BASE=http://localhost:4100/api

# Cloud backend API endpoint (for production)
VITE_CLOUD_BACKEND_BASE=https://api.ant.works/api
```

**Key Environment Variables**:

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_FRONTEND_MODE` | Where frontend runs | `local` or `cloud` |
| `VITE_TARGET_BACKEND_MODE` | Which backend to connect to | `local` or `cloud` |
| `VITE_LOCAL_BACKEND_BASE` | Local backend URL | `http://localhost:4100/api` |
| `VITE_CLOUD_BACKEND_BASE` | Cloud backend URL | `https://api.ant.works/api` |

### Running the Application

#### Option 1: Start Everything (Recommended)

```bash
pnpm dev
```

This starts:
- `ant-cli` (backend) on port **4100**
- `ant-ui` (frontend) on port **4200**
- `ant-ide` (web IDE) on port **4400**

Access the app at **http://localhost:4200**

#### Option 2: Start Individually

**Terminal 1 - Backend**:
```bash
pnpm dev:cli
```

**Terminal 2 - Frontend**:
```bash
pnpm dev:ui
```

**Terminal 3 - Web IDE** (optional):
```bash
pnpm dev:ide
```

---

## Workspace Structure

ANT Works uses a **centralized workspace directory** to store all projects, features, and artifacts.

### Path Structure

#### Local Mode
```
~/ant-workspaces/                    # Root directory (configurable)
└── local/                           # Fixed: local mode namespace
    └── user/                        # Fixed: single user
        └── {project}/               # Project name (e.g., "my-app")
            ├── config.json          # Project configuration
            ├── codebase/            # Project source code (for cloud)
            │   └── (git repository)
            └── features/            # Feature workspace
                └── {feature}/       # Feature name (e.g., "auth-system")
                    ├── inputs/
                    │   ├── directives/   # AI instructions
                    │   │   ├── design/
                    │   │   │   └── directive.md
                    │   │   └── code/
                    │   │       └── directive.md
                    │   └── sources/      # Reference files
                    │       └── prd.md
                    ├── outputs/
                    │   ├── design/       # Design documents
                    │   └── reports/      # Execution logs
                    └── sessions/         # Job state persistence
                        ├── design.json
                        ├── code.json
                        └── chat.json
```

#### Cloud Mode
```
~/ant-workspaces/                    # Root directory (configurable)
└── {org}/                           # Organization (e.g., "acme-corp")
    └── {user}/                      # User (e.g., "john")
        └── {project}/               # Project name
            ├── config.json          # Project configuration
            ├── codebase/            # Project source code
            └── features/            # Same as local mode
```

### Configuration File (`config.json`)

Each project has a `config.json` file:

```json
{
  "repositoryName": "my-app",
  "repoType": "local",
  "localPath": "~/dev/my-app",
  "branchBase": "main",
  "autoLearn": true,
  "llmProvider": "anthropic",
  "llmModel": "claude-sonnet-4-5"
}
```

**Fields**:
- `repositoryName`: Repository/codebase name (sanitized from project name)
- `repoType`: `local` (use localPath) | `cloud` (use workspaces/codebase) | `github` (clone from remote)
- `localPath`: Path to actual codebase (for local mode)
- `branchBase`: Default git branch
- `autoLearn`: Enable agent learning from past executions
- `llmProvider`: LLM provider (from env or override)
- `llmModel`: Specific model (optional)

---

## Usage

### 1. Create a Project

1. Open **http://localhost:4200**
2. Click **"+ New Project"**
3. Enter project name and confirm
4. A `config.json` will be created automatically

### 2. Create a Feature

1. Select your project
2. Click **"+ New Feature"**
3. Enter feature name (e.g., "auth-system")
4. The feature workspace is created with `inputs/`, `outputs/`, and `sessions/` directories

### 3. Add Requirements

1. Select your feature
2. Navigate to **"Inputs"** in the file panel
3. Create `sources/prd.md` with your requirements:
   ```markdown
   # Product Requirements Document
   
   ## Feature: User Authentication
   
   ### Requirements
   - [ ] User login with email and password
   - [ ] JWT-based session management
   - [ ] Password hashing with bcrypt
   - [ ] Remember me functionality
   
   ### Technical Stack
   - Backend: Node.js + Express
   - Database: PostgreSQL
   - Authentication: JWT
   ```

### 4. Run Design Job

1. Select **"Architect"** agent from the top bar
2. Select **"Design"** task
3. Click **"Run"**
4. Watch the Kanban board for task progress
5. View generated design documents in `outputs/design/`

### 5. Run Code Job

1. Switch to **"Code"** task
2. Click **"Run"**
3. Agent will:
   - Decompose requirements into tasks
   - Generate code for each task
   - Validate and fix errors
   - Write files to your codebase
4. Review generated code in your local codebase path

### 6. Chat with Agent

1. Open the **Chat Panel** (bottom center)
2. Ask questions or give additional instructions:
   ```
   Add error handling for network failures
   ```
3. Agent will incorporate your feedback in real-time

---

## API Reference

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create new project |
| `DELETE` | `/api/projects/:id` | Delete project |
| `GET` | `/api/projects/:id/config` | Get project config |
| `PUT` | `/api/projects/:id/config` | Update project config |

### Features

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects/:id/features` | List features |
| `POST` | `/api/projects/:id/features` | Create feature |
| `DELETE` | `/api/projects/:id/features/:feature` | Delete feature |

### Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/:id/features/:feature/execute` | Execute job |
| `POST` | `/api/jobs/:jobId/stop` | Stop running job |
| `POST` | `/api/jobs/:jobId/resume` | Resume paused job |
| `GET` | `/api/jobs/:jobId/logs` | Get job logs |

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects/:id/features/:feature/files` | Get file tree |
| `GET` | `/api/projects/:id/features/:feature/files/*` | Read file |
| `PUT` | `/api/projects/:id/features/:feature/files/*` | Write file |

### Real-time Updates (SSE)

| Endpoint | Description |
|----------|-------------|
| `/api/projects/:id/features/:feature/stream?job={job}` | Unified SSE stream (kanban, chat, file tree, logs) |
| `/api/jobs/:jobId/workflow/stream` | Workflow state updates |

---

## Development

### Build

```bash
# Build all packages
pnpm build

# Build specific package
pnpm build:cli   # Backend only
pnpm build:ui    # Frontend only
pnpm build:ide   # Web IDE only
```

### Type Checking

```bash
# Check all packages
pnpm typecheck

# Check specific package
cd packages/ant-cli && pnpm typecheck
cd packages/ant-ui && pnpm typecheck
```

### Testing

```bash
# Run tests (if available)
pnpm test
```

### Code Quality

```bash
# Lint code
pnpm lint

# Format code
pnpm format
```

---

## Documentation

### Guides
- [Quick Start Guide](docs/guides/QUICK_START.md) - Get up and running
- [CLI Guide](docs/guides/CLI_GUIDE.md) - Command-line usage
- [Evaluation Guide](docs/guides/EVALUATION.md) - Code evaluation system

### Design Documents
- [Architecture](docs/designs/ARCHITECTURE.md) - System architecture overview
- [Workflow](docs/designs/ARCHITECT_CODE_TASK_WORKFLOW.md) - Code task workflow
- [Memory System](docs/designs/MEMORY_SYSTEM.md) - Dual memory architecture

### API Documentation
- [HTTP API](docs/api/HTTP_API.md) - REST API reference
- [SSE Streaming](docs/api/SSE_STREAMING.md) - Real-time updates

---

## Tech Stack

### Backend
- **Runtime**: Node.js 18+, TypeScript 5.0+
- **Framework**: Express.js
- **Orchestration**: LangGraph (@langchain/langgraph)
- **LLM Clients**: OpenAI SDK, Anthropic SDK
- **Vector DB**: ChromaDB (optional)
- **Git**: simple-git
- **Template**: Handlebars
- **Validation**: Zod
- **CLI**: Commander.js

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **State Management**: Zustand
- **Styling**: Tailwind CSS
- **UI Components**: Headless UI, Radix UI
- **Icons**: Lucide React
- **Code Editor**: Monaco Editor

### Infrastructure
- **Package Manager**: pnpm workspaces
- **Authentication**: JWT (cloud mode)
- **Real-time**: Server-Sent Events (SSE)
- **File System**: Node.js fs/promises

---

## Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style (use ESLint/Prettier)
- Write meaningful commit messages
- Add tests for new features
- Update documentation as needed
- Ensure all tests pass before submitting PR

---

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/to-nexus/ant/issues)
- **Documentation**: [Browse the docs](https://github.com/to-nexus/ant/tree/main/docs)
- **Email**: support@ant.works

---

## Acknowledgments

- Built with ❤️ by the Nexus team
- Powered by [LangChain](https://langchain.com) and [LangGraph](https://github.com/langchain-ai/langgraph)
- UI components from [Tailwind CSS](https://tailwindcss.com), [Headless UI](https://headlessui.dev), and [Radix UI](https://radix-ui.com)

---

**ANT Works** - Transform your development workflow with AI 🚀
