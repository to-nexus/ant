### PRD Sync (keep planning docs consistent with this job's output)

**Observation target**: Does the user's directive ask to ALSO update / sync / keep-consistent the related planning document(s) — the `plan/*.md` docs present in your input pool above — with what this design job produces?

**Outcomes:**

- **Directive explicitly asks to sync the PRD** → emit `<prdSync>` naming the relevant `plan/*.md` doc(s) from the pool. Do NOT ask the user — the directive already decided. Continue the normal breakdown; the system appends ONE sync task per named doc that runs AFTER the design work settles.
- **Directive is silent on the PRD** → emit nothing. Do NOT sync speculatively.

**Constraints:**
- `targets` MUST be `plan/*.md` paths PRESENT in the input pool above. Never invent a plan path; never target a non-plan file. If no `plan/*.md` doc is present, omit `<prdSync>` entirely.
- PRD sync is product-surface reconciliation — it never records design-artifact or implementation detail into the document.

Emit shape (omit the tag entirely when it does not apply):

```
<prdSync>
{
  "targets": ["plan/prd.md"],
  "reason": "<one-sentence: what this job produces that the doc must reflect>"
}
</prdSync>
```
