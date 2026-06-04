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

  FPOP: universal vocabulary only (host entry / per-unit entry / unit) — the
  framework-specific physical form lives in the tech-tier partial.

  Branch axis: `taskBand` (SBS gate axis).
--}}
{{~#if (eq taskBand "integration")~}}
You own host entries (the shared frame: the framework's root composition; and any central registry/wiring many units register into) at the literal host-entry path pinned by the tech-tier partial (sibling coordinates are not substitutes); a per-unit entry that serves ONE unit is NOT yours (it belongs to that unit's author); mount platform-provided services, do not author them
{{~else if (eq taskBand "platform")~}}
You own a shared runtime service consumed by many features: define its access contract AND its producer here (contract + implementation) so consumers bind instead of hand-constructing; host-entry mounting belongs to the integration band
{{~else if (eq taskBand "foundation")~}}
You own pure contracts (types/interfaces) only — shared runtime services/state belong to the `platform` band, host entries to the `integration` band
{{~else~}}
All files belong to YOUR task scope; your tech-tier partial pins whether a unit you author also owns its own per-unit entry (create AND wire it in the same task, never a placeholder) or registers into a host entry the `integration` band owns — follow it (the shared frame / central registry are NOT yours); obtain any shared runtime value from its `platform` access contract, never hand-construct it with empty/placeholder fields to satisfy a type
{{~/if~}}
