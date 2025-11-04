# Fix SessionView Component Bug

## Problem Description

**Error**: `Uncaught TypeError: Cannot read properties of undefined (reading 'length')`
**Location**: `SessionView.tsx:131:30`
**Component**: `SessionView`

### Error Stack Trace
```
Uncaught TypeError: Cannot read properties of undefined (reading 'length')
    at SessionView (SessionView.tsx:131:30)
    at div
    at div
    at main
    at div
    at div
    at App (http://localhost:3000/src/App.tsx:30:35)
```

### Root Cause

The `SessionView` component expects `session.tasks` to be an array, but the actual API response from ant-cli server does NOT include a `tasks` field.

**Current Code (Line 131)**:
```tsx
{session.tasks.length} task{session.tasks.length !== 1 ? 's' : ''} in this session
```

**Actual API Response Structure**:
```json
{
  "sessionId": "...",
  "project": "ant-ui",
  "feature": "skeleton",
  "createdAt": "...",
  "updatedAt": "...",
  "turns": [...],
  "artifacts": {...},
  "state": {
    "taskQueue": [],
    "completedTasks": [...]
  }
}
```

**Note**: The API returns `state.taskQueue` and `state.completedTasks`, not `tasks`.

## Objective

Fix the `SessionView` component to handle the actual API response structure safely and display session information correctly without crashing.

## Requirements

### 1. Type Safety
- Update `Session` type definition in `src/types/session.ts` to match actual API response
- OR create adapter/mapper to transform API response to expected format

### 2. Null Safety
- Add proper null/undefined checks before accessing nested properties
- Use optional chaining (`?.`) and nullish coalescing (`??`) where appropriate
- Ensure component doesn't crash when fields are missing

### 3. Display Correct Data
- Show task information from `state.taskQueue` and `state.completedTasks` if available
- Calculate total tasks: `taskQueue.length + completedTasks.length`
- Handle case when `state` or nested fields are undefined

### 4. Maintain Existing UI/UX
- Keep the same visual layout and styling
- Don't change CardHeader, CardTitle, Badge, or grid layouts
- Only fix the data access logic

## Files to Modify

### Primary File
- **packages/ant-ui/src/components/SessionView.tsx**
  - Line 131: Fix the crash by safely accessing `tasks` field
  - Add proper checks for all potentially undefined fields
  - Consider mapping API response to component's expected format

### Optional (if needed)
- **packages/ant-ui/src/types/session.ts**
  - Update `Session` interface to match actual API response structure
  - OR keep current interface and create mapper function

### Do NOT modify
- packages/ant-ui/src/ui/* (UI components)
- packages/ant-cli/* (server code)

## Success Criteria

1. ✅ No TypeScript errors
2. ✅ No runtime crashes when selecting a project
3. ✅ SessionView displays session information correctly
4. ✅ Shows task count from `state.completedTasks.length` or shows "0 tasks" if unavailable
5. ✅ All existing fields (sessionId, projectId, status, timestamps) still display correctly
6. ✅ Component handles missing/undefined fields gracefully

## Testing

After implementing the fix, verify:

1. Open http://localhost:3000
2. Click on "ant-ui" project in the left sidebar
3. Verify SessionView displays without errors
4. Check browser console has no errors
5. Verify task count displays correctly (should show completed tasks count)

## Technical Notes

### Current API Response Format
```typescript
{
  sessionId: string;
  project: string;
  feature: string;
  createdAt: string;
  updatedAt: string;
  turns: any[];
  artifacts: any;
  state: {
    taskQueue: any[];
    completedTasks: string[];
    retries: number;
    maxRetries: number;
    previousAttempts: any[];
    enforcementHistory: any[];
    lastViolations: any[];
    resolvedCategories: any[];
  };
}
```

### Suggested Fix Approach

**Option 1: Safe Access Pattern**
```tsx
const taskCount = session.state?.completedTasks?.length ?? 0;
{taskCount} task{taskCount !== 1 ? 's' : ''} in this session
```

**Option 2: Add Computed Property**
```tsx
const getTotalTasks = (session: Session) => {
  const completed = session.state?.completedTasks?.length ?? 0;
  const queued = session.state?.taskQueue?.length ?? 0;
  return completed + queued;
};
```

**Option 3: Create Adapter**
```tsx
// In src/lib/session.ts or similar
function adaptSessionFromAPI(apiResponse: any): Session {
  return {
    id: apiResponse.sessionId,
    projectId: apiResponse.project,
    // ... map other fields
    tasks: [
      ...(apiResponse.state?.taskQueue ?? []),
      ...(apiResponse.state?.completedTasks?.map(id => ({ id, status: 'completed' })) ?? [])
    ]
  };
}
```

Choose the approach that best fits the codebase architecture. Prioritize safety and maintainability.

## Implementation Constraints

- Must maintain Hexagonal Architecture principles (if applicable)
- Must not break existing functionality
- Should follow React best practices
- TypeScript strict mode must pass
- No eslint errors

## Priority

**HIGH** - This is a critical bug preventing users from using the application.
