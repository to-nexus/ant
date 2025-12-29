Execute a shell command. Supports both build commands and server verification.

For servers (npm start, npm run dev, etc.):
- Starts the server and monitors for 10 seconds
- If no errors during startup, returns success
- Automatically terminates after verification (default)
- If you need the server to stay up temporarily for testing, pass keep_running=true
- Any keep_running=true servers will be cleaned up automatically when the task completes
- Use this to verify "does the fix work?" without hanging

⚠️ CRITICAL: Port Management Rules
1. Find ACTUAL running processes and ports first:
   run_command("lsof -i -P -n | grep LISTEN")
   → Shows all listening ports with process names
2. Identify YOUR project's server (check process name/path)
3. Kill ONLY that specific port OR kill by process name
4. NEVER kill port 4100 (Ant orchestrator) or other unknown ports

Example workflow:
1. run_command("lsof -i -P -n | grep LISTEN")  → See what's running
2. Identify your server's port (e.g., node on 3000)
3. ONLY kill THAT port: lsof -ti:3000 | xargs kill -9
   OR kill by process: pkill -f 'packages/backend'
4. DO NOT kill any other port numbers

Examples:
- npm install, npm run build, npm test (runs to completion)
- npm start, npm run dev (verifies startup, then terminates)
- lsof -i -P -n | grep LISTEN (check running ports)
- lsof -ti:3000 | xargs kill -9 (after verifying port)
- pkill -f 'packages/backend' (kill by process path - safer)


