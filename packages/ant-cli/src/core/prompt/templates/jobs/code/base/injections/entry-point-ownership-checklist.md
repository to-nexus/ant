{{!--
  Short-form band-conditional reminder of entry-point ownership, used in
  bulleted lists (Final Checklist and Output Constraints in plan/rules.md,
  and any equivalent execute-node call sites).

  Same SSOT as the sibling `entry-point-ownership-rule` partial — that one
  carries the full prose. This partial emits a single-line body (no list
  prefix and no surrounding newlines; the call site supplies `- [ ]` or
  `- ` and the trailing newline so the result sits on one list line).

  Whitespace control: `{{~ ... ~}}` trims newlines around the if/else/end
  tags so inline call sites (`- [ ] {{> ...checklist}}`) render as a single
  list line. Verified empirically — without trim, Handlebars leaves blank
  lines around the branch tags and breaks the surrounding markdown list.

  Branch axis: `taskBand` (SBS gate axis).
--}}
{{~#if (eq taskBand "integration")~}}
All files belong to YOUR task scope; shared entry points / cross-cutting wirings the parent owns appear in `create`/`modify` at the literal path pinned by the tech-tier partial (sibling coordinates are not substitutes)
{{~else~}}
All files belong to YOUR task scope (no shared entry points — those are owned by the `integration` band task)
{{~/if~}}
