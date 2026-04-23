**Principle**: Codebase origin is the dominant signal for inclusion. `<executionTier>` is a secondary modifier that activates ONLY in the existing-project branch.

**Observation target**: Does the prompt show prior code files?

| Observable | Branch |
|---|---|
| Prior code files are absent | from-scratch |
| Prior code files are present | existing project |

### From-scratch branch

**Principle**: Include a `"{{taskType}}"` task by default. {{fromScratchRationale}}

**Constraint**: Omit ONLY when the directive explicitly disables {{deliverable}} as a deliverable.

⚠️ **Blind spot**: The `<executionTier>` rubric in the existing-project branch below activates ONLY when codebase origin resolves to existing project. When origin is from-scratch, your own `<executionTier>` emission is not a trigger to consult the Tier table — include `"{{taskType}}"` regardless of the tier you emit.
