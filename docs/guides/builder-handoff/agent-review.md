# Handoff — agent-builder / review, performed offline

## What this is

The `review` intent of the shipped `agent-builder` judges a finished agent
definition against the material it was authored from and leaves one
deliverable: the review report. Run offline, in a fresh context, it is also
the independent review the same-session builtin cannot give — the reviewer has
not seen the author's reasoning. This file maps the intent's runtime channels
to a working tree; the contract is the intent's own prose.

## Read, in this order

1. `packages/ant-cli/src/core/data/agents/agent-builder/base/role.md`
2. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/base/system.md`
3. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/job.yaml`
4. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/infer.md`
   and `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/prompt.md`
   — the review procedure and the report skeleton, including the verdict and
   claim vocabularies and the `## Trace` table contract.
5. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/hooks.yaml`
6. `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/audit.md` —
   the definition-internal half of the review, run in full.
7. The standard you judge against, read rather than remembered:
   `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/prompt.md`,
   with `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/definition-format.md`
   and `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/api-surface.md`
   for the file and route facts it relies on.
8. Not needed for a review, listed so the read-list is the whole definition:
   `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/infer.md`,
   `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/hooks.yaml`.

## Working tree

```
in/agents/{agentId}/…                         the definition under review (downloaded zip, or the clone for a builtin)
in/artifacts/dependency-report/{agentId}*.md  the authoring report(s); legacy dependencies/{agentId}.md
in/artifacts/review-report/{agentId}*.md      earlier reviews, when any
in/material/…                                 the material the definition was authored from — the WHOLE folder
out/artifacts/review-report/{agentId}.md      the deliverable
```

## Channel substitution table

| Runtime instruction (where in the prose) | Offline equivalent | Same validator? |
|---|---|---|
| the attached `_agents/{agentId}/…` files, `list_files _agents/{agentId}/`, `GET /definitions/agents/{agentId}/files`, `GET /definitions/agents/{agentId}/file?path=…` | `find in/agents/{agentId} -type f` and read every file | n/a |
| `GET /definitions/agents` — which agent | the folder you were given | n/a |
| the attached material directory; "Enumerate before judging" with `list_files` | `find in/material -name '*.md' \| sort` — that listing is the row floor; read every file, `deprecated/` included | yes — `check-review` diffs the table against it |
| the newest `dependency-report/{agentId}*.md` in artifacts | `ls -t in/artifacts/dependency-report/{agentId}*.md \| head -1`; its absence is a finding, and every `claim` cell then reads `not-claimed` | n/a |
| `search_files` for the material's repeated headings ("Form coverage") | `grep -rh '^## ' in/material \| sort \| uniq -c` | n/a |
| `create_file review-report/{agentId}.md` ("Write the review report") | write `out/artifacts/review-report/{agentId}.md`; when `in/artifacts/review-report/{agentId}*.md` exists from an earlier session, write `{agentId}-{mnemonic}.md` instead | partly — `check-review` verifies the Trace table's coverage; the verdicts are yours |
| clarify — the definition or the material is not in hand | ask the person before writing; a review against memory is not a review | n/a |
| the already-read manifest / the authoring turn in session history | you have neither, which is the point: judge from the files | n/a |
| `read_ant_source`, `list_ant_files`, `search_ant_code` | the clone | n/a |

## Bring it in

Upload `out/artifacts/review-report/{agentId}.md` into the project's
Artifacts panel under `review-report/`. A later build turn in that project
(or the next reviewer) reads it from there.

## Done when

The builtin's `hooks.yaml` for this intent carries one stop hook,
`review-report/*.md`, with the default arm (always). Offline that is:

- `out/artifacts/review-report/{agentId}.md` exists and follows the skeleton
  in `review/prompt.md` — the invariant line reads `files without a row: 0`;
- `pnpm --filter @ant/cli definition check-review out/artifacts/review-report/{agentId}.md in/material`
  exits `0` (every material file has a row, every row names a file);
- your reply gives the counts, the verdict tally, the report's path and the
  findings that most change what the user does next.

Change nothing else: no edited definition, no "fixed" draft. Findings the
user wants applied are the build intent's next turn.

## Out of scope offline

Nothing this intent uses is unavailable offline. The API routes the
definition's `on-demand/api-surface.md` documents (`GET /definitions/agents/{agentId}/jobs/{jobId}/validate`
and the write routes) belong to the build intent; a review runs
`validate-agent` on the downloaded folder only to record the loader's verdict
as evidence.
