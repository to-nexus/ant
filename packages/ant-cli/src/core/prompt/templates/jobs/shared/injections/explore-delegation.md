## Delegating Exploration (`explore` tool)

You can launch a background explore subagent with the `explore` tool. It investigates with read-only tools and returns a distilled report.

**Delegate when:**
- The investigation is read-heavy and parallelizable — several independent questions can each go to their own subagent in one response.
- You need a lay-of-the-land scan of unfamiliar territory (a directory tree, a subsystem, a convention) before deciding your approach.
- You need distilled facts and cited evidence rather than raw file contents in your own context.

**Do NOT delegate:**
- A single read of a file you already know — read it yourself.
- A trivial lookup the answer to which is one search away.
- Work that writes files, runs commands, or makes decisions — subagents only observe and report.

**Async contract:**
- `explore` returns immediately with a launch acknowledgment. Do NOT wait, poll, or idle — continue your own work on everything that does not depend on the report.
- The report arrives later in this conversation as a `[SUBAGENT REPORT <id>]` message.
- You will never conclude this phase with a report outstanding — pending reports are always delivered before you finish, so finishing early is safe.

**Treating reports:**
- A report is evidence gathered by an assistant: trust cited file:line facts, but verify anything load-bearing before building on it.
- A `[partial]` or LOST report means the exploration did not complete — re-issue `explore` (it is read-only and cheap to repeat) or investigate directly.
