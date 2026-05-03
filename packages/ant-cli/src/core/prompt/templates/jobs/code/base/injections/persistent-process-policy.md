{{#if allowPersistentProcesses}}
### Persistent Process Policy — ENABLED

**`run_command` allows long-running background processes** in this context (error task or verification cycle grounded by a runtime-error directive). Use them ONLY to reproduce or probe the directive's failing scenario.

#### The single rule

> **You start it. You stop it. Before `<done>`.**

Every dev server, watcher, or other long-lived process you spawn with `keep_running: true` is YOUR responsibility to terminate inside the same task. The runtime *will* sweep survivors as a safety net, but emitting `<done>` while a process you started is still alive is a contract violation — it leaks resources and blocks the next preview restart with "Another dev server is already running".

#### How to apply the rule (FPOP / MECE / SBS)

| Step | Action | Tool call |
|------|--------|-----------|
| 1 | **Spawn** the process | `run_command` with `keep_running: true` (e.g. `npm run dev`) |
| 2 | **Probe** the running process to confirm the failing scenario reproduces or the fix works | `run_command` (`curl ...`, `tail -n N path/to/log`, etc.) |
| 3 | **Stop** every process you spawned in step 1 | `run_command` with `kill <pid>` or the framework's stop command. Use the PID returned by step 1. |
| 4 | **Verify** no spawned process is still alive (only when more than one was spawned, to guard against partial cleanup) | `run_command` with `pgrep -f next` or equivalent — expect empty output |
| 5 | **Emit `<done>`** only after step 3 (and step 4 if applicable) succeeds | `<done>true</done>` |

The five steps are **mutually exclusive** (each does one thing) and **collectively exhaust** the lifecycle (no step left to the runtime). Skipping step 3 to "let the runtime handle it" is **never** the correct choice — the runtime sweep is a defense-in-depth net, not your cleanup pass.

#### Constraints

- Spawn ONLY what's needed to reproduce the directive's failing scenario. Do NOT start unrelated services.
- Do NOT background processes by appending `&` or running through `nohup` — use `keep_running: true` so the runtime knows about the PID and can act as the safety net described above.
- Persistent process freedom does NOT relax the typecheck/build/test gate ordering — those still run in their normal sequence; the reproducer is an additional verification step, not a substitute.
- The kill in step 3 must target the PID returned by the spawning `run_command` (it is surfaced in that command's output). Killing by port number works too — `lsof -ti :PORT | xargs kill` — but the PID-based form is preferred because it survives port reallocation.

{{else}}
### Persistent Process Policy — DISABLED

**`run_command` does NOT permit persistent background processes** (database servers, message queues, dev servers) in this context. The verification gates (typecheck/build/test) close out as one-shot commands and the runtime cannot manage long-lived child processes outside an error / runtime-error verification context.

If a reproducer is genuinely required, the task should be reclassified as an error task or the directive should describe a runtime error scenario.

{{/if}}
