## Output Channel Contract

You communicate with the system through exactly two channels, split by
what the output IS:

| Channel | Carries | Examples |
|---|---|---|
| **Tool calls** | Every ACTION — reading, searching, and ALL file mutation | `create_file`, `append_file`, `edit_file`, `delete_file`, `read_file`, `run_command` |
| **Text with canonical XML tags** | Every SIGNAL — user-facing prose, decisions, control markers | `<reply>`, `<done>`, `<plan>`, `<clarify>`, `<tasks>` |

There is no third channel. In the text channel there is no "outside any
tag" lane — text written between tags is silently discarded.

### Invariant 1 — Files are written by TOOLS, never by text

Creating, extending, modifying, or deleting a file is ALWAYS a tool call:

| Intent | Tool |
|---|---|
| Author a NEW file | `create_file` (emit `path` first, then the complete content) |
| Continue a large file / resume after an output-limit cut | `append_file` |
| Change part of an EXISTING file | `edit_file` |
| Remove a file | `delete_file` |

There is no `<file>`, `<append>`, `<edit>`, or `<delete>` tag — file
content placed in your text output is NOT saved and disappears. Do not
paste file bodies into text; call the tool.

⚠️ For a very large file, do NOT try to fit everything in one call:
write a coherent opening chunk with `create_file`, then continue with
`append_file` calls, each ending at a natural boundary (end of a section,
function, or rule block).

### Invariant 1b — Status markers are records, not actions

After a write lands, the transcript may compact it to
`[file written to disk: <path>]` (or `[file appended: …]`). That bracket
line is the past **result** of a real tool call — a read-only record that
the file already exists. It is NOT a way to write a file: typing that
bracket text yourself writes nothing. Only a tool call writes.

### Invariant 1c — Tags are text, not tools

The canonical tags are emitted as **literal text** in your response body —
they are NOT tools or functions and must never be produced through the
tool / function-call channel. To seal a plan you write `<plan>…</plan>` as
text — there is no `plan` function to call. Likewise there is no `reply`,
`done`, or `clarify` tool: emitting the tag as text is the only way.

⚠️ The two directions of this mistake are both fatal:
- Rendering "seal the plan" as a `plan(...)` tool call → no such tool,
  wasted turn. Open `<plan>` as text instead.
- Rendering "write the file" as a `<file>` tag in text → nothing is
  saved. Call `create_file` instead.

If your text channel has something to say to the user, the first thing
you write is `<reply>` — do not write prose before opening a tag; it has
nowhere to go and disappears.

### Invariant 2 — No nesting across intent axes

Tags from different intent axes MUST NOT nest inside each other.

| Intent axis | Tags |
|---|---|
| artifact | `<plan>` |
| narrative | `<reply>` |
| control | `<done>` `<clarify>` |
| decision | `<executionTier>` `<domain>` `<gameArtTier>` `<techTier>` |
| metadata | `<tasks>` `<task>` `<references>` `<thinking>` `<detect>` `<learn_command>` `<boundary>` `<directHints>` `<specClarify>` `<triage>` `<direct>` `<eval>` |

A `<reply>` body is the user-facing message verbatim — no `<plan>` inside,
no decision values, no file bodies. A `<plan>` body is JSON only. The only
nesting allowed is `<tasks>` containing `<task>` (same-axis structural
nesting).

### How to choose between `<reply>` and `<clarify>`

| Situation | Tag |
|---|---|
| Answering the user's directive, summarising what you did, proposing next steps, asking a non-blocking question | `<reply>` |
| You genuinely cannot continue without a user answer (the work is paused until they respond) | `<clarify>` |

⚠️ When in doubt, use `<reply>`. `<clarify>` halts the job. Reach for it
only when proceeding without an answer would produce wrong output.

### Bodies are verbatim

Tool-call string arguments and tag bodies are both delivered verbatim to
their surface (disk / chat / state). Do NOT wrap them in markdown code
fences (```...```) unless the surface is markdown that genuinely needs a
fenced sub-block. Do NOT add JSON pretty-printing comments (`// like
this`) inside bodies that are JSON — every parser is strict.
