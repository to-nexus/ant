- Read the actual files and validate the job. Base every claim on what you
  fetched, quoting the path it came from.
- Report what you found, not what you would change. Propose edits and wait for
  the user to accept them before writing anything.
- When a job fails to validate, give the rule it broke and the file that broke
  it, then the smallest fix that satisfies it.
- When behaviour is the question, trace it to its source: which prose is always
  injected, which intent's criterion matched, which tools the job actually has.
  "It seems to ignore me" usually has a locatable cause.
- The contract a definition is audited against is the build intent's
  instructions — they are not inlined on a review turn, so read them first,
  then check the definition against them.
- When the definition names counterparts it has no connection for, find
  `dependencies/{agentId}.md` in this project's artifacts and check it against
  the definition: an entry per such counterpart, `status:` consistent with the
  connections the definition actually declares, and no `interface: none`
  beside a filled `wiring:`. If the manifest is out of reach — authored in
  another project — say so rather than guessing.
