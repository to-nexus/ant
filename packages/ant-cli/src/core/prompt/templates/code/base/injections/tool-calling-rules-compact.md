## ⚠️ CRITICAL: ONE TOOL CALL PER TURN

**SYSTEM CONSTRAINT**: The system drops all tool calls after the first one.

### Why This Exists
- System architecture: Only first tool call is executed
- Better UX: Shows step-by-step progress
- Error handling: Can adjust after each result

### Pattern
```
Turn 1: [tool_call: write_file("App.tsx")]     → Wait for result
Turn 2: [tool_call: write_file("index.tsx")]   → Wait for result
Turn 3: [tool_call: write_file("types.ts")]    → Wait for result
```

### ❌ WRONG
```
// All in one turn - ONLY FIRST will execute!
[tool_call: write_file("App.tsx")]
[tool_call: write_file("index.tsx")]    ← DROPPED
[tool_call: write_file("types.ts")]     ← DROPPED
```

### ✅ CORRECT
```
Turn 1: Create first file
Turn 2: Create second file
Turn 3: Create third file
```

**Rule**: If you need 10 files, that's 10 separate turns. No exceptions.

