Routing is **file-per-route**: each route is its own file and there is NO central route registry. This decides ownership per entry:

- **Per-unit entries are owned by the task that AUTHORS that unit, NOT the `integration` band**: each route file, including the root `/` route. The task that creates a unit creates AND wires its own route file in the SAME task — it does not leave a placeholder for a later task, and it does not wait for `integration` to mount it. A later restyle/ui task refines an existing unit; it does not re-create its route.
- **Host entries are owned by the `integration` band**: the shared frame (root composition / provider/host tree / global navigation). These mount no single unit.

Closure: because a per-unit route file is non-shared (no other task registers into it), a routable surface with no authoring task creating its route file is a dead, unreachable surface — the authoring task MUST close it.
