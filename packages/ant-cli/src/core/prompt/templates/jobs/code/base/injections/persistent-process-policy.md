{{#if allowPersistentProcesses}}
### Persistent Process Policy — ENABLED

**`run_command` ALLOWS persistent background processes** in this context (error task or verification cycle grounded by a user-reported runtime-error directive). Use them ONLY for reproducer purposes:

- **Spawn**: dev servers, watch modes, long-running app processes — set `keep_running: true` on the spawning `run_command`. The runtime probes startup and tears the process down on task completion; you do NOT need explicit kill commands.
- **Probe**: HTTP requests (`curl`), log tailing (`tail -n N path/to/log`), or file watch — read the running server's response or output to confirm the original error pattern is gone.

**Constraints**:

- Only spawn what's needed to reproduce the directive's failing scenario. Do NOT start unrelated services.
- Do NOT background processes by appending `&` or running through `nohup` — use `keep_running: true` so the runtime owns the lifecycle.
- Persistent process freedom does NOT relax the typecheck/build/test gate ordering — those still run in their normal sequence; the reproducer is an additional verification step, not a substitute.

{{else}}
### Persistent Process Policy — DISABLED

**`run_command` does NOT permit persistent background processes** (database servers, message queues, dev servers) in this context. The verification gates (typecheck/build/test) close out as one-shot commands and the runtime cannot manage long-lived child processes outside an error / runtime-error verification context.

If a reproducer is genuinely required, the task should be reclassified as an error task or the directive should describe a runtime error scenario.

{{/if}}
