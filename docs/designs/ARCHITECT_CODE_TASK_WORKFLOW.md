# Architect Code Task Workflow

Technical documentation for the code generation workflow.

## Overview

LangGraph-based workflow that decomposes specifications into tasks, generates code, validates output, and resolves errors through structured retry strategies.

## Graph Structure

```
resolve → decompose → [Task Loop] → evaluate → learn
                          ↓
           ┌─────────────┴─────────────┐
           │ plan → execute → writeFiles →
           │ validate → installDeps →
           │ runtimeValidate
           │   ↓ (if errors)
           │ enforce → plan (retry)
           └─────────────┬─────────────┘
                          ↓
                    (next task or done)
```

## Node Descriptions

### resolve

**Purpose**: Load inputs and analyze codebase

```typescript
resolve(state) {
  // Load artifacts
  const prd = await loadPRD();
  const design = await loadDesign();
  const directive = await loadDirective();
  
  // Load codebase via CodebaseRetriever
  const code = await retriever.retrieve(context);
  
  // Analyze project profile
  const profile = await analyzer.analyze(code);
  
  return { prd, design, directive, code, profile };
}
```

**Output**: All necessary context for planning

---

### decompose

**Purpose**: Break spec into executable tasks (runs once)

```typescript
decompose(state) {
  // Check session for existing tasks
  const session = await deps.session.load(project, feature);
  if (session.state?.taskQueue) {
    // Resume from checkpoint
    return { taskQueue, completedTasks };
  }
  
  // LLM decomposes spec → tasks
  const tasks = await llm.invoke({
    spec: { prd, design, directive },
    instruction: "Break into tasks with priorities"
  });
  
  // Create priority queue
  const taskQueue = new TaskQueue();
  tasks.forEach(t => taskQueue.push(t));
  
  // Add final verification task
  taskQueue.push({
    id: "final-verification",
    type: "feature",
    priority: 999,
    description: "Verify all requirements met"
  });
  
  return { taskQueue, completedTasks: [] };
}
```

**Output**: Priority-sorted task queue

**Task Priorities** (lower = higher priority):
- Setup: 100-149 (config files)
- Errors: 1-99 (blocking issues)
- Features: 200-299 (user requirements)

---

### plan

**Purpose**: Generate execution plan for current task

```typescript
plan(state) {
  // Pop next task from queue
  const nextTask = state.taskQueue.peek();
  if (!nextTask) {
    return { /* queue empty */ };
  }
  
  // For non-setup tasks, reload codebase
  let currentCode = state.code;
  if (nextTask.type !== 'setup') {
    currentCode = await gitPort.listFiles(workDir, {
      exclude: ['node_modules', 'dist', '.git', '*.test.*']
    });
  }
  
  // Generate plan
  const planText = await engine.buildPlanPrompt({
    task: nextTask,
    code: currentCode,
    spec: { prd, design, directive },
    violations: state.violations  // Previous errors if retry
  });
  
  // Save checkpoint
  await saveCheckpoint(state);
  
  return { 
    currentTask: nextTask, 
    planText, 
    code: currentCode,
    retries: 0  // Reset for new task
  };
}
```

**Checkpoint**: Saved after plan generation

---

### execute

**Purpose**: Generate code from plan

```typescript
execute(state) {
  // Build prompt with plan + context
  const codePrompt = await engine.buildExecutePrompt({
    plan: state.planText,
    task: state.currentTask,
    code: state.code,
    profile: state.profile
  });
  
  // LLM generates code
  const raw = await llm.invoke(codePrompt);
  
  // Parse files from response
  const files = parseResponse(raw);
  
  // Record attempt
  const attempt = {
    attemptNumber: state.previousAttempts.length + 1,
    filesGenerated: files.map(f => f.path),
    taskName: state.currentTask.name
  };
  
  // Save checkpoint
  await saveCheckpoint(state);
  
  return { 
    rawResponse: raw, 
    files, 
    previousAttempts: [...state.previousAttempts, attempt]
  };
}
```

**Checkpoint**: Saved after code generation

---

### writeFiles

**Purpose**: Write files to disk immediately

```typescript
writeFiles(state) {
  const workDir = state.context.workDir || '.';
  
  for (const file of state.files) {
    const fullPath = path.join(workDir, file.path);
    await gitPort.writeFile(fullPath, file.content);
  }
  
  // Delete requested files
  for (const path of state.filesToDelete || []) {
    await gitPort.deleteFile(path);
  }
  
  return { /* no state changes */ };
}
```

**Critical**: Files written before any validation to ensure LLM output is persisted even if recursion limit hits.

---

### validate

**Purpose**: Fast static checks

```typescript
validate(state) {
  const violations = [];
  
  // Check 1: No files generated?
  if (!state.files || state.files.length === 0) {
    // Check if source files already exist
    const hasExistingFiles = await checkSourceFiles(workDir);
    if (!hasExistingFiles) {
      violations.push({
        type: 'no_files',
        severity: 'critical',
        message: 'No files generated',
        isRetryable: true
      });
    }
  }
  
  // Check 2: Ellipsis patterns
  for (const file of state.files) {
    if (/\.{3}|\/\/\s*\.\.\./.test(file.content)) {
      violations.push({
        type: 'ellipsis',
        severity: 'major',
        file: file.path,
        message: 'Contains ellipsis placeholder',
        isRetryable: true
      });
    }
  }
  
  // Check 3: Excessive deletion
  if (state.code && state.files.length < state.code.length * 0.7) {
    violations.push({
      type: 'excessive_deletion',
      severity: 'critical',
      message: 'Deleted >30% of original code',
      isRetryable: true
    });
  }
  
  return { violations };
}
```

**Decision**:
- If violations → `enforce`
- If OK → `installDeps`

---

### installDeps

**Purpose**: Install dependencies

```typescript
installDeps(state) {
  const violations = [];
  
  // Check if package.json changed
  const pkgJsonChanged = state.files.some(f => 
    f.path.endsWith('package.json')
  );
  
  if (pkgJsonChanged) {
    // Detect package manager
    const pm = detectPackageManager(workDir);
    
    // Run install
    const result = await command.execute(`${pm} install`, {
      cwd: workDir,
      env: { ...process.env, NODE_ENV: 'development' }
    });
    
    if (result.exitCode !== 0) {
      violations.push({
        type: 'missing_dependency',
        severity: 'critical',
        message: `Dependency install failed: ${result.stderr}`,
        isRetryable: false  // Needs package.json fix
      });
    }
  }
  
  return { violations };
}
```

---

### runtimeValidate

**Purpose**: Build, lint, type-check

```typescript
runtimeValidate(state) {
  const violations = [];
  
  // Skip for setup tasks (config-only)
  if (state.currentTask.type === 'setup') {
    // Only validate JSON syntax
    for (const file of state.files) {
      if (file.path.endsWith('.json')) {
        try {
          JSON.parse(file.content);
        } catch (e) {
          violations.push({
            type: 'syntax_error',
            severity: 'critical',
            file: file.path,
            message: `Invalid JSON: ${e.message}`,
            isRetryable: true
          });
        }
      }
    }
    
    // Save checkpoint
    await saveCheckpoint(state);
    
    return { violations };
  }
  
  // TypeScript check
  const tscResult = await command.execute('npx tsc --noEmit');
  if (tscResult.exitCode !== 0) {
    const diagnosis = await diagnostics.analyzeTypeScript(tscResult.stderr);
    violations.push(...diagnosis);
  }
  
  // ESLint check
  const lintResult = await command.execute('npm run lint');
  if (lintResult.exitCode !== 0) {
    // Check if linting build artifacts
    if (/\/(dist|build)\//.test(lintResult.stdout)) {
      violations.push({
        type: 'config_error',
        severity: 'critical',
        message: 'ESLint checking build artifacts. Add ignorePatterns to .eslintrc.json',
        isRetryable: false
      });
    } else {
      const diagnosis = await diagnostics.analyzeESLint(lintResult.stdout);
      violations.push(...diagnosis);
    }
  }
  
  // Build check
  const buildResult = await command.execute('npm run build');
  if (buildResult.exitCode !== 0) {
    const diagnosis = await diagnostics.analyzeBuild(buildResult.stderr);
    violations.push(...diagnosis);
  }
  
  // Save checkpoint
  await saveCheckpoint(state);
  
  return { violations };
}
```

**Checkpoint**: Saved after validation complete

**Decision**:
```typescript
if (no violations) {
  // Task succeeded
  if (currentTask.type === 'feature') {
    state.completedTasks.push(currentTask.id);
  } else if (currentTask.type === 'error') {
    // Remove all error tasks (errors resolved)
    state.taskQueue.removeType('error');
  }
  
  // Pop completed task
  state.taskQueue.pop();
  
  if (taskQueue.isEmpty()) {
    return "evaluate";  // All done
  } else {
    return "plan";  // Next task
  }
} else if (retries < maxRetries) {
  return "enforce";  // Try to fix
} else {
  // Max retries reached, skip task
  state.taskQueue.pop();
  if (taskQueue.isEmpty()) {
    return "evaluate";
  } else {
    return "plan";
  }
}
```

---

### enforce

**Purpose**: Analyze violations and prepare retry

```typescript
enforce(state) {
  // Format violations
  const formatted = violations.map((v, i) => 
    `${i+1}. [${v.severity.toUpperCase()}] ${v.type}: ${v.message}
       File: ${v.file || 'N/A'}
       💡 Fix: ${v.suggestedFix || 'See error message'}
       ♻️  Retryable: ${v.isRetryable ? 'YES' : 'NO'}`
  ).join('\n\n');
  
  // Save feedback for learning
  const feedback = {
    taskId: state.currentTask.id,
    taskName: state.currentTask.name,
    attemptNumber: state.retries + 1,
    violations,
    enforcementReason: formatted,
    timestamp: Date.now()
  };
  
  return {
    enforcementReason: formatted,
    retries: state.retries + 1,
    enforcementHistory: [...state.enforcementHistory, feedback]
  };
}
```

**Output**: Formatted error context for next `plan` call

---

### evaluate

**Purpose**: Analyze code quality

```typescript
evaluate(state) {
  // Only if --eval flag
  if (!state.context.config.autoEval) {
    return { /* skip */ };
  }
  
  // Analyze metrics
  const metrics = await evaluator.analyze(state.files);
  
  // Generate report
  const report = formatReport(metrics);
  
  // Save report
  await reporter.save(report, 'outputs/eval/report.md');
  
  return { evaluationReport: report };
}
```

---

### learn

**Purpose**: Store learnings and create branch

```typescript
learn(state) {
  // Extract learnings
  const learnings = {
    context: { project, feature, mode },
    profile: state.profile,
    plan: state.planText,
    filesGenerated: state.files.map(f => f.path),
    violations: state.enforcementHistory,
    metrics: state.evaluationReport
  };
  
  // Create Git branch
  const branch = `feature/${project}-${feature}`;
  await gitPort.createBranch(branch);
  
  // Save session turn
  await session.addTurn(project, feature, {
    task: 'code',
    input: { prd, design, directive },
    output: learnings,
    state: {
      taskQueue: state.taskQueue.getAll(),
      completedTasks: state.completedTasks,
      retries: state.retries
    }
  });
  
  // Chunk and store to vector DB
  const chunks = await chunk.process(learnings);
  await memory.store(chunks, project);
  
  return { 
    learnings, 
    branch, 
    filesWritten: state.files.length 
  };
}
```

---

## Task Queue Management

### Priority Rules

```typescript
export const TASK_PRIORITIES = {
  SETUP_PROJECT: 100,           // Config files
  
  ERROR_MISSING_ENTRY: 10,      // index.html
  ERROR_MISSING_DEPS: 15,       // package.json deps
  ERROR_CONFIG: 20,             // tsconfig.json
  ERROR_TYPE: 30,               // TypeScript errors
  ERROR_IMPORT: 35,             // Import errors
  ERROR_BUILD: 40,              // Build errors
  ERROR_SYNTAX: 50,             // Syntax errors
  ERROR_LINT: 70,               // Lint errors
  ERROR_OTHER: 80,              // Other
  
  FEATURE_CRITICAL: 200,
  FEATURE_IMPORTANT: 220,
  FEATURE_NORMAL: 250,
  FEATURE_NICE_TO_HAVE: 280,
};
```

### Example Flow

```typescript
// Initial decompose
taskQueue: [
  { id: "setup", type: "setup", priority: 100 },
  { id: "auth", type: "feature", priority: 200 },
  { id: "api", type: "feature", priority: 220 }
]

// After setup task fails (missing deps)
taskQueue: [
  { id: "fix-deps", type: "error", priority: 15 },  // Added by plan node
  { id: "setup", type: "setup", priority: 100 },    // Re-queued
  { id: "auth", type: "feature", priority: 200 },
  { id: "api", type: "feature", priority: 220 }
]

// After error task succeeds
taskQueue: [
  { id: "setup", type: "setup", priority: 100 },
  { id: "auth", type: "feature", priority: 200 },
  { id: "api", type: "feature", priority: 220 }
]
// Note: All error tasks removed when any error task succeeds
```

---

## Checkpointing

State is saved at three critical points:

1. **After plan**: Task plan generated, currentCode loaded
2. **After execute**: Files generated by LLM (critical!)
3. **After runtimeValidate**: Validation complete

### Checkpoint Structure

```typescript
checkpoint = {
  taskQueue: Task[],
  completedTasks: string[],
  retries: number,
  maxRetries: number,
  previousAttempts: Attempt[],
  enforcementHistory: Feedback[],
  lastViolations: Violation[],
  previousFileCount: number,
  resolvedCategories: string[]
}
```

### Recursion Limit Handling

```typescript
runner.ts:
  try {
    state = await app.invoke(initial, { recursionLimit: 25 });
  } catch (error) {
    if (error.message.includes('Recursion limit')) {
      // Restore from checkpoint
      const session = await sessionPort.load(project, feature);
      const taskQueue = new TaskQueue();
      session.state.taskQueue.forEach(t => taskQueue.push(t));
      
      // Force learn node execution
      state = await learn({ ...initial, taskQueue, ... });
      
      // Report paused state
      console.log(`⏸️  Paused: ${taskQueue.size()} tasks remaining`);
    }
  }
```

---

## Language-Specific Features

### Setup Task Constraints

Setup tasks (config files) have language-specific constraints injected dynamically:

**TypeScript** (`templates/code/languages/typescript/setup/constraints.md`):
```markdown
SETUP TASK - Configuration Files ONLY

Allowed:
- package.json, tsconfig.json, vite.config.ts
- .eslintrc.json (MUST include ignorePatterns)
- tailwind.config.js, postcss.config.js
- index.html, .gitignore, README.md

Forbidden:
- src/*, app/*, lib/*, components/*
- Any .tsx, .jsx files
```

Injected via:
```typescript
ModeController.selectInjections(taskType) {
  if (taskType === 'setup') {
    const lang = detectLanguage(context);
    return [`code/languages/${lang}/setup/constraints`];
  }
  return [];
}
```

### Validation Strategies

**Setup Tasks**:
- JSON syntax validation only
- Skip TypeScript checks (no src/ files yet)
- Skip build (no code to build)

**Feature Tasks**:
- Full TypeScript type-check
- ESLint
- Build verification
- Dependency check

---

## Error Handling

### Violation Structure

```typescript
interface Violation {
  type: ViolationType;
  severity: 'critical' | 'major' | 'minor';
  message: string;
  file?: string;
  suggestedFix?: string;
  isRetryable?: boolean;  // Key for retry decision
  module?: string;
  }
```

### Retry Decision Logic

```typescript
const allRetryable = violations.every(v => v.isRetryable === true);
const hasBlockingErrors = violations.some(v => 
  v.type === 'missing_dependency' || 
  v.type === 'missing_file' ||
  v.type === 'config_error'
);

if (allRetryable && !hasBlockingErrors) {
  // Simple retry
  return plan(state);
} else {
  // LLM analyzes errors and decides strategy
  const decision = await llm.invoke({
    violations,
    context,
    instruction: "Decide: retry or add error tasks?"
  });
  
  if (decision.action === 'add_tasks') {
    decision.newTasks.forEach(t => taskQueue.push(t));
  }
  
  return plan(state);
}
```

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
  "llmModel": "claude-sonnet-4-5"
}
```

### Graph Config

- **recursionLimit**: 25 (in runner.ts)
- **maxRetries**: 3 per task (in state.ts)

---

## Performance

### Token Usage

**Typical Task**:
- Plan: ~8K tokens
- Execute: ~12K tokens
- Retry: +6K tokens per attempt

**Optimizations**:
- Checkpoint system avoids re-running entire graph
- Language-specific validation skips unnecessary checks
- Retry heuristic reduces LLM calls for simple errors

### Execution Time

**Setup Task**: ~30s
- Plan: 3s
- Execute: 8s
- Validate: 1s
- InstallDeps: 15s
- RuntimeValidate: 3s

**Feature Task**: ~45s
- Plan: 5s
- Execute: 12s
- Validate: 1s
- InstallDeps: 2s (if cached)
- RuntimeValidate: 25s (build + lint + types)

---

## Troubleshooting

### Files not saved despite LLM generation

**Cause**: Recursion limit hit before `writeFiles` node  
**Solution**: `writeFiles` now runs immediately after `execute` (before validation)

### Setup task generating src/ files

**Cause**: Validation forcing LLM to create files to pass TypeScript checks  
**Solution**: Setup tasks now skip TypeScript/build checks, only validate JSON syntax

### Session not resuming after interruption

**Cause**: State not saved when recursion limit hit  
**Solution**: Checkpointing system + forced `learn` node execution in runner.ts

### ESLint errors in dist/ folder

**Cause**: .eslintrc.json missing `ignorePatterns`  
**Solution**: Setup task constraints now mandate `ignorePatterns` in ESLint config
