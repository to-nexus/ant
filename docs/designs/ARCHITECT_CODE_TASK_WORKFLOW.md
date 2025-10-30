# Architect Agent: Code Task Complete Workflow

**Date**: 2025-10-30  
**Version**: 3.0 (Self-Healing Planner Pattern with Task Queue)

---

## Overview

Complete workflow showing **Self-Healing Planner** pattern:
1. **Decompose**: Meta-level planning (spec → tasks)
2. **Plan**: Task-level planning + dynamic queue management
3. **Execute**: Code generation
4. **Validate**: Static (fast) + Dynamic (build/lint)
5. **Enforce**: Error analysis + learning feedback
6. **Self-Healing**: Automatic error categorization and retry strategy

---

## What is Self-Healing Planner?

A pattern where the agent:
- 🔄 **Learns from failures**: Structured error tracking
- 🧠 **Adapts strategy**: Decides between retry vs task decomposition
- 📊 **Prioritizes intelligently**: Blocking errors first, features second
- 💾 **Remembers patterns**: Saves enforcement feedback for future learning

### Key Principles

| Principle | Implementation |
|-----------|----------------|
| **Iterative Refinement** | Retry with previous context + feedback |
| **Self-Diagnosis** | LLM analyzes violation types and severity |
| **Task Decomposition** | Creates sub-tasks when retry won't work |
| **Priority Scheduling** | Fixed priority rules (errors: 1-100, features: 200-299) |
| **Stateful Retry** | Session-based context + enforcement history |

---

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. RESOLVE: Load inputs & analyze codebase                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. DECOMPOSE: Meta-level planning (ONCE)                   │
│    Spec → Feature Tasks (priority queue)                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. TASK LOOP (Self-Healing)                                │
│    ┌──────────────────────────────────────┐               │
│    │ Pop task from queue                  │               │
│    │  ↓                                    │               │
│    │ PLAN: Generate execution plan        │               │
│    │  ↓                                    │               │
│    │ EXECUTE: Generate code               │               │
│    │  ↓                                    │               │
│    │ VALIDATE (static): Check patterns    │               │
│    │  ↓                                    │               │
│    │ POSTPROCESS: Install deps & write    │               │
│    │  ↓                                    │               │
│    │ DYNAMICVALIDATE: Build & lint        │               │
│    │  ↓                                    │               │
│    │ If ❌ violations:                    │               │
│    │   → ENFORCE: Analyze errors          │               │
│    │   → Check isRetryable flag           │               │
│    │   → PLAN: Decide strategy            │               │
│    │      • Retry (if minor errors)       │               │
│    │      • Add error tasks (if blocking) │               │
│    │   → Back to PLAN                     │               │
│    │                                        │               │
│    │ If ✅ success:                       │               │
│    │   → Mark task completed              │               │
│    │   → Next task                        │               │
│    └──────────────────────────────────────┘               │
│                                                             │
│    Until: Queue empty OR max retries                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. EVALUATE & LEARN                                         │
│    Quality metrics → Branch → Vector DB storage            │
└─────────────────────────────────────────────────────────────┘
```

---

## Detailed Node-by-Node Flow

### Stage 1: Resolve (Initialization)

```
┌──────────┐
│ resolve  │  Load all inputs and prepare context
└──────────┘
    │
    ├─ Load: PRD, Design, Directive
    ├─ Retrieve: Relevant codebase via CodebaseRetriever
    ├─ Analyze: Project profile (language/framework)
    └─ Output: { prd, design, directive, code, codeHead, profile }
```

**Purpose**: Gather all necessary context for planning  
**Duration**: ~5-10 seconds (vector search + file loading)

---

### Stage 2: Decompose (Meta-Level Planning)

```
┌────────────┐
│ decompose  │  Break specification into executable tasks (ONCE)
└────────────┘
    │
    ├─ Input: { prd, design, directive }
    │
    ├─ LLM Task: Analyze requirements → Create feature tasks
    │   │
    │   └─ Returns: Task[]
    │       [
    │         {
    │           "id": "auth-impl",
    │           "name": "Implement User Authentication",
    │           "type": "feature",
    │           "priority": 250,
    │           "description": "Login, signup, JWT, protected routes"
    │         },
    │         {
    │           "id": "todo-crud",
    │           "name": "Build Todo CRUD API",
    │           "type": "feature",
    │           "priority": 240,
    │           "description": "CRUD operations for todo items"
    │         }
    │       ]
    │
    ├─ Create: TaskQueue (priority-sorted)
    ├─ Store: featureTasks Map (for completion tracking)
    └─ Output: { taskQueue, featureTasks, completedTasks: [] }
```

**Key Point**: This runs ONCE at the beginning. All feature tasks are created here.

**Task Priority Rules**:
```typescript
TASK_PRIORITIES = {
  // Feature Tasks (200-299)
  FEATURE_CRITICAL: 280,
  FEATURE_IMPORTANT: 250,
  FEATURE_NORMAL: 220,
  FEATURE_NICE_TO_HAVE: 200,
  
  // Error Tasks (1-100)
  ERROR_MISSING_ENTRY: 95,      // index.html etc
  ERROR_MISSING_DEPS: 90,       // npm packages
  ERROR_CONFIG: 80,             // tsconfig.json
  ERROR_TYPE: 70,               // TypeScript errors
  ERROR_IMPORT: 65,             // Import errors
  ERROR_BUILD: 60,              // Build errors
  ERROR_SYNTAX: 50,             // Syntax errors
  ERROR_LINT: 30,               // Lint errors
  ERROR_OTHER: 20,              // Misc
}
```

---

### Stage 3: Task Loop (Self-Healing Pattern)

#### Node 1: Plan (Task-Level Planning)

```
┌──────┐
│ plan │  Generate execution plan for current task
└──────┘
    │
    ├─ Pop next task from queue (highest priority)
    │
    ├─ If retry (has violations):
    │   │
    │   ├─ Check Retry Heuristic:
    │   │   │
    │   │   ├─ All violations.isRetryable === true?
    │   │   │   → Simple retry (no LLM call)
    │   │   │
    │   │   └─ Has blocking errors (missing_dependency, missing_file)?
    │   │       → Call LLM for error analysis
    │   │
    │   └─ LLM Decision:
    │       {
    │         "action": "add_tasks" | "retry",
    │         "reason": "...",
    │         "newTasks": [
    │           {
    │             "id": "fix-deps-1",
    │             "name": "Install Missing Dependencies",
    │             "type": "error",
    │             "priority": 90,
    │             "description": "Install react, react-dom, etc",
    │             "errors": ["Cannot find module 'react'", ...]
    │           }
    │         ]
    │       }
    │
    ├─ If action === "add_tasks":
    │   ├─ Add error tasks to queue (high priority)
    │   ├─ Re-queue current task
    │   └─ Pop again (now error task comes first)
    │
    ├─ Generate Execution Plan:
    │   │
    │   └─ LLM Input:
    │       - Current task description
    │       - Feature tasks status (for context)
    │       - Queue status
    │       - Previous violations (if retry)
    │       - Previous attempts history
    │       - PRD/Design/Directive
    │       - Current codebase
    │
    └─ Output: { planText, currentTask, retries: 0 }
```

**Retry Heuristic Logic**:
```typescript
// Check if all errors are retryable
const allRetryable = violations.every(v => v.isRetryable === true);
const hasBlockingErrors = violations.some(v => 
  v.type === 'missing_dependency' || 
  v.type === 'missing_file' || 
  v.type === 'config_error'
);

if (allRetryable && !hasBlockingErrors) {
  // Just retry - no need to call LLM
  return { currentTask: nextTask, retries: 0 };
} else {
  // Need LLM to analyze and decide strategy
  // ... (call LLM for error analysis)
}
```

---

#### Node 2: Execute (Code Generation)

```
┌─────────┐
│ execute │  Generate code based on plan
└─────────┘
    │
    ├─ LLM Input:
    │   - Execution plan (from plan node)
    │   - Current task description
    │   - Codebase context
    │   - Profile (language/framework conventions)
    │
    ├─ LLM Generates:
    │   - New files
    │   - Modified files
    │   - Files to delete
    │
    ├─ Parse Response:
    │   └─ Extract files from markdown blocks
    │
    ├─ Record Attempt:
    │   {
    │     attemptNumber: N,
    │     filesGenerated: ["auth.ts", "api.ts"],
    │     keyChanges: ["Added dependencies: react, express"],
    │     subtaskName: "Implement Auth",
    │     errorsAttemptedToFix: [...]
    │   }
    │
    └─ Output: { files, filesToDelete, previousAttempts }
```

---

#### Node 3: Validate (Static Checks)

```
┌──────────┐
│ validate │  Fast static validation (no build)
└──────────┘
    │
    ├─ Check 1: Files generated?
    │   └─ If no files → Violation { type: 'no_files', isRetryable: true }
    │
    ├─ Check 2: Ellipsis patterns (...)
    │   └─ If found → Violation { type: 'ellipsis', isRetryable: true }
    │
    ├─ Check 3: Excessive deletion (< 70% of original)
    │   └─ If found → Violation { type: 'excessive_deletion', isRetryable: true }
    │
    └─ Output: { violations: Violation[] }
```

**Violation Structure**:
```typescript
interface Violation {
  type: ViolationType;           // error category
  severity: 'critical' | 'major' | 'minor';
  message: string;
  file?: string;
  suggestedFix?: string;
  isRetryable?: boolean;         // 🔑 KEY for retry heuristic
  module?: string;
}
```

**Decision**:
- If violations → `enforce`
- If OK → `postProcess` (install deps)

---

#### Node 4: PostProcess (Dependency Installation)

```
┌──────────────┐
│ postProcess  │  Write files + Install dependencies
└──────────────┘
    │
    ├─ 1. Write all files to disk
    │   └─ Required for dynamicValidate to check
    │
    ├─ 2. If package.json changed:
    │   │
    │   ├─ Detect package manager (npm/pnpm/yarn)
    │   └─ Run: npm install
    │       │
    │       ├─ Success → Continue
    │       │
    │       └─ Failure → Violation
    │           {
    │             type: 'missing_dependency',
    │             severity: 'critical',
    │             message: "Dependency install failed...",
    │             isRetryable: false  // Needs package.json fix
    │           }
    │
    └─ Output: { violations (if any) }
```

---

#### Node 5: DynamicValidate (Build & Lint)

```
┌─────────────────┐
│ dynamicValidate │  Run actual build/lint/type-check
└─────────────────┘
    │
    ├─ 1. TypeScript type-check (tsc --noEmit)
    │   └─ Failures → Violation { type: 'type_error', isRetryable: true }
    │
    ├─ 2. ESLint (if configured)
    │   └─ Failures → Violation { type: 'lint_error', severity: 'minor', isRetryable: true }
    │
    ├─ 3. Build (npm run build)
    │   │
    │   ├─ Missing entry file (index.html) → Violation
    │   │   {
    │   │     type: 'missing_file',
    │   │     severity: 'critical',
    │   │     file: 'index.html',
    │   │     suggestedFix: 'Create the missing entry file',
    │   │     isRetryable: false  // Needs file creation
    │   │   }
    │   │
    │   ├─ Missing module (react) → Violation
    │   │   {
    │   │     type: 'missing_dependency',
    │   │     severity: 'critical',
    │   │     module: 'react',
    │   │     suggestedFix: 'Install missing dependency',
    │   │     isRetryable: false  // Needs package.json update
    │   │   }
    │   │
    │   └─ Other build errors → Violation
    │       { type: 'build_error', isRetryable: false }
    │
    └─ Output: { violations: Violation[], dynamicValidationResult }
```

**Decision Logic**:
```typescript
if (no violations) {
  // ✅ Task succeeded!
  if (currentTask.type === 'feature') {
    // Mark feature as completed
    featureTasks.get(currentTask.id).completed = true;
  } else if (currentTask.type === 'error') {
    // Remove all error tasks (errors resolved)
    taskQueue.removeType('error');
  }
  
  if (taskQueue.isEmpty()) {
    return "evaluate";  // All done!
  } else {
    return "plan";  // Next task
  }
} else if (retries < maxRetries) {
  return "enforce";  // Try to fix
} else if (!taskQueue.isEmpty()) {
  // Skip this task, try next
  return "plan";
} else {
  return "evaluate";  // Give up
}
```

---

#### Node 6: Enforce (Error Analysis & Learning)

```
┌─────────┐
│ enforce │  Analyze violations & save feedback
└─────────┘
    │
    ├─ 1. Format violations for LLM
    │   │
    │   └─ Example:
    │       1. [CRITICAL] missing_file: index.html does not exist
    │          File: index.html
    │          💡 Suggested Fix: Create the missing entry file
    │          ♻️  Retryable: NO (needs task decomposition)
    │       
    │       2. [MAJOR] type_error: TypeScript errors (12 total)
    │          💡 Suggested Fix: Fix type errors in code
    │          ♻️  Retryable: YES
    │
    ├─ 2. Check Retry Heuristic
    │   │
    │   └─ All retryable?
    │       - YES → Simple feedback
    │       - NO → Needs error analysis in Plan node
    │
    ├─ 3. Save Enforcement Feedback (for learning)
    │   {
    │     taskId: "auth-impl",
    │     taskName: "Implement Auth",
    │     attemptNumber: 2,
    │     violations: [Violation, ...],
    │     enforcementReason: "...",
    │     fixStrategy: "retry" | "add_tasks" | "skip",
    │     addedTasks: [Task, ...],  // If add_tasks
    │     timestamp: 1234567890
    │   }
    │
    ├─ 4. Increment retries
    │
    └─ Output: 
        { 
          enforcementReason: formatted_violations,
          retries: N+1,
          enforcementHistory: [..., newFeedback]
        }
        → Go to Plan node (for strategy decision)
```

**Enforcement Feedback** is stored for:
1. Vector DB learning (pattern matching)
2. Future error detection
3. Debugging and analysis

---

### Stage 4: Finalization

#### Node 7: Evaluate (Code Quality)

```
┌──────────┐
│ evaluate │  Analyze code quality metrics
└──────────┘
    │
    ├─ Analyze: Complexity, maintainability, comment density
    ├─ Generate: Recommendations
    ├─ Check: Quality thresholds (if configured)
    └─ Save: Report to workspace/outputs/eval/
```

---

#### Node 8: Learn (Knowledge Storage)

```
┌────────┐
│ learn  │  Store learnings + create branch
└────────┘
    │
    ├─ 1. Extract learnings:
    │   - Context (project, feature, mode)
    │   - Codebase profile
    │   - Implementation plan summary
    │   - Files generated
    │   - Violations encountered
    │   - Enforcement feedback history
    │   - Quality metrics
    │
    ├─ 2. Create Git branch
    │   └─ feature/{project}-{timestamp}
    │
    ├─ 3. Save session turn
    │   └─ workspace/{project}/outputs/session.json
    │
    ├─ 4. Chunk and store to Vector DB
    │   └─ Linked to session (for traceability)
    │
    └─ Output: { learnings, branch, filesWritten }
```

---

## Task Queue Management

### Initial State (After Decompose)

```typescript
taskQueue: [
  { id: "auth-impl", name: "Implement Auth", type: "feature", priority: 250 },
  { id: "todo-crud", name: "Todo CRUD", type: "feature", priority: 240 }
]

featureTasks: Map {
  "auth-impl" => { ..., completed: false },
  "todo-crud" => { ..., completed: false }
}
```

### After First Task Fails (Missing Deps)

```typescript
// Plan node adds error tasks
taskQueue: [
  { id: "fix-deps-1", name: "Install Dependencies", type: "error", priority: 90 },
  { id: "auth-impl", name: "Implement Auth", type: "feature", priority: 250 },
  { id: "todo-crud", name: "Todo CRUD", type: "feature", priority: 240 }
]

// Error task is now first (higher priority)
```

### After Error Task Completes

```typescript
// dynamicValidate removes ALL error tasks
taskQueue: [
  { id: "auth-impl", name: "Implement Auth", type: "feature", priority: 250 },
  { id: "todo-crud", name: "Todo CRUD", type: "feature", priority: 240 }
]

// Resume feature tasks
```

### Completion Tracking

```typescript
completedTasks: ["fix-deps-1", "auth-impl"]

featureTasks: Map {
  "auth-impl" => { ..., completed: true },   // ✅
  "todo-crud" => { ..., completed: false }   // ⏳
}
```

---

## Key Improvements from Previous Version

| Aspect | v2.0 (Dual-Track) | v3.0 (Self-Healing) |
|--------|-------------------|---------------------|
| **Error Structure** | `string[]` | `Violation[]` (typed) |
| **Retry Logic** | Fixed retries | Smart heuristic (`isRetryable`) |
| **Task Decomposition** | Manual in Plan node | Separate Decompose node |
| **Learning** | Basic attempt history | Enforcement feedback with strategy |
| **Priority** | Ad-hoc | Fixed rules (`TASK_PRIORITIES`) |
| **Error Analysis** | Every failure | Only for blocking errors |
| **Pattern Name** | Dual-Track Subtask | Self-Healing Planner |

---

## Example Execution Trace

### Scenario: Build React Todo App

#### 1. Decompose Output
```json
{
  "tasks": [
    {
      "id": "setup-project",
      "name": "Setup Project Structure",
      "type": "feature",
      "priority": 280,
      "description": "Vite + React + TypeScript setup"
    },
    {
      "id": "todo-ui",
      "name": "Build Todo UI",
      "type": "feature",
      "priority": 250
    }
  ]
}
```

#### 2. First Task: "Setup Project Structure"

**Plan → Execute → Validate (✅) → PostProcess → DynamicValidate**

DynamicValidate fails:
```typescript
violations: [
  {
    type: 'missing_file',
    severity: 'critical',
    file: 'index.html',
    message: 'Could not resolve entry module "index.html"',
    suggestedFix: 'Create the missing entry file',
    isRetryable: false  // ← Blocking error
  }
]
```

**Enforce → Plan (Error Analysis)**

Plan node checks retry heuristic:
```typescript
const hasBlockingErrors = true;  // missing_file
// → Call LLM for analysis
```

LLM Decision:
```json
{
  "action": "add_tasks",
  "reason": "Missing critical entry file - needs separate task",
  "newTasks": [
    {
      "id": "fix-entry-1",
      "name": "Create Missing index.html",
      "type": "error",
      "priority": 95,
      "description": "Create Vite entry file with React root",
      "errors": ["Could not resolve entry module 'index.html'"]
    }
  ]
}
```

Queue updates:
```typescript
// Before
taskQueue: [
  "setup-project" (250),
  "todo-ui" (250)
]

// After
taskQueue: [
  "fix-entry-1" (95),      // ← Added, highest priority!
  "setup-project" (250),   // ← Re-queued
  "todo-ui" (250)
]
```

#### 3. Second Iteration: "Create Missing index.html"

**Plan → Execute → Validate (✅) → PostProcess → DynamicValidate (✅)**

Task completes! Queue updated:
```typescript
// Error task done → Remove ALL error tasks
taskQueue: [
  "setup-project" (250),
  "todo-ui" (250)
]

completedTasks: ["fix-entry-1"]
```

#### 4. Third Iteration: "Setup Project Structure" (Retry)

**Plan → Execute → Validate (✅) → PostProcess → DynamicValidate (✅)**

Task completes! Feature marked:
```typescript
featureTasks: Map {
  "setup-project" => { completed: true },  // ✅
  "todo-ui" => { completed: false }
}

completedTasks: ["fix-entry-1", "setup-project"]
```

#### 5. Fourth Iteration: "Build Todo UI"

**Plan → Execute → Validate (✅) → PostProcess → DynamicValidate**

Minor type errors:
```typescript
violations: [
  {
    type: 'type_error',
    severity: 'major',
    message: 'TypeScript errors (3 total)...',
    isRetryable: true  // ← Retryable!
  }
]
```

**Enforce → Plan (Retry Heuristic)**

```typescript
const allRetryable = true;
const hasBlockingErrors = false;
// → Simple retry (no LLM call)
```

**Plan → Execute → ... → DynamicValidate (✅)**

All done! Queue empty → Evaluate → Learn

---

## Enforcement Feedback Example

After completion, `enforcementHistory` contains:
```typescript
[
  {
    taskId: "setup-project",
    taskName: "Setup Project Structure",
    attemptNumber: 1,
    violations: [
      { type: 'missing_file', severity: 'critical', ... }
    ],
    enforcementReason: "Missing critical entry file",
    fixStrategy: "add_tasks",
    addedTasks: [
      { id: "fix-entry-1", name: "Create index.html", ... }
    ],
    timestamp: 1730280000000
  },
  {
    taskId: "todo-ui",
    taskName: "Build Todo UI",
    attemptNumber: 1,
    violations: [
      { type: 'type_error', severity: 'major', ... }
    ],
    enforcementReason: "TypeScript type errors",
    fixStrategy: "retry",
    timestamp: 1730280120000
  }
]
```

This history is:
1. Stored in session
2. Saved to Vector DB (for pattern learning)
3. Used for future error detection

---

## Benefits of Self-Healing Pattern

### 1. **Reduced LLM Calls**
- Retry heuristic avoids calling LLM for trivial errors (ellipsis, minor types)
- Cost savings: ~30-40% fewer calls

### 2. **Smarter Error Handling**
- Structured violations enable pattern matching
- Can learn "missing index.html in Vite projects" pattern

### 3. **Stable Priority Management**
- Fixed rules prevent queue explosion
- Blocking errors always handled first

### 4. **Complete Traceability**
- Enforcement feedback tracks every decision
- Can replay failures for debugging

### 5. **Incremental Improvement**
- Vector DB accumulates patterns over time
- Future projects benefit from past learnings

---

## Configuration

### Task Priorities

Defined in `src/agents/architect/graph/code/state.ts`:
```typescript
export const TASK_PRIORITIES = {
  FEATURE_CRITICAL: 280,
  FEATURE_IMPORTANT: 250,
  FEATURE_NORMAL: 220,
  FEATURE_NICE_TO_HAVE: 200,
  
  ERROR_MISSING_ENTRY: 95,
  ERROR_MISSING_DEPS: 90,
  ERROR_CONFIG: 80,
  ERROR_TYPE: 70,
  ERROR_IMPORT: 65,
  ERROR_BUILD: 60,
  ERROR_SYNTAX: 50,
  ERROR_LINT: 30,
  ERROR_OTHER: 20,
};
```

### Max Retries

Default: 3 per task  
Can be configured in workspace config.

### Validation

- Static validation: Always enabled
- Dynamic validation: Enabled by default (`strictValidation: true`)
- Disable: Set `strictValidation: false` in config

---

## Troubleshooting

### Issue: Task keeps retrying same error

**Cause**: LLM not generating correct fix  
**Solution**: Check `enforcementHistory` to see what was tried. May need better prompt or manual intervention.

### Issue: Queue grows infinitely

**Cause**: LLM creating too many error tasks  
**Solution**: Check `TASK_PRIORITIES`. Ensure error tasks have priority < 100.

### Issue: Build fails but no error task created

**Cause**: `isRetryable` incorrectly set to `true`  
**Solution**: Review `dynamicValidate.ts` violation generation logic.

---

## Comparison to Industry Systems

| System | Pattern | Similar To Ours? |
|--------|---------|------------------|
| **Claude Projects** | Retry + dependency suggestion | ✅ Very similar |
| **SWE-Agent** | plan → edit → test → replan loop | ✅ Same structure |
| **Devin** | Queue + retry chain | ✅ Queue-based |
| **AutoGPT** | Task decomposition + queue | ✅ Task queue |

Our implementation is a **production-ready version** of patterns used by leading AI coding systems.

---

## Future Enhancements

1. **Pattern Library**: Pre-built error patterns (e.g., "Vite needs index.html")
2. **Parallel Tasks**: Execute independent tasks simultaneously
3. **Cost Tracking**: Monitor LLM token usage per task
4. **Confidence Scores**: LLM provides confidence for retry decisions
5. **Rollback**: Undo task if quality degrades

---

## Conclusion

The **Self-Healing Planner Pattern** provides:
- ✅ Systematic error handling
- ✅ Cost-effective retries
- ✅ Learning from failures
- ✅ Production-grade stability

This is the foundation for a truly autonomous code generation system.
