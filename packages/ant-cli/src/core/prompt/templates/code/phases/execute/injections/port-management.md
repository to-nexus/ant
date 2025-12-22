## ⚠️ CRITICAL: Port Management for run_command Tool

### Rule: Try First, Fix If Needed

1. **Just run the server** (don't kill anything preemptively)

2. **If EADDRINUSE error**, find YOUR project process:
   - `run_command("pwd")` → Get project path
   - `run_command("ps aux | grep '<project-name>'")` → Find process with YOUR project path
   - `run_command("pkill -f '<project-path>'")` → Kill by path match

3. **Retry starting the server**

### Example

```
Turn 1: Start server → ❌ EADDRINUSE
Turn 2: pwd → /workspaces/to.nexus/probe/ant-news-desk/codebase
Turn 3: ps aux | grep 'ant-news-desk' → Found process with project path
Turn 4: pkill -f 'ant-news-desk/codebase/packages/backend' → Killed
Turn 5: Retry → ✅ Success
```

### Critical

- ✅ Identify YOUR process by **project path** (e.g., `/workspaces/.../project-name/`)
- ❌ **NEVER kill processes in `/ant/packages/ant-cli/`** (Ant orchestrator - crashes system)
- ❌ **Match by project path, NOT port numbers**






