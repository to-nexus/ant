{{#if content}}
<session_history>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 WORK HISTORY IN THIS FEATURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This shows your previous work in this feature.
Use this to understand context and detect if work was reset/discarded.

{{{content}}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  IMPORTANT: Check for Work Continuity

Compare session history with current repository state:

1. **If history shows files generated but files don't exist:**
   → User discarded previous work (git reset or deleted files)
   → Treat as fresh start, but learn from previous attempts
   → Don't reference "existing files" that were discarded
   
2. **If history shows previous attempts with same directive:**
   → User may not have been satisfied with previous result
   → Consider adjusting approach or implementation
   → Review what might have been wrong

3. **If files exist and match history:**
   → Normal continuation, build upon existing work
   → Preserve continuity

CRITICAL: Session history is a RECORD, not current state.
Always verify actual file existence before assuming files are there.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

</session_history>
{{/if}}
