Execute a shell command. Long-running server commands are tested for startup then cleaned up.

📁 WORKING DIRECTORY:
- Default cwd = **feature root** (the directory containing `codebase/`, `inputs/`, `outputs/`)
- For language/build tools (`go`, `npm`, `pnpm`, `cargo`, `python`, etc.): set `working_directory` to `"codebase"`
- Do NOT use `cd codebase &&` inside the command — use the `working_directory` parameter instead
- Do NOT run `pwd` to discover the path — the working directory is always deterministic

⛔ BUILD RESTRICTION:
- build, start → ONLY allowed in:
  • Final Verification task (priority 1000)
  • Error tasks (behavioral bug verification)
- docker compose up/down → ONLY allowed in:
  • Final Verification task (infrastructure startup before build/test)
  • Error tasks (infrastructure needed for verification)
- Setup tasks: ONLY dependency install allowed
- Feature tasks: NO build, NO docker (code only)
- Test-code tasks: ONLY test-runner dependency install allowed. NO test execution, NO build.

If build accidentally run in wrong task and fails: DO NOT retry, just complete the task.

⚠️ INFRASTRUCTURE BLIND SPOT (Final Verification / Error tasks):
When running `docker compose up`, the infrastructure services are running but the APPLICATION does not automatically know how to connect. You MUST:
1. Read the compose file to find service credentials and ports
2. Read the application's env requirements (`.env.example`, config loader)
3. Set the required environment variables BEFORE starting the application (e.g., via `export VAR=value && command` or by writing a `.env` file)

⚠️ BLIND SPOT — file creation via shell:
File creation/overwrite (`cat >`, `echo >`, heredoc) tends to happen when executing multiple `run_command` calls in sequence. Prefer `<file>` tag for file creation — it provides streaming, proper encoding, and buffer synchronization that shell redirection does not.
