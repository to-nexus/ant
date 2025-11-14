# Environment Variables

## Required Variables

Create a `.env` file in `packages/ant-cli/` with the following variables:

```bash
# Server Configuration
ANT_SERVER_MODE=local       # 'local' or 'cloud'
PORT=4100                   # Server port
WORKSPACE_ROOT=../../workspaces  # workspaces/local/ for local, workspaces/<org>/<user>/ for cloud
CLOUD_URL=https://ant.nexus.ai  # Cloud service URL

# LLM Configuration
AI_MODEL_PROVIDER=openai
AI_MODEL_NAME=gpt-4

# API Keys
OPENAI_API_KEY=sk-...
```

## All Variables

```bash
# ========================================
# Server Configuration
# ========================================
ANT_SERVER_MODE=local       # 'local' or 'cloud'
PORT=4100
WORKSPACE_ROOT=../../workspaces
CLOUD_URL=https://ant.nexus.ai

# ========================================
# LLM Configuration
# ========================================
AI_MODEL_PROVIDER=openai
AI_MODEL_NAME=gpt-4
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# ========================================
# Cloud Mode Only
# ========================================
REDIS_URL=redis://localhost:6379
VECTOR_DB_URL=http://localhost:8000

# ========================================
# Development
# ========================================
NODE_ENV=development
LOG_LEVEL=info
```

