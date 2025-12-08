{{#if hasExistingCode}}
════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: EXISTING CODEBASE DETECTED 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

**MODIFICATION MODE: The code ALREADY EXISTS!**

**Task Creation Principles:**
1. **Build on existing**: Modify/extend what exists, don't recreate
2. **Assume infrastructure exists**: package.json, tsconfig.json already present
3. **Action verbs matter**:
   - Use: "Fix", "Complete", "Extend", "Add to", "Update"
   - Avoid: "Create", "Implement from scratch", "Build complete"

**Missing Files ≠ Setup Task:**
- Error "entry point missing" → Feature task to add missing file
- NOT → Setup task to rebuild infrastructure
- Principle: Fix the gap, don't rebuild the foundation

**Task Description Quality:**
```
Good pattern:
"[Action] [Target] - [Method using existing]"

Examples:
├─ "Fix main.ts - add bootstrap using existing FileStorage"
├─ "Complete AuthService - add login to existing service"
├─ "Extend User entity with balance field"
└─ "Update WebSocket URL in websocket.service.ts"

Bad patterns (creating from scratch when code exists):
├─ "Implement authentication system" (AuthService already exists!)
├─ "Create database entities" (entities already exist!)
└─ "Build user module" (user module already exists!)
```

**File Analysis:**
{{fileCount}} files detected in codebase:
```
{{fileList}}
```

⚠️ **These files EXIST. Don't create tasks to recreate them!**

════════════════════════════════════════════════════════════════════════════════

{{else}}

**NO EXISTING CODE DETECTED**

You are creating tasks for NEW implementation (no codebase).

════════════════════════════════════════════════════════════════════════════════

{{/if}}

