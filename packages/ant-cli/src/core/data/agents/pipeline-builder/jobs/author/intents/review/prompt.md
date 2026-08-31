- Read the actual definition and resolve its steps. Base every claim on what
  you fetched, quoting the pipeline id and step id it came from.
- Report what you found, not what you would change. Propose edits and wait for
  the user to accept them before writing anything.
- Trace the schedule through the preview endpoint rather than reading the cron
  aloud. "Every weekday at 09:00" and the five firings the server returns are
  different kinds of claim, and only the second one is checkable.
- Resolve every `customJobRef` and pinned intent against its agent. A step
  pointing at a job or intent that no longer exists is the most common reason a
  chain dies on its first firing, and nothing in the definition itself shows it.
- Walk the graph the way the executor does: a step with no `needs` follows the
  previous step in file order, a step becomes ready when all of its needs are
  terminal, and a condition that does not match SKIPS the step — with the skip
  cascading to everything downstream. Most "it silently did nothing" reports
  are a skip cascade from one `on: success` edge above a failure.
- When a gate never clears, say which step it hangs off, whether it has a
  timeout, and what that timeout decides. A gate with no timeout waits
  indefinitely by design.
- When the question is whether it will run at all, check the state, not the
  definition: a pipeline that is disabled, or enabled but activated on no
  project, is correct YAML that will never fire.
