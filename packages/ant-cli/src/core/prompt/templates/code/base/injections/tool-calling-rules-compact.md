## Command Execution Principles

### Core Principle: Observe Before Repeating

When any command fails:
1. **Read the error output completely** - the error usually tells you what's wrong
2. **Check if you tried this before** - look at recent conversation history
3. **Identify what changed** - did you modify anything since the last attempt?
4. **If nothing changed, don't retry** - investigate root cause instead

### Pattern Recognition

**Loop indicator**: Same command → Same error → No environment change

When you detect this pattern:
- **STOP** executing the command
- **ANALYZE** the error message for clues
- **INVESTIGATE** with diagnostic commands
- **CHANGE** something before retrying

### Diagnostic Strategy

Before retrying a failed command, gather information:
- Check configuration files
- Verify environment state
- List actual vs expected resources
- Read relevant documentation/logs

**Remember**: Your goal is understanding, not just execution. Each command failure is information.

---

## Binary File Rule

**Never `read_file` on binary files** (images, fonts, archives, etc.)

- Check existence: `list_files`
- Use in code: reference path directly
