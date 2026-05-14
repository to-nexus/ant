Execute a shell command. Long-running server commands are tested for startup then cleaned up.

📁 WORKING DIRECTORY:
- Default cwd = **feature root** (the directory containing `codebase/`, `plan/`, `architecture/`, `visual/`, `meta/`, `sessions/`)
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

⚠️ NON-TERMINATING PROCESSES — declare termination intent:
A command resolves only when its foreground process terminates. Open async handles (network connections, timers, watchers, unconsumed input/output streams) keep a process alive past the observable output. Without intent declaration, such processes are caught only by the default no-output watchdog after a long wait, producing a non-zero exit that misrepresents an otherwise valid operation.

For one-shot operations whose only purpose is producing observable output and then terminating, set `oneshot: true`. The system will reap the process shortly after the output settles, recovering from missing explicit termination in the embedded source.

Do NOT set `oneshot: true` on commands intended to keep running, to emit progress over a long compute, or to compute silently for tens of seconds. Use `keep_running: true` for long-running servers — these flags are mutually exclusive.

⚠️ SILENT-SLOW COMMANDS — prefer dedicated tools:
The watchdog terminates commands that produce no output for >60s. For codebase exploration, the following commands scale unpredictably and almost always hit the watchdog — use scoped tools instead:

- file search        → `search_code` / `list_files`                       (NOT `find` / `grep -r`)
- file content       → `read_file` (supports ranges)                       (NOT `cat <large>`)
- dependency lookup  → query the package manager for a specific package    (NOT a recursive dump of the whole graph)
- repo-wide history  → narrow with `-L <file>` or a path filter            (NOT a regex search over the entire repo)

If you genuinely need a shell traversal (e.g., counting matches), scope it tightly: pass a starting directory deeper than the workspace root, add `-maxdepth N` to `find`, or pipe into `| head` to bound output volume.
