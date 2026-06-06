{{#if allowPersistentProcesses}}
### Persistent Process Policy — ENABLED

**`run_command` allows long-running background processes** in this context (an error task, a runtime-error directive, or a verification / self-verify RCA cycle). Use them ONLY to reproduce or probe a route/runtime-shaped failure surfaced by your gates or the directive — not to start unrelated services.

#### The single rule

> **You start it. You stop it. Before `<done>`.**

Every dev server, watcher, or other long-lived process you spawn with `keep_running: true` is YOUR responsibility to terminate inside the same task. The runtime *will* sweep survivors as a safety net, but emitting `<done>` while a process you started is still alive is a contract violation — it leaks resources and blocks the next preview restart with "Another dev server is already running".

#### How to apply the rule (FPOP / MECE / SBS)

| Step | Action | Tool call |
|------|--------|-----------|
| 1 | **Spawn** the process | `run_command` with `keep_running: true` (e.g. `npm run dev`). The result reports `server_pid` and `server_url` — note both. |
| 2 | **Probe** the running server to confirm the failing scenario reproduces or the fix works | `http_request` against the failing route (it auto-targets the running server's port, so you need not know it). For log/process inspection use `run_command` (`tail -n N path/to/log`, etc.). |
| 3 | **Stop** every process you spawned in step 1 | `run_command` with `kill <server_pid>` (the PID reported by step 1) or the framework's stop command. |
| 4 | **Verify** no spawned process is still alive (only when more than one was spawned, to guard against partial cleanup) | `run_command` with `pgrep -f next` or equivalent — expect empty output |
| 5 | **Emit `<done>`** only after step 3 (and step 4 if applicable) succeeds | `<done>true</done>` |

The five steps are **mutually exclusive** (each does one thing) and **collectively exhaust** the lifecycle (no step left to the runtime). Skipping step 3 to "let the runtime handle it" is **never** the correct choice — the runtime sweep is a defense-in-depth net, not your cleanup pass.

#### Constraints

- Spawn ONLY what's needed to reproduce the failing scenario. Do NOT start unrelated services.
- Probe ONLY routes that execute server code — API routes, server-rendered pages, server actions. A 200 from a client-rendered (CSR) shell proves nothing about whether the page renders; an HTTP probe never runs the page's JavaScript. Do NOT treat a shell 200 as evidence the page works.
- Do NOT background processes by appending `&` or running through `nohup` — use `keep_running: true` so the runtime knows about the PID and can act as the safety net described above.
- Persistent process freedom does NOT relax the typecheck/build/test gate ordering — those still run in their normal sequence; the reproducer is an additional verification step, not a substitute.
- The kill in step 3 must target the PID returned by the spawning `run_command` (it is surfaced in that command's output). Killing by port number works too — `lsof -ti :PORT | xargs kill` — but the PID-based form is preferred because it survives port reallocation.

{{else}}
### Persistent Process Policy — DISABLED

**`run_command` does NOT permit persistent background processes** (database servers, message queues, dev servers) in this context. This is an apply phase (applying fixes / writing code), not a reproduction context — the runtime manages long-lived child processes only inside an error task, a runtime-error-grounded context, or a verification / self-verify RCA cycle. The verification gates (typecheck/build/test) the following cycle runs close out as one-shot commands.

A bounded boot smoke check is still available everywhere via `run_command` with `keep_running: false` (the default): it spawns the server, waits the startup window, probes `/` once, and auto-kills. If a persistent reproducer is genuinely required, defer it to the verification cycle.

{{/if}}
