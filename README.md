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
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GIT_TOKEN=ghp_...
CHROMA_URL=http://localhost:8000
```

### 3. ChromaDB (Docker)

```bash
docker run -d -p 8000:8000 chromadb/chroma
```

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

### Workflow

```bash
# 1. Generate Design
pnpm tsx src/index.ts arch-design projects/cross-ramp/feature-ui-1.2.0/prd/spec.md

# 2. (Optional) Design Directive
# Option A: Use directive file
cat > projects/cross-ramp/feature-ui-1.2.0/directives/design-directive-1.md << EOF
- Use Zustand for state management
- Prefer functional components
EOF
pnpm tsx src/index.ts feedback projects/cross-ramp/feature-ui-1.2.0 --directive

# Option B: Use stdin
echo "Use Zustand for state management" | pnpm tsx src/index.ts feedback projects/cross-ramp/feature-ui-1.2.0

# 3. Generate Code (with learning & report)
pnpm tsx src/index.ts arch-code projects/cross-ramp/feature-ui-1.2.0
# → Generates code, extracts principles, stores in ChromaDB, creates report

# 4. Review generated code
cd /path/to/target-repo
git diff
# Check: projects/cross-ramp/feature-ui-1.2.0/generated/reports/code-generation-report-*.md

# 5. (Optional) Create directive file and regenerate
cat > projects/cross-ramp/feature-ui-1.2.0/directives/code-directive-1.md << EOF
- Add error handling for all async operations
- Use more descriptive function names
EOF

pnpm tsx src/index.ts arch-code projects/cross-ramp/feature-ui-1.2.0 --directive
# → Reads directive, regenerates code, learns new principles, creates new report

# 6. (Optional) More iterations
cat > projects/cross-ramp/feature-ui-1.2.0/directives/code-directive-2.md << EOF
- Improve error messages
EOF

pnpm tsx src/index.ts arch-code projects/cross-ramp/feature-ui-1.2.0 --directive

# 7. Final commit
cd /path/to/target-repo
git commit -m "feat: implement feature"
git push origin feature/feature-ui-1.2.0
```

**Auto-detection:**
- Project: `projects/cross-ramp/...` → `cross-ramp`
- Design: Latest `generated/design/design-*.md`
- Code Directive: Latest `directives/code-directive-N.md` by number (with `--directive`)
- Branch: Reused if exists

**Directive file naming:**
- Design directive: `design-directive-1.md`, `design-directive-2.md`, ...
- Code directive: `code-directive-1.md`, `code-directive-2.md`, ...
- Higher number = latest

### Commands

| Command | Description |
|---------|-------------|
| `arch-design` | PRD → System design document |
| `arch-code [--directive]` | Design → Code (modified, not staged) + Learning + Report<br>※ `--directive`: Apply latest code-directive-N.md |
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
│   │   └── design-<project>-*.md       # Generated design documents
│   └── reports/
│       └── code-generation-report-*.md # AI thinking process & learnings
└── directives/
    ├── design-directive-N.md            # Human directives on design
    └── code-directive-N.md              # Human directives on code (HIGHEST PRIORITY)
```
