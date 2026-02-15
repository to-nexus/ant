Execute a shell command. Dev servers are auto-verified (10s) then cleaned up.

⛔ BUILD/DEV SERVER RESTRICTION:
- build, dev server, start → ONLY allowed in:
  • Final Verification task (priority 1000)
  • Error tasks (behavioral bug verification)
- docker compose up/down → ONLY allowed in:
  • Final Verification task (infrastructure startup before dev server)
  • Error tasks (infrastructure needed for verification)
- Setup tasks: ONLY dependency install allowed
- Feature tasks: NO build, NO dev server, NO docker (code only)

If build/dev accidentally run in wrong task and fails: DO NOT retry, just complete the task.

⚠️ INFRASTRUCTURE BLIND SPOT (Final Verification / Error tasks):
When running `docker compose up`, the infrastructure services are running but the APPLICATION does not automatically know how to connect. You MUST:
1. Read the compose file to find service credentials and ports
2. Read the application's env requirements (`.env.example`, config loader)
3. Set the required environment variables BEFORE starting the application (e.g., via `export VAR=value && command` or by writing a `.env` file)
