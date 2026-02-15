## Port Management for run_command Tool

### Reserved Port

Port **8080** is used by the orchestrator. Do NOT start your application on port 8080.

Use a different port (e.g., 3000, 8081, 9000) or find an available one:
```
run_command("for p in 3000 8081 9000; do (echo >/dev/tcp/localhost/$p) 2>/dev/null || { echo $p; break; }; done")
```

### If EADDRINUSE

1. Identify YOUR process by **project path**:
   - `run_command("ps aux | grep '<project-name>'")` → Find process with YOUR project path
   - `run_command("pkill -f '<project-path>'")` → Kill by path match

2. Retry starting the server

### Constraints

- ✅ Identify processes by **project path** (e.g., `/workspaces/.../project-name/`)
- ❌ **NEVER kill processes in `/ant/packages/ant-cli/`** (orchestrator)
- ❌ **Do NOT use port 8080** (orchestrator)
- ❌ **Do NOT match by port numbers** — match by project path




