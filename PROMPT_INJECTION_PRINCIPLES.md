# Prompt Injection Principles

This document defines the architectural principles and rules governing how prompt injections are selected and applied in the Ant CLI system.

## Overview

The prompt injection system is a **conditional, context-driven mechanism** that dynamically assembles prompts based on task requirements, project context, and execution mode. This ensures prompts are relevant, efficient, and maintainable.

## Core Architecture

### Three-Layer Hierarchy

```
Layer 1: common/injections
  ↓ (broadest scope - all jobs)
Layer 2: task/base/injections  
  ↓ (task-specific - code/design/learn)
Layer 3: task/phases/[phase]/injections
  ↓ (most specific - plan/execute per task)
```

**Principle:** Injections are organized by specificity. More general injections live higher in the hierarchy.

**Location Rules:**
1. **Common** (`templates/common/injections/`): Content relevant to ALL jobs
   - Examples: memory, directive, design-doc, prd-spec
   
2. **Task-level** (`templates/[task]/base/injections/`): Content specific to one task type
   - Examples: git-diff, retrieved-code (code job only), behavioral-debugging (code job only)
   
3. **Phase-level** (`templates/[task]/phases/[phase]/injections/`): Content specific to one phase
   - Examples: retry-context, lessons (execute phase only)

## Injection Decision Algorithm

The `ModeController.selectInjections()` method applies conditional logic to determine which injections to include:

```
1. Identify task, phase, mode
2. Analyze context (memory, git, retry, etc.)
3. Evaluate conditions
4. Build injection list
5. Return to TemplateComposer for rendering
```

## Conditional Injection Rules

### Context-Driven Conditions

**Definition:** Injections triggered by presence/absence of specific context data.

| Condition | Injection | Rationale |
|-----------|-----------|-----------|
| `context.stats.hasMemory` | `common/injections/memory` | Past learnings available |
| `context.designDoc` | `common/injections/design-doc` | Design spec exists |
| `context.prdSpec` | `common/injections/prd-spec` | PRD available |
| `context.projectCodeContext?.gitDiff` | `code/base/injections/git-diff` | Git changes detected |
| `context.projectCodeContext?.files` | `code/base/injections/retrieved-code` | RAG retrieved code |
| `context.retryContext` | `[task]/phases/execute/injections/retry-context` | Retry attempt |
| `context.lessons` | `[task]/phases/execute/injections/lessons` | Past lessons exist |

**Principle:** Only include data-related injections when the data actually exists.

### Mode-Driven Conditions

**Definition:** Injections triggered by execution mode (generate/refactor/explain).

| Mode | Injection | Rationale |
|------|-----------|-----------|
| `mode = 'refactor'` | `code/base/injections/behavioral-debugging` | Debugging guidance for bug fixes |
| `mode = 'generate'` | _(no debugging)_ | Fresh implementation doesn't need debugging |
| `mode = 'explain'` | _(no debugging)_ | Explanation tasks don't involve fixes |

**Principle:** Mode determines the type of guidance needed (creation vs modification vs explanation).

**Implementation:**
```typescript
// In ModeController.selectInjections()
if (task === 'code') {
  // Behavioral debugging (only for refactor mode)
  if (this.isRefactorMode(mode, context)) {
    injections.push(`${taskPrefix}/behavioral-debugging`);
  }
}
```

**Fallback Logic:**
```typescript
private isRefactorMode(mode: CodeMode | undefined, context: AssembledContext): boolean {
  // Explicit mode takes precedence
  if (mode === 'refactor') return true;
  
  // Fallback: Infer from context
  if (context.stats.hasProjectCode && context.currentTask?.type === 'error') {
    return true;
  }
  
  return false;
}
```

### Content-Driven Conditions

**Definition:** Injections triggered by analyzing directive/error content.

| Detection | Injection | Rationale |
|-----------|-----------|-----------|
| `containsRuntimeError(directive)` | `[task]/phases/execute/injections/runtime-error-fix` | Runtime error detected |
| `context.stats.hasMissingDependency` | `code/phases/execute/injections/missing-dependency-fix` | Dependency error |

**Principle:** Analyze error content to provide targeted guidance.

### Environment-Driven Conditions

**Definition:** Injections based on detected environment (browser/node-api/cli/etc).

| Environment | Injection | Rationale |
|-------------|-----------|-----------|
| Language detected | `code/languages/[lang]/environments/[env]/rules` | Environment-specific rules |
| Domain = game | `design/phases/execute/injections/game-domain-guide` | Game-specific design patterns |
| Domain = service | `design/phases/execute/injections/service-domain-guide` | Service-specific patterns |

**Principle:** Provide environment-specific guidance only when relevant.

### Phase-Driven Conditions

**Definition:** Injections available only in specific phases.

| Phase | Injection | Rationale |
|-------|-----------|-----------|
| Plan | `modification-warning` | Warn before modifying existing code |
| Plan | `new-project-warning` | Warn about setup requirements |
| Execute | `retry-context` | Previous attempt details |
| Execute | `lessons` | Past learnings |
| Execute | `session-context` | Compressed history |

**Principle:** Phase determines what information is relevant.

## Anti-Patterns to Avoid

### ❌ Hardcoded Injections in Templates

**Bad:**
```markdown
{{> code/phases/execute/injections/runtime-debugging-protocol}}
```

**Why:** Always includes injection, even when irrelevant. Wastes tokens and context.

**Good:**
Let ModeController conditionally include via `selectInjections()`.

### ❌ Overly Broad Conditions

**Bad:**
```typescript
if (task === 'code') {
  injections.push('behavioral-debugging'); // Always for all code tasks
}
```

**Why:** Includes debugging guidance even for fresh implementations.

**Good:**
```typescript
if (task === 'code' && this.isRefactorMode(mode, context)) {
  injections.push('behavioral-debugging'); // Only for bug fixes
}
```

### ❌ Injection Without Clear Trigger

**Bad:**
```typescript
injections.push('some-guide'); // When should this be included?
```

**Why:** Unclear when injection applies. Hard to maintain.

**Good:**
```typescript
// Only include when specific condition met
if (context.designDomain === 'game') {
  injections.push('game-domain-guide');
}
```

## Design Principles Summary

1. **Conditional, not universal**: Only include injections when relevant
2. **Context-driven**: Base decisions on actual project state
3. **Hierarchical organization**: General → Specific
4. **Explicit triggers**: Every injection has clear inclusion criteria
5. **Mode-aware**: Different modes need different guidance
6. **Maintainable**: Clear rules, easy to extend

## Adding New Injections

When adding a new injection, follow this checklist:

1. **Determine scope**: Common, Task, or Phase level?
2. **Define trigger**: What condition(s) should include this?
3. **Implement in ModeController**: Add condition to `selectInjections()`
4. **Document here**: Update this file with the new rule
5. **Test**: Verify it's included only when intended

**Example:**

```typescript
// New injection: test-debugging (for test failures)
if (task === 'code' && this.containsTestFailure(directive)) {
  injections.push(`${phasePrefix}/test-debugging`);
  console.log('[ModeController] Adding test-debugging for test failures');
}
```

## Verification

To verify injection system is working correctly:

1. **Mode test**: `mode=refactor` → includes `behavioral-debugging` ✓
2. **Mode test**: `mode=generate` → excludes `behavioral-debugging` ✓
3. **Context test**: Has git diff → includes `git-diff` ✓
4. **Context test**: No git diff → excludes `git-diff` ✓

Check ModeController console logs to see which injections are added.

## Benefits of This Architecture

1. **Efficiency**: Only relevant prompts included, saves tokens
2. **Clarity**: Explicit conditions make system predictable
3. **Maintainability**: Clear rules, easy to extend
4. **Consistency**: All injections follow same pattern
5. **Flexibility**: Easy to add new conditions and injections

---

**Last Updated:** 2025-12-15

**Owner:** Prompt Engineering Team
