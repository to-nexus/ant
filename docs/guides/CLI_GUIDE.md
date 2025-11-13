# CLI Guide

## Command Structure

```bash
npm run dev -- <agent> <task> [options] <input>
```

## Agents

### architect (`arch`)

Design and code generation with autonomous error resolution.

**Tasks:**
- `design` - Generate architecture design from PRD
- `code` - Generate code from design (auto-detects mode)
- `learn` - Learn repository patterns

**Options:**
- `--mode <mode>` - Code generation mode (optional, auto-inferred)
  - `generate` - Create new code
  - `edit` - Modify existing code
  - `refactor` - Restructure code
- `--eval` - Run evaluation after code generation
- `--project <name>` - Override auto-detected project

**Examples:**

```bash
# Design from PRD
npm run dev -- arch design workspace/my-app/auth/

# Code generation (mode auto-inferred)
npm run dev -- arch code workspace/my-app/auth/

# Code with evaluation
npm run dev -- arch code workspace/my-app/auth/ --eval

# Explicit mode
npm run dev -- arch code workspace/my-app/auth/ --mode refactor

# Learn from codebase
npm run dev -- arch learn workspace/my-app/common/inputs/directives/learn/directive.md
```

---

### reviewer (`review`)

Code review and quality analysis.

**Options:**
- `--pr <number>` - Pull request number
- `--project <name>` - Override project

**Examples:**

```bash
# Review directory
npm run dev -- review workspace/my-app/auth/

# Review PR
npm run dev -- review workspace/my-app/auth/ --pr 123
```

---

### planner (`plan`)

Project planning and sprint breakdown.

**Examples:**

```bash
npm run dev -- plan workspace/my-app/requirements.md
```

---

### doc

Documentation generation.

**Examples:**

```bash
npm run dev -- doc workspace/my-app/
```

---

## Input Resolution

CLI automatically resolves input files based on task type.

### Design Task

Uses PRD from `inputs/sources/prd.md`:

```
workspace/project/feature/inputs/sources/
└── prd.md
```

Optional directive from `inputs/directives/design/`:

```
workspace/project/feature/inputs/directives/design/
├── directive.md        ← Used if no numbered files
└── directive-N.md      ← Highest N used
```

### Code Task

Uses latest design document from `outputs/design/`:

```
workspace/project/feature/outputs/design/
└── design-*.md         ← Latest selected automatically
```

Optional code directive from `inputs/directives/code/`:

```
workspace/project/feature/inputs/directives/code/
└── directive.md
```

### Learn Task

Uses learn directive:

```
workspace/project/common/inputs/directives/learn/
└── directive.md
```

---

## Project Auto-Detection

Project name extracted from path:

```
workspace/my-app/...       → Project: my-app
workspace/cross-ramp/...   → Project: cross-ramp
```

Override with `--project`:

```bash
npm run dev -- arch design workspace/my-app/auth/ --project custom-name
```

---

## Code Generation Modes

Mode is **automatically inferred** from directive keywords. Override with `--mode`.

### Mode Inference Priority

1. **Directive keywords** (highest)
   - "explain", "describe" → `explain`
   - "refactor", "restructure", "migrate" → `refactor`
   - Default → `generate`
2. **Design document** (if no directive)
3. **Git changes** (if present → `refactor`)

### Generate (default)

Create new code or add features:

```bash
npm run dev -- arch code workspace/my-app/auth/
# Directive: "Add JWT authentication"
# → Mode: generate (auto-inferred)
```

### Edit

Modify existing code:

```bash
npm run dev -- arch code workspace/my-app/auth/
# Directive: "Refactor error handling in auth routes"
# → Mode: refactor (auto-inferred)
```

### Explain

Analyze and explain:

```bash
npm run dev -- arch code workspace/my-app/auth/
# Directive: "Explain authentication flow"
# → Mode: explain (auto-inferred)
```

---

## Workspace Structure

```
workspace/
  project/
    config.json
    feature/
      inputs/
        directives/
          design/directive.md
          code/directive.md
        sources/prd.md
      outputs/
        design/design-*.md
        reports/architect-code-*.log
        eval/report.md         # If --eval used
      session.json
```

Generated code written to repository root (`src/`, `lib/`), not `workspace/outputs/`.

---

## Configuration

### Workspace Config (`workspace/project/config.json`)

```json
{
  "projectName": "my-app",
  "branchBase": "main",
  "autoLearn": true,
  "strictValidation": true,
  "runTests": false,
  "llmProvider": "anthropic",
  "llmModel": "claude-3-5-sonnet-20241022"
}
```

### Environment Variables

```bash
# LLM API keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Vector DB
CHROMA_URL=http://localhost:8000

# Optional
NODE_ENV=development

# Recursion Limit (default: 50)
# Controls maximum graph execution steps before pause
# Higher values = more tasks per run, but may hit API rate limits
RECURSION_LIMIT=10
```

**Recursion Limit Configuration:**
- **Default**: 50 (recommended for most cases)
- **Minimum**: 10 (enforced for safety)
- **Suggested values**:
  - `25-50`: Standard tasks (balanced)
  - `100-200`: Large projects (requires higher API limits)
  - `10-20`: Testing/debugging
- When limit is reached, session is saved and can be resumed with the same command

---

## Output Files

### Design Task

```
workspace/project/feature/outputs/design/
└── design-project-<timestamp>.md
```

### Code Task

Generated files written to repository:
```
src/
lib/
app/
components/
...
```

Session saved:
```
workspace/project/feature/session.json
```

Report:
```
workspace/project/feature/outputs/reports/
└── architect-code-<timestamp>.log
```

Evaluation (if `--eval`):
```
workspace/project/feature/outputs/eval/
├── report.md
└── report.json
```

---

## Full Workflow Example

```bash
# 1. Initialize (auto-created if not exists)
npm run dev -- arch design workspace/my-app/auth/

# 2. Edit PRD
vim workspace/my-app/auth/inputs/sources/prd.md

# 3. Generate design
npm run dev -- arch design workspace/my-app/auth/

# 4. Generate code
npm run dev -- arch code workspace/my-app/auth/ --eval

# 5. Check results
cat workspace/my-app/auth/outputs/reports/architect-code-*.log
cat workspace/my-app/auth/outputs/eval/report.md

# 6. Review generated code
git diff

# 7. Continue if interrupted (resumes from checkpoint)
npm run dev -- arch code workspace/my-app/auth/
```

---

## Resuming After Interruption

If execution is interrupted (recursion limit, error, Ctrl+C), state is saved to `session.json`. 

**Resume**:
```bash
# Run same command again
npm run dev -- arch code workspace/my-app/auth/
```

System will:
1. Load state from checkpoint
2. Restore task queue
3. Continue from last completed task

**Clear and restart**:
```bash
rm workspace/my-app/auth/session.json
npm run dev -- arch code workspace/my-app/auth/
```

---

## Troubleshooting

### No design document found

**Error**: `⚠️ No design document or directive found`

**Solution**: Run design task first or check paths:
```bash
npm run dev -- arch design workspace/my-app/auth/
ls workspace/my-app/auth/outputs/design/
```

### Project not detected

**Error**: `Failed to detect project`

**Solution**: Ensure path starts with `workspace/`:
```bash
# Bad
npm run dev -- arch code my-app/auth/

# Good
npm run dev -- arch code workspace/my-app/auth/
```

### ChromaDB connection failed

**Error**: `Failed to connect to vector database`

**Solution**: Start ChromaDB:
```bash
cd src/periphery/integrations/vector-memory
docker-compose up -d
```

### Session corrupted

**Error**: `Failed to load session`

**Solution**: Delete and restart:
```bash
rm workspace/my-app/auth/session.json
npm run dev -- arch code workspace/my-app/auth/
```

---

## Help

Show help:

```bash
npm run dev -- --help
npm run dev -- architect --help
npm run dev -- arch design --help
```
