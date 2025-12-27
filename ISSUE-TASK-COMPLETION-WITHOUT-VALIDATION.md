# Issue: Task Marked Complete Without Build Validation

**Date**: 2025-12-27  
**Project**: ant-news-desk/skeleton  
**Issue**: Final Verification task completed successfully despite build failures (vite not installed)

---

## 📋 Problem Summary

### What Happened
```
1. User requested basename configuration for React Router
2. Agent completed the code changes successfully
3. Final Verification task started
4. npm run build failed 84+ times (Cannot find package 'vite')
5. Task marked as "completed: true" ✅
6. No violations recorded
7. Dev server fails to start (vite missing)
```

### Expected Behavior
```
1. Final Verification detects build failure
2. Creates violations
3. Task marked as failed
4. Agent attempts to fix or reports error
```

---

## 🔍 Root Cause Analysis

### Issue #1: Tool Node Doesn't Generate Violations

**Location**: `packages/ant-cli/src/agents/architect/graph/code/nodes/tool.ts`

**Current Behavior**:
- tool.ts executes commands and returns results as strings
- No violations are generated for command failures
- LLM must detect patterns from conversation history alone

**Flow**:
```
tool (npm install fails)
  ↓ returns error string
codeGen (LLM sees error)
  ↓ decides to retry
tool (npm install fails again)
  ↓ returns same error
codeGen (LLM doesn't detect loop)
  ↓ decides to retry
... (84+ times)
```

**Evidence**:
```bash
# From report
grep -o "npm install\|npm run build" report.log | wc -l
# Result: 84 npm install, 68 npm run build
```

---

### Issue #2: LLM Failed to Detect Repetition

**Location**: Conversation history & prompt

**Analysis**:
- Conversation history preserved (messages=3,5,7,9...207)
- History budget: 75K tokens (sufficient)
- BUT: Prompt lacked "repetition detection" principles

**What LLM Saw**:
```
Turn 1: npm install → failed
Turn 2: npm install → failed (same error)
Turn 3: npm install → failed (same error)
...
Turn 84+: npm install → failed (same error)
```

**Why LLM Didn't Stop**:
- No explicit "stop on repetition" rule in prompt
- Relied on LLM's implicit pattern recognition (failed)

**Temporary Fix Applied**:
- Added principles to `tool-calling-rules-compact.md`:
  - "Observe Before Repeating"
  - "Pattern Recognition" 
  - "Loop indicator: Same command → Same error → No environment change"

---

### Issue #3: RuntimeValidate Skipped

**Location**: `packages/ant-cli/src/agents/architect/graph/code/routers/codeGenRouter.ts`

**Router Logic**:
```typescript
if (response.done) {
  const isFinalTask = currentTask?.priority === TASK_PRIORITIES.FINAL_VERIFICATION;
  
  if (isFinalTask) {
    return 'installDeps';  // → runtimeValidate → checkTaskStatus
  } else {
    return 'checkTaskStatus';  // ← Skip validation
  }
}
```

**What Actually Happened**:
```
1. LLM kept calling tools (done=false)
2. Loop: codeGen → tool → codeGen → tool (84+ times)
3. Eventually: LLM returned done=true (gave up?)
4. BUT: Router went to checkTaskStatus (NOT installDeps)
5. Result: runtimeValidate was NEVER executed
```

**Evidence**:
```bash
grep "runtimeValidate\|installDeps\|Final task done" report.log
# Result: No matches - these nodes were never entered
```

---

### Issue #4: CheckTaskStatus Marked as Complete

**Location**: `packages/ant-cli/src/agents/architect/graph/code/graph.ts` (checkTaskStatus node)

**Logic**:
```typescript
async function checkTaskStatus(state: ArchitectGraphState) {
  const violations = [...(state.violations || [])];
  const hasViolations = (violations && violations.length > 0);
  
  if (!hasViolations && state.currentTask) {
    // ✅ Task succeeded
    const completedTask = TaskTimingHelper.completeTask(...);
    return { completed: true, ... };
  }
  
  // ❌ Task failed
  return { violations, ... };
}
```

**Why It Passed**:
- No violations in state
- tool.ts doesn't create violations
- runtimeValidate was skipped (would have created violations)
- checkTaskStatus logic: `violations.length === 0` → Success ✅

---

### Issue #5: DevServerService Dependency Check Insufficient

**Location**: `packages/ant-cli/src/periphery/adapters/http/services/DevServerService/DevServerService.ts:319-324`

**Current Check**:
```typescript
private async installDependenciesIfNeeded(packagePath: string, serverKey: string): Promise<void> {
  const nodeModulesPath = path.join(packagePath, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    console.log(`[DevServerService] Dependencies already installed: ${packagePath}`);
    return;  // ❌ PROBLEM: Only checks if node_modules exists
  }
  // ... npm install
}
```

**Problem**:
- Only checks if `node_modules/` directory exists
- Doesn't verify if actual dependencies are installed
- Agent ran `npm install` during build → created `node_modules/`
- But only production deps installed (NODE_ENV=production likely)
- `vite` is in devDependencies → not installed
- DevServerService sees `node_modules/` → skips install
- Dev server fails: "Cannot find package 'vite'"

**Proof**:
```bash
cd /Users/probe/dev/ant-workspaces/to.nexus/probe/ant-news-desk/codebase
ls node_modules/ | grep -i vite
# Before fix: (empty)
# After npm install --include=dev: vite, @vitejs
```

---

## 🎯 Required Solutions

### Solution #1: Tool Node - Command History Tracking (CRITICAL)

**File**: `packages/ant-cli/src/agents/architect/graph/code/nodes/tool.ts`

**Goal**: Tool should track command history and report repetition patterns

**Implementation**:
```typescript
// Add to state
state.commandHistory = state.commandHistory || [];

// Track execution
const historyEntry = {
  command: command,
  timestamp: Date.now(),
  success: result.success,
  exitCode: result.exitCode,
  errorSnippet: result.stderr.slice(0, 100)
};

state.commandHistory.push(historyEntry);

// Detect repetition (same command, same error, within 5 minutes)
const recent = state.commandHistory.filter(h => 
  h.command === command && 
  !h.success &&
  Date.now() - h.timestamp < 5 * 60 * 1000
);

// Format response with context
if (recent.length >= 3) {
  return formatFailureWithContext(command, result, recent);
}
```

**Key Points**:
- Tool remains "fact reporter" (doesn't create violations)
- BUT: Reports structured context
- LLM gets clear signal: "This command failed 3 times in 5 minutes"
- Enables LLM to detect pattern from structured data

---

### Solution #2: Prompt Enhancement (DONE - Needs Testing)

**File**: `packages/ant-cli/src/core/prompt/templates/code/base/injections/tool-calling-rules-compact.md`

**Status**: ✅ Already applied (needs verification with new job)

**Added Principles**:
- Core Principle: Observe Before Repeating
- Pattern Recognition: Loop indicators
- Diagnostic Strategy: Investigate before retry

**Verification**: Run new job and check if LLM stops repeating

---

### Solution #3: RuntimeValidate Execution Guarantee (CRITICAL)

**File**: `packages/ant-cli/src/agents/architect/graph/code/routers/codeGenRouter.ts`

**Problem**: Final task sometimes skips runtimeValidate

**Root Cause**: LLM may never return `done=true` if stuck in loop

**Proposed Solution A - Recursion Limit Check**:
```typescript
export function routeAfterCodeGen(state: ArchitectGraphState): string {
  const response = state.llmResponse;
  
  // ✅ NEW: Check if approaching recursion limit for final task
  if (state.currentTask?.priority === TASK_PRIORITIES.FINAL_VERIFICATION) {
    const remaining = state.recursionLimit - state.recursionCount;
    
    if (remaining < 50) {
      console.warn(`⚠️  Final task recursion limit approaching (${state.recursionCount}/${state.recursionLimit})`);
      console.warn(`   Forcing validation regardless of LLM response`);
      return 'installDeps';  // Force validation
    }
  }
  
  // ... existing logic
}
```

**Proposed Solution B - Tool Failure Threshold**:
```typescript
// If same tool fails repeatedly, force validation for final task
if (state.currentTask?.priority === TASK_PRIORITIES.FINAL_VERIFICATION) {
  const recentFailures = detectRecentToolFailures(state);
  
  if (recentFailures >= 5) {
    console.warn(`⚠️  Multiple tool failures detected for final task`);
    console.warn(`   Forcing validation to create proper violations`);
    return 'installDeps';
  }
}
```

**Trade-offs**:
- Solution A: Simple but arbitrary threshold
- Solution B: More intelligent but requires state tracking

**Recommendation**: Implement both as safety nets

---

### Solution #4: RuntimeValidate Violations for Loop Detection

**File**: `packages/ant-cli/src/agents/architect/graph/code/nodes/runtimeValidate.ts`

**Enhancement**: Detect if validation is running after suspicious activity

```typescript
export async function runtimeValidate(state: ArchitectGraphState) {
  // ... existing code ...
  
  // ✅ NEW: Check if we got here despite tool failures
  const recentToolFailures = detectRecentToolFailures(state);
  
  if (recentToolFailures >= 3) {
    console.warn(`⚠️  Validation starting after ${recentToolFailures} recent tool failures`);
    console.warn(`   Will create violation if build fails`);
    
    // Add context to violations if build fails
    violations.push({
      type: 'build_error',
      severity: 'critical',
      message: `Build validation failed after ${recentToolFailures} failed command attempts. This indicates a systemic issue that was not resolved.`,
      suggestedFix: 'Review command history and environment setup',
      isRetryable: false,
      metadata: {
        context: 'repeated_tool_failures',
        failureCount: recentToolFailures
      }
    });
  }
  
  // ... rest of validation
}
```

---

### Solution #5: DevServerService Dependency Check Enhancement

**File**: `packages/ant-cli/src/periphery/adapters/http/services/DevServerService/DevServerService.ts:319-357`

**Current Problem**:
```typescript
private async installDependenciesIfNeeded(packagePath: string): Promise<void> {
  if (fs.existsSync(path.join(packagePath, 'node_modules'))) {
    return;  // ❌ Too simplistic
  }
  // ...
}
```

**Enhanced Solution**:
```typescript
private async installDependenciesIfNeeded(packagePath: string, serverKey: string): Promise<void> {
  const nodeModulesPath = path.join(packagePath, 'node_modules');
  
  // Check if node_modules exists
  if (!fs.existsSync(nodeModulesPath)) {
    console.log(`[DevServerService] No node_modules found, installing...`);
    return this.runNpmInstall(packagePath, serverKey);
  }
  
  // ✅ NEW: Verify critical dependencies are actually installed
  const packageJsonPath = path.join(packagePath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.warn(`[DevServerService] No package.json found at ${packagePath}`);
    return;
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const criticalDeps = this.identifyCriticalDeps(packageJson);
  
  // Check if critical deps exist in node_modules
  const missingDeps = criticalDeps.filter(dep => 
    !fs.existsSync(path.join(nodeModulesPath, dep))
  );
  
  if (missingDeps.length > 0) {
    console.log(`[DevServerService] Missing critical dependencies: ${missingDeps.join(', ')}`);
    console.log(`[DevServerService] Re-installing dependencies...`);
    return this.runNpmInstall(packagePath, serverKey);
  }
  
  console.log(`[DevServerService] Dependencies already installed: ${packagePath}`);
}

private identifyCriticalDeps(packageJson: any): string[] {
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const critical = [];
  
  // Build tools (must have for dev server)
  if (deps['vite']) critical.push('vite');
  if (deps['webpack']) critical.push('webpack');
  if (deps['next']) critical.push('next');
  if (deps['@vue/cli-service']) critical.push('@vue/cli-service');
  
  // Frameworks (must have)
  if (deps['react']) critical.push('react');
  if (deps['vue']) critical.push('vue');
  
  return critical;
}

private async runNpmInstall(packagePath: string, serverKey: string): Promise<void> {
  this.appendLog(serverKey, 'stdout', `📦 Installing dependencies...`);
  
  return new Promise((resolve, reject) => {
    // ✅ CRITICAL: Include devDependencies
    const installProcess = spawn('npm', ['install', '--include=dev'], {
      cwd: packagePath,
      shell: true,
      stdio: 'pipe'
    });
    
    // ... rest of logic
  });
}
```

**Key Improvements**:
1. Verifies critical dependencies actually exist
2. Re-installs if critical deps missing
3. Always includes devDependencies (`--include=dev`)

---

## 📊 Implementation Priority

### P0 - Critical (Must Fix)
1. ✅ **Solution #5**: DevServerService dependency check
   - **Impact**: Immediate - fixes current dev server issue
   - **Risk**: Low - improves existing check
   - **Effort**: 1-2 hours

2. ⚠️  **Solution #3**: RuntimeValidate execution guarantee
   - **Impact**: High - prevents silent failures
   - **Risk**: Medium - changes routing logic
   - **Effort**: 2-4 hours

### P1 - Important (Should Fix)
3. ⚠️  **Solution #1**: Tool command history tracking
   - **Impact**: High - enables pattern detection
   - **Risk**: Low - adds telemetry only
   - **Effort**: 2-3 hours

4. ⚠️  **Solution #4**: RuntimeValidate loop detection
   - **Impact**: Medium - better error reporting
   - **Risk**: Low - adds context only
   - **Effort**: 1-2 hours

### P2 - Nice to Have
5. ✅ **Solution #2**: Prompt enhancement
   - **Impact**: Medium - may reduce loops
   - **Risk**: Low - prompt changes
   - **Effort**: DONE (needs testing)

---

## 🧪 Testing Plan

### Test Case 1: Missing devDependencies
```bash
# Setup
cd test-project
npm install --production  # Only prod deps

# Expected
ant dev-server start
→ DevServerService detects vite missing
→ Runs: npm install --include=dev
→ Dev server starts successfully
```

### Test Case 2: Repeated Command Failures
```bash
# Setup
Inject fault: npm install always fails

# Expected
1. Tool reports failure with history context
2. LLM sees: "This command failed 3 times"
3. LLM stops retrying, investigates environment
4. After 5 failures: Router forces validation
5. RuntimeValidate creates violations
6. Task marked as failed (not completed)
```

### Test Case 3: Final Task Validation
```bash
# Setup
Final verification task with build errors

# Expected
1. LLM completes code changes
2. Router: isFinalTask → installDeps
3. installDeps runs
4. RuntimeValidate executes
5. Build fails → violations created
6. Task marked as failed
7. Agent attempts fix or reports
```

---

## 📁 Files to Modify

### Critical
- [ ] `packages/ant-cli/src/periphery/adapters/http/services/DevServerService/DevServerService.ts`
- [ ] `packages/ant-cli/src/agents/architect/graph/code/routers/codeGenRouter.ts`
- [ ] `packages/ant-cli/src/agents/architect/graph/code/nodes/tool.ts`

### Important
- [ ] `packages/ant-cli/src/agents/architect/graph/code/nodes/runtimeValidate.ts`
- [ ] `packages/ant-cli/src/agents/architect/graph/code/state.ts` (add commandHistory)

### Monitoring
- [ ] Add telemetry for loop detection
- [ ] Add metrics for validation skip rate

---

## 🔄 Current Status

### Completed
- ✅ Root cause analysis
- ✅ Temporary fix: Manual `npm install --include=dev`
- ✅ Prompt enhancement (tool-calling-rules-compact.md)

### Next Steps
1. Review this document
2. Prioritize solutions
3. Implement P0 fixes first
4. Test thoroughly
5. Deploy and monitor

---

## 💡 Key Insights

### Design Principles Violated
1. **Fail-safe**: System should detect failures, not silently pass
2. **Validation**: Final tasks must run build validation
3. **Feedback Loop**: Tool should provide structured context for pattern detection

### Lessons Learned
1. Directory existence ≠ Dependencies installed
2. Prompt principles need explicit "stop conditions"
3. LLM won't detect patterns without structured signals
4. Router logic needs safety nets for edge cases

---

## 📞 Questions for Discussion

1. Should tool.ts create violations for repeated failures, or just report context?
2. What's acceptable recursion threshold before forcing validation?
3. Should we add explicit "max tool failures" per task?
4. How to handle NPM_CONFIG or NODE_ENV affecting installs?

---

**End of Document**

