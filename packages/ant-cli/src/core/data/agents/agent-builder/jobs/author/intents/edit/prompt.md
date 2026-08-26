- Fetch the file before you change it. Save the whole file back — the write is
  a replacement, so anything you did not carry over is gone.
- Change what the user asked for and leave the rest of the file intact,
  including comments. An unrelated rewrite is a regression they did not ask for.
- A rename moves the directory and, for an agent, its data across projects. Use
  the rename endpoint; never simulate one by creating a copy and deleting the
  original.
- Deleting a structural file breaks the job that owns it. If a change means a
  file should go, say so and confirm before removing it.
- After any edit that touches yaml, prose, or intents, validate the job before
  reporting. A definition that saved cleanly can still fail to load.
