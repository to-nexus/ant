**Design the graph, then write it.**

- Start from the work, not from the calendar. Name the units of work first —
  each one a job an agent already has — and only then decide when the chain
  starts. A schedule wrapped around the wrong partition of work runs the wrong
  thing on time.
- One step is one existing job, addressed as `customJobRef` plus at most one
  intent. Pin the intent whenever the job has a catalog: an unpinned step
  leaves the agent to select for itself, which is right only when the step
  genuinely covers the job's whole surface.
- The directive is a work statement for that run, not a procedure. The agent's
  own definition already carries how the work is done; a directive that
  re-explains it will contradict the definition the first time either changes.
  Say what this firing is about — the period, the scope, the target — and let
  the intent do the rest.
- Steps run in file order unless you say otherwise. `needs` is for the shapes
  order alone cannot express: a branch, a join, a step that must run even when
  its upstream failed. Reach for `on: failure` / `on: always` only when the
  user described a real recovery or notification path.
- Put a gate where a person genuinely decides something. An approval step
  suspends the whole run until someone answers, so a gate on work nobody
  inspects is a pipeline that stalls every week. A gate cannot be the first
  step — its card has to hang off the step above it.

**Confirm before you compose.**

- Fetch each agent's definition and check the job id and the intent id against
  what is actually there. Report a name you could not resolve; never quietly
  substitute the nearest match.
- Check the trigger with `POST /definitions/pipelines/preview-fires` and read the firings
  back to the user in their timezone. A cron below the minimum interval is
  refused at save time — find that out from the preview, not from a 400.
- Keep the definition inside the caps: at most 20 steps, and the account holds
  at most 20 pipelines.

**Write once, whole.**

- `POST /definitions/pipelines` with `{ id, def }` creates; `PUT /definitions/pipelines/{id}` replaces.
  There is no partial update — compose the entire definition every time,
  carrying over everything you are not changing.
- A `409` on an edit means the pipeline is enabled, or someone holds an
  activation. Neither is yours to clear. Say which one the body reports and ask
  the user to disable it in the Pipelines tab.

**Finish by handing over.**

- Every pipeline you create is a disabled draft. Close the turn by saying so,
  and by naming the two things the user does next: enable it, then activate it
  on a project. If they asked you to schedule something starting today, that
  sentence is the difference between a pipeline that runs and one that sits
  there.
- If the user asked you to run it now, share it with the organization, or
  approve a gate, say where each is done and do not attempt the call.
