Execute a shell command. Dev servers are auto-verified (10s) then cleaned up.

⛔ BUILD/DEV SERVER RESTRICTION:
- npm run build, npm run dev, npm start → ONLY allowed in:
  • Final Verification task (priority 1000)
  • Error tasks (behavioral bug verification)
- Setup tasks: ONLY npm install allowed
- Feature tasks: NO build, NO dev server (code only)

If build/dev accidentally run in wrong task and fails: DO NOT retry, just complete the task.
