# AI Dev Framework

AI-powered development framework for automated architecture design, code generation, and iterative refinement.

### Author: Harvey(probe@to.nexus)

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Environment Variables

Create `.env` file:

```bash
# Global AI Model Configuration (모든 에이전트 기본값)
AI_MODEL_PROVIDER=openai        # 'openai' or 'anthropic'
AI_MODEL_NAME=gpt-4o            # Optional, uses defaults if not set

# Agent별 개별 설정 (선택사항)
ARCHITECT_MODEL_PROVIDER=openai
ARCHITECT_MODEL_NAME=gpt-4o
ARCHITECT_MODEL_MAX_TOKENS=16000

REVIEWER_MODEL_PROVIDER=anthropic
REVIEWER_MODEL_NAME=claude-3-haiku-20240307

PLANNER_MODEL_PROVIDER=openai
PLANNER_MODEL_NAME=gpt-4o

DOC_MODEL_PROVIDER=anthropic
DOC_MODEL_NAME=claude-3-haiku-20240307

# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GIT_TOKEN=ghp_...

# Vector Database
CHROMA_URL=http://localhost:8000
EMBEDDER_URL=http://localhost:8001
```

**Model Options:**
- OpenAI: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`
- Anthropic: `claude-3-opus-20240229`, `claude-3-sonnet-20240229`, `claude-3-haiku-20240307`

**Default Models:**
- OpenAI: `gpt-4o` (16,000 tokens)
- Anthropic: `claude-3-haiku-20240307` (4,000 tokens)

**Agent별 설정 우선순위:**
1. `{AGENT}_MODEL_PROVIDER` (예: `ARCHITECT_MODEL_PROVIDER`)
2. `AI_MODEL_PROVIDER` (전역 설정)
3. 기본값 (`openai`)

### 3. Vector Database (Docker)

Start ChromaDB and Embedding Server:

```bash
cd vector-memory
docker-compose up -d
```

This starts:
- ChromaDB on port 8000
- Embedding server (all-MiniLM-L6-v2) on port 8001

### 4. Project Configuration

Create `projects/<project-name>/config.json`:

```json
{
  "repoType": "local",
  "localPath": "/path/to/target-repo",
  "branchBase": "main"
}
```

## Usage

### Architect Quickstart (Primary)

```bash
# 1) Generate/refresh design from PRD
pnpm tsx src/index.ts arch-design projects/<project>/<feature>/prd/spec.md

# 2) Generate code from latest design (+ optional directive)
pnpm tsx src/index.ts arch-code projects/<project>/<feature>

# 3) Review
# - Inspect changes in the target repo via `git diff`
# - Read report: projects/<project>/<feature>/generated/reports/code-generation-report-*.md
```

Key behaviors (Architect):
- Plan → Code two-phase flow using the latest design.
- Uses COMPLETE HEAD originals as the modification base (no truncation).
- Minimal-change invariant: preserve structure/logic; style-only edits don’t refactor logic.
- Strict output rules: pure code (no backticks/markdown), actual paths, COMPLETE files (no ellipsis).
- Type-safety defaults: guard possibly-undefined (e.g., `projectId ?? ''`, `language ?? 'en'`), consistent null→undefined.
- Required integrations auto-inferred from design/plan and enforced with a guided retry.
- Excessive deletion or skipped code triggers a single stricter regeneration.

See detailed architecture: docs/project-architecture.md

### Workflow

```bash
# 1. Generate Design
pnpm tsx src/index.ts arch-design projects/cross-ramp/feature-ui-1.2.0/prd/spec.md

# 2. (Optional) Add Design Directive
cat > projects/cross-ramp/feature-ui-1.2.0/directives/design/directive-1.md << EOF
- Use Zustand for state management
- Prefer functional components
EOF

# 3. Generate Code (with learning & report)
pnpm tsx src/index.ts arch-code projects/cross-ramp/feature-ui-1.2.0
# → Generates code, extracts principles, stores in ChromaDB, creates report

# 4. Review generated code
cd /path/to/target-repo
git diff
# Check: projects/cross-ramp/feature-ui-1.2.0/generated/reports/code-generation-report-*.md

# 5. (Optional) Create directive file and regenerate
cat > projects/cross-ramp/feature-ui-1.2.0/directives/code/directive-1.md << EOF
- Add error handling for all async operations
- Use more descriptive function names
EOF

pnpm tsx src/index.ts arch-code projects/cross-ramp/feature-ui-1.2.0
# → Automatically reads directives, regenerates code, learns new principles, creates new report

# 6. (Optional) Learn from codebase
cat > projects/cross-ramp/feature-ui-1.2.0/directives/learn/directive-1.md << EOF
- target: /path/to/repo/src/components
- focus: 컴포넌트 구조와 상태 관리 패턴 분석
- aspects:
  - 컴포넌트 분리 기준
  - 상태 관리 방식
  - 성능 최적화 패턴
EOF

pnpm tsx src/index.ts arch-learn projects/cross-ramp/feature-ui-1.2.0
# → Analyzes target code, extracts principles, stores in ChromaDB

# 7. (Optional) More iterations
cat > projects/cross-ramp/feature-ui-1.2.0/directives/code/directive-2.md << EOF
- Improve error messages
EOF

pnpm tsx src/index.ts arch-code projects/cross-ramp/feature-ui-1.2.0

# 8. Final commit
cd /path/to/target-repo
git commit -m "feat: implement feature"
git push origin feature/feature-ui-1.2.0
```

**Auto-detection:**
- Project: `projects/cross-ramp/...` → `cross-ramp`
- Design: Latest `generated/design/design-*.md`
- Code Directive: Latest `directives/code/directive-N.md` by number (automatically detected)
- Branch: Reused if exists

**Directive Structure:**
```
directives/
├── code/              # Code generation/modification directives
│   └── directive-N.md
├── design/            # Design-related directives
│   └── directive-N.md
└── learn/            # Learning directives
    └── directive-N.md
```

Higher number (N) = latest version

### Recent Updates (Architect Agent)
- Uses COMPLETE original files from HEAD (no truncation) as the modification base.
- Two-phase flow in arch-code: Plan (with latest design) → Implementation.
- Directive is treated as incremental changes; prior integrations aren’t rolled back.
- Strict output rules: pure code (no backticks), actual paths, COMPLETE files (no ellipsis).
- Minimal-change invariant: preserve structure/logic; style-only edits don’t refactor logic.
- Type safety: guard possibly-undefined (e.g., projectId ?? '', language ?? 'en'); consistent null→undefined boundary.
- Required integrations auto-inferred from design/plan; enforced post-generation with one guided retry.
- Output validation: detects excessive deletions or skipped code and retries once with stricter instructions.
- Architect model tuned for consistency (lower temperature by default).

### Commands

| Command | Description |
|---------|-------------|
| `arch-design` | PRD → System design document |
| `arch-code` | Design → Code (modified, not staged) + Learning + Report |
| `arch-learn` | Analyze and learn from target codebase |
| `feedback` | Design directive → ChromaDB |
| `review` | Code review |

## Features

- **Two-stage workflow**: Design review before code generation
- **Always learning**: Every `arch-code` execution extracts principles and stores in ChromaDB
- **AI reports**: Every code generation creates a detailed report with thinking process
- **Manual control**: Code modified only (not staged/committed) - review with `git diff`
- **Branch naming**: Uses feature folder name (e.g., `feature/feature-ui-1.2.0`)
- **Multi-file generation**: Updates/creates multiple files in actual project structure
- **Directive-driven improvement**: Optional code-directive files for iterative refinement with highest priority

### Generated Files Structure

```
projects/<project>/<feature>/
├── prd/
│   └── spec.md                          # Input PRD
├── generated/
│   ├── design/
│   │   └── design-<project>-*.md        # Generated design documents
│   └── reports/
│       ├── code-generation-report-*.md   # Code generation process & learnings
│       └── learning-report-*.md          # Codebase analysis results
└── directives/
    ├── code/                            # Code generation directives
    │   └── directive-N.md
    ├── design/                          # Design directives
    │   └── directive-N.md
    └── learn/                           # Learning directives
        └── directive-N.md                # Learning targets and aspects
```

### Vector Memory (Embeddings + ChromaDB)
- Bring up services: `cd vector-memory && docker-compose up -d`
- Configure via `.env`:
  - `CHROMA_URL` (default http://localhost:8000)
  - `EMBEDDER_URL` (default http://localhost:8001)
- Architect stores learnings after each arch-code run; other agents can query memory for context.
- Details: docs/project-architecture.md#11-embeddings--vector-db-chromadb
