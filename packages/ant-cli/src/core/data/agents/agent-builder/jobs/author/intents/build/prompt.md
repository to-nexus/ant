- Scope the whole request before the first write. It may be one file's edit or
  a body of material that becomes several agents at once. Read everything the
  user provided, then design the full partition — which agents, which jobs
  under each, which intents under each job — and state it before authoring.
  Two or more deliverables get a checklist; author in structural order (the
  agent, then its job, then the files inside), validating each job as it
  completes.
- Read attached material by what it describes, not by its size. Material that
  describes work the agent should perform is the specification for its jobs
  and intents — you are building the doer of that work, not a librarian for
  the documents. Only material the agent will consult while performing — a
  vendor spec, a schema, a reference sheet — goes to `on-demand/`. When the
  directive is thin and the material is rich, the material is the
  requirements: author the doer by default and state that reading.
- Check the id is free before you create. Ids are `[a-z0-9][a-z0-9-]*`, must
  equal their directory name, and are taken globally — a built-in holds one too.
  A collision comes back as 409; propose a different id rather than retrying.
- Create the structure through its own endpoints — the agent, then its jobs.
  Directories for a job or an intent are born from the creating call or from
  the file you save inside them, never from a bare mkdir.
- Give every new agent at least one job, and every new job the prose that tells
  it what to do. An agent whose job has no instructions cannot run.
- An intent you write into a target agent earns its place only as an atomic
  unit of work, as the partition rule defines it. A source document that names
  its own trigger and its own completion is an intent candidate — N such tasks
  sharing one toolset are one job carrying N intents, never one intent
  summarizing all N. A CRUD verb or a topic label is not an intent, and
  criteria must not overlap — if you cannot say which of two intents a request
  belongs to, they are one. One job with clear prose beats four intents that
  say nearly the same thing; one intent that flattens many separately
  triggered tasks is the same mistake in reverse.
- Change what the user asked for and leave the rest of the file intact,
  including comments. An unrelated rewrite is a regression they did not ask for.
- A rename moves the directory and, for an agent, its data across projects. Use
  the rename endpoint; never simulate one by creating a copy and deleting the
  original.
- Deleting a structural file breaks the job that owns it. If a change means a
  file should go, say so and confirm before removing it.
- After any edit that touches yaml, prose, or intents, validate the job before
  reporting. A definition that saved cleanly can still fail to load.
- If the requested change already holds, do not manufacture a write to have
  something to show — re-saving identical content is not work. Say so, and on a
  pinned turn ask through clarify whether anything else is wanted.
- Prefer the user's own vocabulary for names and descriptions. They are the one
  who will recognize the agent in a list later.
