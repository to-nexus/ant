{{#if hasErrorInDirective}}
════════════════════════════════════════════════════════════════════════════════
🚨 ERROR DETECTED IN DIRECTIVE
════════════════════════════════════════════════════════════════════════════════

**CRITICAL: Separate facts from user interpretation**

**Your task decomposition approach:**

1. **Extract objective facts** (high confidence):
   - Error code/message (e.g., "GAME_IN_PROGRESS", "TypeError: Cannot read...")
   - Stack trace (e.g., "RoomPage.tsx:103", "game.gateway.ts:45")
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

User directive: "After modifying env.ts, I get GAME_IN_PROGRESS error at RoomPage.tsx:103"

✅ GOOD task:
```
Name: "Investigate GAME_IN_PROGRESS error in RoomPage"
Description: "Error 'Game is already in progress' occurs at RoomPage.tsx:103.
             Error code: GAME_IN_PROGRESS
             Context: Happens when joining room
             User mentioned: env.ts modified recently (may or may not be related)"
```

❌ BAD task:
```
Name: "Fix env.ts WebSocket configuration"
Description: "env.ts validation receiving wrong URL scheme"
```
**Why bad?** Based on user's guess, ignores actual error code and stack trace.

════════════════════════════════════════════════════════════════════════════════

{{else}}

════════════════════════════════════════════════════════════════════════════════
📋 GENERAL PRINCIPLE FOR ALL TASKS
════════════════════════════════════════════════════════════════════════════════

**User directive contains both facts and interpretations. Distinguish them.**

**Task decomposition approach:**

1. **Extract what user wants** (objective):
   - Feature to add (e.g., "room list display")
   - Problem to solve (e.g., "slow page load")
   - Component to modify (e.g., "login form styling")

2. **Separate user's how from what**:
   - What: "Display room list"
   - How (user's suggestion): "using DataTable component"
   - **Task should focus on WHAT, let execution phase decide HOW**

3. **Create focused, what-oriented tasks**:
   - Task name: What needs to be done (not how)
   - Task description: Requirements, context, constraints
   - **Don't** prescribe implementation details
   - **Don't** assume user's suggested approach is best

**Example:**

User directive: "Add room list using DataTable component with real-time updates via WebSocket"

✅ GOOD task:
```
Name: "Implement room list display with real-time updates"
Description: "Display list of available game rooms with:
             - Room name, player count, status
             - Real-time updates when rooms change
             - User suggested: DataTable component, WebSocket (consider but don't mandate)"
```

❌ BAD task:
```
Name: "Add DataTable component for room list with WebSocket"
Description: "Create DataTable component with WebSocket connection for room updates"
```
**Why bad?** Prescribes implementation (DataTable, WebSocket), limits execution phase options.

════════════════════════════════════════════════════════════════════════════════

{{/if}}

