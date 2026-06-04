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
You own app-shell + registry entries (shared frame: root layout / provider tree / global nav; central route table / DI container) at the literal app-shell path pinned by the tech-tier partial (sibling coordinates are not substitutes); a per-screen route that mounts ONE screen is NOT yours (it belongs to that screen's author); mount platform-provided services, do not author them
{{~else if (eq taskBand "platform")~}}
You own a shared runtime service consumed by many features: define its access contract AND its producer here (contract + implementation) so consumers bind instead of hand-constructing; app-shell/registry mounting belongs to the integration band
{{~else if (eq taskBand "foundation")~}}
You own pure contracts (types/interfaces) only — shared runtime services/state belong to the `platform` band, app-shell/registry entries to the `integration` band
{{~else~}}
All files belong to YOUR task scope{{#if (eq entryPointTopology "file-per-route")}}, including the per-screen route file that mounts a screen you author — create AND wire it in the same task, never leave a placeholder{{/if}} (app-shell frame / central registry are NOT yours — those are the `integration` band's); obtain any shared runtime value from its `platform` access contract, never hand-construct it with empty/placeholder fields to satisfy a type
{{~/if~}}
