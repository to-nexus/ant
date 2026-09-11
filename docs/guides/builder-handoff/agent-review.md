# Handoff — agent-builder / review, performed offline

## What this is

The `review` intent of the shipped `agent-builder` judges a finished agent
definition against the material it was authored from and leaves one
deliverable: the review report. Run offline, in a fresh context, it is also
the independent review the same-session builtin cannot give — the reviewer has
not seen the author's reasoning. This file maps the intent's runtime channels
to a working tree; the contract is the intent's own prose, inlined as Part 2 of
this bundle.

## Read, in this order

Each path below is a `## FILE:` heading in Part 2, in this order — walk Part 2
from top to bottom and you have read the list. (A clone at the server's commit
keeps the same bytes at the same paths.) Read every file in full before
designing.

1. `packages/ant-cli/src/core/data/agents/agent-builder/base/role.md`
2. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/base/system.md`
3. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/job.yaml`
4. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/infer.md`
   — the criterion that selects this intent.
5. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/prompt.md`
   — the review procedure and the report skeleton, including the verdict and
   claim vocabularies and the `## Trace` table contract.
6. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/hooks.yaml`
7. `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/api-surface.md`
   — the route facts the authoring contract relies on.
8. `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/audit.md` —
   the definition-internal half of the review, run in full.
9. `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/definition-format.md`
   — the file contract you judge the definition against.
10. The standard you judge by, read rather than remembered — the build intent's
    own instructions. Its criterion and hook are listed so the read-list is the
    whole definition:
    `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/infer.md`,
    `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/prompt.md`,
    `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/hooks.yaml`.

## Working tree

No layout is prescribed. Work where the person says; when nobody says, make a
fresh folder OUTSIDE any Ant clone, so nothing you write lands in a git
working tree. Two names bind:

- **the report is `review-report/{agentId}.md`**, or its `-{mnemonic}`
  revision when a review from an earlier session was handed to you;
- **its Trace table's first column is the material path relative to the
  material folder's root**, so that column and a listing of the material folder
  compare line for line — that comparison is the coverage count you report, and
  `check-review` mechanises it for anyone holding a clone.

You were given four things, wherever the person put them: the definition under
review, the material it was authored from (the WHOLE folder), the authoring
report, and any earlier reviews. Write nothing back into them.

## Channel substitution table

"Same validator?" means the same server functions judge your work either way:
with a clone you run them yourself, without one the import runs them as it
accepts the folder. A cell that names a clone-only command says so.

| Runtime instruction (where in the prose) | Offline equivalent | Same validator? |
|---|---|---|
| the attached `_agents/{agentId}/…` files, `list_files _agents/{agentId}/`, `GET /definitions/agents/{agentId}/files`, `GET /definitions/agents/{agentId}/file?path=…` | `find <the definition> -type f` and read every file | n/a |
| `GET /definitions/agents` — which agent | the folder you were given | n/a |
| the attached material directory; "Enumerate before judging" with `list_files` | `find <the material> -name '*.md' \| sort` — that listing is the row floor; read every file, `deprecated/` included | that listing IS the check: your Trace table must have one row per line of it. With a clone, `check-review` diffs the two for you |
| the newest `dependency-report/{agentId}*.md` in artifacts | the newest `{agentId}*.md` among the authoring reports you were given; its absence is a finding, and every `claim` cell then reads `not-claimed` | n/a |
| `search_files` for the material's repeated headings ("Form coverage") | `grep -rh '^## ' <the material> \| sort \| uniq -c` | n/a |
| `create_file review-report/{agentId}.md` ("Write the review report") | write `review-report/{agentId}.md`; when a review from an earlier session was handed to you, write `{agentId}-{mnemonic}.md` instead | you are the checker: diff your Trace table's first column against the listing you made, and state the count. With a clone, `check-review` verifies that same coverage; the verdicts are yours either way |
| clarify — the definition or the material is not in hand | ask the person before writing; a review against memory is not a review | n/a |
| the already-read manifest / the authoring turn in session history | you have neither, which is the point: judge from the files | n/a |
| `read_ant_source`, `list_ant_files`, `search_ant_code` | nothing to substitute, and nothing you need: Part 2 is the whole standard you judge against. If you believe you need Ant's source, stop and say so rather than improvising (with a clone: `packages/ant-cli/src/**`, `docs/**`) | n/a |

## Bring it in

Upload `review-report/{agentId}.md` into the project's Artifacts panel under
`review-report/`. A later build turn in that project
(or the next reviewer) reads it from there.

## Done when

The builtin's `hooks.yaml` for this intent carries one stop hook,
`review-report/*.md`, with the default arm (always). Offline that is:

- `review-report/{agentId}.md` exists and follows the skeleton in
  `review/prompt.md`, and you have checked its invariant line yourself:
  `files without a row: 0`, by diffing the Trace table's first column against
  the material listing you made. That diff is the floor, and it needs no tools
  beyond the ones you already used;
- with a clone,
  `pnpm --filter @ant/cli definition check-review <the report> <the material>`
  exits `0` — the same coverage check, mechanised. Without a clone your own
  diff is the whole of it: nothing downstream re-runs it, so an uncounted row
  stays uncounted;
- your reply gives the counts, the verdict tally, the report's path and the
  findings that most change what the user does next.

Change nothing else: no edited definition, no "fixed" draft. Findings the
user wants applied are the build intent's next turn.

Nothing validates a review for you. The report goes into the Artifacts panel as
a file, and no loader reads it — so the coverage count you state is the only
check there is. Say plainly which rows you could not source rather than
rounding the count.

## Out of scope offline

Nothing this intent NEEDS is unavailable offline — the judgement is yours and
the standard is Part 2. Two things are still clone-only, and neither changes a
verdict: `check-review`, whose coverage check you perform by hand instead, and
`validate-agent`, which a review would run on the downloaded folder only to
record the loader's verdict as one more piece of evidence. Browsing Ant's own
source is unavailable and unnecessary. The API routes
`on-demand/api-surface.md` documents (`GET /definitions/agents/{agentId}/jobs/{jobId}/validate`
and the write routes) belong to the build intent.
