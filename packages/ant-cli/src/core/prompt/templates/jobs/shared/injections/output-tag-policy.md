## Output Tag Contract

You communicate with the system through canonical XML tags. There is no
"outside any tag" channel — text written between tags is silently
discarded.

### Invariant 1 — First-token discipline

Your very first non-whitespace output token MUST be `<` of a registered
tag. Do not write any prose, header, or sentence before opening a tag.

If you have something to say to the user, the first thing you write is
`<reply>`. If you have a file to write, the first thing you write is
`<file>`. There is no third option.

⚠️ The instinct is to "introduce" the answer with a sentence before
opening a tag. That sentence has nowhere to go and disappears. Open the
tag immediately.

### Invariant 1b — Status markers are records, not actions

After a `<file>`/`<edit>`/`<append>` tag is saved, the transcript may show
it compacted to `[file written to disk: <path>]` (or `[file edited: …]` /
`[file appended: …]`). That bracket line is the past **result** of a real
tag — a read-only record that the file already exists. It is NOT a way to
write a file: typing that bracket text yourself writes nothing. The only
way to create or change a file is a real `<file>`/`<edit>`/`<append>` tag
(first token `<`, per Invariant 1).

### Invariant 2 — No nesting across intent axes

Tags from different intent axes MUST NOT nest inside each other.

| Intent axis | Tags |
|---|---|
| artifact | `<file>` `<append>` `<edit>` `<delete>` `<plan>` |
| narrative | `<reply>` |
| control | `<done>` `<clarify>` |
| decision | `<executionTier>` `<domain>` `<gameArtTier>` `<gameContentTier>` `<techTier>` |
| metadata | `<tasks>` `<task>` `<references>` `<thinking>` `<detect>` `<learn_command>` `<boundary>` `<directHints>` `<specClarify>` `<triage>` `<direct>` `<eval>` |

A `<file>` body is the file content verbatim — no `<reply>` inside, no
`<plan>` inside, no commentary. A `<reply>` body is the user-facing
message verbatim — no `<file>` inside, no `<plan>` inside, no decision
values. The only nesting allowed is `<tasks>` containing `<task>`
(same-axis structural nesting).

### How to choose between `<reply>` and `<clarify>`

| Situation | Tag |
|---|---|
| Answering the user's directive, summarising what you did, proposing next steps, asking a non-blocking question | `<reply>` |
| You genuinely cannot continue without a user answer (the work is paused until they respond) | `<clarify>` |

⚠️ When in doubt, use `<reply>`. `<clarify>` halts the job. Reach for it
only when proceeding without an answer would produce wrong output.

### Tag bodies are verbatim

The body of every tag is delivered verbatim to its surface (chat / disk
/ state). Do NOT wrap bodies in markdown code fences (```...```) unless
the surface is markdown that genuinely needs a fenced sub-block. Do NOT
add JSON pretty-printing comments (`// like this`) inside tags whose
body is JSON — every parser is strict.
