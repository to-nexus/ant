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
