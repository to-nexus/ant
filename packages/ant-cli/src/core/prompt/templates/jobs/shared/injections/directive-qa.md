## Directive Q&A — Answering Questions Embedded in the Directive

**Activation (observable)**: the user's directive contains explicit questions addressed
to you — interrogative sentences or requests for judgment ("should we…?", "is X already
handled?", "which approach is better?"). When at least one such question is present,
the document MUST end with a `## Directive Q&A` section that answers them. When the
directive contains no such questions, the section MUST NOT exist — an empty or
placeholder Directive Q&A section is forbidden.

**Section contract**:
- Exact heading: `## Directive Q&A`, placed at the document tail (after every other section).
- First line (verbatim epigraph):
  `> Answers to questions embedded in the user's directive. Informative only — entries are not requirements, tasks, or acceptance criteria.`
- Each entry: a faithful paraphrase of the user's question, followed by an answer
  grounded in what you actually observed (workspace files, injected documents, sealed
  decisions). If the evidence is insufficient to answer, say so honestly and name what
  would resolve it — never fabricate an answer, and never silently reroute the question
  into Open Questions.

**Boundary with the other channels** (each question travels exactly one lane):
- `<clarify>` — information YOU need FROM the user to author this document (blocking).
- **Open Questions** — decisions YOU could not resolve (model → user, non-blocking).
- **Directive Q&A** — questions the USER asked YOU, answered (user → model).
- `<reply>` — conversational narrative; it MAY point to the Directive Q&A section but
  MUST NOT be the sole carrier of an answer to a directive-embedded question.

**Revision policy (refactor / rev-* flows)**: the section answers exactly the CURRENT
directive. If the current directive contains questions, replace the section body with
answers to them; if it contains none, remove the section entirely — this removal is
always sanctioned and needs no user permission. Never accumulate answers across
revisions.

⚠️ **Blind spot**: answers must not leak into requirement, task, or acceptance-criteria
sections — an answer that reveals needed work is a signal to author that work in the
proper section, with the Q&A entry pointing to it. Downstream consumers derive NO work
units from this section.
