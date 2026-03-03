{{#if hasErrorInDirective}}
════════════════════════════════════════════════════════════════════════════════
🚨 ERROR DETECTED IN DIRECTIVE
════════════════════════════════════════════════════════════════════════════════

**CRITICAL: Separate facts from user interpretation**

**Your task decomposition approach:**

1. **Extract objective facts** (high confidence):
   - Error code/message (e.g., "RESOURCE_NOT_FOUND", "TypeError: Cannot read...")
   - Stack trace (e.g., "UserService.ts:103", "data.handler.ts:45")
   - Observable behavior (e.g., "clicking button causes crash", "duplicate requests")

2. **Note user interpretation** (low confidence):
   - User mentions specific files (e.g., "env.ts is wrong")
   - User's suspected cause (e.g., "configuration issue")
   - **These are hypotheses, not facts!**

3. **Create investigation tasks based on facts**:
   - Task name: Based on **error code + location** (not user's guess)
   - Task description: Include **error message, stack trace, observed behavior**
   - **Don't** prescribe solutions
   - **Don't** assume user's diagnosis is correct

**Example:**

User directive: "After modifying config.ts, I get RESOURCE_NOT_FOUND error at UserService.ts:103"

✅ GOOD task:
```
Name: "Investigate RESOURCE_NOT_FOUND error in UserService"
Description: "Error 'Resource not found' occurs at UserService.ts:103.
             Error code: RESOURCE_NOT_FOUND
             Context: Happens when fetching user data
             User mentioned: config.ts modified recently (may or may not be related)"
```

❌ BAD task:
```
Name: "Fix config.ts database configuration"
Description: "config.ts validation receiving wrong connection string"
```
**Why bad?** Based on user's guess, ignores actual error code and stack trace.

════════════════════════════════════════════════════════════════════════════════

{{else}}

════════════════════════════════════════════════════════════════════════════════
📋 GENERAL PRINCIPLE
════════════════════════════════════════════════════════════════════════════════

**User directive contains both facts and interpretations.**
Extract objective requirements (what user wants); separate from user's implementation suggestions (how).
Task descriptions follow the scope and content rules defined in the Task Schema section below.

════════════════════════════════════════════════════════════════════════════════

{{/if}}

